import { GRID, type Grid } from '../core/mask';
import { mulberry32, type Rng } from '../core/rng';
import { blurredLayer } from './blur';
import { X, Y, type Layout } from './layout';
import { HOME_ALONE } from './scenes';

/**
 * Home Alone mode's backdrop (spec 2026-10-14 §2): the McCallister living room on Christmas Eve, 1990. Red striped
 * wallpaper over a dark wainscot, a tall paned window behind the tree with green velvet drapes and a snowy night outside,
 * a plank floor with a rug, and Micro-Machine cars and broken-ornament glints underfoot. Painted once per resize/scene
 * change into the sky canvas; nothing here runs per frame.
 */

const TAU = Math.PI * 2;

/** The paned window behind the tree (spec 2026-10-14 §2), CSS px. The window gags draw inside it (home-alone-window.ts). */
export interface WindowRect {
  x: number;
  y: number;
  w: number;
  h: number;
  cols: number;
  rows: number;
}

/** Tiles: the window spans u ±8 (clear of the screen edges), from v −2.4 to v 4.8: wider than the tree's upper half. */
const WIN_HALF = 8;
const WIN_TOP = -2.4;
const WIN_BOTTOM = 4.8;

export function homeWindow(L: Layout): WindowRect {
  const half = Math.min(WIN_HALF * L.s, L.w / 2 - 0.3 * L.s);
  const y = Math.max(0.4 * L.s, Y(L, WIN_TOP));
  return { x: L.ox - half, y, w: 2 * half, h: Y(L, WIN_BOTTOM) - y, cols: 4, rows: 3 };
}

export interface Toy {
  kind: 'car' | 'shard';
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  color: string;
}
export const TOY_COLORS = ['#d62828', '#1d4ed8', '#f4b400', '#2e9e4f'] as const;

/**
 * Micro-Machine cars and broken-ornament glints on the floor (seeded, so every frame and resize agrees): below the
 * horizon, on screen, clear of every tile, the tree's base and each other. Three cars and five shards when they fit.
 */
export function floorToys(L: Layout, grid: Grid): Toy[] {
  const r = mulberry32(1990);
  const tiles = grid.ids.map((i) => {
    const x0 = X(L, (i % grid.w) - grid.w / 2);
    const y0 = Y(L, Math.floor(i / grid.w));
    return { x0, y0, x1: x0 + L.s, y1: y0 + L.s };
  });
  const top = Y(L, 10.35);
  const bottom = L.h - 0.35 * L.s;
  const out: Toy[] = [];
  if (bottom - top < 0.4 * L.s) return out;
  const pad = 0.15 * L.s;
  const clear = (a: { x: number; y: number; w: number; h: number }, b: { x0: number; y0: number; x1: number; y1: number }) =>
    a.x + a.w + pad <= b.x0 || b.x1 <= a.x - pad || a.y + a.h + pad <= b.y0 || b.y1 <= a.y - pad;
  for (const kind of ['car', 'car', 'car', 'shard', 'shard', 'shard', 'shard', 'shard'] as const) {
    const w = (kind === 'car' ? 0.62 : 0.22) * L.s;
    const h = (kind === 'car' ? 0.3 : 0.16) * L.s;
    // Cars come in the toy box's colours; shards are broken bulbs off this tree.
    const palette: readonly string[] = kind === 'car' ? TOY_COLORS : HOME_ALONE.bulbs;
    for (let tries = 0; tries < 24; tries++) {
      const x = 0.3 * L.s + r() * (L.w - 0.6 * L.s - w);
      const y = top + r() * Math.max(0, bottom - top - h);
      const toy: Toy = { kind, x, y, w, h, rot: (r() - 0.5) * 0.9, color: palette[Math.floor(r() * palette.length)] };
      if (Math.abs(x + w / 2 - L.ox) < 2.2 * L.s) continue; // the trunk and the rug's centre
      if (!tiles.every((t) => clear(toy, t))) continue;
      if (!out.every((o) => clear(toy, { x0: o.x, y0: o.y, x1: o.x + o.w, y1: o.y + o.h }))) continue;
      out.push(toy);
      break;
    }
  }
  return out;
}

