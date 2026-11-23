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
  /** Anzahl WIRELESS+ Ladeschalen (je 2 an einer Adapter Unit) */
  chargingStations?: number;
  /** Fahrtrichtung: rechtsherum (Uhrzeigersinn), linksherum oder beliebig */
  direction?: TravelDirection | 'auto';
  /** Seite der Grundfläche, an der die Control Unit erreichbar sein muss */
  cuEdge?: CuEdge;
  maxResults?: number;
  timeBudgetMs?: number;
  seed?: number;
}

/** 'cw' = rechtsherum (im Uhrzeigersinn), 'ccw' = linksherum */
export type TravelDirection = 'cw' | 'ccw';
/** Standort der Control Unit: Seite der Grundfläche (vorne = Fahrerseite = unten im Plan) */
export type CuEdge = 'front' | 'back' | 'left' | 'right' | 'any';
/** Reichweite: Mitte der Control Unit höchstens so weit von der gewählten Kante (mm, Schätzwert Armlänge) */
export const CU_REACH = 700;
const EDGE_NORMAL: Record<Exclude<CuEdge, 'any'>, [number, number]> = { front: [0, 1], back: [0, -1], left: [-1, 0], right: [1, 0] };

/** Abstand der Control-Unit-Mitte zur gewählten Kante (mm), Infinity ohne CU */
export function cuEdgeDistance(accessories: AccessoryBox[], edge: CuEdge, areaW: number, areaD: number): number {
  if (edge === 'any') return 0;
  const cu = accessories.find(a => a.kind === 'controlunit');
  if (!cu) return Infinity;
  return { front: areaD - cu.y, back: cu.y, left: cu.x, right: areaW - cu.x }[edge];
}

/** Stellfläche neben der Bahn (Control Unit, Ladeschale), Maße in mm */
export interface AccessoryBox {
  kind: 'controlunit' | 'charger';
  /** Mittelpunkt */
  x: number;
  y: number;
  /** Ausdehnung entlang der Fahrbahn / quer dazu */
  along: number;
  across: number;
  heading: number;
  /** Index des Bahnteils, an dem das Zubehör angeschlossen ist */
  piece: number;
  /** Seite der Fahrbahn (+1 rechts, -1 links in Fahrtrichtung) */
  side?: 1 | -1;
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
  chargingStations: number;
  accessories: AccessoryBox[];
  /** Fahrtrichtung ab Start/Ziel */
  direction?: TravelDirection;
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
  easy: [0, 0.2],
  medium: [0.2, 0.5],
  hard: [0.5, 1],
};

/**
 * Profile der Schwierigkeit. Maßgeblich ist nicht die Enge der Kurven (Kurve 1
 * steckt in jeder Grundpackung), sondern was Fahrer fordert:
 *  - S-Kurven (Richtungswechsel mit kurzer Verbindung)
 *  - Schikanen (Richtungswechsel ohne Gerade dazwischen)
 *  - Kurven mit zu- oder abnehmendem Radius („Parabolica“)
 *  - lange Gerade in eine sich zuziehende Kurve
 *  - Vielfalt der Radien
 * Oval und Acht gelten als Einsteiger-Strecken.
 */
interface Profile {
  straightRun: [number, number];
  radiusWeight: Record<number, number>;
  bankedPref: number;
  /** Wahrscheinlichkeit einer Gegenkurve (S-Kurve) */
  reversal: number;
  /** Wahrscheinlichkeit, eine Schikane einzubauen */
  chicane: number;
  /** Wahrscheinlichkeit, dass eine Kurve den Radius wechselt */
  parabolic: number;
  /** Wahrscheinlichkeit: lange Gerade vor sich zuziehender Kurve */
  longIntoTight: number;
  corners: number[];
}

