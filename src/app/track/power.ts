/**
 * Stromplan: Empfehlung für Zusatzeinspeisungen (Carrera DIGITAL 132).
 *
 * Rechenweg: Spannungsfall über die Widerstände der Schienen und der
 * Steckverbindungen. Die Strecke ist ein Ring – der Strom erreicht jeden Punkt
 * von beiden Seiten; jede Zusatzeinspeisung ist ein weiterer Weg direkt von der
 * Control Unit (sternförmig). Für jeden Punkt der Strecke wird der Spannungsfall
 * berechnet, wenn dort ein Fahrzeug Strom zieht. Liegt der größte Wert über der
 * Grenze, wird an der schlechtesten Stelle eine Einspeisung gesetzt – so lange,
 * bis die Grenze eingehalten ist.
 *
 * Kennwerte (Carrera veröffentlicht keine; Schätzwerte aus Messungen an
 * anderen Systemen, geeicht an den Carrera-Erfahrungswerten):
 *  - Übergangswiderstand je Steckverbindung und Leiter: neu ≈ 25 mΩ,
 *    gebraucht/oxidiert ≈ 50 mΩ (Messung lockerer Schienenverbinder: Ø 48 mΩ)
 *  - Schiene (Stahlband): ≈ 0,05 Ω/m je Leiter (Stahlschiene im Slotcar-Bereich
 *    ≈ 0,13 Ω/m bei kleinerem Querschnitt)
 *  - Last: größtmögliche Zahl gleichzeitig fahrender Autos (6 über Handregler
 *    + Pace Car + Autonomous Car = 8), je ≈ 0,6 A (D132) bzw. 0,8 A (D124),
 *    insgesamt höchstens so viel, wie das Netzteil liefert
 *    (D132: 51,8 VA / 14,8 V = 3,5 A; D124: 54 VA / 18 V = 3,0 A).
 *    Die Autos fahren gleichmäßig verteilt; geprüft wird jede Lage des Feldes.
 *  - Grenze: 5 % der Netzteilspannung (D132 0,74 V, D124 0,9 V).
 *  - Carrera-Zusatzeinspeisung 20020584 (5 m) / 20020585 (10 m): 4-adriges Kabel
 *    mit Messinglaschen, die von unten in die Anschlussschiene oder eine
 *    beliebige Standardgerade geschoben werden; sternförmig von der Control Unit.
 *  - Strom muss wegen des Digitalsignals immer über die Control Unit kommen –
 *    auch eine „externe“ Quelle ist ein stärkeres Netzteil an der Control Unit,
 *    niemals ein zweites Netzteil direkt an den Schienen.
 */

import { PlacedPiece } from './generator';

export type FeedSource = 'internal' | 'external';
/** Zustand der Steckverbindungen */
export type JointCondition = 'new' | 'used';

export const JOINT_OHM: Record<JointCondition, number> = { new: 0.025, used: 0.05 };
export const RAIL_OHM_PER_M = 0.05;
/** Kabel der Zusatzeinspeisung je Leiter (≈ 0,5 mm² Kupfer) */
export const CABLE_OHM_PER_M = 0.035;
export type TrackSystem = 'digital132' | 'digital124';

export interface SupplyData {
  volts: number;
  va: number;
  /** geschätzte Stromaufnahme je Auto unter Last (A) */
  ampsPerCar: number;
}
export const SUPPLY: Record<TrackSystem, SupplyData> = {
  digital132: { volts: 14.8, va: 51.8, ampsPerCar: 0.6 },
  digital124: { volts: 18, va: 54, ampsPerCar: 0.8 },
};
/** 6 Fahrer + Pace Car + Autonomous Car */
export const MAX_CARS = 8;
/** zulässiger Spannungsfall: Anteil der Netzteilspannung */
export const MAX_DROP_SHARE = 0.05;
/** darunter keine Empfehlung; dazwischen „optional“ */
export const OPTIONAL_SHARE = 0.85;

export function loadFor(system: TrackSystem) {
  const sup = SUPPLY[system];
  const total = Math.min(MAX_CARS * sup.ampsPerCar, sup.va / sup.volts);
  return { cars: MAX_CARS, total, perCar: total / MAX_CARS, maxDrop: sup.volts * MAX_DROP_SHARE, volts: sup.volts };
}

export interface FeedPoint {
  /** fortlaufende Nummer ab 1 */
  no: number;
  /** Index des Bahnteils (Standardgerade) */
  piece: number;
  /** Position entlang der Strecke ab Start/Ziel (mm) */
  at: number;
  /** Mittelpunkt der Standardgerade */
  x: number;
  y: number;
  /** Luftlinie Control Unit → Einspeisepunkt (mm) */
  distance: number;
  /** geschätzte Kabellänge unter der Bahn (mm) */
  cableNeeded: number;
  /** passendes Carrera-Kabel oder null (zu lang) */
  cable: 'feed5' | 'feed10' | null;
}

