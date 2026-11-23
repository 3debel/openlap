/**
 * Teilekatalog für Carrera EVOLUTION und DIGITAL 132.
 *
 * Alle Schienen der Serie EVOLUTION passen auch auf DIGITAL 132 (und
 * DIGITAL 124). Die Digital-Teile (Weichen, Boxengasse, Check Lane …)
 * funktionieren nur mit der Digital-Control-Unit.
 *
 * Maße in Millimetern, gemessen auf der Fahrbahnmitte.
 * Quellen: Händlerangaben (Längen der Geraden, Außendurchmesser der
 * Kurvenkreise, Spurlängen je 180°). Daraus abgeleitet:
 *   Fahrbahnbreite ≈ 200 mm, Spurabstand ≈ 100 mm,
 *   Kurvenradius Mitte: K1 ≈ 300, K2 ≈ 500, K3 ≈ 700, K4 ≈ 900.
 * `measured: false` heißt: Wert ist abgeleitet bzw. noch nicht an einem
 * echten Teil nachgemessen. Vor dem Streckeneditor an echten Teilen prüfen.
 */

export type SeriesId = 'evolution' | 'digital132';

export interface Series {
  id: SeriesId;
  name: string;
  scale: string;
}

export const SERIES: Series[] = [
  { id: 'evolution', name: 'Carrera Evolution', scale: '1:32' },
  { id: 'digital132', name: 'Carrera Digital 132', scale: '1:32' },
];

export type PartCategory = 'straight' | 'curve' | 'banked' | 'lanechange' | 'pit' | 'special';

export const CATEGORY_ORDER: PartCategory[] = ['straight', 'curve', 'banked', 'lanechange', 'pit', 'special'];

export const CATEGORY_LABELS: Record<PartCategory, string> = {
  straight: 'Straights',
  curve: 'Curves',
  banked: 'Banked curves',
  lanechange: 'Lane changes & switches',
  pit: 'Pit lane & timing',
  special: 'Special parts',
};

export type Geometry =
  | { kind: 'straight'; length: number }
  | { kind: 'curve'; radius: number; angle: number }
  | { kind: 'unknown' };

/** Besonderheit, die die Vorschau zusätzlich zeichnet */
export type PartFeature = 'banked' | 'switch' | 'crossover' | 'narrow' | 'bridge' | 'pit' | 'sensor';

export interface Part {
  /** Carrera-Artikelnummer (8-stellig) oder eigene Kennung */
  id: string;
  /** Artikelnummer zur Anzeige, null wenn nicht einzeln erhältlich */
  articleNo: string | null;
  name: { de: string; en: string };
  category: PartCategory;
  series: SeriesId[];
  geometry: Geometry;
  feature?: PartFeature;
  /** Teile pro Verkaufspackung (nur Info) */
  packSize?: number;
  measured: boolean;
  note?: { de: string; en: string };
}

export const TRACK_WIDTH = 200;
export const LANE_OFFSET = 50;

const BOTH: SeriesId[] = ['evolution', 'digital132'];
const DIGITAL: SeriesId[] = ['digital132'];

const R1 = 300, R2 = 500, R3 = 700, R4 = 900;
const STRAIGHT = 345;