const PROFILES: Record<Difficulty, Profile> = {
  easy: {
    straightRun: [1, 4],
    radiusWeight: { 300: 0.4, 500: 0.35, 700: 0.15, 900: 0.1 },
    bankedPref: 0.4, reversal: 0.03, chicane: 0, parabolic: 0, longIntoTight: 0,
    corners: [90, 180, 180],
  },
  medium: {
    straightRun: [1, 3],
    radiusWeight: { 300: 0.4, 500: 0.35, 700: 0.18, 900: 0.07 },
    bankedPref: 0.25, reversal: 0.3, chicane: 0.15, parabolic: 0.25, longIntoTight: 0.2,
    corners: [60, 90, 120, 180],
  },
  hard: {
    straightRun: [0, 3],
    radiusWeight: { 300: 0.45, 500: 0.3, 700: 0.15, 900: 0.1 },
    bankedPref: 0.05, reversal: 0.5, chicane: 0.5, parabolic: 0.6, longIntoTight: 0.5,
    corners: [30, 60, 90, 120, 180],
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
export const CONNECTION = 'connection-straight';
export const ADAPTER = '20030360';
/** Teile, die immer verfügbar angenommen werden (fehlen sie im Bestand, erscheinen sie als „fehlend“) */
const ASSUMED = [CONNECTION, ADAPTER];

/**
 * Stellflächen (Näherung): Control Unit und Ladeschale neben der Fahrbahn.
 * Control Unit: Länge wie die Anschlussschiene (34,5 cm laut Händlerangabe),
 * Tiefe 15 cm geschätzt – bitte nachmessen.
 */
export const CU_SIZE = { along: 345, across: 150 };
/** Seite der Control Unit in Fahrtrichtung: −1 = links (Original-Aufbau) */
export const CU_SIDE: -1 = -1;
const CHARGER_SIZE = { along: 110, across: 140 };
const ACCESSORY_GAP = 50;

export function adapterUnitsFor(chargingStations: number) {
  return Math.ceil(Math.max(0, chargingStations) / 2);
}
export const LANE_CHANGE_IDS = ['20030343', '20030345', '20030347'];

function isCurve(p: Part) {
  return p.geometry.kind === 'curve';
}

function isBanked(p: Part) {
  return p.feature === 'banked';
}

function radiusOf(p: Part): number {
  return p.geometry.kind === 'curve' ? p.geometry.radius : 0;
}

export interface Move {
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
  /** Anzahl Brücken (zusammenhängende erhöhte Abschnitte über einer Kreuzung) */
  bridges: number;
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
    return { joints: offsets.map(() => 0), maxHeight: 0, bridges: 0 };
  }
  // Immer die niedrigste mögliche Lösung: zuerst 2 Ebenen; 3 Ebenen nur, wenn 2 nicht reichen
  const two = solveHeightsWith(crossings, offsets, total, banked, [[1, 0]]);
  if (two || levels < 3) return two;
  return solveHeightsWith(crossings, offsets, total, banked, [[1, 0], [2, 1], [2, 0]]);
}

function solveHeightsWith(crossings: Crossing[], offsets: number[], total: number, banked: boolean[], pairs: [number, number][]): HeightResult | null {
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
    // möglichst wenig Höhe (Stützen)
    const cost = maxHeight * 1000 + joints.reduce((a, b) => a + b, 0);
    if (cost < bestCost) {
      bestCost = cost;
      // Brücken: obenliegende Kreuzungspunkte, die nicht auf demselben erhöhten Abschnitt liegen
      const overs = [...new Set(choice.map(c => c.over))].sort((a, b) => a - b);
      let bridges = 0;
      for (let i = 0; i < overs.length; i++) {
        const prev = overs[(i - 1 + overs.length) % overs.length];
        let connected = overs.length > 1 && i > 0;
        if (connected) {
          // dazwischen durchgehend erhöht?
          for (let x = prev; x <= overs[i]; x += 50) {
            if (h(x) < 0.99) { connected = false; break; }
          }
        }
        if (!connected) bridges++;
      }
      best = { joints, maxHeight, bridges };
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

export interface DifficultyFeatures {
  /** Richtungswechsel mit kurzer Verbindung (< 2 Standardgeraden); eine S-Kurve zählt doppelt */
  esses: number;
  /** Richtungswechsel ohne nennenswerte Gerade (≤ 1/3 Gerade) */
  chicanes: number;
  /** Kurven mit wechselndem Radius */
  parabolic: number;
  /** lange Gerade (≥ 3 Standardgeraden) in eine sich zuziehende Kurve */
  longIntoTight: number;
  /** Anzahl verschiedener Radien (ohne Steilkurven) */
  radii: number;
  bankedShare: number;
}

export function difficultyFeatures(pieces: { partId: string; dir: Dir }[]): DifficultyFeatures {
  type Run = { kind: 'straight'; length: number } | { kind: 'curve'; dir: Dir; angle: number; radii: number[] };
  const runs: Run[] = [];
  let total = 0, banked = 0;
  const radiusSet = new Set<number>();
  for (const pc of pieces) {
    const part = PART_BY_ID.get(pc.partId)!;
    const g = part.geometry;
    const last = runs[runs.length - 1];
    if (g.kind === 'straight') {
      if (last && last.kind === 'straight') last.length += g.length;
      else runs.push({ kind: 'straight', length: g.length });
    } else if (g.kind === 'curve') {
      total += g.angle;
      if (isBanked(part)) banked += g.angle;
      else radiusSet.add(g.radius);
      if (last && last.kind === 'curve' && last.dir === pc.dir) {
        last.angle += g.angle;
        if (last.radii[last.radii.length - 1] !== g.radius) last.radii.push(g.radius);
      } else {
        runs.push({ kind: 'curve', dir: pc.dir, angle: g.angle, radii: [g.radius] });
      }
    }
  }
  if (runs.length > 1) {
    const a = runs[0], b = runs[runs.length - 1];
    if (a.kind === 'straight' && b.kind === 'straight') {
      a.length += b.length;
      runs.pop();
    }
  }
  const f: DifficultyFeatures = { esses: 0, chicanes: 0, parabolic: 0, longIntoTight: 0, radii: radiusSet.size, bankedShare: total ? banked / total : 0 };
  const n = runs.length;
  for (let i = 0; i < n; i++) {
    const r = runs[i];
    if (r.kind !== 'curve') continue;
    if (r.radii.length > 1) f.parabolic++;
    // nächste Kurvengruppe und die Gerade dazwischen
    let gap = 0, j = (i + 1) % n;
    while (runs[j].kind === 'straight' && j !== i) {
      gap += (runs[j] as { length: number }).length;
      j = (j + 1) % n;
    }
    const next = runs[j];
    if (next.kind === 'curve' && next.dir !== r.dir) {
      if (gap < 690) f.esses++;
      if (gap <= 116) f.chicanes++;
    }
    // lange Gerade davor und Kurve zieht sich zu
    const prev = runs[(i - 1 + n) % n];
    if (prev.kind === 'straight' && prev.length >= 1035 && r.radii.length > 1 && r.radii[r.radii.length - 1] < r.radii[0]) {
      f.longIntoTight++;
    }
  }
  return f;
}

/**
 * Schwierigkeit 0–1. Oval und Acht liegen bei ~0, Strecken mit mehreren
 * S-Kurven im mittleren Bereich, Schikanen und Kurven mit wechselndem Radius
 * machen eine Strecke schwer.
 */
export function scoreDifficulty(pieces: { partId: string; dir: Dir }[], _crossings = 0): number {
  const f = difficultyFeatures(pieces);
  const score =
    0.3 * Math.min(1, f.esses / 4) +
    0.25 * Math.min(1, f.parabolic / 2) +
    0.2 * Math.min(1, f.chicanes / 2) +
    0.1 * Math.min(1, f.longIntoTight) +
    0.15 * Math.max(0, Math.min(1, (f.radii - 1) / 2)) -
    0.1 * f.bankedShare;
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
  /** keine Gerade davor (Schikane) */
  tight?: boolean;
  /** lange Gerade davor (Bremszone) */
  longBefore?: boolean;
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
  const has = (r: number) => ctx.curves.some(c => radiusOf(c) === r && (used[c.id] ?? 0) < avail(opts, c.id));
  const pickRadius = (exclude: number[] = []) => pickWeighted(rand, radii, r =>
    exclude.includes(r) || !has(r) ? 0 : profile.radiusWeight[r]);

  /** Kurventeile für `angle` Grad auf den Radien `seq` (nacheinander) zusammenstellen. */
  const take = (seq: number[], angle: number): string[] | null => {
    const pieces: string[] = [];
    let a = 0;
    seq.forEach((r, idx) => {
      const share = idx === seq.length - 1 ? angle - a : Math.round(angle / seq.length / 15) * 15;
      let part = 0;
      const types = ctx.curves.filter(c => radiusOf(c) === r);
      const preferBanked = rand() < profile.bankedPref;
      types.sort((x, y) => Number(isBanked(y) === preferBanked) - Number(isBanked(x) === preferBanked));
      for (const t of types) {
        const step = (t.geometry as { angle: number }).angle;
        while (part + step <= share && (used[t.id] ?? 0) < avail(opts, t.id)) {
          pieces.push(t.id);
          used[t.id] = (used[t.id] ?? 0) + 1;
          part += step;
        }
      }
      a += part;
    });
    return a > 0 ? pieces : null;
  };
  const angleOf = (pieces: string[]) => pieces.reduce((s, id) => s + (PART_BY_ID.get(id)!.geometry as { angle: number }).angle, 0);

  for (let guard = 0; guard < 40; guard++) {
    const remaining = target - turned;
    if (remaining === 0 && corners.length >= 3) return corners;
    const need: Dir = remaining > 0 ? 1 : remaining < 0 ? -1 : (lastDir === 1 ? -1 : 1);

    // Schikane: zwei kurze Gegenkurven ohne Gerade dazwischen (Netto-Drehung 0)
    if (rand() < profile.chicane && corners.length > 0) {
      const r = pickRadius();
      if (r !== undefined) {
        const a = rand() < 0.5 ? 30 : 60;
        const d: Dir = rand() < 0.5 ? 1 : -1;
        const p1 = take([r], a);
        const p2 = p1 ? take([r], angleOf(p1)) : null;
        if (p1 && p2 && angleOf(p1) === angleOf(p2)) {
          corners.push({ dir: d, pieces: p1, tight: rand() < 0.5 });
          corners.push({ dir: (d === 1 ? -1 : 1) as Dir, pieces: p2, tight: true });
          continue;
        }
      }
    }

    // S-Kurve: Gegenkurve, nur wenn noch genug Drehung übrig ist
    let dir: Dir = need;
    if (Math.abs(remaining) >= 90 && rand() < profile.reversal) dir = need === 1 ? -1 : 1;

    const radius = pickRadius();
    if (radius === undefined) return null;
    let angle = profile.corners[Math.floor(rand() * profile.corners.length)];
    if (dir === need && remaining !== 0) angle = Math.min(angle, Math.abs(remaining));
    if (dir !== need) angle = Math.min(angle, 60);

    // Kurve mit wechselndem Radius (weit → eng oder eng → weit)
    let seq = [radius];
    let longBefore = false;
    if (angle >= 60 && rand() < profile.parabolic) {
      const second = pickRadius([radius]);
      if (second !== undefined) {
        const tightening = rand() < 0.6;
        seq = tightening ? [Math.max(radius, second), Math.min(radius, second)] : [Math.min(radius, second), Math.max(radius, second)];
        longBefore = tightening && rand() < profile.longIntoTight;
      }
    }
    const pieces = take(seq, angle);
    if (!pieces) continue;
    corners.push({ dir, pieces, longBefore });
    turned += dir * angleOf(pieces);
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
  const sign = opts.direction === 'cw' ? 1 : opts.direction === 'ccw' ? -1 : rand() < 0.5 ? 1 : -1;
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
    if (c.tight) return 0;                                         // Schikane: direkt aneinander
    if (prev.dir !== c.dir && rand() < profile.reversal) return rand() < 0.5 ? 0 : 12; // S-Kurve
    let [lo, hi] = profile.straightRun;
    if (c.longBefore) { lo = Math.max(lo, 3); hi = Math.max(hi, 5); }
    const n = lo + Math.floor(rand() * (hi - lo + 1));
    const extra = rand() < 0.25 ? (rand() < 0.5 ? 3 : 4) : 0;
    return n * 12 + extra;
  });
  const startUnits = 12 * (1 + adapterUnitsFor(opts.chargingStations ?? 0));
  units[0] = Math.max(units[0], startUnits);                      // Control Unit + Adapter Units

  // Zwei Geraden mit verschiedener Richtung so lang machen, dass die Strecke schließt
  const pairs: [number, number][] = [];
  for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) pairs.push([i, j]);
  shuffle(rand, pairs);
  const total345 = avail(opts, STANDARD) + 1 + adapterUnitsFor(opts.chargingStations ?? 0) +
    LANE_CHANGE_IDS.reduce((s, id) => s + avail(opts, id), 0);

  for (const [i, j] of pairs.filter(([a, b]) => !corners[a].tight && !corners[b].tight).slice(0, 40)) {
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
      if (i === 0 && ni < startUnits) continue;
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
  const adapters = adapterUnitsFor(opts.chargingStations ?? 0);
  if (slotIds[0].length < 1 + adapters) return null;
  slotIds[0][0] = CONNECTION;                       // Start/Ziel: Control Unit immer zuerst
  for (let a = 1; a <= adapters; a++) slotIds[0][a] = ADAPTER;
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
/**
 * Lage der Strecke in der Grundfläche: Drehung (0/90/180/270°) und Verschiebung.
 * Ohne Standortwunsch mittig (ggf. um 90° gedreht). Mit Standortwunsch liegt die
 * Startgerade parallel zur gewählten Kante, die Strecke wird an diese Kante
 * geschoben; steht die Control Unit zwischen Bahn und Kante, bleibt Platz für sie.
 */
function placeInArea(box: Box, W: number, D: number, orientation: 'normal' | 'rotated', edge: CuEdge, start: PlacedPiece): ((p: Pose) => Pose) | null {
  const rot = (r: number) => {
    const c = Math.round(Math.cos(r * Math.PI / 180)), s = Math.round(Math.sin(r * Math.PI / 180));
    return (x: number, y: number) => [x * c - y * s, x * s + y * c] as [number, number];
  };
  const make = (r: number, tx: number, ty: number) => {
    const R = rot(r);
    return (p: Pose): Pose => {
      const [x, y] = R(p.x, p.y);
      return { x: x + tx, y: y + ty, heading: normalizeHeading(p.heading + r) };
    };
  };
  const boxOf = (r: number) => {
    const R = rot(r);
    const pts = [R(box.minX, box.minY), R(box.maxX, box.minY), R(box.minX, box.maxY), R(box.maxX, box.maxY)];
    return { minX: Math.min(...pts.map(p => p[0])), maxX: Math.max(...pts.map(p => p[0])), minY: Math.min(...pts.map(p => p[1])), maxY: Math.max(...pts.map(p => p[1])) };
  };
  if (edge === 'any') {
    const r = orientation === 'rotated' ? 90 : 0;
    const b = boxOf(r);
    return make(r, (W - (b.maxX - b.minX)) / 2 - b.minX, (D - (b.maxY - b.minY)) / 2 - b.minY);
  }
  const [ex, ey] = EDGE_NORMAL[edge];
  const rotations = ex === 0 ? [0, 180] : [90, 270];
  let best: { r: number; tx: number; ty: number; dist: number } | null = null;
  for (const r of rotations) {
    const b = boxOf(r);
    if (b.maxX - b.minX > W || b.maxY - b.minY > D) continue;
    // Mitte der Startgeraden und Seite der Control Unit (links in Fahrtrichtung)
    const R = rot(r);
    const t0 = (start.start.heading * Math.PI) / 180;
    const [mx, my] = R(start.start.x + Math.cos(t0) * start.length / 2, start.start.y + Math.sin(t0) * start.length / 2);
    const h = ((start.start.heading + r) * Math.PI) / 180;
    const cuNx = -Math.sin(h) * CU_SIDE, cuNy = Math.cos(h) * CU_SIDE;
    const cuTowardEdge = cuNx * ex + cuNy * ey > 0.5;
    // Koordinate u entlang der Kantennormalen
    const u = (x: number, y: number) => x * ex + y * ey;
    const edgeU = edge === 'front' ? D : edge === 'right' ? W : 0;
    const extent = ex === 0 ? D : W;
    const bMaxU = Math.max(u(b.minX, b.minY), u(b.maxX, b.maxY), u(b.minX, b.maxY), u(b.maxX, b.minY));
    const bMinU = Math.min(u(b.minX, b.minY), u(b.maxX, b.maxY), u(b.minX, b.maxY), u(b.maxX, b.minY));
    const startU = u(mx, my);
    let shift = edgeU - 20 - bMaxU;
    if (cuTowardEdge) shift = Math.min(shift, edgeU - 10 - (startU + TRACK_WIDTH / 2 + ACCESSORY_GAP + CU_SIZE.across));
    if (bMinU + shift < edgeU - extent) continue;
    const cuCenterU = startU + shift + (cuTowardEdge ? 1 : -1) * (TRACK_WIDTH / 2 + ACCESSORY_GAP + CU_SIZE.across / 2);
    const dist = Math.abs(edgeU - cuCenterU);
    if (dist > CU_REACH) continue;
    // quer zur Kante mittig
    let tx = (W - (b.maxX - b.minX)) / 2 - b.minX, ty = (D - (b.maxY - b.minY)) / 2 - b.minY;
    if (ex === 0) ty = shift * ey; else tx = shift * ex;
    if (!best || dist < best.dist) best = { r, tx, ty, dist };
  }
  return best ? make(best.r, best.tx, best.ty) : null;
}

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
    if (!ASSUMED.includes(id) && n > (opts.counts[id] ?? 0)) return null;
  }
  const laneChanges = moves.filter(m => LANE_CHANGE_IDS.includes(m.partId)).length;
  if (laneChanges < opts.minLaneChanges) return null;

  const tf = placeInArea(box, opts.areaWidth, opts.areaDepth, orientation, opts.cuEdge ?? 'any', placed[0]);
  if (!tf) return null;

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
  const direction = travelDirection(pieces);
  if (opts.direction && opts.direction !== 'auto' && direction !== opts.direction) return null;
  const accessories = placeAccessories(pieces, opts.chargingStations ?? 0, opts.areaWidth, opts.areaDepth);
  if (!accessories) return null;

  return {
    pieces,
    areaWidth: opts.areaWidth,
    areaDepth: opts.areaDepth,
    length: total,
    laneChanges,
    crossings: heights.bridges,
    levelsUsed: Math.round(heights.maxHeight) + 1,
    supports,
    difficultyScore: round2(score),
    difficulty: classify(score),
    partCounts: counts,
    chargingStations: opts.chargingStations ?? 0,
    accessories,
    direction,
  };
}

// ---------------------------------------------------------------- Zubehör-Stellflächen

function pieceSamples(pieces: PlacedPiece[]): { samples: Sample[]; offset: number }[] {
  let offset = 0;
  return pieces.map(p => {
    const r = { samples: transformSamples(p.start, relSamples(p.partId, p.dir)), offset };
    offset += p.length;
    return r;
  });
}

/**
 * Control Unit neben die Anschlussschiene, Ladeschalen neben die Adapter Units –
 * zuerst außen, sonst innen. Prüft Grundfläche und Abstand zur übrigen Bahn.
 */
export function placeAccessories(pieces: PlacedPiece[], chargingStations: number, areaW: number, areaD: number): AccessoryBox[] | null {
  if (!pieces.length || pieces[0].partId !== CONNECTION) return [];
  const seq = pieceSamples(pieces);
  const all = seq.flatMap(s => s.samples);
  const cx = all.reduce((a, q) => a + q.x, 0) / all.length;
  const cy = all.reduce((a, q) => a + q.y, 0) / all.length;
  const total = pieces.reduce((a, p) => a + p.length, 0);

  const wanted: { piece: number; kind: AccessoryBox['kind']; along: number; across: number; shift: number }[] =
    [{ piece: 0, kind: 'controlunit', ...CU_SIZE, shift: 0 }];
  let left = chargingStations;
  for (let i = 1; i < pieces.length && left > 0; i++) {
    if (pieces[i].partId !== ADAPTER) continue;
    const n = Math.min(2, left);
    for (let k = 0; k < n; k++) {
      wanted.push({ piece: i, kind: 'charger', ...CHARGER_SIZE, shift: n === 2 ? (k === 0 ? -62 : 62) : 0 });
    }
    left -= n;
  }

  const boxesFor = (cuSide: 1 | -1, chargerSide: 1 | -1): AccessoryBox[] | null => {
    const boxes: AccessoryBox[] = [];
    for (const w of wanted) {
      const side = w.kind === 'controlunit' ? cuSide : chargerSide;
      const p = pieces[w.piece];
      const t = (p.start.heading * Math.PI) / 180;
      const ux = Math.cos(t), uy = Math.sin(t);
      const nx = -Math.sin(t) * side, ny = Math.cos(t) * side;
      const d = TRACK_WIDTH / 2 + ACCESSORY_GAP + w.across / 2;
      const mx = p.start.x + ux * (p.length / 2 + w.shift), my = p.start.y + uy * (p.length / 2 + w.shift);
      const box: AccessoryBox = { kind: w.kind, x: mx + nx * d, y: my + ny * d, along: w.along, across: w.across, heading: p.start.heading, piece: w.piece, side };
      // Ecken in der Grundfläche?
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const ex = box.x + ux * a * w.along / 2 + nx * b * w.across / 2;
        const ey = box.y + uy * a * w.along / 2 + ny * b * w.across / 2;
        if (ex < 0 || ey < 0 || ex > areaW || ey > areaD) return null;
      }
      // Abstand zur übrigen Bahn (Teile, die entlang der Strecke weiter weg liegen)
      const base = seq[w.piece].offset + p.length / 2;
      for (const s of seq) {
        for (const q of s.samples) {
          if (cyclicDist(s.offset + q.s, base, total) < 450) continue;
          const dx = q.x - box.x, dy = q.y - box.y;
          const u = Math.abs(dx * ux + dy * uy), v = Math.abs(dx * nx + dy * ny);
          if (u < w.along / 2 + TRACK_WIDTH / 2 && v < w.across / 2 + TRACK_WIDTH / 2) return null;
        }
      }
      boxes.push(box);
    }
    return boxes;
  };

  // Control Unit: fest links in Fahrtrichtung (Carrera: Autos fahren von rechts
  // nach links an der Control Unit vorbei). Rechtsherum steht sie damit außen,
  // linksherum innen. Ladeschalen bevorzugt außen (vom Schwerpunkt weg).
  const p0 = pieces[0];
  const t0 = (p0.start.heading * Math.PI) / 180;
  const outward: 1 | -1 = ((-Math.sin(t0)) * (p0.start.x - cx) + Math.cos(t0) * (p0.start.y - cy)) >= 0 ? 1 : -1;
  return boxesFor(CU_SIDE, outward) ?? boxesFor(CU_SIDE, outward === 1 ? -1 : 1);
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
    5 * Math.min(l.levelsUsed - 1, opts.levels - 1) -
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

  let all = [...found.values()];
  // Mehrere Ebenen gewünscht: Strecken ohne Brücke nur zeigen, wenn es keine mit Brücke gibt
  if (opts.levels > 1 && all.some(l => l.levelsUsed > 1)) all = all.filter(l => l.levelsUsed > 1);
  const layouts = all
    .sort((a, b) => rank(b, opts, ctx.maxLength) - rank(a, opts, ctx.maxLength))
    .slice(0, maxResults);
  if (layouts.length && !layouts.some(l => l.difficulty === opts.difficulty)) warnings.push('difficulty-not-reached');
  if (layouts.length && opts.levels > 1 && !layouts.some(l => l.levelsUsed >= opts.levels)) warnings.push('levels-not-reached');
  return { layouts, attempts, warnings };
}

