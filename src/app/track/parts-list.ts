import { ACCESSORIES, CATEGORY_ORDER, PARTS, accessoryName, partName } from './catalog';
import { CONNECTION, Layout } from './generator';
import { PowerPlan } from './power';

export interface PartsListRow {
  name: string;
  articleNo: string | null;
  count: number;
  owned: number | null;
  missing: number;
  partId?: string;
}

export interface PartsList {
  track: PartsListRow[];
  accessories: PartsListRow[];
  missingTotal: number;
}

/**
 * Teileliste einer Strecke: Schienen (mit Abgleich gegen den Bestand) und Zubehör
 * (Ladeschalen, Zusatzeinspeisung, Netzteil). Die Anschlussschiene mit Control Unit
 * gilt als vorhanden (Bestandteil jeder Digital-Grundpackung).
 */
export function buildPartsList(layout: Layout, power: PowerPlan | null, inventory: Record<string, number>, lang: string): PartsList {
  const order = new Map(PARTS.map((p, i) => [p.id, CATEGORY_ORDER.indexOf(p.category) * 100 + i]));
  const track: PartsListRow[] = Object.entries(layout.partCounts)
    .sort(([a], [b]) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    .map(([id, count]) => {
      const part = PARTS.find(p => p.id === id)!;
      const owned = id === CONNECTION ? Math.max(1, inventory[id] ?? 0) : (inventory[id] ?? 0);
      return { partId: id, name: partName(part, lang), articleNo: part.articleNo, count, owned, missing: Math.max(0, count - owned) };
    });

  const accessories: PartsListRow[] = [];
  if (layout.chargingStations > 0) {
    const a = ACCESSORIES['charger'];
    accessories.push({ name: accessoryName(a, lang), articleNo: a.articleNo, count: layout.chargingStations, owned: null, missing: 0 });
  }
  if (power) {
    for (const key of ['feed5', 'feed10'] as const) {
      if (power.cables[key] > 0) {
        const a = ACCESSORIES[key];
        accessories.push({ name: accessoryName(a, lang), articleNo: a.articleNo, count: power.cables[key], owned: null, missing: 0 });
      }
    }
    if (power.source === 'internal') {
      const a = ACCESSORIES['transformer'];
      accessories.push({ name: accessoryName(a, lang), articleNo: a.articleNo, count: 1, owned: null, missing: 0 });
    }
  }
  return { track, accessories, missingTotal: track.reduce((s, r) => s + r.missing, 0) };
}
