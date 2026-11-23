import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';

import { LANE_OFFSET, PARTS, TRACK_WIDTH } from './catalog';
import { samplePiece } from './geometry';
import { AccessoryBox, Layout, PlacedPiece } from './generator';
import { PowerPlan } from './power';

interface Shape {
  index: number;
  body: string;
  lanes: string[];
  fill: string;
  mark?: string;
  height: number;
  selected: boolean;
  problem: boolean;
}

interface Box {
  points: string;
  label: string;
  lx: number;
  ly: number;
  kind: AccessoryBox['kind'];
  transform: string;
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
 * Optional: Stromplan (Einspeisepunkte), antippbare Teile, Hervorhebungen.
 */
@Component({
  selector: 'layout-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg *ngIf="layout" [attr.viewBox]="viewBox" preserveAspectRatio="xMidYMid meet" role="img"
         [attr.aria-label]="label" [class.selectable]="selectable">
      <rect class="area" [attr.x]="0" [attr.y]="0" [attr.width]="layout.areaWidth" [attr.height]="layout.areaDepth" rx="40"></rect>
      <ng-container *ngFor="let b of boxes">
        <g *ngIf="b.kind === 'controlunit'; else plainBox" class="cu" [attr.transform]="b.transform">
          <g cu-symbol></g>
        </g>
        <ng-template #plainBox>
          <g class="box">
            <polygon [attr.points]="b.points"></polygon>
            <text [attr.x]="b.lx" [attr.y]="b.ly" text-anchor="middle" dominant-baseline="central">{{b.label}}</text>
          </g>
        </ng-template>
      </ng-container>
      <g *ngFor="let s of shapes" (click)="tap(s.index)" [class.sel]="s.selected" [class.problem]="s.problem">
        <path class="body" [attr.d]="s.body" [attr.fill]="s.fill"></path>
        <path *ngFor="let l of s.lanes" class="lane" [attr.d]="l"></path>
        <path *ngIf="s.mark" class="mark" [attr.d]="s.mark"></path>
      </g>
      <path class="start" [attr.d]="startLine"></path>
      <ng-container *ngIf="power?.origin as o">
        <g *ngFor="let p of power!.points" class="feed">
          <line [attr.x1]="o.x" [attr.y1]="o.y" [attr.x2]="p.x" [attr.y2]="p.y"></line>
          <circle [attr.cx]="p.x" [attr.cy]="p.y" r="70"></circle>
          <text [attr.x]="p.x" [attr.y]="p.y" text-anchor="middle" dominant-baseline="central">{{p.no}}</text>
        </g>
      </ng-container>
    </svg>
  `,
  styles: [`
    :host { display: block; }
    svg { display: block; width: 100%; height: auto; }
    .area { fill: #111113; stroke: #3a3a3c; stroke-width: 12; stroke-dasharray: 40 30; }
    .body { stroke: #000; stroke-width: 6; }
    .lane { fill: none; stroke: rgba(255,255,255,0.55); stroke-width: 6; stroke-linecap: round; pointer-events: none; }
    .mark { fill: none; stroke: #64d2ff; stroke-width: 16; stroke-linecap: round; pointer-events: none; }
    .start { stroke: #fff; stroke-width: 22; stroke-dasharray: 22 22; pointer-events: none; }
    .selectable g { cursor: pointer; }
    .sel .body { stroke: #ffd60a; stroke-width: 22; }
    .problem .body { stroke: #ff453a; stroke-width: 16; }
    .box polygon { fill: #2c2c2e; stroke: #636366; stroke-width: 8; }
    .box.cu polygon { fill: #3a3a3c; stroke: #ffffff; }
    .box text { fill: #fff; font-size: 64px; font-weight: 600; pointer-events: none; }
    .feed line { stroke: #ff9f0a; stroke-width: 14; stroke-dasharray: 40 28; pointer-events: none; }
    .feed circle { fill: #ff9f0a; stroke: #000; stroke-width: 8; }
    .feed text { fill: #000; font-size: 80px; font-weight: 700; pointer-events: none; }
  `],
  standalone: false
})
export class LayoutViewComponent implements OnChanges {

  @Input() layout: Layout;
  @Input() label = '';
  @Input() power: PowerPlan | null = null;
  @Input() selectable = false;
  @Input() selected = -1;
  @Input() problems: number[] = [];
  @Output() pieceTap = new EventEmitter<number>();

  shapes: Shape[] = [];
  boxes: Box[] = [];
  viewBox = '0 0 100 100';
  startLine = '';

  ngOnChanges() {
    if (!this.layout || !this.layout.pieces.length) return;
    const pad = 80;
    this.viewBox = `${-pad} ${-pad} ${this.layout.areaWidth + 2 * pad} ${this.layout.areaDepth + 2 * pad}`;
    this.shapes = this.layout.pieces
      .map((p, i) => shapeOf(p, i, i === this.selected, this.problems.includes(i)))
      .sort((a, b) => (a.height - b.height) || (Number(a.selected) - Number(b.selected)));
    let charger = 0;
    this.boxes = (this.layout.accessories ?? []).map(b => boxOf(b, b.kind === 'controlunit' ? 'CU' : 'L' + (++charger)));
    const first = this.layout.pieces[0];
    const t = (first.start.heading * Math.PI) / 180;
    const nx = -Math.sin(t) * (TRACK_WIDTH / 2), ny = Math.cos(t) * (TRACK_WIDTH / 2);
    const x = first.start.x + Math.cos(t) * 60, y = first.start.y + Math.sin(t) * 60;
    this.startLine = `M${(x + nx).toFixed(1)},${(y + ny).toFixed(1)} L${(x - nx).toFixed(1)},${(y - ny).toFixed(1)}`;
  }

  tap(index: number) {
    if (this.selectable) this.pieceTap.emit(index);
  }
}

function boxOf(b: AccessoryBox, label: string): Box {
  const t = (b.heading * Math.PI) / 180;
  const ux = Math.cos(t), uy = Math.sin(t), nx = -Math.sin(t), ny = Math.cos(t);
  const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, c]) =>
    `${(b.x + ux * a * b.along / 2 + nx * c * b.across / 2).toFixed(1)},${(b.y + uy * a * b.along / 2 + ny * c * b.across / 2).toFixed(1)}`);
  const transform = `translate(${b.x.toFixed(1)},${b.y.toFixed(1)}) rotate(${b.heading}) scale(1,${b.side ?? 1}) translate(${-b.along / 2},${-b.across / 2})`;
  return { points: pts.join(' '), label, lx: b.x, ly: b.y, kind: b.kind, transform };
}

function shapeOf(p: PlacedPiece, index: number, selected: boolean, problem: boolean): Shape {
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
    const a = offset(LANE_OFFSET), b = offset(-LANE_OFFSET);
    const i0 = Math.floor(a.length * 0.25), i1 = Math.floor(a.length * 0.75);
    mark = `M${a[i0][0].toFixed(1)},${a[i0][1].toFixed(1)} L${b[i1][0].toFixed(1)},${b[i1][1].toFixed(1)}`;
  } else if (part.feature === 'adapter') {
    const a = offset(TRACK_WIDTH / 2 - 15);
    const i0 = Math.floor(a.length * 0.3), i1 = Math.floor(a.length * 0.7);
    mark = `M${a[i0][0].toFixed(1)},${a[i0][1].toFixed(1)} L${a[i1][0].toFixed(1)},${a[i1][1].toFixed(1)}`;
  }
  const height = (p.h0 + p.h1) / 2;
  return { index, body, lanes, fill: levelColor(height), mark, height, selected, problem };
}