/** The window's mullions and muntins (also redrawn by the window gags over their silhouettes). Path ops only. */
export function paintMullions(c: CanvasRenderingContext2D, win: WindowRect, s: number): void {
  const bar = Math.max(2, 0.12 * s);
  c.fillStyle = '#2c1709';
  for (let k = 1; k < win.cols; k++) c.fillRect(win.x + (k * win.w) / win.cols - bar / 2, win.y, bar, win.h);
  for (let k = 1; k < win.rows; k++) c.fillRect(win.x, win.y + (k * win.h) / win.rows - bar / 2, win.w, bar);
  c.fillStyle = 'rgba(255,214,150,.10)'; // a warm catch-light down each bar's left edge
  for (let k = 1; k < win.cols; k++) c.fillRect(win.x + (k * win.w) / win.cols - bar / 2, win.y, 1, win.h);
}

function disc(c: CanvasRenderingContext2D, x: number, y: number, rad: number): void {
  c.beginPath();
  c.arc(x, y, rad, 0, TAU);
  c.fill();
}

/** The McCallister living room (paintBackground has laid the wall and floor gradients), painted once per resize/scene change. CSS px. */
export function paintHomeAlone(c: CanvasRenderingContext2D, L: Layout, r: Rng, hz: number): void {
  paintWall(c, L, hz);
  paintWindow(c, L, r, hz);
  paintFloor(c, L, hz);
  for (const t of floorToys(L, GRID)) paintToy(c, t);
}

/** Wallpaper stripes and a sparse diamond motif, then the wainscot and its chair rail. */
function paintWall(c: CanvasRenderingContext2D, L: Layout, hz: number): void {
  const { w, s } = L;
  const step = 0.9 * s;
  const band = 0.45 * s;
  c.fillStyle = 'rgba(90,6,14,.22)';
  for (let x = 0; x < w; x += step) c.fillRect(x, 0, band, hz);
  c.fillStyle = 'rgba(214,170,90,.07)';
  for (let x = 0; x < w; x += step) {
    c.fillRect(x, 0, 1, hz);
    c.fillRect(x + band - 1, 0, 1, hz);
  }
  // Diamonds in the plain stripes, on a 0.9 s × 1.2 s lattice: one path, one fill.
  const d = 0.11 * s;
  c.fillStyle = 'rgba(255,200,140,.035)';
  c.beginPath();
  for (let y = 0.6 * s; y < hz; y += 1.2 * s)
    for (let x = band + (step - band) / 2; x < w + step; x += step) {
      c.moveTo(x, y - d);
      c.lineTo(x + d * 0.7, y);
      c.lineTo(x, y + d);
      c.lineTo(x - d * 0.7, y);
      c.closePath();
    }
  c.fill();
  // Wainscot and chair rail.
  const wt = hz - 1.4 * s;
  c.fillStyle = 'rgba(40,14,8,.55)';
  c.fillRect(0, wt, w, hz - wt);
  c.fillStyle = 'rgba(200,150,80,.18)';
  c.fillRect(0, wt, w, 2);
}