export interface PowerPlan {
  /** 'none': Spannungsfall gering, 'optional': spürbar, 'recommended': über der Grenze */
  need: 'none' | 'optional' | 'recommended';
  source: FeedSource;
  joints: JointCondition;
  system: TrackSystem;
  /** zulässiger Spannungsfall (V) */
  maxDrop: number;
  /** Gesamtstrom aller Autos in der Rechnung (A) und Zahl der Autos */
  loadAmps: number;
  cars: number;
  /** größter Spannungsfall ohne Zusatzeinspeisung (V) */
  dropWithout: number;
  /** größter Spannungsfall mit den vorgeschlagenen Einspeisungen (V) */
  dropWith: number;
  /** Stelle des größten Spannungsfalls ohne Einspeisung (mm ab Start/Ziel) */
  worstAt: number;
  trackLength: number;
  /** Anschlussschiene (Start der Kabel) */
  origin: { x: number; y: number } | null;
  points: FeedPoint[];
  cables: { feed5: number; feed10: number };
  /** Hinweise als Übersetzungsschlüssel */
  notes: string[];
}

const STANDARD = '20020509';
const CONNECTION = 'connection-straight';
/** Kabel läuft unter der Bahn nicht gerade: Zuschlag und Reserve */
const ROUTE_FACTOR = 1.3;
const ROUTE_RESERVE = 500;
const MAX_FEEDS = 12;

/**
 * Widerstandsmatrix des Netzes (Knoten = Teilgrenzen, Knoten 0 = Anschlussschiene
 * mit fester Spannung). Z[i][j] = Spannungsfall an Knoten i je Ampere an Knoten j.
 * Widerstände als Schleife (Hin- und Rückleiter zusammen).
 */
function impedance(pieces: { length: number }[], jointOhm: number, feeds: { node: number; ohm: number }[]): number[][] {
  const n = pieces.length;
  const m = n - 1;
  const g = pieces.map(p => 1 / (2 * (p.length / 1000 * RAIL_OHM_PER_M + jointOhm)));
  const A: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
  const add = (a: number, b: number, v: number) => {
    if (a > 0) A[a - 1][a - 1] += v;
    if (b > 0) A[b - 1][b - 1] += v;
    if (a > 0 && b > 0) { A[a - 1][b - 1] -= v; A[b - 1][a - 1] -= v; }
  };
  for (let i = 0; i < n; i++) add(i, (i + 1) % n, g[i]);
  for (const f of feeds) if (f.node > 0) add(f.node, 0, 1 / f.ohm);
  const inv: number[][] = Array.from({ length: m }, (_, i) => { const r = new Array(m).fill(0); r[i] = 1; return r; });
  for (let c = 0; c < m; c++) {
    let piv = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    [inv[c], inv[piv]] = [inv[piv], inv[c]];
    const d = A[c][c];
    for (let k = 0; k < m; k++) { A[c][k] /= d; inv[c][k] /= d; }
    for (let r = 0; r < m; r++) {
      if (r === c || A[r][c] === 0) continue;
      const f = A[r][c];
      for (let k = 0; k < m; k++) { A[r][k] -= f * A[c][k]; inv[r][k] -= f * inv[c][k]; }
    }
  }
  // um Knoten 0 erweitern (Spannungsfall 0)
  return [new Array(n).fill(0), ...inv.map(row => [0, ...row])];
}

/**
 * Größter Spannungsfall je Knoten, wenn `cars` Autos mit je `perCar` A
 * gleichmäßig verteilt fahren – für jede Lage des Feldes rund um die Strecke.
 */
export function voltageDrops(pieces: { length: number }[], jointOhm: number, feeds: { node: number; ohm: number }[],
                             cars = 1, perCar = 1): number[] {
  const n = pieces.length;
  if (n < 2) return pieces.map(() => 0);
  const Z = impedance(pieces, jointOhm, feeds);
  const offs: number[] = [];
  let acc = 0;
  for (const p of pieces) { offs.push(acc); acc += p.length; }
  const total = acc;
  const nodeAt = (s: number) => {
    s = ((s % total) + total) % total;
    let lo = 0;
    for (let i = 0; i < n; i++) if (offs[i] <= s) lo = i;
    return lo;
  };
  const worst = new Array(n).fill(0);
  for (let k = 0; k < n; k++) {
    // Feld so verteilt, dass ein Auto auf Knoten k steht
    const nodes = [...Array(cars)].map((_, c) => nodeAt(offs[k] + (c * total) / cars));
    for (let i = 0; i < n; i++) {
      let v = 0;
      for (const j of nodes) v += Z[i][j] * perCar;
      if (v > worst[i]) worst[i] = v;
    }
  }
  return worst;
}