// ---------------------------------------------------------------- Bearbeiten (Editor)

const PLAIN_STRAIGHTS = [STANDARD, '20020611', '20020612'];

export interface Conflict {
  /** Indizes der beteiligten Teile */
  a: number;
  b: number;
  kind: 'overlap' | 'crossing';
}

export interface Evaluation {
  pieces: PlacedPiece[];
  /** Abstand Ende → Start in mm */
  gap: number;
  /** fehlende Drehung bis zum Schließen (Grad, −180…180) */
  headingGap: number;
  closed: boolean;
  outside: boolean;
  conflicts: Conflict[];
  crossings: number;
  levelsUsed: number;
  supports: number;
  length: number;
  laneChanges: number;
  partCounts: Record<string, number>;
  difficultyScore: number;
  difficulty: Difficulty;
  accessories: AccessoryBox[];
  accessoriesFit: boolean;
  direction: TravelDirection;
  /** Control Unit von der gewählten Seite erreichbar */
  cuReachable: boolean;
}

/**
 * Fahrtrichtung, gemessen an der Startgeraden: Liegt die Außenseite der
 * Strecke (vom Schwerpunkt weg) links in Fahrtrichtung, fährt man rechtsherum
 * (im Uhrzeigersinn) – die Control Unit (links) steht dann außen.
 * Funktioniert auch für Achten, bei denen die Kurvensumme 0 ist.
 */
