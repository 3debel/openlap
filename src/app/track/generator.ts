/**
 * Automatische Streckenerstellung.
 *
 * Ablauf je Versuch:
 *  1. Anfang der Strecke nach dem Profil der Schwierigkeit zusammenwürfeln
 *     (Geraden, Kurven, Weichen am Ende von Geraden).
 *  2. Nach jedem Teil prüfen, ob eine kurze Teilefolge aus einer vorab
 *     berechneten Tabelle die Strecke exakt zum Start zurückführt.
 *  3. Geschlossene Strecke prüfen: Grundfläche, Überschneidungen,
 *     Höhenprofil (Brücken/Rampen), Bestand, Mindestzahl Spurwechsel.
 *  4. Schwierigkeit bewerten und die besten Vorschläge auswählen.
 *
 * Schwierigkeit (angelehnt an gängige Slotcar-Planungsregeln):
 *  - leicht: weite Radien, Steilkurven, wenig Richtungswechsel (oval-artig)
 *  - mittel: Mischung der Radien, einzelne S-Kurven
 *  - schwer: viele enge Kurven (Radius 1), Haarnadeln, S-Kurven/Schikanen,
 *            lange Gerade direkt in enge Kurve, sich ändernde Radien
 */

import { PARTS, Part, TRACK_WIDTH } from './catalog';
import { Dir, Pose, Sample, crossingAngle, normalizeHeading, pieceLength, place, relative, samplePiece } from './geometry';

export type Difficulty = 'easy' | 'medium' | 'hard';
export type Levels = 1 | 2 | 3;

export interface GeneratorOptions {
  /** Grundfläche in mm */
  areaWidth: number;
  areaDepth: number;
  levels: Levels;
  minLaneChanges: number;
  difficulty: Difficulty;
  /** verfügbare Stückzahl je Teil (Infinity = unbegrenzt) */
  counts: Record<string, number>;
  maxResults?: number;
  timeBudgetMs?: number;
  seed?: number;
}

export interface PlacedPiece {
  partId: string;
  dir: Dir;
  start: Pose;
  end: Pose;
  length: number;
  /** Höhe (Ebenen ab 0) am Anfang und Ende des Teils */
  h0: number;
  h1: number;
}

export interface Layout {
  pieces: PlacedPiece[];
  areaWidth: number;
  areaDepth: number;
  length: number;
  laneChanges: number;
  crossings: number;
  levelsUsed: number;
  supports: number;
  difficultyScore: number;
  difficulty: Difficulty;
  partCounts: Record<string, number>;
}

export interface GeneratorResult {
  layouts: Layout[];
  attempts: number;
  /** Hinweise, warum Wünsche nicht (ganz) erfüllt werden konnten */
  warnings: string[];
}

// ---------------------------------------------------------------- Konstanten

/** Abstand Fahrbahnrand bis Rand der Grundfläche (Randstreifen/Leitplanke) */
const EDGE_MARGIN = 40;
/** Rampenlänge je Ebene (≈ halbe Überfahrt 20587: 2 Standardgeraden) */
export const RAMP_PER_LEVEL = 690;
const CLOSE_TOL = 6;      // mm
const KEY_Q = 8;          // mm Raster der Schließ-Tabelle
const MIN_CROSS_ANGLE = 45;
const CONFLICT_DIST = TRACK_WIDTH - 2;
const SAMPLE_STEP = 30;
/** Punkte, die entlang der Strecke näher liegen, gelten als Nachbarn (keine Überschneidung) */
const NEIGHBOR_ALONG = 400;

export const DIFFICULTY_BANDS: Record<Difficulty, [number, number]> = {
  easy: [0, 0.3],
  medium: [0.3, 0.55],
  hard: [0.55, 1],
};

interface Profile {
  straightProb: number;
  straightRun: [number, number];
  radiusWeight: Record<number, number>;
  bankedPref: number;
  sameDir: number;
  corners: number[];
  hairpin: number;
  longStraightIntoTight: number;
  radiusChange: number;
}

