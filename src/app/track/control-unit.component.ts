import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/**
 * Schematische, maßstäbliche Draufsicht der Control Unit (DIGITAL 124/132).
 *
 * Anordnung der Bedienelemente und Buchsen nach der Montage- und
 * Betriebsanleitung 30352 (Buchsen von links nach rechts: Rundenzähler,
 * PC-Unit, Regler 1–4, Netzteil). Keine Nachbildung von Logo oder Aufdruck.
 * Maße: Länge 345 mm wie die Anschlussschiene (Händlerangabe), Tiefe 150 mm
 * geschätzt.
 *
 * Koordinaten in mm: x entlang der Fahrbahn (0–345), y quer (0 = Fahrbahnseite,
 * 150 = Bedienseite mit den Buchsen).
 */
export const CU_W = 345;
export const CU_D = 150;

/** Buchsen in der Reihenfolge der Anleitung */
export const CU_SOCKETS: { key: string; x: number; kind: 'data' | 'controller' | 'power' }[] = [
  { key: 'cu_socket_lap', x: 38, kind: 'data' },
  { key: 'cu_socket_pc', x: 78, kind: 'data' },
  { key: 'cu_socket_c1', x: 128, kind: 'controller' },
  { key: 'cu_socket_c2', x: 168, kind: 'controller' },
  { key: 'cu_socket_c3', x: 208, kind: 'controller' },
  { key: 'cu_socket_c4', x: 248, kind: 'controller' },
  { key: 'cu_socket_power', x: 305, kind: 'power' },
];

/** Tasten auf der Oberseite */
export const CU_BUTTONS: { key: string; x: number }[] = [
  { key: 'cu_btn_code', x: 105 },
  { key: 'cu_btn_start', x: 145 },
  { key: 'cu_btn_esc', x: 185 },
  { key: 'cu_btn_speed', x: 225 },
  { key: 'cu_btn_brake', x: 265 },
  { key: 'cu_btn_fuel', x: 305 },
];

