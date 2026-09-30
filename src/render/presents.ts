import type { Grid } from '../core/mask';
import { CANVAS_FILTER } from './blur';
import { hexRgb } from './color';
import { X, Y, type Layout } from './layout';
import type { Scene } from './scenes';

/**
 * Presents under the tree (spec §4.8). Visual only: they never overlap a tile's hit area.
 * Each gift is pre-rendered twice on layout or scene change: a `base` sprite (scene ambient light, contact shadow,
 * Fireside floor reflection) and a `light` sprite (the tree's warm light on the same surfaces). Per frame the light
 * sprite is added over the base with the lit fraction, so the gifts are dark when unlit and warm as the tree lights.
 */

export interface Paper {
  base: string;
  ribbon: string;
  pattern: 'plain' | 'stripe' | 'dots';
  ink: string;
}

export const PAPERS: readonly Paper[] = [
  { base: '#8e1622', ribbon: '#e2b25a', pattern: 'plain', ink: '#8e1622' }, // cranberry, gold ribbon
  { base: '#1d5534', ribbon: '#efe0bd', pattern: 'dots', ink: '#e2b25a' }, // forest green, gold dots
  { base: '#e6d8bb', ribbon: '#b3202c', pattern: 'stripe', ink: '#b3202c' }, // ivory, red pinstripe
  { base: '#1f3f66', ribbon: '#e2b25a', pattern: 'plain', ink: '#1f3f66' }, // midnight blue, gold ribbon
  { base: '#c49440', ribbon: '#9e1b2a', pattern: 'plain', ink: '#c49440' }, // gold paper, red ribbon
  { base: '#6e1420', ribbon: '#efe0bd', pattern: 'stripe', ink: '#e2b25a' }, // wine, gold stripe
];

/** [u, w, h, dz, paper, bow]: centre offset, width, height and depth-forward in tile units; bow scale. */
type Spec = readonly [number, number, number, number, number, number];

/** Phones: a cluster in front of the tree, below the ground line (units of the gift scale). */
const FRONT: readonly Spec[] = [
  [-3.25, 1.8, 1.4, 0, 0, 1],
  [1.75, 1.55, 1.2, 0.1, 2, 1],
  [-1.5, 1.25, 0.95, 0.4, 1, 0.9],
  [3.4, 1.1, 0.85, 0.45, 3, 0.85],
  [0.2, 0.9, 0.7, 0.75, 4, 0.8],
];

/** Desktop: flanking the tree base. Tall gifts stand outside the tile columns (|u| > 8.5); low ones tuck in. */
const FLANK: readonly Spec[] = [
  [-9.85, 1.5, 1.45, 0, 0, 1],
  [9.7, 1.35, 1.3, 0, 3, 1],
  [7.85, 1.15, 0.64, 0.25, 1, 0.85],
  [-7.75, 1.3, 0.6, 0.3, 2, 0.8],
  [-6.3, 0.85, 0.5, 0.5, 4, 0.75],
  [6.55, 0.8, 0.46, 0.5, 5, 0.7],
];

export interface Gift {
  /** Front face centre x and floor line y (CSS px). */
  cx: number;
  base: number;
  w: number;
  h: number;
  /** Back face offset from the front face: x toward the centre of view, y up (the top face shows). */
  sx: number;
  rise: number;
  lid: number;
  over: number;
  bow: number;
  paper: Paper;
}

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function makeGift(L: Layout, cx: number, base: number, w: number, h: number, paper: Paper, bowScale: number): Gift {
  const depth = 0.75 * w;
  const toward = Math.max(-1, Math.min(1, (L.ox - cx) / (L.w * 0.5)));
  return {
    cx, base, w, h, paper,
    sx: toward * depth * 0.34,
    rise: depth * 0.3,
    lid: Math.min(0.24 * h, 0.2 * w),
    over: 0.035 * w,
    bow: Math.min(w, depth) * 0.36 * bowScale,
  };
}