export const PARTS: Part[] = [
  // ---- Geraden ----
  { id: '20020509', articleNo: '20020509', name: { de: 'Standardgerade', en: 'Standard straight' },
    category: 'straight', series: BOTH, geometry: { kind: 'straight', length: STRAIGHT }, packSize: 4, measured: false },
  { id: '20020611', articleNo: '20020611', name: { de: '1/3 Gerade', en: '1/3 straight' },
    category: 'straight', series: BOTH, geometry: { kind: 'straight', length: STRAIGHT / 3 }, packSize: 2, measured: false },
  { id: '20020612', articleNo: '20020612', name: { de: '1/4 Gerade', en: '1/4 straight' },
    category: 'straight', series: BOTH, geometry: { kind: 'straight', length: STRAIGHT / 4 }, packSize: 2, measured: false },
  { id: 'connection-straight', articleNo: null, name: { de: 'Anschlussgerade', en: 'Connection straight' },
    category: 'straight', series: BOTH, geometry: { kind: 'straight', length: STRAIGHT }, measured: false,
    note: { de: 'Aus der Grundpackung, für Netzteil bzw. Control Unit', en: 'From the starter set, for power supply or Control Unit' } },

  // ---- Kurven ----
  { id: '20020571', articleNo: '20020571', name: { de: 'Kurve 1/60°', en: 'Curve 1/60°' },
    category: 'curve', series: BOTH, geometry: { kind: 'curve', radius: R1, angle: 60 }, packSize: 3, measured: false },
  { id: '20020577', articleNo: '20020577', name: { de: 'Kurve 1/30°', en: 'Curve 1/30°' },
    category: 'curve', series: BOTH, geometry: { kind: 'curve', radius: R1, angle: 30 }, packSize: 6, measured: false },
  { id: '20020572', articleNo: '20020572', name: { de: 'Kurve 2/30°', en: 'Curve 2/30°' },
    category: 'curve', series: BOTH, geometry: { kind: 'curve', radius: R2, angle: 30 }, packSize: 6, measured: false },
  { id: '20020573', articleNo: '20020573', name: { de: 'Kurve 3/30°', en: 'Curve 3/30°' },
    category: 'curve', series: BOTH, geometry: { kind: 'curve', radius: R3, angle: 30 }, packSize: 6, measured: false },
  { id: '20020578', articleNo: '20020578', name: { de: 'Kurve 4/15°', en: 'Curve 4/15°' },
    category: 'curve', series: BOTH, geometry: { kind: 'curve', radius: R4, angle: 15 }, packSize: 12, measured: false },
  { id: '20020613', articleNo: '20020613', name: { de: 'Haarnadelkurve', en: 'Hairpin curve' },
    category: 'curve', series: BOTH, geometry: { kind: 'unknown' }, measured: false,
    note: { de: 'Set mit eigenen Kurventeilen – Maße folgen', en: 'Set with its own curve parts – dimensions to follow' } },

  // ---- Steilkurven ----
  { id: '20020574', articleNo: '20020574', name: { de: 'Steilkurve 1/30°', en: 'Banked curve 1/30°' },
    category: 'banked', series: BOTH, geometry: { kind: 'curve', radius: R1, angle: 30 }, feature: 'banked', packSize: 6, measured: false },
  { id: '20020575', articleNo: '20020575', name: { de: 'Steilkurve 2/30°', en: 'Banked curve 2/30°' },
    category: 'banked', series: BOTH, geometry: { kind: 'curve', radius: R2, angle: 30 }, feature: 'banked', packSize: 6, measured: false },
  { id: '20020576', articleNo: '20020576', name: { de: 'Steilkurve 3/30°', en: 'Banked curve 3/30°' },
    category: 'banked', series: BOTH, geometry: { kind: 'curve', radius: R3, angle: 30 }, feature: 'banked', packSize: 6, measured: false },
  { id: '20020579', articleNo: '20020579', name: { de: 'Steilkurve 4/15°', en: 'Banked curve 4/15°' },
    category: 'banked', series: BOTH, geometry: { kind: 'curve', radius: R4, angle: 15 }, feature: 'banked', packSize: 12, measured: false },

  // ---- Spurwechsel & Weichen ----
  { id: '20020517', articleNo: '20020517', name: { de: 'Spurwechsel (Kreuzung)', en: 'Lane crossover' },
    category: 'lanechange', series: BOTH, geometry: { kind: 'straight', length: STRAIGHT }, feature: 'crossover', packSize: 2, measured: false },
  { id: '20030343', articleNo: '20030343', name: { de: 'Weiche links', en: 'Lane change left' },
    category: 'lanechange', series: DIGITAL, geometry: { kind: 'straight', length: STRAIGHT }, feature: 'switch', measured: false },
  { id: '20030345', articleNo: '20030345', name: { de: 'Weiche rechts', en: 'Lane change right' },
    category: 'lanechange', series: DIGITAL, geometry: { kind: 'straight', length: STRAIGHT }, feature: 'switch', measured: false },
  { id: '20030347', articleNo: '20030347', name: { de: 'Doppelweiche', en: 'Double lane change' },
    category: 'lanechange', series: DIGITAL, geometry: { kind: 'straight', length: STRAIGHT }, feature: 'crossover', packSize: 2, measured: false },
  { id: '20030362', articleNo: '20030362', name: { de: 'Spurwechselkurve links, innen nach außen', en: 'Lane change curve left, in to out' },
    category: 'lanechange', series: DIGITAL, geometry: { kind: 'unknown' }, feature: 'switch', measured: false },
  { id: '20030363', articleNo: '20030363', name: { de: 'Spurwechselkurve links, außen nach innen', en: 'Lane change curve left, out to in' },
    category: 'lanechange', series: DIGITAL, geometry: { kind: 'unknown' }, feature: 'switch', measured: false },
  { id: '20030364', articleNo: '20030364', name: { de: 'Spurwechselkurve rechts, innen nach außen', en: 'Lane change curve right, in to out' },
    category: 'lanechange', series: DIGITAL, geometry: { kind: 'unknown' }, feature: 'switch', measured: false },
  { id: '20030365', articleNo: '20030365', name: { de: 'Spurwechselkurve rechts, außen nach innen', en: 'Lane change curve right, out to in' },
    category: 'lanechange', series: DIGITAL, geometry: { kind: 'unknown' }, feature: 'switch', measured: false },

  // ---- Boxengasse & Zeitmessung ----
  { id: '20030356', articleNo: '20030356', name: { de: 'Pit Lane (Boxengasse)', en: 'Pit lane' },
    category: 'pit', series: DIGITAL, geometry: { kind: 'unknown' }, feature: 'pit', measured: false,
    note: { de: 'Mehrteilig – Maße folgen', en: 'Multi-part – dimensions to follow' } },
  { id: '20030346', articleNo: '20030346', name: { de: 'Pit Stop Lane', en: 'Pit stop lane' },
    category: 'pit', series: DIGITAL, geometry: { kind: 'unknown' }, feature: 'pit', measured: false },
  { id: '20030341', articleNo: '20030341', name: { de: 'Einspurgerade für Pit-Stop-Verlängerung', en: 'Single-lane straight for pit stop extension' },
    category: 'pit', series: DIGITAL, geometry: { kind: 'unknown' }, feature: 'pit', measured: false },
  { id: '20030371', articleNo: '20030371', name: { de: 'Check Lane (Sektorzeit)', en: 'Check lane (sector timing)' },
    category: 'pit', series: DIGITAL, geometry: { kind: 'straight', length: STRAIGHT }, feature: 'sensor', measured: false },
  { id: '20030370', articleNo: '20030370', name: { de: 'Multistart Lane', en: 'Multistart lane' },
    category: 'pit', series: DIGITAL, geometry: { kind: 'unknown' }, feature: 'sensor', measured: false },

  // ---- Sonderteile ----
  { id: '20020516', articleNo: '20020516', name: { de: 'Engstelle', en: 'Chicane / narrow section' },
    category: 'special', series: BOTH, geometry: { kind: 'straight', length: STRAIGHT }, feature: 'narrow', packSize: 2, measured: false },
  { id: '20030350', articleNo: '20030350', name: { de: 'Engstelle links (Digital)', en: 'Narrow section left (Digital)' },
    category: 'special', series: DIGITAL, geometry: { kind: 'unknown' }, feature: 'narrow', measured: false },
  { id: '20030351', articleNo: '20030351', name: { de: 'Engstelle rechts (Digital)', en: 'Narrow section right (Digital)' },
    category: 'special', series: DIGITAL, geometry: { kind: 'unknown' }, feature: 'narrow', measured: false },
  { id: '20020587', articleNo: '20020587', name: { de: 'Überfahrt (Brücke)', en: 'Flyover (bridge)' },
    category: 'special', series: BOTH, geometry: { kind: 'straight', length: STRAIGHT }, feature: 'bridge', packSize: 4, measured: false,
    note: { de: '4 Teile mit Stützen, zusammen ca. 1380 mm', en: '4 parts with supports, about 1380 mm in total' } },
];

export function partsForSeries(series: SeriesId): Part[] {
  return PARTS.filter(part => part.series.includes(series));
}

export function partName(part: Part, lang: string): string {
  return lang?.startsWith('de') ? part.name.de : part.name.en;
}

export function partNote(part: Part, lang: string): string | undefined {
  if (!part.note) return undefined;
  return lang?.startsWith('de') ? part.note.de : part.note.en;
}

/** Kurzbeschreibung der Maße, z. B. "345 mm" oder "R 300 · 30°" */
export function geometryLabel(geometry: Geometry): string | undefined {
  switch (geometry.kind) {
    case 'straight':
      return `${Math.round(geometry.length)} mm`;
    case 'curve':
      return `R ${geometry.radius} · ${geometry.angle}°`;
    default:
      return undefined;
  }
}