/** Gemeinsame Zeichnung (ohne Text), nutzbar im Streckenplan. */
@Component({
  selector: '[cu-symbol]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg:rect class="cu-body" x="4" y="6" [attr.width]="w - 8" [attr.height]="d - 6" rx="20"></svg:rect>
    <svg:rect class="cu-top" x="18" y="18" [attr.width]="w - 36" height="92" rx="12"></svg:rect>
    <!-- Ein/Aus-Schalter -->
    <svg:rect class="cu-switch" x="32" y="52" width="26" height="16" rx="4"></svg:rect>
    <!-- Anzeige: fünf LEDs -->
    <svg:circle *ngFor="let i of leds" class="cu-led" [class.on]="i === 2" [attr.cx]="160 + i * 18" cy="34" r="5"></svg:circle>
    <!-- Tasten -->
    <svg:circle *ngFor="let b of buttons" class="cu-btn" [attr.cx]="b.x" cy="74" r="11"></svg:circle>
    <!-- Tank-Schiebeschalter (Aus / An / Real) -->
    <svg:rect class="cu-slide" x="72" y="28" width="44" height="12" rx="6"></svg:rect>
    <svg:rect class="cu-slide-knob" x="72" y="28" width="16" height="12" rx="6"></svg:rect>
    <!-- Buchsen auf der Bedienseite -->
    <svg:rect *ngFor="let s of sockets" class="cu-socket" [class.ctrl]="s.kind === 'controller'" [class.pwr]="s.kind === 'power'"
              [attr.x]="s.x - 13" [attr.y]="d - 22" width="26" height="14" rx="3"></svg:rect>
  `,
  styles: [`
    .cu-body { fill: #1c1c1e; stroke: #8e8e93; stroke-width: 6; }
    .cu-top { fill: #2c2c2e; stroke: none; }
    .cu-switch { fill: #48484a; }
    .cu-led { fill: #3a3a3c; }
    .cu-led.on { fill: #30d158; }
    .cu-btn { fill: #636366; stroke: #1c1c1e; stroke-width: 3; }
    .cu-slide { fill: #48484a; }
    .cu-slide-knob { fill: #aeaeb2; }
    .cu-socket { fill: #000; stroke: #8e8e93; stroke-width: 3; }
    .cu-socket.ctrl { stroke: #0a84ff; }
    .cu-socket.pwr { stroke: #ff9f0a; }
  `],
  standalone: false
})
export class ControlUnitSymbolComponent {
  w = CU_W;
  d = CU_D;
  leds = [0, 1, 2, 3, 4];
  buttons = CU_BUTTONS;
  sockets = CU_SOCKETS;
}

/**
 * Beschriftete Detailansicht: Control Unit an der Anschlussschiene, mit
 * Tasten, Buchsen und dem Anschluss der Zusatzeinspeisung.
 */
@Component({
  selector: 'control-unit-figure',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="-20 -150 385 380" role="img" [attr.aria-label]="'Control Unit' | translate">
      <!-- Anschlussschiene -->
      <rect class="track" x="0" y="-130" [attr.width]="w" height="110" rx="4"></rect>
      <line class="lane" x1="0" [attr.x2]="w" y1="-102" y2="-102"></line>
      <line class="lane" x1="0" [attr.x2]="w" y1="-48" y2="-48"></line>
      <line class="startline" x1="40" x2="40" y1="-130" y2="-20"></line>
      <text class="t small" [attr.x]="w / 2" y="-75" text-anchor="middle">{{'cu_track' | translate}}</text>
      <g *ngIf="feeds">
        <rect class="lug" x="90" y="-26" width="30" height="10" rx="2"></rect>
        <rect class="lug" x="225" y="-26" width="30" height="10" rx="2"></rect>
      </g>
      <!-- Control Unit -->
      <g cu-symbol></g>
      <!-- Beschriftung Tasten -->
      <text *ngFor="let b of buttons; let i = index" class="t tiny" [attr.x]="b.x" [attr.y]="i % 2 ? 56 : 100" text-anchor="middle">{{b.key | translate}}</text>
      <text class="t tiny" x="45" y="98" text-anchor="middle">{{'cu_onoff' | translate}}</text>
      <text class="t tiny" x="94" y="20" text-anchor="middle">{{'cu_fuel_switch' | translate}}</text>
      <text class="t tiny" x="196" y="20" text-anchor="middle">{{'cu_display' | translate}}</text>
      <!-- Beschriftung Buchsen -->
      <g *ngFor="let s of sockets; let i = index">
        <line class="lead" [attr.x1]="s.x" [attr.x2]="s.x" [attr.y1]="d - 8" [attr.y2]="d + 14 + (i % 2) * 34"></line>
        <text class="t tiny" [class.ctrl]="s.kind === 'controller'" [class.pwr]="s.kind === 'power'"
              [attr.x]="s.x" [attr.y]="d + 28 + (i % 2) * 34" text-anchor="middle">{{s.key | translate}}</text>
      </g>
    </svg>
  `,
  styles: [`
    :host { display: block; }
    svg { display: block; width: 100%; height: auto; }
    .track { fill: #3a3a3c; stroke: #000; stroke-width: 3; }
    .lane { stroke: rgba(255,255,255,0.55); stroke-width: 4; }
    .startline { stroke: #fff; stroke-width: 10; stroke-dasharray: 10 10; }
    .lug { fill: #ffd60a; stroke: #000; stroke-width: 2; }
    .lead { stroke: #636366; stroke-width: 2; }
    .t { fill: #fff; font-family: -apple-system, system-ui, sans-serif; }
    .small { font-size: 15px; font-weight: 600; }
    .tiny { font-size: 11px; }
    .ctrl { fill: #64d2ff; }
    .pwr { fill: #ff9f0a; }
    .feed { fill: #ffd60a; }
  `],
  standalone: false
})
export class ControlUnitFigureComponent {
  /** Hinweis auf die Laschen der Zusatzeinspeisung zeigen */
  @Input() feeds = false;
  w = CU_W;
  d = CU_D;
  buttons = CU_BUTTONS;
  sockets = CU_SOCKETS;
}
