/**
 * Geometrie der Streckenteile.
 *
 * Koordinaten in Millimetern, x nach rechts, y nach unten (wie SVG).
 * Richtung `heading` in Grad, 0° = nach rechts, positiv = im Uhrzeigersinn.
 * Kurvenrichtung `dir`: +1 = Rechtskurve, -1 = Linkskurve, 0 = Gerade.
 * Alle Teile werden auf der Fahrbahnmitte aneinandergesetzt.
 */

import { Geometry } from './catalog';

export interface Pose {
  x: number;
  y: number;
  heading: number;
}

export type Dir = -1 | 0 | 1;

export interface Sample {
  x: number;
  y: number;
  /** Richtung der Fahrbahn an dieser Stelle (Grad) */
  heading: number;
  /** Abstand vom Teilanfang entlang der Mitte (mm) */
  s: number;
}

const RAD = Math.PI / 180;

export function normalizeHeading(h: number): number {
  const r = h % 360;
  return r < 0 ? r + 360 : r;
}

export function pieceLength(g: Geometry): number {
  if (g.kind === 'straight') return g.length;
  if (g.kind === 'curve') return (g.radius * g.angle * Math.PI) / 180;
  return 0;
}

/** Endpunkt eines Teils, das an `p` angesetzt wird. */
export function place(p: Pose, g: Geometry, dir: Dir): Pose {
  const t = p.heading * RAD;
  if (g.kind === 'straight') {
    return { x: p.x + g.length * Math.cos(t), y: p.y + g.length * Math.sin(t), heading: p.heading };
  }
  if (g.kind === 'curve') {
    const d = dir === 0 ? 1 : dir;
    const cx = p.x - d * g.radius * Math.sin(t);
    const cy = p.y + d * g.radius * Math.cos(t);
    const phi = d * g.angle * RAD;
    const rx = p.x - cx, ry = p.y - cy;
    return {
      x: cx + rx * Math.cos(phi) - ry * Math.sin(phi),
      y: cy + rx * Math.sin(phi) + ry * Math.cos(phi),
      heading: normalizeHeading(p.heading + d * g.angle),
    };
  }
  return { ...p };
}

/** Punkte entlang der Fahrbahnmitte, etwa alle `step` mm (inkl. Anfang und Ende). */
export function samplePiece(p: Pose, g: Geometry, dir: Dir, step = 25): Sample[] {
  const len = pieceLength(g);
  const n = Math.max(1, Math.ceil(len / step));
  const out: Sample[] = [];
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    if (g.kind === 'straight') {
      const q = place(p, { kind: 'straight', length: g.length * f }, 0);
      out.push({ x: q.x, y: q.y, heading: p.heading, s: len * f });
    } else if (g.kind === 'curve') {
      const q = place(p, { kind: 'curve', radius: g.radius, angle: g.angle * f }, dir);
      out.push({ x: q.x, y: q.y, heading: q.heading, s: len * f });
    }
  }
  return out;
}

/** Relativlage von `b` gesehen aus `a` (für die Schließ-Tabelle). */
export function relative(a: Pose, b: Pose): Pose {
  const t = -a.heading * RAD;
  const dx = b.x - a.x, dy = b.y - a.y;
  return {
    x: dx * Math.cos(t) - dy * Math.sin(t),
    y: dx * Math.sin(t) + dy * Math.cos(t),
    heading: normalizeHeading(b.heading - a.heading),
  };
}

/** Kleinster Winkel zwischen zwei Richtungen, ohne Fahrtrichtung (0–90°). */
export function crossingAngle(h1: number, h2: number): number {
  let d = Math.abs(normalizeHeading(h1) - normalizeHeading(h2)) % 180;
  if (d > 90) d = 180 - d;
  return d;
}