const PROFILES: Record<Difficulty, Profile> = {
  easy: {
    straightProb: 0.65, straightRun: [1, 4],
    radiusWeight: { 300: 0.1, 500: 0.45, 700: 0.3, 900: 0.15 },
    bankedPref: 0.6, sameDir: 0.9, corners: [90, 180, 180, 120],
    hairpin: 0, longStraightIntoTight: 0, radiusChange: 0,
  },
  medium: {
    straightProb: 0.5, straightRun: [1, 3],
    radiusWeight: { 300: 0.4, 500: 0.35, 700: 0.18, 900: 0.07 },
    bankedPref: 0.3, sameDir: 0.65, corners: [60, 90, 120, 180],
    hairpin: 0.1, longStraightIntoTight: 0.2, radiusChange: 0.15,
  },
  hard: {
    straightProb: 0.4, straightRun: [0, 3],
    radiusWeight: { 300: 0.7, 500: 0.22, 700: 0.06, 900: 0.02 },
    bankedPref: 0.05, sameDir: 0.45, corners: [30, 60, 90, 180],
    hairpin: 0.35, longStraightIntoTight: 0.45, radiusChange: 0.35,
  },
};

// ---------------------------------------------------------------- Hilfen

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PART_BY_ID = new Map(PARTS.map(p => [p.id, p]));

const STRAIGHT_IDS = ['20020509', '20020611', '20020612'];
const STANDARD = '20020509';
const CONNECTION = 'connection-straight';
const LANE_CHANGE_IDS = ['20030343', '20030345', '20030347'];

function isCurve(p: Part) {
  return p.geometry.kind === 'curve';
}

function isBanked(p: Part) {
  return p.feature === 'banked';
}

function radiusOf(p: Part): number {
  return p.geometry.kind === 'curve' ? p.geometry.radius : 0;
}

interface Move {
  partId: string;
  dir: Dir;
}

/** Abtastpunkte eines Teils relativ zum Ursprung – werden je Lage nur verschoben/gedreht. */
const SAMPLE_CACHE = new Map<string, Sample[]>();
function relSamples(partId: string, dir: Dir): Sample[] {
  const key = partId + '|' + dir;
  let s = SAMPLE_CACHE.get(key);
  if (!s) {
    const part = PART_BY_ID.get(partId)!;
    s = samplePiece({ x: 0, y: 0, heading: 0 }, part.geometry, dir, SAMPLE_STEP);
    SAMPLE_CACHE.set(key, s);
  }
  return s;
}

function transformSamples(p: Pose, rel: Sample[]): Sample[] {
  const t = (p.heading * Math.PI) / 180;
  const c = Math.cos(t), s = Math.sin(t);
  return rel.map(q => ({
    x: p.x + q.x * c - q.y * s,
    y: p.y + q.x * s + q.y * c,
    heading: normalizeHeading(p.heading + q.heading),
    s: q.s,
  }));
}

function geometryOf(partId: string) {
  return PART_BY_ID.get(partId)!.geometry;
}

function headingDiff(a: number, b: number) {
  const d = Math.abs(normalizeHeading(a) - normalizeHeading(b));
  return Math.min(d, 360 - d);
}

// ---------------------------------------------------------------- Prüfungen

interface Crossing {
  a: number; // globale Position (mm) auf der Strecke
  b: number;
}

interface Analysis {
  ok: boolean;
  crossings: Crossing[];
}

/** Überschneidungen der ganzen Strecke prüfen (Teil i und j nicht benachbart). */
function analyzeConflicts(seq: { samples: Sample[]; offset: number }[], allowCrossings: boolean, total: number): Analysis {
  const cell = 220;
  const grid = new Map<string, { piece: number; q: Sample; g: number }[]>();
  const n = seq.length;
  const crossings: Crossing[] = [];
  for (let i = 0; i < n; i++) {
    for (const q of seq[i].samples) {
      const cx = Math.floor(q.x / cell), cy = Math.floor(q.y / cell);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const list = grid.get(`${cx + ox},${cy + oy}`);
          if (!list) continue;
          for (const o of list) {
            if (cyclicDist(o.g, seq[i].offset + q.s, total) < NEIGHBOR_ALONG) continue;
            if (Math.hypot(o.q.x - q.x, o.q.y - q.y) >= CONFLICT_DIST) continue;
            if (!allowCrossings) return { ok: false, crossings };
            if (crossingAngle(o.q.heading, q.heading) < MIN_CROSS_ANGLE) return { ok: false, crossings };
            const ga = o.g, gb = seq[i].offset + q.s;
            if (!crossings.some(c => Math.abs(c.a - ga) < 450 && Math.abs(c.b - gb) < 450)) {
              crossings.push({ a: ga, b: gb });
            }
          }
        }
      }
    }
    for (const q of seq[i].samples) {
      const k = `${Math.floor(q.x / cell)},${Math.floor(q.y / cell)}`;
      let list = grid.get(k);
      if (!list) {
        list = [];
        grid.set(k, list);
      }
      list.push({ piece: i, q, g: seq[i].offset + q.s });
    }
  }
  return { ok: true, crossings };
}

