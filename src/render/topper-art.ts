import type { TopperKind } from '../store/look';
import { blurredLayer } from './blur';
import { hexRgb } from './color';
import { drawStarBody, type StarState } from './effects';
import type { Rgb, Scene } from './scenes';

/**
 * The toppers beside the star (ported from the visual lab, 2026-11): an angel (porcelain gown, gilded wings, a halo),
 * a velvet ribbon bow with long dovetailed tails, and a crystalline snowflake. Each follows the star's states
 * (starState): dim glass in the scene's light before the win, warming as the tree lights, then igniting on the win.
 *
 * Each is painted once (per size, dpr and scene light) as an albedo, from which its sprites are derived: `dim` (the
 * scene's ambient light), `lit` (the tree's warm light from below), `emit` (a glowing silhouette added on the win) and
 * `aura` (its glow, for the half-res glow layer). Per frame: a few drawImages, plus the snowflake's glints. The topper
 * (topper.ts) places, pops, turns and flips it; everything here is drawn about the origin, the star's centre.
 */

export type ArtKind = Exclude<TopperKind, 'star'>;
type Ctx = CanvasRenderingContext2D;
type Box = readonly [number, number, number, number];

/** Each topper's sprite box in tiles around the star's centre: left, top, width, height. */
const BOX: Record<ArtKind, Box> = {
  angel: [-1.25, -1.3, 2.5, 2.3],
  bow: [-1.25, -0.85, 2.5, 2.25],
  snowflake: [-1.0, -1.0, 2.0, 2.0],
};
/** Each topper's glow (toppersGlow in the lab): the box its halo fills. */
const AURA_BOX: Record<ArtKind, Box> = {
  angel: [-1.15, -1.35, 2.3, 2.3],
  bow: [-1.3, -1.4, 2.6, 2.6],
  snowflake: [-0.92, -0.92, 1.84, 1.84],
};
/** The glow sprite's resolution against the stage's: the glow layer is half-res, and the bloom softens it anyway. */
const AURA_RES = 0.5;
/** The win's glowing silhouette: strongest for the snowflake and the angel; the bow's velvet stays deep. */
const EMIT: Record<ArtKind, number> = { bow: 0.12, angel: 0.26, snowflake: 0.32 };
/** The lab's sprite cache held this many before starting over. */
const CACHE_MAX = 12;

const TAU = Math.PI * 2;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const byte = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
const css = (c: Rgb, a = 1): string => (a >= 1 ? `rgb(${byte(c[0])},${byte(c[1])},${byte(c[2])})` : `rgba(${byte(c[0])},${byte(c[1])},${byte(c[2])},${Math.max(0, a).toFixed(3)})`);
const mixRgb = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  const x = c.getContext('2d');
  if (!x) throw new Error('Canvas 2D is unavailable');
  return [c, x];
}

function radial(c: Ctx, x: number, y: number, r: number, stops: readonly (readonly [number, string])[]): void {
  if (r <= 0) return;
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  for (const [o, col] of stops) g.addColorStop(o, col);
  c.fillStyle = g;
  c.fillRect(x - r, y - r, 2 * r, 2 * r);
}

/* ---------- shared painting helpers (tile units: `s` CSS px per tile, origin at the star's centre) ---------- */

const GOLD_DK: Rgb = [120, 80, 26];
const GOLD: Rgb = [214, 170, 84];
const GOLD_HI: Rgb = [255, 236, 170];

/** A metallic gold fill across a box (horizontal bands of light and dark, like polished leaf). */
function goldFill(c: Ctx, x0: number, y0: number, x1: number, y1: number): CanvasGradient {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, css(GOLD_DK));
  g.addColorStop(0.3, css(GOLD_HI));
  g.addColorStop(0.5, css(GOLD));
  g.addColorStop(0.72, css(GOLD_DK));
  g.addColorStop(1, css(GOLD));
  return g;
}

/* ---------- the angel ---------- */

/** A single long feather from (x, y) along `ang` (radians, screen), slightly curved, root gold, tip ivory. */
function quill(c: Ctx, x: number, y: number, ang: number, len: number, wid: number, bend: number, root: Rgb, tip: Rgb): void {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const nx = -uy;
  const ny = ux;
  const tx = x + ux * len + nx * bend * len;
  const ty = y + uy * len + ny * bend * len;
  const mx = x + ux * len * 0.55 + nx * bend * len * 0.7;
  const my = y + uy * len * 0.55 + ny * bend * len * 0.7;
  const g = c.createLinearGradient(x, y, tx, ty);
  g.addColorStop(0, css(root));
  g.addColorStop(0.5, css(mixRgb(root, tip, 0.75)));
  g.addColorStop(1, css(tip));
  c.beginPath();
  c.moveTo(x + nx * wid * 0.2, y + ny * wid * 0.2);
  c.quadraticCurveTo(mx + nx * wid * 0.62, my + ny * wid * 0.62, tx, ty);
  c.quadraticCurveTo(mx - nx * wid * 0.5, my - ny * wid * 0.5, x - nx * wid * 0.2, y - ny * wid * 0.2);
  c.closePath();
  c.fillStyle = g;
  c.fill();
  c.strokeStyle = 'rgba(110,72,24,.38)';
  c.lineWidth = Math.max(0.5, wid * 0.07);
  c.stroke();
  c.strokeStyle = 'rgba(150,105,40,.4)';
  c.lineWidth = Math.max(0.4, wid * 0.05);
  c.beginPath();
  c.moveTo(x, y);
  c.quadraticCurveTo(mx, my, tx, ty);
  c.stroke();
}