/** Bow knot position: the middle of the lid's top face. */
function bowCentre(g: Gift): [number, number] {
  return [g.cx + g.sx / 2, g.base - g.h - g.rise / 2];
}

/** Everything that is the gift itself (faces, lid, bow, contact shadow), for placement checks. */
export function giftBounds(g: Gift): Rect {
  const [bx, by] = bowCentre(g);
  const x0 = Math.min(g.cx - g.w / 2 - g.over, g.cx - g.w / 2 - g.over + g.sx, bx - 1.2 * g.bow);
  const x1 = Math.max(g.cx + g.w / 2 + g.over, g.cx + g.w / 2 + g.over + g.sx, bx + 1.2 * g.bow);
  const y0 = Math.min(g.base - g.h - g.rise - 0.02 * g.h, by - 0.95 * g.bow);
  return { x0, y0, x1, y1: g.base + 0.14 * g.w + 3 };
}

const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Hit rectangle of every tile (spec: the whole grid cell is the hit area). */
export function tileRects(L: Layout, grid: Grid): Rect[] {
  return grid.ids.map((i) => {
    const x0 = X(L, (i % grid.w) - grid.w / 2);
    const y0 = Y(L, Math.floor(i / grid.w));
    return { x0, y0, x1: x0 + L.s, y1: y0 + L.s };
  });
}

function fits(L: Layout, gifts: readonly Gift[], tiles: readonly Rect[]): boolean {
  const pad = 3;
  const edge = 6;
  for (const g of gifts) {
    const b = giftBounds(g);
    if (b.x0 < edge || b.x1 > L.w - edge || b.y0 < edge || b.y1 > L.h - edge) return false;
    const grown = { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad };
    for (const t of tiles) if (overlaps(grown, t)) return false;
  }
  return true;
}

/** `unit` sizes the gifts, `posUnit` spaces them; `floor` is the lowest y a gift's shadow may reach. */
function build(L: Layout, specs: readonly Spec[], unit: number, posUnit: number, baseline: number, floor: number): Gift[] {
  // Big windows leave little room under the ground line: pull the front gifts back rather than off the bottom.
  const maxDz = Math.max(...specs.map((sp) => sp[3]));
  const shadow = Math.max(...specs.map((sp) => sp[1])) * unit * 0.14 + 3;
  const dzScale = Math.max(0, Math.min(1, (floor - shadow - baseline) / (maxDz * unit)));
  return [...specs]
    .sort((a, b) => a[3] - b[3])
    .map(([u, w, h, dz, p, bow]) => makeGift(L, L.ox + u * posUnit, baseline + dz * dzScale * unit, w * unit, h * unit, PAPERS[p], bow));
}

/**
 * Places the gifts: in front of the tree on phones (w < 600), flanking the base on desktop. Every candidate is checked
 * against the tile hit areas and the viewport; if nothing fits (extreme aspect ratios) there are no gifts.
 */
export function placePresents(L: Layout, grid: Grid): Gift[] {
  const tiles = tileRects(L, grid);
  const s = L.s;
  if (L.w < 600) {
    for (const k of [1.2, 1.1, 1, 0.9, 0.8]) {
      const unit = s * k;
      const baseline = Math.min(Y(L, 10.35) + 2.2 * s, L.h - 10 - 0.95 * unit);
      const gifts = build(L, FRONT, unit, unit, baseline, L.h - 8);
      if (fits(L, gifts, tiles)) return gifts;
    }
  }
  for (const k of [1, 0.9, 0.8]) {
    const gifts = build(L, FLANK, s * k, s, Y(L, 10.25), L.h - 8);
    if (fits(L, gifts, tiles)) return gifts;
  }
  return [];
}

/* ---------- painting ---------- */

type Pass = 'base' | 'light';
type Face = 'front' | 'top' | 'side';

interface Lighting {
  /** Ambient light colour (0..1 per channel) per face for the base pass. */
  ambient: readonly [number, number, number];
  face: Readonly<Record<Face, number>>;
  /** Warm tree light colour (0..1) and per-face response for the light pass. */
  warm: readonly [number, number, number];
  lightFace: Readonly<Record<Face, number>>;
}

