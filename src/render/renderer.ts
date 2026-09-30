import type { Board } from '../core/board';
import { degree } from '../core/dirs';
import { GRID } from '../core/mask';
import { drawBlurred } from './blur';
import { drawBulb, drawBulbGlint, drawBulbHalo } from './bulbs';
import type { Camera } from './camera';
import {
  Current, Embers, Snowfall, drawFirelight, drawFlashGlows, drawFlashRings, drawFrontier, drawGroundPool,
  drawHover, drawSourceCore, drawSourceGlow, drawStar, drawStarGlow, easeSnap, starState,
} from './effects';
import { tileGeometry } from './geometry';
import { Y, computeLayout, tileCenter, type Layout } from './layout';
import { paintBackground } from './paint-background';
import { paintTree } from './paint-tree';
import { drawLitCore, drawLitGlow, drawUnlit, neonFlicker, type PathStyle } from './paths';
import { QualityGovernor } from './quality';
import { SCENES, type Scene } from './scenes';
import { TILE_FILL_MS, type VisualState } from './visual-state';

const GLOW_SCALE = 0.5;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export interface FrameInput {
  board: Board;
  vis: VisualState;
  now: number;
  dt: number;
  camera: Camera;
  hover: number;
  revealAt: number;
  winAt: number | null;
  reducedMotion: boolean;
  /** Light show (Plan 2): extra brightness for a bulb tile. */
  extraBulb?: (tile: number) => number;
  /** Light show (Plan 2): low-band energy 0..1 that breathes the ground pool and star. */
  ambient?: number;
}

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const x = c.getContext('2d');
  if (!x) throw new Error('Canvas 2D is unavailable');
  return x;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly glow = document.createElement('canvas');
  private readonly g: CanvasRenderingContext2D;
  private readonly bg = document.createElement('canvas');
  private readonly tree = document.createElement('canvas');
  layout: Layout = computeLayout(1, 1, 1);
  scene: Scene = SCENES.fireside;
  style: PathStyle = 'filament';
  readonly quality = new QualityGovernor();
  private readonly snow = new Snowfall();
  private readonly embers = new Embers();
  private readonly current = new Current();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = ctx2d(canvas);
    this.g = ctx2d(this.glow);
  }

  resize(w: number, h: number, dpr: number): void {
    for (const c of [this.canvas, this.bg, this.tree]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    this.glow.width = Math.round(w * dpr * GLOW_SCALE);
    this.glow.height = Math.round(h * dpr * GLOW_SCALE);
    this.layout = computeLayout(w, h, dpr);
    this.repaint();
  }

  setScene(scene: Scene): void {
    if (scene === this.scene) return;
    this.scene = scene;
    this.repaint();
  }

  setStyle(style: PathStyle): void {
    this.style = style;
    this.current.clear();
  }

  /** Device-pixel rectangle around the tree (share image). Valid for the identity camera. */
  treeRect(): { x: number; y: number; w: number; h: number } {
    const L = this.layout;
    const x = Math.max(0, (L.ox - 10.5 * L.s) * L.dpr);
    const y = Math.max(0, Y(L, -2.8) * L.dpr);
    return { x, y, w: Math.min(this.canvas.width - x, 21 * L.s * L.dpr), h: Math.min(this.canvas.height - y, 13.6 * L.s * L.dpr) };
  }

  private repaint(): void {
    paintBackground(ctx2d(this.bg), this.layout, this.scene);
    paintTree(ctx2d(this.tree), this.layout, this.scene);
  }

  frame(f: FrameInput): void {
    const { board, vis, now, camera: cam } = f;
    const L = this.layout;
    const s = L.s;
    const sc = this.scene;
    const style = this.style;
    const ctx = this.ctx;
    const g = this.g;
    const dpr = L.dpr;
    const tier = this.quality.sample(f.dt);
    const won = f.winAt !== null;
    const litFrac = won ? 1 : board.lighting.count / GRID.ids.length;
    const motionDt = f.reducedMotion ? 0 : f.dt;
    const density = tier >= 2 ? 0.5 : 1;
    const world = (c: CanvasRenderingContext2D, k: number) => c.setTransform(k * cam.scale, 0, 0, k * cam.scale, k * cam.tx, k * cam.ty);

    vis.prune(now);
    if (style === 'filament' && tier < 2) this.current.step(board, vis, now, f.dt);
    else this.current.clear();

    // 1. Background (screen space) + dynamic back layers
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.bg, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (sc.light === 'fire') drawFirelight(ctx, L, now);
    if (sc.embers && tier < 3) this.embers.draw(ctx, L, motionDt, now);
    this.snow.draw(ctx, L, sc, false, motionDt, now, density);

    // 2. Tree + hover (world space)
    world(ctx, dpr);
    ctx.drawImage(this.tree, 0, 0, L.w, L.h);
    if (f.hover >= 0 && !won) drawHover(ctx, L, f.hover, sc);

    // 3. Pass 1: unlit wires + glass on main; lit glow on the half-res glow layer
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.glow.width, this.glow.height);
    world(g, dpr * GLOW_SCALE);
    for (const i of GRID.ids) {
      const row = Math.floor(i / GRID.w);
      const reveal = clamp01((now - f.revealAt - (GRID.h - 1 - row) * 55) / 380);
      if (reveal <= 0) continue;
      const [cx, cy] = tileCenter(L, GRID, i);
      const rot = board.rotating.get(i);
      const shown = rot ? rot.from : board.bits[i];
      const angle = rot ? (Math.PI / 2) * easeSnap(clamp01((now - rot.t0) / board.rotateMs)) : 0;
      const k = f.reducedMotion ? 1 : vis.settleScale(i, now);
      const isBulb = degree(board.solution[i]) === 1;
      ctx.save();
      ctx.globalAlpha = reveal;
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.scale(k, k);
      drawUnlit(ctx, tileGeometry(shown, 0), s, sc, style);
      if (isBulb) drawBulb(ctx, shown, sc.bulbs[board.colors[i]], 0, s, sc, style);
      ctx.restore();

      const { q, alpha } = vis.fill(board, i, now);
      if (alpha <= 0) continue;
      const prims = tileGeometry(board.bits[i], board.lighting.entry[i]);
      const flicker = style === 'neon' ? neonFlicker(now - (vis.litStart[i] + TILE_FILL_MS)) : 1;
      g.save();
      g.translate(cx, cy);
      g.scale(k, k);
      drawLitGlow(g, prims, s, sc, style, { q, alpha, seed: i, now, flicker });
      if (isBulb && q >= 1) drawBulbHalo(g, sc.bulbs[board.colors[i]], this.bulbAmount(f, i) * alpha, s);
      g.restore();
      if (q >= 1 && board.lighting.lit[i] && !won) drawFrontier(g, board, L, i, now, sc, false);
    }
    if (!f.reducedMotion) drawFlashGlows(g, vis, L, now, sc);
    drawSourceGlow(g, L, sc);
    drawGroundPool(g, L, sc, litFrac + (f.ambient ?? 0) * 0.5);
    const st = starState(now, f.winAt, litFrac);
    st.glow *= 1 + (f.ambient ?? 0) * 0.3;
    drawStarGlow(g, L, sc, st, won);
    this.current.draw(g, board, L, s * 0.17);

    // 4. Bloom: blurred copies of the glow layer, additive, with auto-exposure (spec §4.5 item 8)
    const expo = 1 - 0.42 * Math.pow(litFrac, 1.4);
    const unit = s * cam.scale * dpr;
    const passes: [number, number][] = [
      [0.18, 0.95 * expo],
      [0.55, 0.75 * expo],
      [1.5, 0.55 * expo * expo],
    ];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    passes.slice(0, tier >= 1 ? 2 : 3).forEach(([radius, alpha], idx) => {
      ctx.globalAlpha = alpha * sc.bloom;
      drawBlurred(ctx, this.glow, radius * unit, `bloom${idx}`);
    });
    if (sc.reflect && tier < 3) {
      const hz = (Y(L, 10.05) * cam.scale + cam.ty) * dpr;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, hz, this.canvas.width, this.canvas.height - hz);
      ctx.clip();
      ctx.setTransform(1, 0, 0, -1, 0, 2 * hz);
      ctx.globalAlpha = 0.34;
      drawBlurred(ctx, this.glow, 0.22 * unit, 'reflect');
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // 5. Pass 2: crisp lit cores, lit bulbs, glints, frontier cores
    world(ctx, dpr);
    for (const i of GRID.ids) {
      const { q, alpha } = vis.fill(board, i, now);
      if (alpha <= 0) continue;
      const [cx, cy] = tileCenter(L, GRID, i);
      const k = f.reducedMotion ? 1 : vis.settleScale(i, now);
      const prims = tileGeometry(board.bits[i], board.lighting.entry[i]);
      const flicker = style === 'neon' ? neonFlicker(now - (vis.litStart[i] + TILE_FILL_MS)) : 1;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(k, k);
      drawLitCore(ctx, prims, s, sc, style, { q, alpha, seed: i, now, flicker });
      if (degree(board.solution[i]) === 1 && q >= 1) {
        drawBulb(ctx, board.bits[i], sc.bulbs[board.colors[i]], this.bulbAmount(f, i) * alpha, s, sc, style);
        if (!f.reducedMotion) drawBulbGlint(ctx, now - (vis.litStart[i] + TILE_FILL_MS), s);
      }
      ctx.restore();
      if (q >= 1 && board.lighting.lit[i] && !won) drawFrontier(ctx, board, L, i, now, sc, true);
    }
    if (!f.reducedMotion) drawFlashRings(ctx, vis, L, now);
    drawSourceCore(ctx, L, sc);
    this.current.draw(ctx, board, L, s * 0.048);
    drawStar(ctx, L, sc, st, won);

    // 6. Foreground snow (screen space)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.snow.draw(ctx, L, sc, true, motionDt, now, density);
  }

  /** Pop intensity + light-show boost + the bottom-to-top win wave (spec §4.5 item 10). */
  private bulbAmount(f: FrameInput, i: number): number {
    let a = f.vis.bulbIntensity(i, f.now) + (f.extraBulb?.(i) ?? 0);
    if (f.winAt !== null && !f.reducedMotion) {
      const row = Math.floor(i / GRID.w);
      const w = f.now - f.winAt - (GRID.h - 1 - row) * 70;
      a += 0.6 * Math.exp(-(w * w) / (2 * 110 * 110));
    }
    return a;
  }
}
