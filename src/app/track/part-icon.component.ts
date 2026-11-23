import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';

import { LANE_OFFSET, Part, TRACK_WIDTH } from './catalog';

const VIEW_W = 64;
const VIEW_H = 40;
const PAD = 2;
/** Obergrenze des Maßstabs, damit kurze Teile auch kurz aussehen (Standardgerade ≈ 60 px). */
const MAX_SCALE = (VIEW_W - 2 * PAD) / 345;

interface Drawing {
  body: string;
  lanes: string[];
  outer?: string;
  extra?: string;
  transform: string;
}

/**
 * Vorschau eines Streckenteils als SVG, berechnet aus der Geometrie.
 * Gerade und Kurven werden maßstäblich gezeichnet; Teile ohne bekannte
 * Maße erscheinen als neutrales Symbol.
 */
@Component({
  selector: 'part-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg [attr.viewBox]="'0 0 ' + w + ' ' + h" [attr.width]="w" [attr.height]="h" aria-hidden="true">
      <ng-container *ngIf="drawing; else unknown">
        <g [attr.transform]="drawing.transform">
          <path class="body" [attr.d]="drawing.body"></path>
          <path *ngIf="drawing.outer" class="banked" vector-effect="non-scaling-stroke" [attr.d]="drawing.outer"></path>
          <path *ngFor="let lane of drawing.lanes" class="lane" vector-effect="non-scaling-stroke" [attr.d]="lane"></path>
          <path *ngIf="drawing.extra" class="extra" vector-effect="non-scaling-stroke" [attr.d]="drawing.extra"></path>
        </g>
      </ng-container>
      <ng-template #unknown>
        <rect class="body" x="10" y="8" width="44" height="24" rx="6"></rect>
        <text class="unknown" x="32" y="25" text-anchor="middle">?</text>
      </ng-template>
    </svg>
  `,
  styles: [`
    :host { display: inline-flex; flex-shrink: 0; }
    svg { width: 54px; height: 34px; }
    .body { fill: #3a3a3c; }
    .lane { fill: none; stroke: #8e8e93; stroke-width: 0.9; stroke-linecap: round; }
    .banked { fill: none; stroke: #ff453a; stroke-width: 1.6; stroke-dasharray: 2 2; }
    .extra { fill: none; stroke: #0a84ff; stroke-width: 1.2; stroke-linecap: round; }
    .unknown { fill: #8e8e93; font-size: 14px; font-weight: 600; }
  `],
  standalone: false
})
export class PartIconComponent implements OnChanges {

  @Input() part: Part;

  readonly w = VIEW_W;
  readonly h = VIEW_H;
  drawing: Drawing | null = null;

  ngOnChanges() {
    this.drawing = this.part ? draw(this.part) : null;
  }
}

function draw(part: Part): Drawing | null {
  const g = part.geometry;
  if (g.kind === 'straight') {
    return drawStraight(g.length, part);
  }
  if (g.kind === 'curve') {
    return drawCurve(g.radius, g.angle, part);
  }
  return null;
}

function drawStraight(length: number, part: Part): Drawing {
  const half = TRACK_WIDTH / 2;
  const scale = Math.min(MAX_SCALE, (VIEW_H - 2 * PAD) / TRACK_WIDTH);
  const narrow = part.feature === 'narrow';
  const body = narrow
    // Engstelle: Fahrbahn in der Mitte eingeschnürt
    ? `M0,${-half} L${length * 0.3},${-half} L${length * 0.45},${-half * 0.55} L${length * 0.55},${-half * 0.55} ` +
      `L${length * 0.7},${-half} L${length},${-half} L${length},${half} L${length * 0.7},${half} ` +
      `L${length * 0.55},${half * 0.55} L${length * 0.45},${half * 0.55} L${length * 0.3},${half} L0,${half} Z`
    : `M0,${-half} H${length} V${half} H0 Z`;
  const lanes = narrow
    ? [`M0,${-LANE_OFFSET} H${length * 0.3} L${length * 0.45},${-LANE_OFFSET * 0.45} H${length * 0.55} L${length * 0.7},${-LANE_OFFSET} H${length}`,
       `M0,${LANE_OFFSET} H${length * 0.3} L${length * 0.45},${LANE_OFFSET * 0.45} H${length * 0.55} L${length * 0.7},${LANE_OFFSET} H${length}`]
    : [`M0,${-LANE_OFFSET} H${length}`, `M0,${LANE_OFFSET} H${length}`];

  let extra: string | undefined;
  switch (part.feature) {
    case 'switch':
      extra = `M${length * 0.25},${LANE_OFFSET} C${length * 0.5},${LANE_OFFSET} ${length * 0.5},${-LANE_OFFSET} ${length * 0.75},${-LANE_OFFSET}`;
      break;
    case 'crossover':
      extra = `M${length * 0.2},${LANE_OFFSET} L${length * 0.8},${-LANE_OFFSET} M${length * 0.2},${-LANE_OFFSET} L${length * 0.8},${LANE_OFFSET}`;
      break;
    case 'sensor':
      extra = `M${length / 2},${-half + 10} V${half - 10}`;
      break;
    case 'bridge':
      extra = `M${length * 0.15},${half} V${half - 25} M${length * 0.85},${half} V${half - 25}`;
      break;
  }

  const w = length * scale;
  const tx = (VIEW_W - w) / 2;
  return {
    body, lanes, extra,
    transform: `translate(${tx.toFixed(2)},${(VIEW_H / 2).toFixed(2)}) scale(${scale.toFixed(4)})`,
  };
}

function drawCurve(radius: number, angle: number, part: Part): Drawing {
  const half = TRACK_WIDTH / 2;
  const a = (angle * Math.PI) / 180;
  // Bogen symmetrisch um die Senkrechte, Mittelpunkt unten
  const start = -Math.PI / 2 - a / 2;
  const end = -Math.PI / 2 + a / 2;
  const pt = (r: number, t: number) => [r * Math.cos(t), r * Math.sin(t)];
  const arc = (r: number, from: number, to: number, move: boolean) => {
    const [x0, y0] = pt(r, from);
    const [x1, y1] = pt(r, to);
    const sweep = to > from ? 1 : 0;
    const large = Math.abs(to - from) > Math.PI ? 1 : 0;
    return `${move ? 'M' : 'L'}${x0.toFixed(1)},${y0.toFixed(1)} A${r},${r} 0 ${large} ${sweep} ${x1.toFixed(1)},${y1.toFixed(1)}`;
  };

  const rOut = radius + half;
  const rIn = radius - half;
  const body = `${arc(rOut, start, end, true)} ${arc(rIn, end, start, false)} Z`;
  const lanes = [arc(radius + LANE_OFFSET, start, end, true), arc(radius - LANE_OFFSET, start, end, true)];
  const outer = part.feature === 'banked' ? arc(rOut - 4, start, end, true) : undefined;
  const extra = part.feature === 'switch'
    ? `${arc(radius - LANE_OFFSET, start + a * 0.25, start + a * 0.4, true)} L${pt(radius + LANE_OFFSET, start + a * 0.75).map(v => v.toFixed(1)).join(',')}`
    : undefined;

  // Begrenzungsrahmen des Kreisrings berechnen
  const xs: number[] = [], ys: number[] = [];
  for (const r of [rIn, rOut]) {
    for (const t of [start, end, -Math.PI / 2]) {
      if (t >= start && t <= end) {
        const [x, y] = pt(r, t);
        xs.push(x); ys.push(y);
      }
    }
  }
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const bw = maxX - minX, bh = maxY - minY;
  const scale = Math.min(MAX_SCALE, (VIEW_W - 2 * PAD) / bw, (VIEW_H - 2 * PAD) / bh);
  const tx = (VIEW_W - bw * scale) / 2 - minX * scale;
  const ty = (VIEW_H - bh * scale) / 2 - minY * scale;

  return {
    body, lanes, outer, extra,
    transform: `translate(${tx.toFixed(2)},${ty.toFixed(2)}) scale(${scale.toFixed(4)})`,
  };
}