function lighting(sc: Scene): Lighting {
  const g = hexRgb(sc.glow).map((v) => (v / 255) * 0.7 + 0.3) as [number, number, number];
  const lightFace = { top: 0.85, side: 0.65, front: 0.4 };
  if (sc.light === 'day') return { ambient: [0.86, 0.9, 0.95], face: { front: 0.9, top: 1.12, side: 0.66 }, warm: g, lightFace };
  if (sc.light === 'moon') return { ambient: [0.2, 0.24, 0.36], face: { front: 0.9, top: 1.35, side: 0.65 }, warm: g, lightFace };
  return { ambient: [0.3, 0.2, 0.14], face: { front: 0.95, top: 1.25, side: 0.7 }, warm: g, lightFace };
}

class Tone {
  constructor(private readonly lt: Lighting, private readonly pass: Pass) {}

  /** Surface colour `hex` lit on `face`, times `k` (for gradients and specular). */
  of(hex: string, face: Face, k = 1): string {
    const a = hexRgb(hex);
    const lt = this.lt;
    const light = this.pass === 'base' ? lt.ambient : lt.warm;
    const f = (this.pass === 'base' ? lt.face[face] : lt.lightFace[face]) * k;
    const ch = a.map((v, i) => Math.min(255, Math.round(v * light[i] * f)));
    return `rgb(${ch.join(',')})`;
  }
}

type P = readonly [number, number];

function poly(c: CanvasRenderingContext2D, pts: readonly P[]): void {
  c.beginPath();
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.closePath();
}

function linear(c: CanvasRenderingContext2D, a: P, b: P, stops: readonly (readonly [number, string])[]): CanvasGradient {
  const gr = c.createLinearGradient(a[0], a[1], b[0], b[1]);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  return gr;
}

/** Pattern printed on the paper, clipped to the current path. */
function paperPattern(c: CanvasRenderingContext2D, g: Gift, t: Tone, face: Face, box: Rect): void {
  const p = g.paper;
  if (p.pattern === 'plain') return;
  c.save();
  c.clip();
  c.fillStyle = t.of(p.ink, face, 0.95);
  c.strokeStyle = t.of(p.ink, face, 0.95);
  const step = Math.max(4, g.w * 0.11);
  if (p.pattern === 'stripe') {
    c.lineWidth = Math.max(0.6, g.w * 0.018);
    c.globalAlpha = 0.75;
    c.beginPath();
    for (let x = box.x0 - (box.y1 - box.y0); x < box.x1; x += step) {
      c.moveTo(x, box.y1);
      c.lineTo(x + (box.y1 - box.y0), box.y0);
    }
    c.stroke();
  } else {
    c.globalAlpha = 0.85;
    const r = Math.max(0.6, g.w * 0.02);
    let row = 0;
    for (let y = box.y0 + step * 0.4; y < box.y1; y += step * 0.8, row++) {
      for (let x = box.x0 + (row % 2 ? step / 2 : 0); x < box.x1; x += step) {
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.fill();
      }
    }
  }
  c.restore();
}

/** A satin ribbon band: dark edges and a bright centre line along its length. */
function ribbonFill(c: CanvasRenderingContext2D, t: Tone, hex: string, face: Face, a: P, b: P): CanvasGradient {
  return linear(c, a, b, [
    [0, t.of(hex, face, 0.62)],
    [0.42, t.of(hex, face, 1.18)],
    [0.55, t.of(hex, face, 1.32)],
    [1, t.of(hex, face, 0.7)],
  ]);
}