interface Box { minX: number; maxX: number; minY: number; maxY: number; }

function outerBox(samples: Sample[], box: Box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }): Box {
  const half = TRACK_WIDTH / 2 + EDGE_MARGIN;
  for (const q of samples) {
    const t = (q.heading * Math.PI) / 180;
    const nx = -Math.sin(t) * half, ny = Math.cos(t) * half;
    box.minX = Math.min(box.minX, q.x + nx, q.x - nx);
    box.maxX = Math.max(box.maxX, q.x + nx, q.x - nx);
    box.minY = Math.min(box.minY, q.y + ny, q.y - ny);
    box.maxY = Math.max(box.maxY, q.y + ny, q.y - ny);
  }
  return box;
}

function fits(box: Box, w: number, d: number): 'normal' | 'rotated' | null {
  const bw = box.maxX - box.minX, bh = box.maxY - box.minY;
  if (bw <= w && bh <= d) return 'normal';
  if (bw <= d && bh <= w) return 'rotated';
  return null;
}

// ---------------------------------------------------------------- Höhenprofil

interface HeightResult {
  /** Höhe an jeder Teilgrenze (Index i = Anfang von Teil i) */
  joints: number[];
  maxHeight: number;
}

function cyclicDist(a: number, b: number, total: number) {
  const d = Math.abs(a - b) % total;
  return Math.min(d, total - d);
}

/**
 * Höhen so wählen, dass an jeder Kreuzung ein Teil mindestens eine Ebene
 * über dem anderen liegt; Steigung höchstens 1 Ebene je RAMP_PER_LEVEL.
 * Steilkurven bleiben eben.
 */
function solveHeights(crossings: Crossing[], offsets: number[], total: number, banked: boolean[], levels: Levels): HeightResult | null {
  if (crossings.length === 0) {
    return { joints: offsets.map(() => 0), maxHeight: 0 };
  }
  // Drei Ebenen nur mit echter Zwischenebene (2 über 1), nicht als hohe Brücke über 0
  const pairs: [number, number][] = levels === 3 ? [[1, 0], [2, 1]] : [[1, 0]];
  const options: { over: number; under: number; hOver: number; hUnder: number }[][] = crossings.map(c => {
    const list = [];
    for (const [hOver, hUnder] of pairs) {
      list.push({ over: c.a, under: c.b, hOver, hUnder });
      list.push({ over: c.b, under: c.a, hOver, hUnder });
    }
    return list;
  });

  let best: HeightResult | null = null;
  let bestCost = Infinity;
  const choice: typeof options[0][0][] = [];

  const evaluate = () => {
    const bounds = choice.flatMap(c => c.hUnder > 0
      ? [{ s: c.over, h: c.hOver }, { s: c.under, h: c.hUnder }]
      : [{ s: c.over, h: c.hOver }]);
    const h = (s: number) => {
      let v = 0;
      for (const b of bounds) v = Math.max(v, b.h - cyclicDist(s, b.s, total) / RAMP_PER_LEVEL);
      return v;
    };
    for (const c of choice) {
      if (h(c.under) > c.hUnder + 1e-6) return;
      if (h(c.over) - h(c.under) < 1 - 1e-6) return;
    }
    const joints = offsets.map(s => h(s));
    // Steilkurven: eben, auch in der Mitte
    for (let i = 0; i < offsets.length; i++) {
      if (!banked[i]) continue;
      const s0 = offsets[i], s1 = i + 1 < offsets.length ? offsets[i + 1] : total;
      const hm = h((s0 + s1) / 2);
      if (Math.abs(joints[i] - hm) > 0.02 || Math.abs(h(s1 % total) - hm) > 0.02) return;
    }
    const maxHeight = Math.max(...joints, ...choice.map(c => c.hOver));
    const wanted = levels - 1;
    // bevorzugt: gewünschte Ebenenzahl erreicht, dann möglichst wenig Höhe (Stützen)
    const cost = (maxHeight >= wanted ? 0 : 1000) + joints.reduce((a, b) => a + b, 0);
    if (cost < bestCost) {
      bestCost = cost;
      best = { joints, maxHeight };
    }
  };

  const recurse = (k: number) => {
    if (k === options.length) {
      evaluate();
      return;
    }
    for (const o of options[k]) {
      choice[k] = o;
      recurse(k + 1);
    }
  };
  recurse(0);
  return best;
}