export function travelDirection(pieces: PlacedPiece[]): TravelDirection {
  if (!pieces.length) return 'cw';
  const cx = pieces.reduce((a, p) => a + p.start.x, 0) / pieces.length;
  const cy = pieces.reduce((a, p) => a + p.start.y, 0) / pieces.length;
  const p0 = pieces[0];
  const t = (p0.start.heading * Math.PI) / 180;
  const mx = p0.start.x + Math.cos(t) * p0.length / 2, my = p0.start.y + Math.sin(t) * p0.length / 2;
  // > 0: Schwerpunkt liegt rechts → Außenseite links → rechtsherum
  const right = -Math.sin(t) * (cx - mx) + Math.cos(t) * (cy - my);
  return right >= 0 ? 'cw' : 'ccw';
}

/**
 * Fahrtrichtung umkehren: gleiche Strecke, rückwärts befahren. Die
 * Anschlussschiene bleibt Teil 1, die übrigen Teile in umgekehrter Reihenfolge
 * mit gespiegelter Kurvenrichtung.
 */
export function reverseMoves(moves: Move[], start: Pose): { moves: Move[]; start: Pose } {
  if (!moves.length) return { moves, start };
  const end = place(start, geometryOf(moves[0].partId), moves[0].dir);
  const rest = moves.slice(1).reverse().map(m => ({ partId: m.partId, dir: (m.dir === 0 ? 0 : -m.dir) as Dir }));
  return {
    moves: [{ ...moves[0] }, ...rest],
    start: { x: end.x, y: end.y, heading: normalizeHeading(end.heading + 180) },
  };
}

