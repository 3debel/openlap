// Prüft die Schwierigkeitsbewertung an Referenzstrecken: npx tsx scripts/check-difficulty.ts
import { scoreDifficulty, classify, difficultyFeatures } from '../src/app/track/generator';
import { planPower } from '../src/app/track/power';
type P = { partId: string; dir: 1 | -1 };
const S = (n = 1): P[] => Array(n).fill({ partId: '20020509', dir: 1 });
const C = (id: string, n: number, dir: 1 | -1 = 1): P[] => Array(n).fill({ partId: id, dir });
const R1 = '20020577', R2 = '20020572', R3 = '20020575';
const cases: [string, P[]][] = [
  ['Oval R1', [...S(4), ...C(R1, 6), ...S(4), ...C(R1, 6)]],
  ['Acht R1', [...S(2), ...C(R1, 9), ...S(2), ...C(R1, 9, -1)]],
  ['Niere (eine S-Kurve)', [...S(3), ...C(R1, 6), ...S(1), ...C(R1, 2, -1), ...S(1), ...C(R1, 8), ...S(3), ...C(R1, 2)]],
  ['Technisch: Schikanen + Parabolica', [...S(4), ...C(R2, 2), ...C(R1, 2), ...C(R1, 1, -1), ...C(R1, 1), ...S(1),
    ...C(R1, 2, -1), ...C(R1, 4), ...C(R3, 2), ...C(R1, 2), ...S(2), ...C(R2, 1, -1), ...C(R2, 1), ...C(R1, 4)]],
];
for (const [n, p] of cases) {
  const s = scoreDifficulty(p);
  console.log(n.padEnd(36), s.toFixed(2), classify(s), JSON.stringify(difficultyFeatures(p)));
}
// Einspeisung nach Länge
const mk = (n: number) => [...Array(n)].map((_, i) => ({ partId: '20020509', dir: 1 as 1, start: { x: i * 345, y: 0, heading: 0 }, end: { x: (i + 1) * 345, y: 0, heading: 0 }, length: 345, height: 0 }));
for (const m of [8, 9.7, 11, 14, 20]) {
  const pl = planPower(mk(Math.round(m * 1000 / 345)) as any, 'internal', 'new');
  console.log(`${m} m → ${pl.need}, ${pl.points.length} Einspeisung(en), ${pl.notes.join(',')}`);
}