/** One wrapped box (lid, ribbons, bow), in CSS px layout coordinates. */
function paintBox(c: CanvasRenderingContext2D, g: Gift, t: Tone, pass: Pass): void {
  const { cx, base, w, h, sx, rise, lid, over } = g;
  const paper = g.paper.base;
  const rib = g.paper.ribbon;
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const yT = base - h;
  const lx0 = x0 - over;
  const lx1 = x1 + over;
  const lyT = yT - 0.02 * h;
  const lyB = yT + lid;
  const rw = Math.max(1.5, w * 0.12);
  const sideRight = sx < 0 ? false : true;
  const bump = (p: P): P => [p[0] + sx, p[1] - rise];

  // Body side face (toward the centre of view), then body front.
  const sideX = sideRight ? x1 : x0;
  const side: P[] = [[sideX, lyB], [sideX, base], bump([sideX, base]), bump([sideX, lyB])];
  if (Math.abs(sx) > 0.5) {
    poly(c, side);
    c.fillStyle = linear(c, [sideX, lyB], [sideX, base], [[0, t.of(paper, 'side', 1)], [1, t.of(paper, 'side', 0.6)]]);
    c.fill();
    paperPattern(c, g, t, 'side', { x0: Math.min(sideX, sideX + sx), y0: lyB - rise, x1: Math.max(sideX, sideX + sx), y1: base });
    // ribbon down the middle of the side face, only where the face is wide enough to read
    if (Math.abs(sx) > rw * 1.6) {
      const m0: P = [sideX + sx * 0.5, lyB - rise * 0.5];
      const hw = Math.abs(sx) * 0.16;
      poly(c, [[m0[0] - hw, m0[1] - rise * 0.1], [m0[0] + hw, m0[1] + rise * 0.1], [m0[0] + hw, base - rise * 0.4], [m0[0] - hw, base - rise * 0.6]]);
      c.fillStyle = t.of(rib, 'side', 0.9);
      c.fill();
    }
  }
  const front: P[] = [[x0, lyB], [x1, lyB], [x1, base], [x0, base]];
  poly(c, front);
  c.fillStyle = linear(c, [0, lyB], [0, base], pass === 'base'
    ? [[0, t.of(paper, 'front', 1.05)], [0.7, t.of(paper, 'front', 0.86)], [1, t.of(paper, 'front', 0.6)]]
    : [[0, t.of(paper, 'front', 1.15)], [1, t.of(paper, 'front', 0.35)]]);
  c.fill();
  poly(c, front);
  paperPattern(c, g, t, 'front', { x0, y0: lyB, x1, y1: base });
  // Paper sheen, and light falling off away from the tree (the tree is toward the centre of view).
  const near = sx >= 0 ? x1 : x0;
  const far = sx >= 0 ? x0 : x1;
  c.fillStyle = linear(c, [near, 0], [far, 0], [[0, 'rgba(0,0,0,0)'], [1, `rgba(0,0,0,${pass === 'base' ? 0.18 : 0.42})`]]);
  c.fillRect(x0, lyB, w, base - lyB);
  c.fillStyle = linear(c, [x0, lyB], [x1, base], [[0.25, 'rgba(255,255,255,0)'], [0.4, `rgba(255,255,255,${pass === 'base' ? 0.05 : 0.1})`], [0.55, 'rgba(255,255,255,0)']]);
  c.fillRect(x0, lyB, w, base - lyB);
  // shadow under the lid overhang
  c.fillStyle = linear(c, [0, lyB], [0, lyB + h * 0.12], [[0, 'rgba(0,0,0,.4)'], [1, 'rgba(0,0,0,0)']]);
  c.fillRect(x0, lyB, w, h * 0.12);
  // vertical ribbon on the body
  c.fillStyle = ribbonFill(c, t, rib, 'front', [cx - rw / 2, 0], [cx + rw / 2, 0]);
  c.fillRect(cx - rw / 2, lyB, rw, base - lyB);

  // Lid: side, front, top.
  const lSideX = sideRight ? lx1 : lx0;
  if (Math.abs(sx) > 0.5) {
    poly(c, [[lSideX, lyT], [lSideX, lyB], bump([lSideX, lyB]), bump([lSideX, lyT])]);
    c.fillStyle = t.of(paper, 'side', 0.9);
    c.fill();
  }
  const lidFront: P[] = [[lx0, lyT], [lx1, lyT], [lx1, lyB], [lx0, lyB]];
  poly(c, lidFront);
  c.fillStyle = linear(c, [0, lyT], [0, lyB], [[0, t.of(paper, 'front', 1.18)], [1, t.of(paper, 'front', 0.9)]]);
  c.fill();
  poly(c, lidFront);
  paperPattern(c, g, t, 'front', { x0: lx0, y0: lyT, x1: lx1, y1: lyB });
  c.fillStyle = ribbonFill(c, t, rib, 'front', [cx - rw / 2, 0], [cx + rw / 2, 0]);
  c.fillRect(cx - rw / 2, lyT, rw, lid);
  const top: P[] = [[lx0, lyT], [lx1, lyT], bump([lx1, lyT]), bump([lx0, lyT])];
  poly(c, top);
  c.fillStyle = linear(c, [0, lyT], [0, lyT - rise], pass === 'base'
    ? [[0, t.of(paper, 'top', 1)], [1, t.of(paper, 'top', 0.88)]]
    : [[0, t.of(paper, 'top', 0.8)], [1, t.of(paper, 'top', 1.2)]]);
  c.fill();
  poly(c, top);
  paperPattern(c, g, t, 'top', { x0: Math.min(lx0, lx0 + sx), y0: lyT - rise, x1: Math.max(lx1, lx1 + sx), y1: lyT });
  // ribbons across the top: front-to-back and left-to-right
  poly(c, [[cx - rw / 2, lyT], [cx + rw / 2, lyT], bump([cx + rw / 2, lyT]), bump([cx - rw / 2, lyT])]);
  c.fillStyle = ribbonFill(c, t, rib, 'top', [cx - rw / 2, 0], [cx + rw / 2, 0]);
  c.fill();
  const my = lyT - rise / 2;
  const mx = sx / 2;
  poly(c, [[lx0 + mx, my - rw * 0.3], [lx1 + mx, my - rw * 0.3], [lx1 + mx, my + rw * 0.3], [lx0 + mx, my + rw * 0.3]]);
  c.fillStyle = ribbonFill(c, t, rib, 'top', [0, my - rw * 0.3], [0, my + rw * 0.3]);
  c.fill();
  // crisp lid edges catch the light
  c.lineWidth = Math.max(0.6, w * 0.012);
  c.strokeStyle = pass === 'base' ? 'rgba(255,255,255,.16)' : t.of('#ffffff', 'top', 0.45);
  c.beginPath();
  c.moveTo(lx0, lyT);
  c.lineTo(lx1, lyT);
  c.stroke();
  c.strokeStyle = 'rgba(0,0,0,.3)';
  c.beginPath();
  c.moveTo(lx0, lyB);
  c.lineTo(lx1, lyB);
  c.stroke();

  paintBow(c, g, t);
}