function wing(c: Ctx, s: number, side: number): void {
  const ivory: Rgb = [250, 243, 228];
  const gold: Rgb = [206, 160, 76];
  const P = (x: number, y: number): [number, number] => [side * x * s, y * s];
  // The arm: from the shoulder up and out to the wrist; the wing is raised behind the angel.
  const R = P(0.09, -0.36);
  const W = P(0.5, -0.92);
  const n = 11;
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1); // 0 at the shoulder, 1 at the wrist
    const x = R[0] + (W[0] - R[0]) * t;
    const y = R[1] + (W[1] - R[1]) * t - Math.sin(Math.PI * t) * 0.08 * s;
    const out = (16 + 46 * t) * (Math.PI / 180);
    const ang = Math.PI / 2 - side * out; // from straight down, swung outward
    const len = (0.46 + 0.26 * Math.pow(t, 0.8)) * s;
    quill(c, x, y, ang, len, 0.15 * s, side * 0.08, mixRgb(gold, ivory, 0.3), ivory);
  }
  // Coverts over the arm: a band of short feathers, softly gilded.
  for (let k = 0; k < 8; k++) {
    const t = k / 7;
    const x = R[0] + (W[0] - R[0]) * t;
    const y = R[1] + (W[1] - R[1]) * t - Math.sin(Math.PI * t) * 0.08 * s;
    const out = (20 + 40 * t) * (Math.PI / 180);
    quill(c, x, y, Math.PI / 2 - side * out, (0.22 + 0.08 * t) * s, 0.12 * s, side * 0.05, gold, mixRgb(ivory, gold, 0.3));
  }
  // The leading edge: a smooth gilded arm.
  c.strokeStyle = goldFill(c, R[0], R[1], W[0], W[1]);
  c.lineWidth = 0.05 * s;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(R[0], R[1]);
  c.quadraticCurveTo((R[0] + W[0]) / 2, (R[1] + W[1]) / 2 - 0.1 * s, W[0], W[1]);
  c.stroke();
}

function angelGownPath(c: Ctx, s: number): void {
  c.beginPath();
  c.moveTo(-0.05 * s, -0.47 * s);
  c.bezierCurveTo(-0.15 * s, -0.45 * s, -0.17 * s, -0.36 * s, -0.16 * s, -0.22 * s);
  c.bezierCurveTo(-0.2 * s, 0.1 * s, -0.36 * s, 0.5 * s, -0.5 * s, 0.82 * s);
  c.bezierCurveTo(-0.25 * s, 0.94 * s, 0.25 * s, 0.94 * s, 0.5 * s, 0.82 * s);
  c.bezierCurveTo(0.36 * s, 0.5 * s, 0.2 * s, 0.1 * s, 0.16 * s, -0.22 * s);
  c.bezierCurveTo(0.17 * s, -0.36 * s, 0.15 * s, -0.45 * s, 0.05 * s, -0.47 * s);
  c.closePath();
}

