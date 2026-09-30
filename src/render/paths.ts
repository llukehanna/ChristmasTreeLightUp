import { heads, pointsAlong, primProgress, tracePrim, type Prim } from './geometry';
import type { Scene, UnlitLook } from './scenes';

export type PathStyle = 'filament' | 'fairy' | 'neon';
export const PATH_STYLES: readonly PathStyle[] = ['filament', 'fairy', 'neon'];

export interface LitArgs {
  q: number;
  alpha: number;
  seed: number;
  now: number;
  flicker: number;
}

const TAU = Math.PI * 2;
const dot = (c: CanvasRenderingContext2D, x: number, y: number, r: number) => {
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fill();
};

export function strokePrims(c: CanvasRenderingContext2D, prims: readonly Prim[], q: number, s: number): void {
  c.beginPath();
  for (const p of prims) {
    const k = primProgress(p, q);
    if (k > 0) tracePrim(c, p, k, s);
  }
  c.stroke();
}

/** Neon tubes stutter on like real ones (spec §4.4). */
export function neonFlicker(sinceLitMs: number): number {
  if (sinceLitMs < 0 || sinceLitMs > 260) return 1;
  return [1, 0.15, 0.9, 0.3, 1, 0.6, 1][Math.floor(sinceLitMs / 38)] ?? 1;
}

/** Daylight treatments (see UnlitLook in scenes.ts): the snow-glint halo and the two-tone body. */
export const GLINT_WIDE = 'rgba(236,246,252,.06)';
export const GLINT_NEAR = 'rgba(236,246,252,.11)';
const BODY = 'rgba(176,196,202,.4)';
const NODE = 0.07;

/** One under-layer: the wire path at `width`, plus the junction node grown to match. */
function underLayer(c: CanvasRenderingContext2D, prims: readonly Prim[], s: number, style: string, width: number, grow: number, node: boolean): void {
  c.strokeStyle = style;
  c.lineWidth = width;
  strokePrims(c, prims, 1, s);
  if (!node) return;
  c.fillStyle = style;
  dot(c, 0, 0, s * NODE + grow / 2);
}

/** What lifts an unlit wire or tube of width `w` off a dark fir in daylight, drawn under it. */
function drawUnder(c: CanvasRenderingContext2D, prims: readonly Prim[], s: number, w: number, look: UnlitLook, node: boolean): void {
  if (look === 'glint') {
    // A soft snow-glint halo in two falling-off layers; no dark edge.
    underLayer(c, prims, s, GLINT_WIDE, w + s * 0.2, s * 0.2, node);
    underLayer(c, prims, s, GLINT_NEAR, w + s * 0.1, s * 0.1, node);
  } else if (look === 'twotone') {
    // A wider translucent silver body that the light core sits in.
    const body = Math.max(w * 2.6, s * 0.11);
    underLayer(c, prims, s, BODY, body, body - w, node);
  }
}

/** Unlit wires in the scene's treatment for this path style (spec §4.4). */
export function drawUnlit(c: CanvasRenderingContext2D, prims: readonly Prim[], s: number, sc: Scene, style: PathStyle): void {
  const u = sc.unlit[style];
  c.lineCap = 'round';
  c.lineJoin = 'round';
  if (style === 'filament') {
    const w = Math.max(1.6, s * u.wireW);
    const node = prims.length > 2;
    drawUnder(c, prims, s, w, u.look, node);
    c.strokeStyle = u.wire;
    c.lineWidth = w;
    strokePrims(c, prims, 1, s);
    if (node) {
      c.fillStyle = u.wire;
      dot(c, 0, 0, s * NODE);
    }
  } else if (style === 'fairy') {
    const w = Math.max(1.2, s * 0.038);
    drawUnder(c, prims, s, w, u.look, false);
    c.strokeStyle = u.copper;
    c.lineWidth = w;
    strokePrims(c, prims, 1, s);
    c.fillStyle = u.led;
    for (const p of pointsAlong(prims, 1, 0.2)) dot(c, p.x * s, p.y * s, s * 0.042);
  } else {
    // A tube is already a two-tone body with an inner shadow; only the glint halo goes under it.
    if (u.look === 'glint') drawUnder(c, prims, s, s * 0.27, u.look, false);
    c.strokeStyle = u.glass;
    c.lineWidth = s * 0.27;
    strokePrims(c, prims, 1, s);
    c.strokeStyle = 'rgba(0,0,0,.22)';
    c.lineWidth = s * 0.15;
    strokePrims(c, prims, 1, s);
    c.strokeStyle = u.glassHi;
    c.lineWidth = Math.max(1, s * 0.03);
    strokePrims(c, prims, 1, s);
  }
}