// ---------------------------------------------------------------- Schwierigkeit

export function scoreDifficulty(pieces: { partId: string; dir: Dir }[], crossings: number): number {
  type Run = { kind: 'straight'; length: number } | { kind: 'curve'; dir: Dir; angle: number; radii: number[]; tightFirst: boolean; banked: number };
  const runs: Run[] = [];
  for (const pc of pieces) {
    const part = PART_BY_ID.get(pc.partId)!;
    const g = part.geometry;
    const last = runs[runs.length - 1];
    if (g.kind === 'straight') {
      if (last && last.kind === 'straight') last.length += g.length;
      else runs.push({ kind: 'straight', length: g.length });
    } else if (g.kind === 'curve') {
      if (last && last.kind === 'curve' && last.dir === pc.dir) {
        last.angle += g.angle;
        if (last.radii[last.radii.length - 1] !== g.radius) last.radii.push(g.radius);
        if (isBanked(part)) last.banked += g.angle;
      } else {
        runs.push({ kind: 'curve', dir: pc.dir, angle: g.angle, radii: [g.radius],
          tightFirst: g.radius <= 300 && !isBanked(part), banked: isBanked(part) ? g.angle : 0 });
      }
    }
  }
  // Rundkurs: letzte und erste Gruppe gleicher Art zusammenfassen
  if (runs.length > 1) {
    const a = runs[0], b = runs[runs.length - 1];
    if (a.kind === 'straight' && b.kind === 'straight') {
      a.length += b.length;
      runs.pop();
    }
  }

  let total = 0, tight = 0, banked = 0, chicanes = 0, braking = 0, radiusChanges = 0, hairpins = 0;
  for (const pc of pieces) {
    const part = PART_BY_ID.get(pc.partId)!;
    if (!isCurve(part)) continue;
    const g = part.geometry as { radius: number; angle: number };
    total += g.angle;
    if (g.radius <= 300) tight += isBanked(part) ? g.angle * 0.5 : g.angle;
    if (isBanked(part)) banked += g.angle;
  }
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    const next = runs[(i + 1) % runs.length];
    const after = runs[(i + 2) % runs.length];
    if (r.kind === 'curve') {
      radiusChanges += r.radii.length - 1;
      if (r.angle >= 180 && Math.min(...r.radii) <= 300) hairpins++;
      if (next.kind === 'curve' && next.dir !== r.dir) chicanes++;
      if (next.kind === 'straight' && next.length <= 235 && after.kind === 'curve' && after.dir !== r.dir) chicanes++;
    } else if (r.length >= 690 && next.kind === 'curve' && next.tightFirst) {
      braking++;
    }
  }
  const tightShare = total ? tight / total : 0;
  const bankedShare = total ? banked / total : 0;
  const score =
    0.4 * tightShare +
    0.2 * Math.min(1, chicanes / 2) +
    0.15 * Math.min(1, braking / 2) +
    0.1 * Math.min(1, radiusChanges / 2) +
    0.1 * Math.min(1, hairpins) +
    0.05 * Math.min(1, crossings) -
    0.15 * bankedShare;
  return Math.max(0, Math.min(1, score));
}

export function classify(score: number): Difficulty {
  if (score < DIFFICULTY_BANDS.easy[1]) return 'easy';
  if (score < DIFFICULTY_BANDS.medium[1]) return 'medium';
  return 'hard';
}

// ---------------------------------------------------------------- Generator

/** Alle Geraden sind Vielfache dieser Einheit: 345 = 12, 115 = 4, 86,25 = 3 Einheiten */
const UNIT = 28.75;

interface Context {
  opts: GeneratorOptions;
  rand: () => number;
  profile: Profile;
  curves: Part[];
  minLength: number;
  maxLength: number;
}

interface Corner {
  dir: Dir;
  pieces: string[];
}

function avail(opts: GeneratorOptions, id: string) {
  return opts.counts[id] ?? 0;
}

function pickWeighted<T>(rand: () => number, items: T[], weight: (t: T) => number): T | undefined {
  const total = items.reduce((s, t) => s + weight(t), 0);
  if (total <= 0) return undefined;
  let r = rand() * total;
  for (const t of items) {
    r -= weight(t);
    if (r <= 0) return t;
  }
  return items[items.length - 1];
}

