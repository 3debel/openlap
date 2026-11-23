import { ChangeDetectionStrategy, Component, Input, OnChanges } from '@angular/core';

import { LANE_OFFSET, PARTS, TRACK_WIDTH } from './catalog';
import { samplePiece } from './geometry';
import { Layout, PlacedPiece } from './generator';

interface Shape {
  body: string;
  lanes: string[];
  fill: string;
  mark?: string;
  height: number;
}

const PART_BY_ID = new Map(PARTS.map(p => [p.id, p]));

/** Farben je Ebene (iOS-Systemfarben): Boden grau, Ebene 2 blau, Ebene 3 lila */
const LEVEL_COLORS: [number, number, number][] = [[72, 72, 74], [10, 132, 255], [191, 90, 242]];

function levelColor(h: number): string {
  const i = Math.max(0, Math.min(LEVEL_COLORS.length - 1, Math.floor(h)));
  const j = Math.min(LEVEL_COLORS.length - 1, i + 1);
  const f = Math.max(0, Math.min(1, h - i));
  const c = LEVEL_COLORS[i].map((v, k) => Math.round(v + (LEVEL_COLORS[j][k] - v) * f));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/**
 * Draufsicht einer Strecke in der Grundfläche.
 * Höhere Ebenen werden zuletzt gezeichnet (Brücken liegen oben).
 */
@Component({
  selector: 'layout-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg *ngIf="layout" [attr.viewBox]="viewBox" preserveAspectRatio="xMidYMid meet" role="img"
         [attr.aria-label]="label">
      <rect class="area" [attr.x]="0" [attr.y]="0" [attr.width]="layout.areaWidth" [attr.height]="layout.areaDepth" rx="40"></rect>
      <g *ngFor="let s of shapes">
        <path class="body" [attr.d]="s.body" [attr.fill]="s.fill"></path>
        <path *ngFor="let l of s.lanes" class="lane" [attr.d]="l"></path>
        <path *ngIf="s.mark" class="mark" [attr.d]="s.mark"></path>
      </g>
      <path class="start" [attr.d]="startLine"></path>
    </svg>
  `,
  styles: [`
    :host { display: block; }
    svg { display: block; width: 100%; height: auto; }
    .area { fill: #111113; stroke: #3a3a3c; stroke-width: 12; stroke-dasharray: 40 30; }
    .body { stroke: #000; stroke-width: 6; }
    .lane { fill: none; stroke: rgba(255,255,255,0.55); stroke-width: 6; stroke-linecap: round; }
    .mark { fill: none; stroke: #64d2ff; stroke-width: 16; stroke-linecap: round; }
    .start { stroke: #fff; stroke-width: 22; stroke-dasharray: 22 22; }
  `],
  standalone: false
})
export class LayoutViewComponent implements OnChanges {

  @Input() layout: Layout;
  @Input() label = '';

  shapes: Shape[] = [];
  viewBox = '0 0 100 100';
  startLine = '';

  ngOnChanges() {
    if (!this.layout) return;
    const pad = 60;
    this.viewBox = `${-pad} ${-pad} ${this.layout.areaWidth + 2 * pad} ${this.layout.areaDepth + 2 * pad}`;
    this.shapes = this.layout.pieces
      .map(p => shapeOf(p))
      .sort((a, b) => a.height - b.height);
    const first = this.layout.pieces[0];
    const t = (first.start.heading * Math.PI) / 180;
    const nx = -Math.sin(t) * (TRACK_WIDTH / 2), ny = Math.cos(t) * (TRACK_WIDTH / 2);
    const x = first.start.x + Math.cos(t) * 60, y = first.start.y + Math.sin(t) * 60;
    this.startLine = `M${(x + nx).toFixed(1)},${(y + ny).toFixed(1)} L${(x - nx).toFixed(1)},${(y - ny).toFixed(1)}`;
  }
}

function shapeOf(p: PlacedPiece): Shape {
  const part = PART_BY_ID.get(p.partId)!;
  const samples = samplePiece(p.start, part.geometry, p.dir, 30);
  const offset = (d: number) => samples.map(q => {
    const t = (q.heading * Math.PI) / 180;
    return [q.x - Math.sin(t) * d, q.y + Math.cos(t) * d];
  });
  const left = offset(-TRACK_WIDTH / 2), right = offset(TRACK_WIDTH / 2);
  const poly = [...left, ...right.reverse()];
  const body = 'M' + poly.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L') + ' Z';
  const line = (pts: number[][]) => 'M' + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L');
  const lanes = [line(offset(-LANE_OFFSET)), line(offset(LANE_OFFSET))];

  let mark: string | undefined;
  if (part.feature === 'switch' || (part.feature === 'crossover' && part.series.length === 1)) {
    // Spurwechsel: Verbindung von einer Spur zur anderen
    const a = offset(LANE_OFFSET), b = offset(-LANE_OFFSET);
    const i0 = Math.floor(a.length * 0.25), i1 = Math.floor(a.length * 0.75);
    mark = `M${a[i0][0].toFixed(1)},${a[i0][1].toFixed(1)} L${b[i1][0].toFixed(1)},${b[i1][1].toFixed(1)}`;
  }
  const height = (p.h0 + p.h1) / 2;
  return { body, lanes, fill: levelColor(height), mark, height };
}
