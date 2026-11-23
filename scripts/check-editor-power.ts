// Prüft Control Unit als Start, Ladeschalen, Editor-Schließen und Stromplan: npx tsx scripts/check-editor-power.ts
import { generateLayouts, evaluateMoves, closeByStraights, Move } from '../src/app/track/generator';
import { planPower } from '../src/app/track/power';
const starter: Record<string, number> = { '20020509': 10, '20020611': 2, '20020612': 2, '20020577': 16, '20020572': 8, '20020575': 6, '20030345': 1, '20030343': 1 };
(async () => {
  for (const cs of [0, 2, 4]) {
    const r = await generateLayouts({ areaWidth: 3000, areaDepth: 1500, levels: 1, minLaneChanges: 1, difficulty: 'medium', counts: starter, chargingStations: cs, seed: 7, timeBudgetMs: 6000 });
    console.log(`\nLadeschalen ${cs}: ${r.layouts.length} Vorschläge, ${r.attempts} Versuche ${r.warnings}`);
    for (const l of r.layouts) {
      const ids = l.pieces.slice(0, 4).map(p => p.partId).join(',');
      console.log(`  ${(l.length/1000).toFixed(1)} m, Start: ${ids}, Zubehör: ${l.accessories.map(a => a.kind).join('/')}, Teile ${JSON.stringify(l.partCounts).slice(0,80)}`);
    }
    if (!r.layouts.length) continue;
    const l = r.layouts[0];
    const moves: Move[] = l.pieces.map(p => ({ partId: p.partId, dir: p.dir }));
    const e0 = evaluateMoves(moves, l.pieces[0].start, 3000, 1500, cs);
    console.log(`  evaluate: geschlossen ${e0.closed}, Lücke ${e0.gap}, außerhalb ${e0.outside}, Konflikte ${e0.conflicts.length}, Zubehör passt ${e0.accessoriesFit}`);
    // eine Standardgerade entfernen -> offen
    const idx = moves.findIndex((m, i) => i > 2 && m.partId === '20020509');
    const broken = moves.filter((_, i) => i !== idx);
    const e1 = evaluateMoves(broken, l.pieces[0].start, 3000, 1500, cs);
    const c = closeByStraights(broken, l.pieces[0].start);
    const e2 = c.ok ? evaluateMoves(c.moves, l.pieces[0].start, 3000, 1500, cs) : null;
    console.log(`  nach Entfernen: Lücke ${e1.gap} mm, Winkel ${e1.headingGap}° -> schließen: ${c.ok ? 'ok, ' + c.changedPieces + ' Teile geändert, Lücke ' + e2!.gap + ', geschlossen ' + e2!.closed : (c as any).reason}`);
    // Kurve entfernen -> Richtung fehlt
    const ci = moves.findIndex(m => m.partId === '20020577');
    const c2 = closeByStraights(moves.filter((_, i) => i !== ci), l.pieces[0].start);
    console.log(`  Kurve entfernt -> ${c2.ok ? 'ok' : (c2 as any).reason + ' ' + ((c2 as any).headingGap ?? '')}°`);
    for (const sp of ['new', 'used'] as const) {
      const pp = planPower(l.pieces, 'internal', sp as any);
      console.log(`  Verbindungen ${sp}: ${pp.dropWithout.toFixed(2)} V → ${pp.dropWith.toFixed(2)} V, ${pp.points.length} Einspeisungen ${pp.points.map(p => `Teil ${p.piece+1} bei ${(p.at/1000).toFixed(1)} m, Kabel ${p.cable} (${(p.cableNeeded/1000).toFixed(1)} m)`).join('; ')} ${pp.notes}`);
    }
  }
  const big = await generateLayouts({ areaWidth: 5000, areaDepth: 6000, levels: 2, minLaneChanges: 0, difficulty: 'hard', counts: Object.fromEntries(['20020509','20020611','20020612','20020571','20020577','20020572','20020573','20020578','20020574','20020575'].map(k => [k, Infinity])), chargingStations: 2, seed: 3, timeBudgetMs: 6000 });
  const L = big.layouts[0];
  if (L) {
    const pp = planPower(L.pieces, 'external', 'new');
    console.log(`\nGroß: ${(L.length/1000).toFixed(1)} m, Ebenen ${L.levelsUsed}, Einspeisungen ${pp.points.length}, Kabel 5m ${pp.cables.feed5} 10m ${pp.cables.feed10}, Hinweise ${pp.notes}`);
  }
})();
