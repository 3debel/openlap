/**
 * Stromplan: Empfehlung für Zusatzeinspeisungen (Carrera DIGITAL 132).
 *
 * Grundlagen (Händler- und Forenangaben, siehe Umsetzungsplan):
 *  - Bei Digital-Bahnen alle 5 m einspeisen; enger (2–3 m) gibt mehr Reserve,
 *    besonders bei vielen Fahrzeugen und Weichen.
 *  - Carrera-Zusatzeinspeisung 20020584 (5 m) / 20020585 (10 m): 4-adriges Kabel
 *    mit Messinglaschen, die von unten in die Anschlussschiene oder eine
 *    beliebige Standardgerade geschoben werden.
 *  - Sternförmig von der Anschlussschiene (Control Unit) aus verlegen.
 *  - Strom muss wegen des Digitalsignals immer über die Control Unit kommen –
 *    auch eine „externe“ Quelle ist ein stärkeres Netzteil an der Control Unit,
 *    niemals ein zweites Netzteil direkt an den Schienen.
 */

import { PlacedPiece } from './generator';

export type FeedSource = 'internal' | 'external';
export type FeedSpacing = 5000 | 2500;

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
  source: FeedSource;
  spacing: FeedSpacing;
  trackLength: number;
  /** Anschlussschiene (Start der Kabel) */
  origin: { x: number; y: number } | null;
  points: FeedPoint[];
  cables: { feed5: number; feed10: number };
  /** Hinweise als Übersetzungsschlüssel */
  notes: string[];
}

const STANDARD = '20020509';
/** Kabel läuft unter der Bahn nicht gerade: Zuschlag und Reserve */
const ROUTE_FACTOR = 1.3;
const ROUTE_RESERVE = 500;

export function planPower(pieces: PlacedPiece[], source: FeedSource, spacing: FeedSpacing): PowerPlan {
  const total = pieces.reduce((a, p) => a + p.length, 0);
  const notes: string[] = [];
  const plan: PowerPlan = { source, spacing, trackLength: total, origin: null, points: [], cables: { feed5: 0, feed10: 0 }, notes };
  if (!pieces.length) return plan;

  const mid = (p: PlacedPiece) => {
    const t = (p.start.heading * Math.PI) / 180;
    return { x: p.start.x + Math.cos(t) * p.length / 2, y: p.start.y + Math.sin(t) * p.length / 2 };
  };
  plan.origin = mid(pieces[0]);

  // Anzahl: so, dass kein Punkt der Strecke weiter als spacing/2 von einer Einspeisung entfernt ist
  const feeds = Math.max(0, Math.ceil(total / spacing) - 1);
  if (feeds === 0) {
    notes.push('power_note_short');
    return plan;
  }

  const offsets: number[] = [];
  let acc = 0;
  for (const p of pieces) {
    offsets.push(acc);
    acc += p.length;
  }
  const used = new Set<number>([0]);
  for (let k = 1; k <= feeds; k++) {
    const target = (total * k) / (feeds + 1);
    // nächstgelegene freie Standardgerade (Laschen passen nur dort bzw. in die Anschlussschiene)
    let bestIdx = -1, bestD = Infinity;
    pieces.forEach((p, i) => {
      if (p.partId !== STANDARD || used.has(i)) return;
      const d = Math.abs(offsets[i] + p.length / 2 - target);
      if (d < bestD) { bestD = d; bestIdx = i; }
    });
    if (bestIdx < 0 || bestD > spacing / 2) {
      notes.push('power_note_no_straight');
      continue;
    }
    used.add(bestIdx);
    const m = mid(pieces[bestIdx]);
    const distance = Math.hypot(m.x - plan.origin.x, m.y - plan.origin.y);
    const cableNeeded = distance * ROUTE_FACTOR + ROUTE_RESERVE;
    const cable = cableNeeded <= 5000 ? 'feed5' : cableNeeded <= 10000 ? 'feed10' : null;
    if (cable) plan.cables[cable]++;
    else notes.push('power_note_too_far');
    plan.points.push({ no: plan.points.length + 1, piece: bestIdx, at: offsets[bestIdx] + pieces[bestIdx].length / 2, x: m.x, y: m.y, distance, cableNeeded, cable });
  }
  plan.points.sort((a, b) => a.at - b.at).forEach((p, i) => p.no = i + 1);
  if (source === 'external') notes.push('power_note_external');
  return plan;
}

/** Laufende Nummer eines Teils (1-basiert, Start/Ziel = 1) – für „Standardgerade Nr. 7“. */
export function pieceNumber(index: number) {
  return index + 1;
}