function paintBow(c: CanvasRenderingContext2D, g: Gift, t: Tone): void {
  const [bx, by] = bowCentre(g);
  const b = g.bow;
  const rib = g.paper.ribbon;
  // tails draping forward over the lid
  for (const d of [-1, 1]) {
    poly(c, [
      [bx + d * 0.05 * b, by],
      [bx + d * 0.3 * b, by],
      [bx + d * 0.62 * b, by + 0.95 * b],
      [bx + d * 0.46 * b, by + 0.82 * b],
      [bx + d * 0.36 * b, by + 1.0 * b],
    ]);
    c.fillStyle = linear(c, [bx, by], [bx + d * 0.6 * b, by + b], [[0, t.of(rib, 'front', 1.1)], [1, t.of(rib, 'front', 0.62)]]);
    c.fill();
  }
  // loops
  for (const d of [-1, 1]) {
    c.beginPath();
    c.moveTo(bx, by);
    c.bezierCurveTo(bx + d * 0.3 * b, by - 0.95 * b, bx + d * 1.25 * b, by - 0.8 * b, bx + d * 1.08 * b, by - 0.12 * b);
    c.bezierCurveTo(bx + d * 0.98 * b, by + 0.26 * b, bx + d * 0.42 * b, by + 0.22 * b, bx, by);
    c.fillStyle = linear(c, [bx, by - 0.8 * b], [bx, by + 0.25 * b], [[0, t.of(rib, 'top', 1.3)], [0.55, t.of(rib, 'top', 0.95)], [1, t.of(rib, 'top', 0.55)]]);
    c.fill();
    // the hollow inside the loop
    c.beginPath();
    c.moveTo(bx + d * 0.22 * b, by - 0.1 * b);
    c.bezierCurveTo(bx + d * 0.42 * b, by - 0.6 * b, bx + d * 0.95 * b, by - 0.55 * b, bx + d * 0.88 * b, by - 0.16 * b);
    c.bezierCurveTo(bx + d * 0.8 * b, by + 0.04 * b, bx + d * 0.45 * b, by + 0.02 * b, bx + d * 0.22 * b, by - 0.1 * b);
    c.fillStyle = t.of(rib, 'side', 0.42);
    c.fill();
    // satin sheen along the upper curve
    c.beginPath();
    c.moveTo(bx + d * 0.12 * b, by - 0.28 * b);
    c.bezierCurveTo(bx + d * 0.35 * b, by - 0.82 * b, bx + d * 0.95 * b, by - 0.72 * b, bx + d * 1.06 * b, by - 0.3 * b);
    c.lineWidth = Math.max(0.5, b * 0.07);
    c.lineCap = 'round';
    c.strokeStyle = t.of('#ffffff', 'top', 0.5);
    c.stroke();
  }
  const kg = c.createRadialGradient(bx - 0.06 * b, by - 0.07 * b, 0, bx, by, 0.24 * b);
  kg.addColorStop(0, t.of(rib, 'top', 1.4));
  kg.addColorStop(1, t.of(rib, 'front', 0.7));
  c.fillStyle = kg;
  c.beginPath();
  c.ellipse(bx, by, 0.22 * b, 0.18 * b, 0, 0, Math.PI * 2);
  c.fill();
}