export function planPower(pieces: PlacedPiece[], source: FeedSource, joints: JointCondition, system: TrackSystem = 'digital132'): PowerPlan {
  const total = pieces.reduce((a, p) => a + p.length, 0);
  const notes: string[] = [];
  const load = loadFor(system);
  const MAX_DROP = load.maxDrop, OPTIONAL_DROP = load.maxDrop * OPTIONAL_SHARE;
  const drop = (f: { node: number; ohm: number }[]) => voltageDrops(seq, jointOhm, f, load.cars, load.perCar);
  const plan: PowerPlan = { need: 'none', source, joints, system, maxDrop: MAX_DROP, loadAmps: load.total, cars: load.cars, dropWithout: 0, dropWith: 0, worstAt: 0, trackLength: total, origin: null, points: [], cables: { feed5: 0, feed10: 0 }, notes };
  if (!pieces.length) return plan;

  const mid = (p: PlacedPiece) => {
    const t = (p.start.heading * Math.PI) / 180;
    return { x: p.start.x + Math.cos(t) * p.length / 2, y: p.start.y + Math.sin(t) * p.length / 2 };
  };
  const ci = Math.max(0, pieces.findIndex(p => p.partId === CONNECTION));
  plan.origin = mid(pieces[ci]);
  // Knoten 0 = Anschlussschiene: Reihenfolge ab der Anschlussschiene
  const order = pieces.map((_, i) => (ci + i) % pieces.length);
  const seq = order.map(i => pieces[i]);
  const jointOhm = JOINT_OHM[joints];
  const offsets: number[] = [];
  let acc = 0;
  for (const p of pieces) { offsets.push(acc); acc += p.length; }

  const feeds: { node: number; ohm: number; piece: number; cableNeeded: number; distance: number }[] = [];
  let drops = drop(feeds);
  const worst = (d: number[]) => d.reduce((b, v, i) => v > d[b] ? i : b, 0);
  plan.dropWithout = Math.max(...drops);
  plan.worstAt = offsets[order[worst(drops)]];

  const used = new Set<number>([ci]);
  while (Math.max(...drops) > MAX_DROP && feeds.length < MAX_FEEDS) {
    const w = worst(drops);
    // freie Standardgerade, die den Spannungsfall am stärksten senkt (in der Nähe der schlechtesten Stelle)
    let best: typeof feeds[0] | null = null, bestDrop = Infinity;
    const cand = seq.map((p, k) => ({ p, k })).filter(({ p, k }) => p.partId === STANDARD && !used.has(order[k]))
      .sort((a, b) => Math.abs(a.k - w) - Math.abs(b.k - w)).slice(0, 6);
    for (const { p, k } of cand) {
      const m = mid(p);
      const distance = Math.hypot(m.x - plan.origin.x, m.y - plan.origin.y);
      const cableNeeded = distance * ROUTE_FACTOR + ROUTE_RESERVE;
      const ohm = 2 * (cableNeeded / 1000 * CABLE_OHM_PER_M + jointOhm);
      const f = { node: k, ohm, piece: order[k], cableNeeded, distance };
      const d = Math.max(...drop([...feeds, f]));
      if (d < bestDrop) { bestDrop = d; best = f; }
    }
    if (!best) { notes.push('power_note_no_straight'); break; }
    feeds.push(best);
    used.add(best.piece);
    drops = drop(feeds);
  }
  plan.dropWith = Math.max(...drops);
  plan.need = plan.dropWithout > MAX_DROP ? 'recommended' : plan.dropWithout > OPTIONAL_DROP ? 'optional' : 'none';
  notes.unshift(plan.need === 'none' ? 'power_note_short' : plan.need === 'optional' ? 'power_note_optional' : 'power_note_recommended');
  if (plan.dropWith > MAX_DROP && feeds.length) notes.push('power_note_still_high');

  for (const f of feeds) {
    const cable = f.cableNeeded <= 5000 ? 'feed5' : f.cableNeeded <= 10000 ? 'feed10' : null;
    if (cable) plan.cables[cable]++;
    else notes.push('power_note_too_far');
    const p = pieces[f.piece], m = mid(p);
    plan.points.push({ no: 0, piece: f.piece, at: offsets[f.piece] + p.length / 2, x: m.x, y: m.y, distance: f.distance, cableNeeded: f.cableNeeded, cable });
  }
  plan.points.sort((a, b) => a.at - b.at).forEach((p, i) => p.no = i + 1);
  if (plan.need !== 'none' && pieces.some(p => ['20030343', '20030345', '20030347'].includes(p.partId))) notes.push('power_note_switches');
  if (source === 'external') notes.push('power_note_external');
  plan.notes = [...new Set(notes)];
  return plan;
}

/** Laufende Nummer eines Teils (1-basiert, Start/Ziel = 1) – für „Standardgerade Nr. 7“. */
export function pieceNumber(index: number) {
  return index + 1;
}