function paintAngel(c: Ctx, s: number): void {
  const porcelain: Rgb = [244, 236, 222];
  wing(c, s, -1);
  wing(c, s, 1);
  // Back hair, falling to the shoulders.
  c.fillStyle = goldFill(c, -0.2 * s, -0.75 * s, 0.2 * s, -0.3 * s);
  c.beginPath();
  c.ellipse(0, -0.56 * s, 0.15 * s, 0.2 * s, 0, 0, TAU);
  c.fill();
  // Gown with soft folds.
  c.save();
  angelGownPath(c, s);
  const gg = c.createLinearGradient(-0.5 * s, 0, 0.5 * s, 0);
  gg.addColorStop(0, css(mixRgb(porcelain, [150, 130, 120], 0.5)));
  gg.addColorStop(0.35, css(porcelain));
  gg.addColorStop(0.55, css([255, 250, 240]));
  gg.addColorStop(1, css(mixRgb(porcelain, [140, 120, 110], 0.55)));
  c.fillStyle = gg;
  c.fill();
  c.clip();
  for (const f of [-0.3, -0.14, 0.02, 0.17, 0.32]) {
    const fg = c.createLinearGradient((f - 0.06) * s, 0, (f + 0.06) * s, 0);
    fg.addColorStop(0, 'rgba(90,70,60,0)');
    fg.addColorStop(0.5, 'rgba(90,70,60,.22)');
    fg.addColorStop(1, 'rgba(255,255,255,.08)');
    c.fillStyle = fg;
    c.beginPath();
    c.moveTo(f * 0.25 * s, -0.15 * s);
    c.quadraticCurveTo(f * 0.6 * s, 0.4 * s, (f * 1.3 - 0.06) * s, 0.95 * s);
    c.lineTo((f * 1.3 + 0.06) * s, 0.95 * s);
    c.quadraticCurveTo(f * 0.6 * s + 0.03 * s, 0.4 * s, f * 0.25 * s + 0.02 * s, -0.15 * s);
    c.fill();
  }
  // Gold sash and hem.
  c.strokeStyle = goldFill(c, -0.5 * s, 0.6 * s, 0.5 * s, 1 * s);
  c.lineWidth = 0.07 * s;
  c.beginPath();
  c.moveTo(-0.52 * s, 0.82 * s);
  c.bezierCurveTo(-0.25 * s, 0.94 * s, 0.25 * s, 0.94 * s, 0.52 * s, 0.82 * s);
  c.stroke();
  c.lineWidth = 0.012 * s;
  c.strokeStyle = css(GOLD);
  c.beginPath();
  c.moveTo(-0.52 * s, 0.73 * s);
  c.bezierCurveTo(-0.25 * s, 0.85 * s, 0.25 * s, 0.85 * s, 0.52 * s, 0.73 * s);
  c.stroke();
  c.fillStyle = goldFill(c, -0.2 * s, -0.24 * s, 0.2 * s, -0.16 * s);
  c.fillRect(-0.3 * s, -0.23 * s, 0.6 * s, 0.045 * s);
  c.restore();
  // Sleeves meeting at the folded hands.
  for (const side of [-1, 1]) {
    c.fillStyle = css(mixRgb(porcelain, [200, 185, 170], 0.35 + 0.15 * side));
    c.beginPath();
    c.moveTo(side * 0.13 * s, -0.42 * s);
    c.bezierCurveTo(side * 0.24 * s, -0.34 * s, side * 0.24 * s, -0.12 * s, side * 0.16 * s, -0.04 * s);
    c.lineTo(side * 0.02 * s, -0.17 * s);
    c.bezierCurveTo(side * 0.06 * s, -0.24 * s, side * 0.08 * s, -0.36 * s, side * 0.07 * s, -0.42 * s);
    c.closePath();
    c.fill();
    c.strokeStyle = css(GOLD);
    c.lineWidth = 0.02 * s;
    c.beginPath();
    c.moveTo(side * 0.16 * s, -0.04 * s);
    c.lineTo(side * 0.02 * s, -0.17 * s);
    c.stroke();
  }
  c.fillStyle = css([248, 232, 214]);
  c.beginPath();
  c.moveTo(0, -0.33 * s);
  c.quadraticCurveTo(0.05 * s, -0.22 * s, 0.025 * s, -0.15 * s);
  c.lineTo(-0.025 * s, -0.15 * s);
  c.quadraticCurveTo(-0.05 * s, -0.22 * s, 0, -0.33 * s);
  c.fill();
  // Head, a little bowed: porcelain, softly shaded, no painted features.
  const hg = c.createRadialGradient(-0.03 * s, -0.64 * s, 0.01 * s, 0, -0.6 * s, 0.14 * s);
  hg.addColorStop(0, css([255, 246, 236]));
  hg.addColorStop(0.7, css([238, 220, 204]));
  hg.addColorStop(1, css([200, 176, 160]));
  c.fillStyle = hg;
  c.beginPath();
  c.ellipse(0.01 * s, -0.6 * s, 0.095 * s, 0.118 * s, 0.12, 0, TAU);
  c.fill();
  // Front hair framing the face: soft gold waves.
  c.fillStyle = goldFill(c, -0.15 * s, -0.75 * s, 0.15 * s, -0.55 * s);
  c.beginPath();
  c.ellipse(0.005 * s, -0.655 * s, 0.108 * s, 0.085 * s, 0.12, Math.PI, 0);
  c.quadraticCurveTo(0.06 * s, -0.66 * s, 0.01 * s, -0.69 * s);
  c.quadraticCurveTo(-0.05 * s, -0.655 * s, -0.103 * s, -0.645 * s);
  c.fill();
  // Halo.
  c.strokeStyle = goldFill(c, -0.22 * s, -0.88 * s, 0.22 * s, -0.8 * s);
  c.lineWidth = 0.032 * s;
  c.beginPath();
  c.ellipse(0, -0.86 * s, 0.19 * s, 0.05 * s, 0, 0, TAU);
  c.stroke();
}

/* ---------- the bow ---------- */

const VELVET: Rgb = [138, 10, 28];
const VELVET_DK: Rgb = [52, 2, 10];
const VELVET_HI: Rgb = [236, 92, 100];

/**
 * Soft strokes (pleats and sheen on the ribbon), blurred by `blur` tiles: painted on a layer in `c`'s transform and
 * composited through src/render/blur.ts, so a browser without canvas filters gets its fallback. `c`'s clip holds.
 */
function softStroke(c: Ctx, s: number, px: number, blur: number, draw: (l: Ctx) => void): void {
  const m = c.getTransform();
  blurredLayer(c, px, blur * s, (l) => {
    l.setTransform(m);
    draw(l);
  });
}