/** Drawn onto the glow layer, which is then bloomed. */
export function drawLitGlow(c: CanvasRenderingContext2D, prims: readonly Prim[], s: number, sc: Scene, style: PathStyle, a: LitArgs): void {
  c.lineCap = 'round';
  c.globalAlpha = a.alpha;
  if (style === 'filament') {
    c.strokeStyle = sc.glow;
    c.lineWidth = s * 0.2;
    strokePrims(c, prims, a.q, s);
  } else if (style === 'fairy') {
    c.strokeStyle = sc.glow;
    c.globalAlpha = a.alpha * 0.4;
    c.lineWidth = s * 0.09;
    strokePrims(c, prims, a.q, s);
    c.fillStyle = sc.glow;
    for (const p of pointsAlong(prims, a.q, 0.2)) {
      c.globalAlpha = a.alpha * (0.7 + 0.3 * Math.sin(a.now * 0.0035 + p.seed * 2.3 + a.seed));
      dot(c, p.x * s, p.y * s, s * 0.11);
    }
  } else {
    c.globalAlpha = a.alpha * a.flicker;
    c.strokeStyle = sc.neon;
    c.lineWidth = s * 0.34;
    strokePrims(c, prims, a.q, s);
  }
  c.globalAlpha = a.alpha;
  c.fillStyle = '#fff';
  for (const [x, y] of heads(prims, a.q)) dot(c, x * s, y * s, s * 0.34);
  c.globalAlpha = 1;
}

/** Crisp cores drawn on the main canvas after bloom. */
export function drawLitCore(c: CanvasRenderingContext2D, prims: readonly Prim[], s: number, sc: Scene, style: PathStyle, a: LitArgs): void {
  c.lineCap = 'round';
  c.globalAlpha = a.alpha;
  if (style === 'filament') {
    c.strokeStyle = sc.core;
    c.lineWidth = Math.max(2, s * 0.078);
    strokePrims(c, prims, a.q, s);
    c.strokeStyle = '#fff';
    c.lineWidth = Math.max(1, s * 0.03);
    strokePrims(c, prims, a.q, s);
    if (prims.length > 2 && a.q >= 0.5) {
      c.fillStyle = sc.core;
      dot(c, 0, 0, s * 0.09);
    }
  } else if (style === 'fairy') {
    c.strokeStyle = sc.copperOn;
    c.lineWidth = Math.max(1.2, s * 0.038);
    strokePrims(c, prims, a.q, s);
    c.fillStyle = sc.core;
    for (const p of pointsAlong(prims, a.q, 0.2)) {
      c.globalAlpha = a.alpha * (0.75 + 0.25 * Math.sin(a.now * 0.0035 + p.seed * 2.3 + a.seed));
      dot(c, p.x * s, p.y * s, s * 0.058);
    }
    c.globalAlpha = a.alpha;
  } else {
    c.globalAlpha = a.alpha * a.flicker;
    c.strokeStyle = sc.neonMid;
    c.lineWidth = s * 0.18;
    strokePrims(c, prims, a.q, s);
    c.strokeStyle = sc.core;
    c.lineWidth = s * 0.075;
    strokePrims(c, prims, a.q, s);
    c.globalAlpha = a.alpha;
  }
  c.fillStyle = '#fff';
  for (const [x, y] of heads(prims, a.q)) dot(c, x * s, y * s, s * 0.085);
  c.globalAlpha = 1;
}
