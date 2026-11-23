// Prüft den Streckengenerator ohne Browser: npx tsx scripts/check-generator.ts
import { generateLayouts, GeneratorOptions } from '../src/app/track/generator';
import { PARTS } from '../src/app/track/catalog';

const INF = Infinity;
const unlimited: Record<string, number> = {};
for (const p of PARTS) if (p.geometry.kind !== 'unknown') unlimited[p.id] = INF;
// typische Grundpackung + etwas Ausbau
const starter: Record<string, number> = {
  'connection-straight': 1, '20020509': 10, '20020611': 2, '20020612': 2,
  '20020577': 16, '20020572': 8, '20020575': 6, '20030345': 1, '20030343': 1, '20030347': 2,
};

async function run(name: string, o: Partial<GeneratorOptions>) {
  const opts: GeneratorOptions = { areaWidth: 3000, areaDepth: 1500, levels: 1, minLaneChanges: 0,
    difficulty: 'medium', counts: starter, seed: 42, timeBudgetMs: 2500, ...o } as GeneratorOptions;
  const t = Date.now();
  const r = await generateLayouts(opts);
  const dt = Date.now() - t;
  console.log(`\n== ${name}: ${r.layouts.length} Vorschläge, ${r.attempts} Versuche, ${dt} ms, Hinweise: ${r.warnings.join(',') || '-'}`);
  for (const l of r.layouts) {
    // Geschlossenheit nachrechnen
    const last = l.pieces[l.pieces.length - 1].end, first = l.pieces[0].start;
    const gap = Math.hypot(last.x - first.x, last.y - first.y).toFixed(1);
    const inside = l.pieces.every(p => p.start.x >= 0 && p.start.x <= opts.areaWidth && p.start.y >= 0 && p.start.y <= opts.areaDepth);
    const over = Object.entries(l.partCounts).filter(([id, n]) => n > (opts.counts[id] ?? 0));
    console.log(`  ${(l.length/1000).toFixed(2)} m, ${l.pieces.length} Teile, Score ${l.difficultyScore} (${l.difficulty}), SW ${l.laneChanges}, Kreuz ${l.crossings}, Ebenen ${l.levelsUsed}, Stützen ${l.supports}, Lücke ${gap} mm, innen ${inside}, Bestand ok ${over.length===0}`);
  }
}

(async () => {
  await run('leicht 3x1,5 Grundpackung', { difficulty: 'easy' });
  await run('mittel 3x1,5 Grundpackung', { difficulty: 'medium' });
  await run('schwer 3x1,5 Grundpackung', { difficulty: 'hard' });
  await run('mittel 2 Spurwechsel', { minLaneChanges: 2 });
  await run('2 Ebenen Grundpackung', { levels: 2 });
  await run('3 Ebenen unbegrenzt 4x2', { levels: 3, counts: unlimited, areaWidth: 4000, areaDepth: 2000 });
  await run('schwer unbegrenzt 4x2', { difficulty: 'hard', counts: unlimited, areaWidth: 4000, areaDepth: 2000 });
  await run('klein 1,6x0,9 leicht', { difficulty: 'easy', areaWidth: 1600, areaDepth: 900 });
  await run('zu viele Spurwechsel', { minLaneChanges: 9 });
})();