function loopPath(c: Ctx, s: number, side: number): void {
  const P = (x: number, y: number): [number, number] => [side * x * s, y * s];
  c.beginPath();
  c.moveTo(...P(0.1, -0.09));
  c.bezierCurveTo(...P(0.34, -0.5), ...P(0.78, -0.74), ...P(1.02, -0.48));
  c.bezierCurveTo(...P(1.17, -0.3), ...P(1.1, 0.0), ...P(0.9, 0.1));
  c.bezierCurveTo(...P(0.62, 0.22), ...P(0.3, 0.16), ...P(0.1, 0.13));
  c.closePath();
}

function loop(c: Ctx, s: number, px: number, side: number): void {
  const P = (x: number, y: number): [number, number] => [side * x * s, y * s];
  c.save();
  loopPath(c, s, side);
  const g = c.createLinearGradient(...P(0.1, 0), ...P(1.1, -0.2));
  g.addColorStop(0, css(VELVET_DK));
  g.addColorStop(0.35, css(VELVET));
  g.addColorStop(0.7, css(mixRgb(VELVET, VELVET_HI, 0.25)));
  g.addColorStop(1, css(VELVET));
  c.fillStyle = g;
  c.fill();
  c.clip();
  // Pleats gathered into the knot: alternating soft light and shadow streaks fanning out.
  const pleats: readonly (readonly [number, number, number])[] = [
    [-0.07, -0.62, 1], [-0.04, -0.45, 0], [-0.01, -0.28, 1], [0.03, -0.1, 0], [0.07, 0.06, 1], [0.1, 0.16, 0],
  ];
  for (const [y0, y1, light] of pleats) {
    softStroke(c, s, px, 0.035, (l) => {
      l.strokeStyle = light ? css(VELVET_HI, 0.38) : css([30, 0, 6], 0.55);
      l.lineWidth = (light ? 0.05 : 0.07) * s;
      l.lineCap = 'round';
      l.beginPath();
      l.moveTo(...P(0.08, y0));
      l.quadraticCurveTo(...P(0.45, (y0 + y1) / 2 - 0.06), ...P(0.86, y1));
      l.stroke();
    });
  }
  // The loop's opening at its outer end: the inside of the ribbon, in shadow, under a lit lip.
  c.save();
  c.translate(...P(0.86, -0.2));
  c.rotate(side * 0.28);
  c.scale(side, 1);
  c.beginPath();
  c.ellipse(0, 0, 0.13 * s, 0.26 * s, 0, 0, TAU);
  const ig = c.createLinearGradient(-0.13 * s, 0, 0.13 * s, 0);
  ig.addColorStop(0, 'rgb(22,0,4)');
  ig.addColorStop(0.6, css(VELVET_DK));
  ig.addColorStop(1, css(mixRgb(VELVET_DK, VELVET, 0.6)));
  c.fillStyle = ig;
  c.fill();
  softStroke(c, s, px, 0.02, (l) => {
    l.strokeStyle = css(VELVET_HI, 0.55);
    l.lineWidth = 0.035 * s;
    l.beginPath();
    l.ellipse(0, 0, 0.13 * s, 0.26 * s, 0, -1.9, 1.1);
    l.stroke();
  });
  c.restore();
  // Velvet's grazing sheen along the outer edge, and a soft key light from the upper left.
  softStroke(c, s, px, 0.03, (l) => {
    loopPath(l, s, side);
    l.strokeStyle = css(VELVET_HI, 0.45);
    l.lineWidth = 0.07 * s;
    l.stroke();
  });
  const kg = c.createRadialGradient(...P(0.5, -0.5), 0, ...P(0.5, -0.5), 0.7 * s);
  kg.addColorStop(0, 'rgba(255,170,170,.18)');
  kg.addColorStop(1, 'rgba(255,170,170,0)');
  c.fillStyle = kg;
  c.fillRect(-1.3 * s, -1 * s, 2.6 * s, 1.4 * s);
  c.restore();
  loopPath(c, s, side);
  c.strokeStyle = css(GOLD, 0.55);
  c.lineWidth = 0.012 * s;
  c.stroke();
}