function shuffle<T>(rand: () => number, a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildContext(opts: GeneratorOptions): Context {
  const curves = PARTS.filter(p => isCurve(p) && avail(opts, p.id) > 0);
  const totalAvail = PARTS.reduce((sum, p) => {
    const n = avail(opts, p.id);
    if (!n || p.geometry.kind === 'unknown') return sum;
    return sum + Math.min(n, 60) * pieceLength(p.geometry);
  }, 0);
  const span = opts.areaWidth + opts.areaDepth;
  return {
    opts,
    rand: rng(opts.seed ?? Date.now()),
    profile: PROFILES[opts.difficulty],
    curves,
    minLength: Math.max(1500, Math.min(span * 0.6, totalAvail * 0.3)),
    maxLength: Math.min(span * 3, totalAvail),
  };
}

/** Kurven würfeln, deren Drehwinkel sich zu `target` (z. B. ±360°) summieren. */
function buildCorners(ctx: Context, used: Record<string, number>, target: number, startDir: Dir): Corner[] | null {
  const { rand, profile, opts } = ctx;
  const corners: Corner[] = [];
  let turned = 0;
  let lastDir: Dir = startDir;
  const radii = Object.keys(profile.radiusWeight).map(Number);
  for (let guard = 0; guard < 40; guard++) {
    const remaining = target - turned;
    if (remaining === 0 && corners.length >= 3) return corners;
    const need: Dir = remaining > 0 ? 1 : remaining < 0 ? -1 : (lastDir === 1 ? -1 : 1);
    // Gegenkurve (S-Kurve/Schikane) nur, wenn noch genug Drehung übrig ist
    let dir: Dir = need;
    if (Math.abs(remaining) >= 90 && rand() > profile.sameDir) dir = need === 1 ? -1 : 1;
    const radius = pickWeighted(rand, radii, r => profile.radiusWeight[r] *
      (ctx.curves.some(c => radiusOf(c) === r && (used[c.id] ?? 0) < avail(opts, c.id)) ? 1 : 0));
    if (radius === undefined) return null;
    const types = ctx.curves.filter(c => radiusOf(c) === radius);
    const preferBanked = rand() < profile.bankedPref;
    types.sort((a, b) => Number(isBanked(b) === preferBanked) - Number(isBanked(a) === preferBanked));
    let angle = radius <= 300 && rand() < profile.hairpin ? 180
      : profile.corners[Math.floor(rand() * profile.corners.length)];
    if (dir === need && remaining !== 0) angle = Math.min(angle, Math.abs(remaining));
    if (dir !== need) angle = Math.min(angle, 60);

    const pieces: string[] = [];
    let a = 0;
    for (const t of types) {
      const step = (t.geometry as { angle: number }).angle;
      while (a + step <= angle && (used[t.id] ?? 0) < avail(opts, t.id)) {
        pieces.push(t.id);
        used[t.id] = (used[t.id] ?? 0) + 1;
        a += step;
      }
      if (a >= angle) break;
    }
    if (a === 0) continue;
    corners.push({ dir, pieces });
    turned += dir * a;
    lastDir = dir;
  }
  return null;
}

/** Zerlegung von n Einheiten in Geraden (12/4/3) unter Beachtung des Bestands. */
function decompose(n: number, left: { a: number; b: number; c: number }): [number, number, number] | null {
  for (let a = Math.min(left.a, Math.floor(n / 12)); a >= 0; a--) {
    const r = n - 12 * a;
    for (let b = Math.min(left.b, Math.floor(r / 4)); b >= 0; b--) {
      const rr = r - 4 * b;
      if (rr % 3 === 0 && rr / 3 <= left.c) return [a, b, rr / 3];
    }
  }
  return null;
}

/** Ein Versuch: Kurven würfeln, Geradenlängen ausrechnen, prüfen. */
function attempt(ctx: Context, seen: Set<string>): Layout | null {
  const { opts, rand, profile } = ctx;
  const used: Record<string, number> = {};

  // Gesamtdrehung: einfache Runde, Acht (Brücke) oder Doppelschleife
  let lobes: number[];
  const r = rand();
  const sign = rand() < 0.5 ? 1 : -1;
  if (opts.levels === 1) lobes = [360 * sign];
  else if (opts.levels === 2) lobes = r < 0.65 ? [360 * sign, -360 * sign] : [360 * sign];
  else lobes = r < 0.4 ? [360 * sign, -360 * sign] : r < 0.75 ? [360 * sign, 360 * sign] : [360 * sign, -360 * sign, 360 * sign];

  const corners: Corner[] = [];
  for (const target of lobes) {
    const c = buildCorners(ctx, used, target, target > 0 ? 1 : -1);
    if (!c) return null;
    corners.push(...c);
  }
  const k = corners.length;

  // Kurven ohne Geraden ablaufen: Richtung vor jeder Geraden und Gesamtversatz
  let pose: Pose = { x: 0, y: 0, heading: 0 };
  const runHeading: number[] = [];
  for (const c of corners) {
    runHeading.push(pose.heading);          // Gerade VOR dieser Kurve
    for (const id of c.pieces) pose = place(pose, geometryOf(id), c.dir);
  }
  const curveOffset = { x: pose.x, y: pose.y };

  // Grundlängen der Geraden (in Einheiten) nach Profil
  const units: number[] = corners.map((c, i) => {
    const prev = corners[(i - 1 + k) % k];
    if (prev.dir !== c.dir && rand() < 0.5) return 0;            // S-Kurve ohne Gerade
    let [lo, hi] = profile.straightRun;
    if (rand() < profile.longStraightIntoTight) { lo = Math.max(lo, 3); hi = Math.max(hi, 5); }
    const n = lo + Math.floor(rand() * (hi - lo + 1));
    const extra = rand() < 0.25 ? (rand() < 0.5 ? 3 : 4) : 0;
    return n * 12 + extra;
  });
  units[0] = Math.max(units[0], 12);                              // Platz für Anschlussgerade

  // Zwei Geraden mit verschiedener Richtung so lang machen, dass die Strecke schließt
  const pairs: [number, number][] = [];
  for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) pairs.push([i, j]);
  shuffle(rand, pairs);
  const total345 = avail(opts, STANDARD) + avail(opts, CONNECTION) + LANE_CHANGE_IDS.reduce((s, id) => s + avail(opts, id), 0);

  for (const [i, j] of pairs.slice(0, 40)) {
    const hi = (runHeading[i] * Math.PI) / 180, hj = (runHeading[j] * Math.PI) / 180;
    const ui = { x: Math.cos(hi), y: Math.sin(hi) }, uj = { x: Math.cos(hj), y: Math.sin(hj) };
    const det = ui.x * uj.y - ui.y * uj.x;
    if (Math.abs(det) < 0.5) continue;
    let rx = -curveOffset.x, ry = -curveOffset.y;
    for (let m = 0; m < k; m++) {
      if (m === i || m === j) continue;
      const h = (runHeading[m] * Math.PI) / 180;
      rx -= units[m] * UNIT * Math.cos(h);
      ry -= units[m] * UNIT * Math.sin(h);
    }
    const li = (rx * uj.y - ry * uj.x) / det;
    const lj = (ui.x * ry - ui.y * rx) / det;
    if (li < -1 || lj < -1) continue;
    const ni0 = Math.round(li / UNIT), nj0 = Math.round(lj / UNIT);
    for (const [di, dj] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = ni0 + di, nj = nj0 + dj;
      if (ni < 0 || nj < 0 || ni === 1 || ni === 2 || ni === 5 || nj === 1 || nj === 2 || nj === 5) continue;
      const ex = ni * UNIT * ui.x + nj * UNIT * uj.x - rx;
      const ey = ni * UNIT * ui.y + nj * UNIT * uj.y - ry;
      if (Math.hypot(ex, ey) > CLOSE_TOL) continue;
      const runs = [...units];
      runs[i] = ni;
      runs[j] = nj;
      if (i === 0 && ni < 12) continue;
      const layout = assemble(ctx, corners, runs, total345, seen);
      if (layout) return layout;
    }
  }
  return null;
}