function contactShadow(c: CanvasRenderingContext2D, g: Gift, sc: Scene): void {
  const col = sc.light === 'day' ? '70,90,110' : '0,0,0';
  const a = sc.light === 'day' ? 0.34 : 0.62;
  const x = g.cx + g.sx / 2;
  const y = g.base - g.rise / 2 + 1;
  const rx = g.w / 2 + Math.abs(g.sx) / 2 + g.w * 0.12;
  const ry = g.rise / 2 + g.w * 0.1;
  c.save();
  c.translate(x, y);
  c.scale(1, ry / rx);
  const gr = c.createRadialGradient(0, 0, 0, 0, 0, rx);
  gr.addColorStop(0, `rgba(${col},${a})`);
  gr.addColorStop(0.6, `rgba(${col},${a * 0.45})`);
  gr.addColorStop(1, `rgba(${col},0)`);
  c.fillStyle = gr;
  c.fillRect(-rx, -rx, 2 * rx, 2 * rx);
  c.restore();
  // occlusion right where the box meets the floor
  c.fillStyle = linear(c, [0, g.base - 1], [0, g.base + 3], [[0, `rgba(${col},${a})`], [1, `rgba(${col},0)`]]);
  c.fillRect(g.cx - g.w / 2 - 1, g.base - 1, g.w + 2, 4);
}

interface Sprite {
  x: number;
  y: number;
  w: number;
  h: number;
  base: HTMLCanvasElement;
  light: HTMLCanvasElement;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d');
  if (!c) throw new Error('Canvas 2D is unavailable');
  return [cv, c];
}

export class Presents {
  gifts: Gift[] = [];
  private sprites: Sprite[] = [];