function tail(c: Ctx, s: number, px: number, side: number): void {
  // Centreline from the knot out and down, clear of row 0 (beyond |x| = 1.5 tiles before reaching its top edge).
  const N = 30;
  const pts: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    pts.push([side * (0.04 + 0.55 * t + 0.42 * t * t) * s, (0.1 + 1.0 * t - 0.1 * t * t + 0.04 * Math.sin(t * 6)) * s]);
  }
  const half = 0.1 * s;
  const twist = (t: number) => Math.cos(Math.PI * (t * 1.15 + 0.12));
  const edges: [number, number, number, number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const [x0, y0] = pts[Math.max(0, i - 1)];
    const [x1, y1] = pts[Math.min(N, i + 1)];
    const l = Math.hypot(x1 - x0, y1 - y0);
    const nx = -(y1 - y0) / l;
    const ny = (x1 - x0) / l;
    const tw = twist(i / N);
    const w = half * (0.18 + 0.82 * Math.abs(tw)) * (1 + 0.15 * (i / N));
    const [x, y] = pts[i];
    edges.push([x + nx * w, y + ny * w, x - nx * w, y - ny * w, tw]);
  }
  for (let i = 0; i < N; i++) {
    const [ax, ay, bx, by, tw] = edges[i];
    const [cx, cy, dx, dy] = edges[i + 1];
    const front = tw > 0;
    const shade = Math.abs(tw);
    c.fillStyle = css(mixRgb(VELVET_DK, front ? mixRgb(VELVET, VELVET_HI, 0.15) : [96, 6, 20], 0.35 + 0.65 * shade));
    c.beginPath();
    c.moveTo(ax, ay);
    c.lineTo(cx, cy);
    c.lineTo(dx, dy);
    c.lineTo(bx, by);
    c.closePath();
    c.fill();
    c.strokeStyle = c.fillStyle;
    c.lineWidth = 0.6;
    c.stroke();
  }
  // Sheen down the tail's broad face, then the gold-wired edges.
  softStroke(c, s, px, 0.02, (l) => {
    l.strokeStyle = css(VELVET_HI, 0.4);
    l.lineWidth = 0.04 * s;
    l.lineCap = 'round';
    l.beginPath();
    for (let i = 0; i <= N; i++) {
      const tw = edges[i][4];
      const [x, y] = pts[i];
      if (tw > 0.45) l.lineTo(x - side * 0.02 * s, y);
      else l.moveTo(x, y);
    }
    l.stroke();
  });
  c.strokeStyle = css(GOLD, 0.6);
  c.lineWidth = 0.012 * s;
  for (const k of [0, 2]) {
    c.beginPath();
    for (const e of edges) c.lineTo(e[k], e[k + 1]);
    c.stroke();
  }
  // Dovetail end.
  const [ax, ay, bx, by] = edges[N];
  const [qx, qy] = pts[N - 1];
  const [ex, ey] = pts[N];
  const l = Math.hypot(ex - qx, ey - qy);
  const ux = (ex - qx) / l;
  const uy = (ey - qy) / l;
  const tip = 0.13 * s;
  c.fillStyle = css(mixRgb(VELVET, VELVET_HI, 0.1));
  c.beginPath();
  c.moveTo(ax, ay);
  c.lineTo(ax + ux * tip, ay + uy * tip);
  c.lineTo(ex + ux * tip * 0.25, ey + uy * tip * 0.25);
  c.lineTo(bx + ux * tip, by + uy * tip);
  c.lineTo(bx, by);
  c.closePath();
  c.fill();
  c.strokeStyle = css(GOLD, 0.6);
  c.stroke();
}

function paintBow(c: Ctx, s: number, px: number): void {
  tail(c, s, px, -1);
  tail(c, s, px, 1);
  loop(c, s, px, -1);
  loop(c, s, px, 1);
  // The knot: a gathered band, pleated, rounder at the middle.
  c.save();
  c.beginPath();
  c.moveTo(-0.13 * s, -0.12 * s);
  c.quadraticCurveTo(0, -0.17 * s, 0.13 * s, -0.12 * s);
  c.quadraticCurveTo(0.17 * s, 0.02 * s, 0.12 * s, 0.17 * s);
  c.quadraticCurveTo(0, 0.21 * s, -0.12 * s, 0.17 * s);
  c.quadraticCurveTo(-0.17 * s, 0.02 * s, -0.13 * s, -0.12 * s);
  c.closePath();
  const kg = c.createLinearGradient(-0.15 * s, 0, 0.15 * s, 0);
  kg.addColorStop(0, css(VELVET_DK));
  kg.addColorStop(0.4, css(mixRgb(VELVET, VELVET_HI, 0.35)));
  kg.addColorStop(0.65, css(VELVET));
  kg.addColorStop(1, css(VELVET_DK));
  c.fillStyle = kg;
  c.fill();
  c.clip();
  for (const [x, light] of [[-0.07, 0], [-0.03, 1], [0.03, 0], [0.07, 1]] as const) {
    softStroke(c, s, px, 0.015, (l) => {
      l.strokeStyle = light ? css(VELVET_HI, 0.35) : 'rgba(30,0,6,.5)';
      l.lineWidth = 0.03 * s;
      l.beginPath();
      l.moveTo(x * s, -0.16 * s);
      l.quadraticCurveTo(x * 1.3 * s, 0.02 * s, x * s, 0.2 * s);
      l.stroke();
    });
  }
  c.restore();
}

/* ---------- the snowflake ---------- */

/** A faceted crystal blade from (x0,y0) to (x1,y1): two halves, one catching the light. */
function blade(c: Ctx, x0: number, y0: number, x1: number, y1: number, w: number, lightA: number): void {
  const ang = Math.atan2(y1 - y0, x1 - x0);
  const nx = -Math.sin(ang);
  const ny = Math.cos(ang);
  const facing = Math.cos(ang + Math.PI / 2 - lightA);
  const lite: Rgb = [250, 253, 255];
  const dark: Rgb = [120, 150, 190];
  const mx = x0 + (x1 - x0) * 0.25;
  const my = y0 + (y1 - y0) * 0.25;
  for (const sgn of [1, -1]) {
    const k = 0.5 + 0.5 * sgn * facing;
    c.fillStyle = css(mixRgb(dark, lite, k), 0.92);
    c.beginPath();
    c.moveTo(x0, y0);
    c.lineTo(mx + sgn * nx * w, my + sgn * ny * w);
    c.lineTo(x1, y1);
    c.closePath();
    c.fill();
  }
  c.strokeStyle = 'rgba(255,255,255,.85)';
  c.lineWidth = w * 0.22;
  c.beginPath();
  c.moveTo(x0, y0);
  c.lineTo(x1, y1);
  c.stroke();
}