/** Geraden in Teile zerlegen, Weichen einsetzen, Teilefolge prüfen. */
function assemble(ctx: Context, corners: Corner[], runs: number[], total345: number, seen: Set<string>): Layout | null {
  const { opts } = ctx;
  const left = { a: total345, b: avail(opts, '20020611'), c: avail(opts, '20020612') };
  const parts: [number, number, number][] = [];
  for (const n of runs) {
    const d = decompose(n, left);
    if (!d) return null;
    left.a -= d[0]; left.b -= d[1]; left.c -= d[2];
    parts.push(d);
  }
  const length = runs.reduce((s, n) => s + n * UNIT, 0) +
    corners.reduce((s, c) => s + c.pieces.reduce((t, id) => t + pieceLength(geometryOf(id)), 0), 0);
  if (length < ctx.minLength || length > ctx.maxLength) return null;

  // 345er-Plätze: Anschlussgerade, Weichen (am Ende langer Geraden), Rest Standardgeraden
  const slotIds: string[][] = parts.map(([a]) => Array(a).fill(STANDARD));
  if (avail(opts, CONNECTION) > 0) {
    if (!slotIds[0].length) return null;
    slotIds[0][0] = CONNECTION;
  }
  const laneLeft = LANE_CHANGE_IDS.flatMap(id => Array(Math.min(avail(opts, id), 20)).fill(id));
  let placedLC = 0;
  const order = runs.map((n, i) => i).sort((x, y) => runs[y] - runs[x]);
  for (const i of order) {
    if (placedLC >= opts.minLaneChanges) break;
    const slots = slotIds[i];
    const idx = slots.length - 1;
    if (idx < 0 || slots[idx] !== STANDARD) continue;
    const id = laneLeft.shift();
    if (!id) break;
    slots[idx] = id;
    placedLC++;
  }
  if (placedLC < opts.minLaneChanges) return null;
  const standardUsed = slotIds.flat().filter(id => id === STANDARD).length;
  if (standardUsed > avail(opts, STANDARD)) return null;

  const moves: Move[] = [];
  corners.forEach((c, i) => {
    const [, b, cc] = parts[i];
    for (const id of slotIds[i]) moves.push({ partId: id, dir: 0 });
    for (let x = 0; x < b; x++) moves.push({ partId: '20020611', dir: 0 });
    for (let x = 0; x < cc; x++) moves.push({ partId: '20020612', dir: 0 });
    for (const id of c.pieces) moves.push({ partId: id, dir: c.dir });
  });
  const sig = signature(moves);
  if (seen.has(sig)) return null;
  seen.add(sig);
  return finalize(ctx, moves);
}