function signedHeading(d: number) {
  const n = normalizeHeading(d);
  return n > 180 ? n - 360 : n;
}

/** Teilefolge ab `start` legen und vollständig bewerten (ohne zu verwerfen). */
export function evaluateMoves(moves: Move[], start: Pose, areaW: number, areaD: number, chargingStations: number, cuEdge: CuEdge = 'any'): Evaluation {
  let pose = start;
  const placed: PlacedPiece[] = [];
  const seq: { samples: Sample[]; offset: number }[] = [];
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
  const gap = Math.hypot(pose.x - start.x, pose.y - start.y);
  const headingGap = signedHeading(start.heading - pose.heading);
  const closed = moves.length > 2 && gap <= CLOSE_TOL + 2 && Math.abs(headingGap) < 0.5;

  // Überschneidungen einzeln erfassen
  const conflicts: Conflict[] = [];
  const crossPts: Crossing[] = [];
  // offene Strecke: Anfang und Ende liegen nur um die Lücke auseinander
  const along = (a: number, b: number) => cyclicDist(a, b, closed ? total : total + gap);
  for (let i = 0; i < seq.length; i++) {
    for (let j = i + 1; j < seq.length; j++) {
      let found: Conflict | null = null;
      outer: for (const q of seq[i].samples) {
        for (const o of seq[j].samples) {
          if (Math.abs(o.x - q.x) >= CONFLICT_DIST || Math.abs(o.y - q.y) >= CONFLICT_DIST) continue;
          if (Math.hypot(o.x - q.x, o.y - q.y) >= CONFLICT_DIST) continue;
          const ga = seq[i].offset + q.s, gb = seq[j].offset + o.s;
          if (along(ga, gb) < NEIGHBOR_ALONG) continue;
          if (crossingAngle(o.heading, q.heading) < MIN_CROSS_ANGLE) {
            found = { a: i, b: j, kind: 'overlap' };
            break outer;
          }
          found = found ?? { a: i, b: j, kind: 'crossing' };
          if (!crossPts.some(c => Math.abs(c.a - ga) < 450 && Math.abs(c.b - gb) < 450)) crossPts.push({ a: ga, b: gb });
        }
      }
      if (found) conflicts.push(found);
    }
  }

  const box = outerBox(seq.flatMap(s => s.samples));
  const outside = box.minX < 0 || box.minY < 0 || box.maxX > areaW || box.maxY > areaD;

  let levelsUsed = 1, supports = 0, bridges = crossPts.length;
  if (closed && !conflicts.some(c => c.kind === 'overlap') && crossPts.length) {
    const banked = moves.map(m => isBanked(PART_BY_ID.get(m.partId)!));
    const heights = solveHeights(crossPts, seq.map(s => s.offset), total, banked, 3);
    if (heights) {
      placed.forEach((p, i) => {
        p.h0 = round2(heights.joints[i]);
        p.h1 = round2(heights.joints[(i + 1) % placed.length]);
      });
      levelsUsed = Math.round(heights.maxHeight) + 1;
      supports = heights.joints.filter(h => h > 0.05).length;
      bridges = heights.bridges;
    } else {
      conflicts.push({ a: -1, b: -1, kind: 'overlap' });
    }
  }

  const accessories = placeAccessories(placed, chargingStations, areaW, areaD);
  const score = scoreDifficulty(moves, crossPts.length);
  return {
    pieces: placed,
    gap: Math.round(gap),
    headingGap: Math.round(headingGap * 10) / 10,
    closed,
    outside,
    conflicts,
    crossings: bridges,
    levelsUsed,
    supports,
    length: total,
    laneChanges: moves.filter(m => LANE_CHANGE_IDS.includes(m.partId)).length,
    partCounts: countMoves(moves),
    difficultyScore: round2(score),
    difficulty: classify(score),
    accessories: accessories ?? [],
    accessoriesFit: accessories !== null,
    direction: travelDirection(placed),
    cuReachable: accessories !== null && cuEdgeDistance(accessories, cuEdge, areaW, areaD) <= CU_REACH,
  };
}