function paintSnowflake(c: Ctx, s: number): void {
  const lightA = (-2.3 * Math.PI) / 4; // light from the upper left
  for (let k = 0; k < 6; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 3;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const P = (t: number): [number, number] => [ux * t * s, uy * t * s];
    for (const [t, len, w] of [[0.36, 0.25, 0.04], [0.56, 0.19, 0.035], [0.72, 0.11, 0.028]] as const) {
      for (const side of [-1, 1]) {
        const b = a + side * (Math.PI / 3);
        const [bx, by] = P(t);
        blade(c, bx, by, bx + Math.cos(b) * len * s, by + Math.sin(b) * len * s, w * s, lightA);
      }
    }
    blade(c, ...P(0.08), ...P(0.86), 0.06 * s, lightA);
    // Tip: a small crystal plate.
    const [tx, ty] = P(0.86);
    c.fillStyle = 'rgba(235,245,255,.9)';
    c.beginPath();
    for (let q = 0; q < 6; q++) {
      const qa = a + (q * Math.PI) / 3;
      c.lineTo(tx + Math.cos(qa) * 0.045 * s, ty + Math.sin(qa) * 0.045 * s);
    }
    c.closePath();
    c.fill();
  }
  // The central hexagonal plate, faceted.
  for (let q = 0; q < 6; q++) {
    const a0 = -Math.PI / 2 + (q * Math.PI) / 3 + Math.PI / 6;
    const a1 = a0 + Math.PI / 3;
    const facing = 0.5 + 0.5 * Math.cos((a0 + a1) / 2 - lightA);
    c.fillStyle = css(mixRgb([130, 160, 200], [252, 254, 255], facing), 0.95);
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(Math.cos(a0) * 0.17 * s, Math.sin(a0) * 0.17 * s);
    c.lineTo(Math.cos(a1) * 0.17 * s, Math.sin(a1) * 0.17 * s);
    c.closePath();
    c.fill();
  }
  c.strokeStyle = 'rgba(255,255,255,.9)';
  c.lineWidth = 0.012 * s;
  c.beginPath();
  for (let q = 0; q <= 6; q++) {
    const a = -Math.PI / 2 + (q * Math.PI) / 3 + Math.PI / 6;
    c.lineTo(Math.cos(a) * 0.1 * s, Math.sin(a) * 0.1 * s);
  }
  c.stroke();
}

/* ---------- glows (the lab's toppersGlow, painted once at full strength) ---------- */

function paintAura(kind: ArtKind, g: Ctx, s: number, glow: Rgb): void {
  if (kind === 'angel') {
    g.strokeStyle = css(mixRgb(glow, [255, 255, 255], 0.5));
    g.lineWidth = 0.12 * s;
    g.beginPath();
    g.ellipse(0, -0.86 * s, 0.19 * s, 0.05 * s, 0, 0, TAU);
    g.stroke();
    radial(g, 0, -0.2 * s, 1.15 * s, [[0, css(glow, 0.55)], [0.5, css(glow, 0.2)], [1, css(glow, 0)]]);
  } else if (kind === 'bow') {
    // A warm backlight behind the bow (the velvet itself does not glow).
    radial(g, 0, -0.1 * s, 1.3 * s, [[0, css(glow, 0.6)], [0.45, css(glow, 0.2)], [1, css(glow, 0)]]);
  } else {
    const ice = mixRgb(glow, [200, 230, 255], 0.6);
    g.strokeStyle = css(ice, 0.7);
    g.lineWidth = 0.1 * s;
    g.lineCap = 'round';
    g.beginPath();
    for (let q = 0; q < 6; q++) {
      const a = -Math.PI / 2 + (q * Math.PI) / 3;
      g.moveTo(0, 0);
      g.lineTo(Math.cos(a) * 0.86 * s, Math.sin(a) * 0.86 * s);
    }
    g.stroke();
    radial(g, 0, 0, 0.9 * s, [[0, css(ice, 0.7)], [1, css(ice, 0)]]);
  }
}

/* ---------- sprites: albedo → dim / lit / emit, and the aura ---------- */

interface Art {
  dim: HTMLCanvasElement;
  lit: HTMLCanvasElement;
  emit: HTMLCanvasElement;
  aura: HTMLCanvasElement;
  /** The angel's lit halo ring, from the scene's core colour. */
  haloCore: string;
}

/** One kind's sprites for one size and scene light; `art` null when no 2D context could be had (the star stands in). */
interface Sprites {
  s: number;
  dpr: number;
  light: Scene['light'];
  glow: string;
  art: Art | null;
}

const cache = new Map<string, Sprites>();
/** What prepareArt last built for each kind: a frame finds its sprites here without building a key. */
const current: Record<ArtKind, Sprites | null> = { angel: null, bow: null, snowflake: null };
/** The dpr prepareArt was last given, for a draw that comes before any prepare. */
let lastDpr = 1;
/** The snowflake's glint: a soft white dot, the same for every scene. */
let glintDot: HTMLCanvasElement | null = null;