/** Teilefolge platzieren, prüfen und in ein Layout umwandeln. */
function finalize(ctx: Context, moves: Move[]): Layout | null {
  const { opts } = ctx;
  let pose: Pose = { x: 0, y: 0, heading: 0 };
  const seq: { samples: Sample[]; offset: number }[] = [];
  const placed: PlacedPiece[] = [];
  let offset = 0;
  for (const m of moves) {
    const g = geometryOf(m.partId);
    const end = place(pose, g, m.dir);
    const len = pieceLength(g);
    seq.push({ samples: transformSamples(pose, relSamples(m.partId, m.dir)), offset });
    placed.push({ partId: m.partId, dir: m.dir, start: pose, end, length: len, h0: 0, h1: 0 });
    offset += len;
    pose = end;
  }
  const total = offset;
  if (Math.hypot(pose.x, pose.y) > CLOSE_TOL + 1 || headingDiff(pose.heading, 0) > 0.5) return null;

  const analysis = analyzeConflicts(seq, opts.levels > 1, total);
  if (!analysis.ok) return null;
  if (analysis.crossings.length > opts.levels) return null;

  const box = outerBox(seq.flatMap(s => s.samples));
  const orientation = fits(box, opts.areaWidth, opts.areaDepth);
  if (!orientation) return null;

  const banked = moves.map(m => isBanked(PART_BY_ID.get(m.partId)!));
  const heights = solveHeights(analysis.crossings, seq.map(s => s.offset), total, banked, opts.levels);
  if (!heights) return null;

  const counts: Record<string, number> = {};
  for (const m of moves) counts[m.partId] = (counts[m.partId] ?? 0) + 1;
  for (const [id, n] of Object.entries(counts)) {
    if (n > (opts.counts[id] ?? 0)) return null;
  }
  const laneChanges = moves.filter(m => LANE_CHANGE_IDS.includes(m.partId)).length;
  if (laneChanges < opts.minLaneChanges) return null;

  // In die Grundfläche legen (ggf. um 90° drehen), mittig ausrichten
  const rotate = orientation === 'rotated';
  const bw = rotate ? box.maxY - box.minY : box.maxX - box.minX;
  const bh = rotate ? box.maxX - box.minX : box.maxY - box.minY;
  const ox = (opts.areaWidth - bw) / 2, oy = (opts.areaDepth - bh) / 2;
  const tf = (p: Pose): Pose => rotate
    ? { x: (box.maxY - p.y) + ox, y: (p.x - box.minX) + oy, heading: normalizeHeading(p.heading + 90) }
    : { x: p.x - box.minX + ox, y: p.y - box.minY + oy, heading: p.heading };

  const n = placed.length;
  const pieces = placed.map((p, i) => ({
    ...p,
    start: tf(p.start),
    end: tf(p.end),
    h0: round2(heights.joints[i]),
    h1: round2(heights.joints[(i + 1) % n]),
  }));
  const supports = heights.joints.filter(h => h > 0.05).length;
  const score = scoreDifficulty(moves, analysis.crossings.length);

  return {
    pieces,
    areaWidth: opts.areaWidth,
    areaDepth: opts.areaDepth,
    length: total,
    laneChanges,
    crossings: analysis.crossings.length,
    levelsUsed: Math.round(heights.maxHeight) + 1,
    supports,
    difficultyScore: round2(score),
    difficulty: classify(score),
    partCounts: counts,
  };
}