  /** Places and pre-renders the gifts. Call on layout or scene change. */
  layout(L: Layout, grid: Grid, sc: Scene): void {
    for (const sp of this.sprites) sp.base.width = sp.light.width = 0;
    this.gifts = placePresents(L, grid);
    const lt = lighting(sc);
    this.sprites = this.gifts.map((g) => this.render(g, L, sc, lt));
  }

  /** Union of the gifts' bounds (CSS px), or null when there are none. */
  bounds(): Rect | null {
    if (!this.gifts.length) return null;
    const bs = this.gifts.map(giftBounds);
    return { x0: Math.min(...bs.map((b) => b.x0)), y0: Math.min(...bs.map((b) => b.y0)), x1: Math.max(...bs.map((b) => b.x1)), y1: Math.max(...bs.map((b) => b.y1)) };
  }

  /** `warm` 0..~1.3: how much of the tree's light reaches them. Caller sets the world transform (CSS px). */
  draw(c: CanvasRenderingContext2D, warm: number): void {
    for (const sp of this.sprites) {
      c.drawImage(sp.base, sp.x, sp.y, sp.w, sp.h);
      if (warm <= 0.004) continue;
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = Math.min(1, warm);
      c.drawImage(sp.light, sp.x, sp.y, sp.w, sp.h);
      if (warm > 1) {
        c.globalAlpha = Math.min(1, warm - 1);
        c.drawImage(sp.light, sp.x, sp.y, sp.w, sp.h);
      }
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
    }
  }

  private render(g: Gift, L: Layout, sc: Scene, lt: Lighting): Sprite {
    const b = giftBounds(g);
    const reflect = sc.reflect;
    const pad = 4;
    const x = Math.floor(b.x0 - pad);
    const y = Math.floor(b.y0 - pad);
    const w = Math.ceil(b.x1 + pad) - x;
    const h = Math.ceil((reflect ? g.base + g.h * 0.75 : b.y1) + pad) - y;
    const dpr = L.dpr;
    const W = Math.max(1, Math.round(w * dpr));
    const H = Math.max(1, Math.round(h * dpr));
    const out: HTMLCanvasElement[] = [];
    for (const pass of ['base', 'light'] as const) {
      const [body, bc] = canvas(W, H);
      bc.setTransform(dpr, 0, 0, dpr, -x * dpr, -y * dpr);
      paintBox(bc, g, new Tone(lt, pass), pass);
      const [cv, c] = canvas(W, H);
      c.setTransform(dpr, 0, 0, dpr, -x * dpr, -y * dpr);
      if (pass === 'base') contactShadow(c, g, sc);
      if (reflect) this.reflection(c, body, g, x, y, w, h, dpr);
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.drawImage(body, 0, 0);
      body.width = 0;
      out.push(cv);
    }
    return { x, y, w, h, base: out[0], light: out[1] };
  }

  /** Fireside: the gift mirrored in the polished floor about its own base line, soft and fading. */
  private reflection(c: CanvasRenderingContext2D, body: HTMLCanvasElement, g: Gift, x: number, y: number, w: number, h: number, dpr: number): void {
    const [rv, r] = canvas(body.width, body.height);
    r.setTransform(dpr, 0, 0, dpr, -x * dpr, -y * dpr);
    r.translate(0, 2 * g.base);
    r.scale(1, -1);
    if (CANVAS_FILTER) r.filter = `blur(${1.2 * dpr}px)`;
    r.drawImage(body, x, y, w, h);
    r.filter = 'none';
    r.setTransform(dpr, 0, 0, dpr, -x * dpr, -y * dpr);
    r.globalCompositeOperation = 'destination-in';
    r.fillStyle = linear(r, [0, g.base], [0, g.base + g.h * 0.7], [[0, 'rgba(0,0,0,.3)'], [1, 'rgba(0,0,0,0)']]);
    r.fillRect(x, g.base, w, g.h * 0.75);
    r.clearRect(x, y, w, g.base - y);
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(rv, 0, 0);
    c.restore();
    rv.width = 0;
  }
}