/** The window: drapes and valance, the night outside (moon glow, rooftops, snow), mullions, casing and sill. */
function paintWindow(c: CanvasRenderingContext2D, L: Layout, r: Rng, hz: number): void {
  const { s } = L;
  const win = homeWindow(L);
  const dw = 0.9 * s;
  const vh = 0.55 * s;
  const frame = Math.max(3, 0.22 * s);
  // Drapes, to the floor either side of the casing.
  const drape = c.createLinearGradient(0, win.y - vh, 0, hz);
  drape.addColorStop(0, '#0f3320');
  drape.addColorStop(1, '#1d5232');
  for (const x0 of [win.x - frame - dw, win.x + win.w + frame]) {
    c.fillStyle = drape;
    c.fillRect(x0, win.y - vh, dw, hz - (win.y - vh));
    c.fillStyle = 'rgba(0,0,0,.25)';
    for (let k = 1; k <= 4; k++) c.fillRect(x0 + (k * dw) / 5, win.y - vh, 1, hz - (win.y - vh));
  }
  // The glass and the night outside, clipped to the window.
  c.save();
  c.beginPath();
  c.rect(win.x, win.y, win.w, win.h);
  c.clip();
  const glass = c.createLinearGradient(0, win.y, 0, win.y + win.h);
  glass.addColorStop(0, '#07102a');
  glass.addColorStop(1, '#1a2a52');
  c.fillStyle = glass;
  c.fillRect(win.x, win.y, win.w, win.h);
  blurredLayer(c, L.dpr, 2 * s, (o) => {
    o.fillStyle = 'rgba(180,200,255,.10)';
    disc(o, win.x + win.w * 0.78, win.y + win.h * 0.2, 2 * s);
  });
  // Neighbours' rooftops along the bottom of the view, a few windows still lit.
  // Each house: walls up to its eaves, a gable roof with a little overhang, a gap to the next.
  const base = win.y + win.h * 0.82;
  const roofs = 5;
  const rw = win.w / roofs;
  const eaves: number[] = [];
  c.fillStyle = '#0a1124';
  c.beginPath();
  for (let k = 0; k < roofs; k++) {
    const x0 = win.x + k * rw;
    const eave = base - win.h * (0.1 + r() * 0.08);
    const peak = eave - win.h * (0.07 + r() * 0.07);
    eaves.push(eave);
    c.moveTo(x0 + rw * 0.14, base + 1);
    c.lineTo(x0 + rw * 0.14, eave);
    c.lineTo(x0 + rw * 0.06, eave);
    c.lineTo(x0 + rw * 0.5, peak);
    c.lineTo(x0 + rw * 0.94, eave);
    c.lineTo(x0 + rw * 0.86, eave);
    c.lineTo(x0 + rw * 0.86, base + 1);
    c.closePath();
  }
  c.fill();
  // Six windows still lit, on the houses' walls.
  c.fillStyle = 'rgba(255,200,120,.6)';
  const sp = Math.max(2, 0.14 * s);
  for (let k = 0; k < 6; k++) {
    const hk = k % roofs;
    const x = win.x + hk * rw + rw * (0.22 + r() * 0.5);
    const y = eaves[hk] + (base - eaves[hk]) * (0.2 + r() * 0.4);
    c.fillRect(x, y, sp, sp * 1.2);
  }
  // Snow banked against the glass, and snow falling outside.
  const bank = win.y + win.h * 0.78;
  const snow = c.createLinearGradient(0, bank, 0, win.y + win.h);
  snow.addColorStop(0, '#dfe8f5');
  snow.addColorStop(1, '#9fb2cc');
  c.fillStyle = snow;
  c.beginPath();
  c.moveTo(win.x, win.y + win.h);
  c.lineTo(win.x, bank + win.h * 0.03);
  c.quadraticCurveTo(win.x + win.w * 0.3, bank - win.h * 0.03, win.x + win.w * 0.55, bank + win.h * 0.01);
  c.quadraticCurveTo(win.x + win.w * 0.8, bank + win.h * 0.04, win.x + win.w, bank);
  c.lineTo(win.x + win.w, win.y + win.h);
  c.closePath();
  c.fill();
  for (let k = 0; k < 90; k++) {
    c.fillStyle = `rgba(240,246,255,${(0.25 + r() * 0.55).toFixed(3)})`;
    disc(c, win.x + r() * win.w, win.y + r() * win.h, 0.4 + r() * 1.0);
  }
  c.restore();
  paintMullions(c, win, s);
  // Casing and sill.
  c.fillStyle = '#3b2112';
  c.fillRect(win.x - frame, win.y - frame, win.w + 2 * frame, frame);
  c.fillRect(win.x - frame, win.y, frame, win.h);
  c.fillRect(win.x + win.w, win.y, frame, win.h);
  const sill = 1.6 * frame;
  c.fillRect(win.x - 2 * frame, win.y + win.h, win.w + 4 * frame, sill);
  c.fillStyle = 'rgba(255,200,140,.12)';
  c.fillRect(win.x - 2 * frame, win.y + win.h, win.w + 4 * frame, 2);
  c.fillRect(win.x - frame, win.y - frame, win.w + 2 * frame, 1);
  // The valance across the top, over the drapes' heads.
  c.fillStyle = drape;
  c.fillRect(win.x - frame - dw, win.y - frame - vh, win.w + 2 * (frame + dw), vh);
  c.fillStyle = 'rgba(0,0,0,.25)';
  c.fillRect(win.x - frame - dw, win.y - frame - 2, win.w + 2 * (frame + dw), 2);
  c.fillStyle = 'rgba(214,170,90,.18)';
  c.fillRect(win.x - frame - dw, win.y - frame - vh, win.w + 2 * (frame + dw), 1);
}