function countMoves(moves: Move[]): Record<string, number> {
  const need: Record<string, number> = {};
  for (const m of moves) need[m.partId] = (need[m.partId] ?? 0) + 1;
  return need;
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}

/** Gleiche Strecke mit anderem Startpunkt oder gespiegelt nur einmal zählen. */
function shapeKey(l: Layout) {
  const counts = Object.entries(l.partCounts).sort().map(([id, n]) => id.slice(-3) + 'x' + n).join(',');
  return `${counts}|${Math.round(l.length / 10)}|${l.difficultyScore}|${l.crossings}`;
}

function signature(moves: Move[]) {
  return moves.map(m => m.partId.slice(-3) + (m.dir === 1 ? 'R' : m.dir === -1 ? 'L' : '')).join('.');
}

/** Rangfolge: gewünschte Schwierigkeit und Ebenen, dann möglichst lang. */
function rank(l: Layout, opts: GeneratorOptions, maxLen: number) {
  const [lo, hi] = DIFFICULTY_BANDS[opts.difficulty];
  const target = (lo + hi) / 2;
  const inBand = l.difficultyScore >= lo && l.difficultyScore < hi + (opts.difficulty === 'hard' ? 1 : 0);
  return (inBand ? 3 : 0) +
    (l.levelsUsed >= opts.levels ? 2 : 0) -
    Math.abs(l.difficultyScore - target) +
    0.8 * (l.length / maxLen);
}

export function startWarnings(opts: GeneratorOptions): string[] {
  const warnings: string[] = [];
  const laneAvail = LANE_CHANGE_IDS.reduce((s, id) => s + (opts.counts[id] ?? 0), 0);
  if (opts.minLaneChanges > laneAvail) warnings.push('not-enough-lane-changes');
  if (!PARTS.some(p => isCurve(p) && (opts.counts[p.id] ?? 0) > 0)) warnings.push('no-curves');
  return warnings;
}

/**
 * Strecken erzeugen. Läuft in kleinen Häppchen, damit die Oberfläche
 * flüssig bleibt; `onProgress` meldet den Fortschritt (0–1).
 */
export async function generateLayouts(opts: GeneratorOptions, onProgress?: (f: number) => void): Promise<GeneratorResult> {
  const warnings = startWarnings(opts);
  if (warnings.length) return { layouts: [], attempts: 0, warnings };
  const ctx = buildContext(opts);
  const maxResults = opts.maxResults ?? 3;
  const budget = opts.timeBudgetMs ?? 2500;
  const t0 = Date.now();
  const found = new Map<string, Layout>();
  const seen = new Set<string>();
  let attempts = 0;

  while (Date.now() - t0 < budget) {
    const chunkEnd = Date.now() + 25;
    while (Date.now() < chunkEnd) {
      attempts++;
      const layout = attempt(ctx, seen);
      if (layout) found.set(shapeKey(layout), layout);
    }
    const good = [...found.values()].filter(l => l.difficulty === opts.difficulty && l.levelsUsed >= opts.levels);
    onProgress?.(Math.min(1, (Date.now() - t0) / budget));
    if (good.length >= maxResults * 4) break;
    await new Promise(r => setTimeout(r, 0));
  }

  const layouts = [...found.values()]
    .sort((a, b) => rank(b, opts, ctx.maxLength) - rank(a, opts, ctx.maxLength))
    .slice(0, maxResults);
  if (layouts.length && !layouts.some(l => l.difficulty === opts.difficulty)) warnings.push('difficulty-not-reached');
  if (layouts.length && opts.levels > 1 && !layouts.some(l => l.levelsUsed >= opts.levels)) warnings.push('levels-not-reached');
  return { layouts, attempts, warnings };
}
