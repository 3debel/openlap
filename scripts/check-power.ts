// Spannungsfall-Modell prüfen: npx tsx scripts/check-power.ts
import { generateLayouts } from '../src/app/track/generator';
import { planPower } from '../src/app/track/power';
import { PARTS } from '../src/app/track/catalog';
const unlimited: Record<string, number> = {};
for (const p of PARTS) if (p.geometry.kind !== 'unknown') unlimited[p.id] = Infinity;
(async () => {
  const sizes: [number, number][] = [[2000, 1000], [3000, 1500], [4000, 2000], [5000, 2500], [6000, 3000]];
  for (const [w, d] of sizes) {
    const r = await generateLayouts({ areaWidth: w, areaDepth: d, levels: 1, minLaneChanges: 0, difficulty: 'medium', counts: unlimited, seed: 7, timeBudgetMs: 1500, maxResults: 3 });
    for (const l of r.layouts) {
      const a = planPower(l.pieces, 'internal', 'new'), b = planPower(l.pieces, 'internal', 'used');
      console.log(`${(l.length / 1000).toFixed(1).padStart(5)} m | neu: ${a.dropWithout.toFixed(2)} V → ${a.points.length} ZE → ${a.dropWith.toFixed(2)} V (${a.need}) | gebraucht: ${b.dropWithout.toFixed(2)} V → ${b.points.length} ZE → ${b.dropWith.toFixed(2)} V | ${a.notes.join(',')}`);
    }
  }
})();
