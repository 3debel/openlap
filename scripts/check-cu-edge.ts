// Standort der Control Unit prüfen: npx tsx scripts/check-cu-edge.ts
import { generateLayouts, cuEdgeDistance } from '../src/app/track/generator';
import { PARTS } from '../src/app/track/catalog';
import { planPower } from '../src/app/track/power';
const unlimited: Record<string, number> = {};
for (const p of PARTS) if (p.geometry.kind !== 'unknown') unlimited[p.id] = Infinity;
(async () => {
  for (const cuEdge of ['front', 'back', 'left', 'right', 'any'] as const) {
    for (const direction of ['cw', 'ccw'] as const) {
      const r = await generateLayouts({ areaWidth: 3000, areaDepth: 1500, levels: 1, minLaneChanges: 0, difficulty: 'medium', counts: unlimited, seed: 9, timeBudgetMs: 1200, direction, cuEdge });
      const info = r.layouts.map(l => {
        const cu = l.accessories.find(a => a.kind === 'controlunit')!;
        const inside = l.pieces.every(p => p.start.x >= 0 && p.start.x <= 3000 && p.start.y >= 0 && p.start.y <= 1500);
        return `${l.direction} CU(${cu.x.toFixed(0)},${cu.y.toFixed(0)}) Abstand ${cuEdgeDistance(l.accessories, cuEdge, 3000, 1500).toFixed(0)} innen ${inside}`;
      });
      console.log(`${cuEdge.padEnd(5)} ${direction}: ${r.layouts.length} | ${info.join(' | ')}`);
    }
  }
  const r = await generateLayouts({ areaWidth: 4000, areaDepth: 2000, levels: 1, minLaneChanges: 0, difficulty: 'medium', counts: unlimited, seed: 9, timeBudgetMs: 1200 });
  for (const cars of [2, 4, 6, 8]) {
    const p = planPower(r.layouts[0].pieces, 'internal', 'new', 'digital132', cars);
    console.log(`${(r.layouts[0].length / 1000).toFixed(1)} m, ${cars} Autos: ${p.loadAmps.toFixed(1)} A, ${p.dropWithout.toFixed(2)} V → ${p.points.length} ZE`);
  }
})();