/** The scene's ambient light on the topper before the tree lights it. */
function ambientTint(sc: Scene): Rgb {
  switch (sc.light) {
    case 'day':
      return [200, 205, 214];
    case 'fire':
      return [78, 56, 44];
    case 'aurora':
      return [60, 86, 104];
    default:
      return [62, 70, 92];
  }
}

function derive(albedo: HTMLCanvasElement, fill: (c: Ctx, w: number, h: number) => void): HTMLCanvasElement {
  const [cv, c] = canvas(albedo.width, albedo.height);
  c.drawImage(albedo, 0, 0);
  fill(c, cv.width, cv.height);
  c.globalCompositeOperation = 'destination-in';
  c.drawImage(albedo, 0, 0);
  return cv;
}

function build(kind: ArtKind, s: number, px: number, sc: Scene): Art {
  const box = BOX[kind];
  const [albedo, a] = canvas(box[2] * s * px, box[3] * s * px);
  a.setTransform(px, 0, 0, px, -box[0] * s * px, -box[1] * s * px);
  if (kind === 'angel') paintAngel(a, s);
  else if (kind === 'bow') paintBow(a, s, px);
  else paintSnowflake(a, s);
  const amb = ambientTint(sc);
  const glow = hexRgb(sc.glow);
  // The origin (star centre) in sprite pixels.
  const ox = -box[0] * s * px;
  const oy = -box[1] * s * px;
  const dim = derive(albedo, (c, w, h) => {
    c.globalCompositeOperation = 'multiply';
    c.fillStyle = css(amb);
    c.fillRect(0, 0, w, h);
    // The scene's key light along one edge so the silhouette still reads.
    c.globalCompositeOperation = 'source-atop';
    const g = c.createLinearGradient(sc.light === 'fire' ? 0 : w, 0, sc.light === 'fire' ? w : 0, 0);
    g.addColorStop(0, sc.light === 'fire' ? 'rgba(255,150,80,.16)' : sc.light === 'day' ? 'rgba(255,255,255,.12)' : 'rgba(150,180,240,.14)');
    g.addColorStop(0.6, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  });
  const lit = derive(albedo, (c, w, h) => {
    c.globalCompositeOperation = 'multiply';
    c.fillStyle = 'rgb(255,236,210)';
    c.fillRect(0, 0, w, h);
    // The tree's light from below, and the room's from above, darker.
    c.globalCompositeOperation = 'source-atop';
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(20,10,0,.22)');
    g.addColorStop(0.55, 'rgba(0,0,0,0)');
    g.addColorStop(1, css(mixRgb(glow, [255, 255, 255], 0.3), 0.32));
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  });
  const emit = derive(albedo, (c, w, h) => {
    c.globalCompositeOperation = 'source-atop';
    const r = Math.max(w, h) * 0.55;
    const g = c.createRadialGradient(ox, oy, 0, ox, oy, r);
    g.addColorStop(0, 'rgba(255,255,250,1)');
    g.addColorStop(0.35, css(mixRgb(glow, [255, 255, 255], 0.55)));
    g.addColorStop(1, css(glow, 0.7));
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  });
  albedo.width = albedo.height = 0;
  const ab = AURA_BOX[kind];
  const gpx = px * AURA_RES;
  const [aura, g] = canvas(ab[2] * s * gpx, ab[3] * s * gpx);
  g.setTransform(gpx, 0, 0, gpx, -ab[0] * s * gpx, -ab[1] * s * gpx);
  paintAura(kind, g, s, glow);
  if (kind === 'snowflake' && !glintDot) {
    const [dot, d] = canvas(32, 32);
    radial(d, 16, 16, 16, [[0, '#fff'], [1, 'rgba(255,255,255,0)']]);
    glintDot = dot;
  }
  return { dim, lit, emit, aura, haloCore: css(mixRgb(hexRgb(sc.core), [255, 255, 255], 0.4)) };
}

/**
 * Builds (or finds in the cache) `kind`'s sprites for tiles of `s` CSS px at `dpr`, in the scene's light and glow. The
 * camera's zoom never rebuilds them: drawImage scales them. Never throws: without a 2D context the star stands in.
 */
export function prepareArt(kind: ArtKind, s: number, dpr: number, sc: Scene): void {
  const q = Math.max(1, Math.round(dpr * 4) / 4);
  lastDpr = q;
  const key = `${kind}|${Math.round(s * 10)}|${q}|${sc.light}|${sc.glow}`;
  let set = cache.get(key);
  if (!set) {
    if (cache.size >= CACHE_MAX) cache.clear();
    let art: Art | null = null;
    try {
      art = build(kind, s, q, sc);
    } catch {
      // No 2D context for the cache (memory pressure, an old browser): the star, rather than trying every frame.
    }
    set = { s, dpr: q, light: sc.light, glow: sc.glow, art };
    cache.set(key, set);
  }
  current[kind] = set;
}

/** This frame's sprites: the prepared ones, or (a draw before any prepare, or after the scene changed) built now. */
function sprites(kind: ArtKind, s: number, sc: Scene): Art | null {
  const set = current[kind];
  if (!set || set.s !== s || set.light !== sc.light || set.glow !== sc.glow) prepareArt(kind, s, lastDpr, sc);
  return current[kind]?.art ?? null;
}

/** How lit the topper is: a little as the tree fills, fully on the win. */
const warmth = (st: StarState, won: boolean, litFrac: number): number => (won ? 0.55 + 0.45 * st.on : 0.55 * litFrac * litFrac);

/**
 * The topper about the origin, at the context's opacity. `st.on` is the star's (the topper adds a tap's or a flip's
 * flash to it, so a flare reads before the win too, where the star's own is 0).
 */
export function drawArt(kind: ArtKind, c: Ctx, s: number, sc: Scene, st: StarState, won: boolean, litFrac: number, now: number): void {
  const art = sprites(kind, s, sc);
  if (!art) {
    drawStarBody(c, s, sc, st.on);
    return;
  }
  const [bx, by, bw, bh] = BOX[kind];
  const base = c.globalAlpha;
  const light = warmth(st, won, litFrac);
  c.save();
  if (kind === 'bow' && won) c.rotate(0.015 * Math.sin(now * 0.0016) * clamp01((st.on - 0.9) * 10));
  c.imageSmoothingEnabled = true;
  c.imageSmoothingQuality = 'high';
  const x = bx * s;
  const y = by * s;
  const w = bw * s;
  const h = bh * s;
  if (light < 1) c.drawImage(art.dim, x, y, w, h);
  if (light > 0) {
    c.globalAlpha = base * light;
    c.drawImage(art.lit, x, y, w, h);
  }
  if (st.on > 0) {
    // Ignite: a glowing silhouette added over it.
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = base * st.on * EMIT[kind] * (0.9 + 0.1 * Math.sin(now * 0.003));
    c.drawImage(art.emit, x, y, w, h);
  }
  c.restore();
  if (kind === 'snowflake') flakeGlints(c, s, st, won, litFrac, now);
  else if (kind === 'angel' && st.on > 0) haloCore(c, s, st, art);
}

/** Twinkling glints at the snowflake's tips and joints (a few tiny crosses; none until the tree is well lit). */
function flakeGlints(c: Ctx, s: number, st: StarState, won: boolean, litFrac: number, now: number): void {
  const amt = won ? 0.6 + 0.4 * st.on : clamp01((litFrac - 0.4) * 1.6) * 0.6;
  if (amt <= 0.02 || !glintDot) return;
  const base = c.globalAlpha;
  c.save();
  c.globalCompositeOperation = 'lighter';
  c.lineCap = 'round';
  c.strokeStyle = '#fff';
  c.lineWidth = Math.max(0.6, s * 0.012);
  for (let q = 0; q < 6; q++) {
    const ph = (now / 1900 + q * 0.37) % 1;
    const a = Math.pow(Math.sin(Math.PI * ph), 4) * amt;
    if (a < 0.03) continue;
    const ang = -Math.PI / 2 + (q * Math.PI) / 3;
    const r = (q % 2 ? 0.86 : 0.56) * s;
    const x = Math.cos(ang) * r;
    const y = Math.sin(ang) * r;
    const len = s * 0.16 * (0.6 + 0.4 * a);
    c.globalAlpha = base * a;
    c.beginPath();
    c.moveTo(x - len, y);
    c.lineTo(x + len, y);
    c.moveTo(x, y - len);
    c.lineTo(x, y + len);
    c.stroke();
    c.drawImage(glintDot, x - len * 0.5, y - len * 0.5, len, len);
  }
  c.restore();
}

/** The lit halo's white-hot ring on top of the sprite. */
function haloCore(c: Ctx, s: number, st: StarState, art: Art): void {
  c.save();
  c.globalCompositeOperation = 'lighter';
  c.globalAlpha *= Math.min(1, st.on);
  c.strokeStyle = art.haloCore;
  c.lineWidth = 0.014 * s;
  c.beginPath();
  c.ellipse(0, -0.86 * s, 0.19 * s, 0.05 * s, 0, 0, TAU);
  c.stroke();
  c.restore();
}

/**
 * The topper's own glow on the half-res glow layer, about the origin at the context's opacity (the star's radial halo,
 * drawStarGlow, is drawn for it already): faint as the tree fills, full on the win.
 */
export function drawArtGlow(kind: ArtKind, g: Ctx, s: number, sc: Scene, st: StarState, won: boolean, litFrac: number, now: number): void {
  const pre = 0.25 * litFrac ** 3;
  const on = won ? st.on : 0;
  const amt = Math.max(pre, on * (0.9 + 0.1 * Math.sin(now * 0.003)));
  if (amt <= 0.01) return;
  const art = sprites(kind, s, sc);
  if (!art) return;
  const [bx, by, bw, bh] = AURA_BOX[kind];
  const base = g.globalAlpha;
  g.globalAlpha = base * amt * (kind === 'bow' ? 0.8 : 1);
  g.drawImage(art.aura, bx * s, by * s, bw * s, bh * s);
  g.globalAlpha = base;
}
