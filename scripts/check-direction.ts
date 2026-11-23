// Fahrtrichtung prüfen: npx tsx scripts/check-direction.ts
import { generateLayouts, reverseMoves, evaluateMoves, travelDirection, CU_SIDE } from '../src/app/track/generator';
import { PARTS } from '../src/app/track/catalog';
const unlimited: Record<string, number> = {};
for (const p of PARTS) if (p.geometry.kind !== 'unknown') unlimited[p.id] = Infinity;
(async () => {
  for (const direction of ['cw', 'ccw', 'auto'] as const) {
    for (const levels of [1, 2] as const) {
      const r = await generateLayouts({ areaWidth: 4000, areaDepth: 2000, levels, minLaneChanges: 0, difficulty: 'medium', counts: unlimited, seed: 5, timeBudgetMs: 1500, direction });
      const info = r.layouts.map(l => {
        const cu = l.accessories.find(a => a.kind === 'controlunit')!;
        const moves = l.pieces.map(p => ({ partId: p.partId, dir: p.dir }));
        const rev = reverseMoves(moves, l.pieces[0].start);
        const e = evaluateMoves(rev.moves, rev.start, 4000, 2000, 0);
        return `${l.direction}/CU-Seite ${cu.side} → umgekehrt ${e.direction}, geschlossen ${e.closed}, Lücke ${e.gap}`;
      });
      console.log(`${direction} ${levels} Ebene(n): ${r.layouts.length} Vorschläge ${r.warnings.join(',')} | ${info.join(' | ')}`);
    }
  }
  console.log('CU_SIDE', CU_SIDE, travelDirection([] as any));
})();