/** Bewertung in ein speicherbares Layout umwandeln. */
export function layoutFromEvaluation(e: Evaluation, areaW: number, areaD: number, chargingStations: number): Layout {
  return {
    pieces: e.pieces,
    areaWidth: areaW,
    areaDepth: areaD,
    length: e.length,
    laneChanges: e.laneChanges,
    crossings: e.crossings,
    levelsUsed: e.levelsUsed,
    supports: e.supports,
    difficultyScore: e.difficultyScore,
    difficulty: e.difficulty,
    partCounts: e.partCounts,
    chargingStations,
    accessories: e.accessories,
    direction: e.direction,
  };
}

export type CloseResult =
  | { ok: true; moves: Move[]; changedPieces: number }
  | { ok: false; reason: 'heading' | 'no-solution' | 'no-curves'; headingGap?: number };

/**
 * Strecke schließen, indem zwei Geradenabschnitte mit unterschiedlicher Richtung
 * verlängert oder gekürzt werden (Standardgerade, 1/3, 1/4). Die Richtung muss
 * bereits stimmen – fehlende Drehung lässt sich nur mit Kurven ausgleichen.
 */
export function closeByStraights(moves: Move[], start: Pose): CloseResult {
  if (!moves.some(m => isCurve(PART_BY_ID.get(m.partId)!))) return { ok: false, reason: 'no-curves' };
  // Drehung prüfen
  let pose = start;
  for (const m of moves) pose = place(pose, geometryOf(m.partId), m.dir);
  const headingGap = signedHeading(start.heading - pose.heading);
  if (Math.abs(headingGap) >= 0.5) return { ok: false, reason: 'heading', headingGap: Math.round(headingGap) };

  // In Abschnitte zerlegen: Gerade-Abschnitt, Kurvenblock, Gerade-Abschnitt, …
  interface Segment { fixed: Move[]; plain: Move[]; heading: number; fixedLen: number; }
  const segments: Segment[] = [];
  const corners: Move[][] = [];
  let seg: Segment = { fixed: [], plain: [], heading: start.heading, fixedLen: 0 };
  let corner: Move[] | null = null;
  let h = start.heading;
  for (const m of moves) {
    const part = PART_BY_ID.get(m.partId)!;
    if (isCurve(part)) {
      if (!corner) {
        segments.push(seg);
        corner = [];
      }
      corner.push(m);
      h = normalizeHeading(h + m.dir * (part.geometry as { angle: number }).angle);
    } else {
      if (corner) {
        corners.push(corner);
        corner = null;
        seg = { fixed: [], plain: [], heading: h, fixedLen: 0 };
      }
      if (PLAIN_STRAIGHTS.includes(m.partId)) seg.plain.push(m);
      else {
        seg.fixed.push(m);
        seg.fixedLen += pieceLength(part.geometry);
      }
    }
  }
  if (corner) {
    corners.push(corner);
    seg = { fixed: [], plain: [], heading: h, fixedLen: 0 };
  }
  segments.push(seg);

  // Versatz der Kurven allein (Geraden ändern die Richtung nicht)
  let cp: Pose = { x: 0, y: 0, heading: start.heading };
  for (const c of corners) for (const m of c) cp = place(cp, geometryOf(m.partId), m.dir);
  const plainUnits = segments.map(sg => sg.plain.reduce((a, m) => a + Math.round(pieceLength(geometryOf(m.partId)) / UNIT), 0));
  const u = segments.map(sg => ({ x: Math.cos((sg.heading * Math.PI) / 180), y: Math.sin((sg.heading * Math.PI) / 180) }));

  const representable = (n: number) => n === 0 || n === 3 || n === 4 || n >= 6;
  let best: { i: number; j: number; ni: number; nj: number; cost: number } | null = null;

  // Zuerst: ein einzelner Abschnitt reicht, wenn die Lücke in seiner Richtung liegt
  for (let i = 0; i < segments.length; i++) {
    let rx = -cp.x, ry = -cp.y;
    segments.forEach((sg, k) => {
      const len = sg.fixedLen + (k === i ? 0 : plainUnits[k] * UNIT);
      rx -= len * u[k].x;
      ry -= len * u[k].y;
    });
    const along = rx * u[i].x + ry * u[i].y;
    const n0 = Math.round(along / UNIT);
    for (const n of [n0, n0 + 1, n0 - 1]) {
      if (n < 0 || !representable(n)) continue;
      if (Math.hypot(n * UNIT * u[i].x - rx, n * UNIT * u[i].y - ry) > CLOSE_TOL) continue;
      const cost = Math.abs(n - plainUnits[i]);
      if (!best || cost < best.cost) best = { i, j: i, ni: n, nj: n, cost };
    }
  }

  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const det = u[i].x * u[j].y - u[i].y * u[j].x;
      if (Math.abs(det) < 0.3) continue;
      let rx = -cp.x, ry = -cp.y;
      segments.forEach((sg, k) => {
        const len = sg.fixedLen + (k === i || k === j ? 0 : plainUnits[k] * UNIT);
        rx -= len * u[k].x;
        ry -= len * u[k].y;
      });
      const li = (rx * u[j].y - ry * u[j].x) / det;
      const lj = (u[i].x * ry - u[i].y * rx) / det;
      const ni0 = Math.round(li / UNIT), nj0 = Math.round(lj / UNIT);
      for (const [di, dj] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const ni = ni0 + di, nj = nj0 + dj;
        if (ni < 0 || nj < 0 || !representable(ni) || !representable(nj)) continue;
        const ex = ni * UNIT * u[i].x + nj * UNIT * u[j].x - rx;
        const ey = ni * UNIT * u[i].y + nj * UNIT * u[j].y - ry;
        if (Math.hypot(ex, ey) > CLOSE_TOL) continue;
        const cost = Math.abs(ni - plainUnits[i]) + Math.abs(nj - plainUnits[j]);
        if (!best || cost < best.cost) best = { i, j, ni, nj, cost };
      }
    }
  }
  if (!best) return { ok: false, reason: 'no-solution' };

  const unlimited = { a: 999, b: 999, c: 999 };
  const plainMoves = (n: number): Move[] => {
    const d = decompose(n, { ...unlimited })!;
    return [
      ...Array(d[0]).fill({ partId: STANDARD, dir: 0 }),
      ...Array(d[1]).fill({ partId: '20020611', dir: 0 }),
      ...Array(d[2]).fill({ partId: '20020612', dir: 0 }),
    ];
  };
  const b = best;
  const out: Move[] = [];
  let changed = 0;
  segments.forEach((sg, k) => {
    let plain = sg.plain;
    if (k === b.i || k === b.j) {
      const n = k === b.i ? b.ni : b.nj;
      if (n !== plainUnits[k]) {
        plain = plainMoves(n);
        changed += Math.abs(plain.length - sg.plain.length) || 1;
      }
    }
    out.push(...sg.fixed, ...plain);
    if (k < corners.length) out.push(...corners[k]);
  });
  return { ok: true, moves: out, changedPieces: changed };
}