/** Planks like Fireside's, a warm sheen at the skirting, and a red rug under the tree. */
function paintFloor(c: CanvasRenderingContext2D, L: Layout, hz: number): void {
  const { w, h, s } = L;
  const fg = c.createLinearGradient(0, hz, 0, h);
  fg.addColorStop(0, 'rgba(255,170,100,.06)');
  fg.addColorStop(0.2, 'rgba(0,0,0,0)');
  c.fillStyle = fg;
  c.fillRect(0, hz, w, h - hz);
  c.strokeStyle = 'rgba(0,0,0,.25)';
  c.lineWidth = 1;
  for (let y = hz + s * 0.3; y < h; y += s * 0.42 + (y - hz) * 0.08) {
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(w, y);
    c.stroke();
  }
  c.fillStyle = 'rgba(120,20,24,.35)';
  c.strokeStyle = 'rgba(214,170,90,.25)';
  c.lineWidth = Math.max(1, 0.06 * s);
  c.beginPath();
  c.ellipse(L.ox, Y(L, 10.55), 5.5 * s, 0.75 * s, 0, 0, TAU);
  c.fill();
  c.stroke();
}

function paintToy(c: CanvasRenderingContext2D, t: Toy): void {
  c.save();
  c.translate(t.x + t.w / 2, t.y + t.h / 2);
  c.rotate(t.rot);
  const hw = t.w / 2;
  const hh = t.h / 2;
  if (t.kind === 'car') {
    // A rounded body, a cab with its windscreen, two wheels.
    const rr = hh * 0.45;
    const top = -hh * 0.35;
    c.fillStyle = t.color;
    c.beginPath();
    c.moveTo(-hw + rr, top);
    c.arcTo(hw, top, hw, hh, rr);
    c.arcTo(hw, hh * 0.7, -hw, hh * 0.7, rr);
    c.arcTo(-hw, hh * 0.7, -hw, top, rr);
    c.arcTo(-hw, top, hw, top, rr);
    c.closePath();
    c.fill();
    c.beginPath();
    c.moveTo(-hw * 0.45, top);
    c.lineTo(-hw * 0.25, -hh);
    c.lineTo(hw * 0.3, -hh);
    c.lineTo(hw * 0.5, top);
    c.closePath();
    c.fill();
    c.fillStyle = 'rgba(200,230,255,.7)';
    c.beginPath();
    c.moveTo(hw * 0.08, top);
    c.lineTo(hw * 0.12, -hh * 0.82);
    c.lineTo(hw * 0.28, -hh * 0.82);
    c.lineTo(hw * 0.4, top);
    c.closePath();
    c.fill();
    c.fillStyle = '#111';
    disc(c, -hw * 0.55, hh * 0.68, hh * 0.32);
    disc(c, hw * 0.55, hh * 0.68, hh * 0.32);
  } else {
    // A broken bulb's shard, with a glint.
    c.fillStyle = t.color;
    c.beginPath();
    c.moveTo(-hw, hh);
    c.lineTo(hw * 0.2, -hh);
    c.lineTo(hw, hh * 0.6);
    c.closePath();
    c.fill();
    c.fillStyle = 'rgba(255,255,255,.8)';
    disc(c, hw * 0.15, -hh * 0.3, Math.max(0.6, hh * 0.22));
  }
  c.restore();
}
