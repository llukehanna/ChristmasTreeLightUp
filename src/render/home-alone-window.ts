import { homeWindow, paintMullions, type WindowRect } from './home-alone-room';
import type { Layout } from './layout';

/** Spec 2026-10-14 §3: silhouettes crossing the window behind the tree, from sprites baked once per layout. */

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** The unit figure height as a fraction of the window's (the bandits are multiples of it); feet on a track at FIG_TRACK of the window's height. */
export const FIG_H = 0.4;
export const FIG_TRACK = 0.9;
/**
 * The bandits as drawn: height as a multiple of the unit figure height (FIG_H), and width over height (the sprite's glass,
 * before its FIG_PAD of rim glow). The geometry test that keeps them beside the tree reads these.
 */
export const BANDIT_FIG = { short: { scale: 0.8, aspect: 0.6 }, tall: { scale: 1.1, aspect: 0.42 } } as const;

export const BANDIT_IDLE_MS = 20_000;
export const BANDIT_EVERY_MS = 60_000;
export const BANDIT_ENTER_MS = 3000;
export const BANDIT_PAUSE_MS = 1200;
export const BANDIT_WALK_MS = 7000;
/** Where they pause (0..1 across the window): off to the left, beside the tree, so the iron lands in plain sight. */
export const BANDIT_STOP = 0.2;
export const BANDIT_GAP = 0.12;
export const IRON_ODDS = 0.25;
export const IRON_DROP_MS = 350;
export const IRON_CRUMPLE_MS = 300;
export const IRON_FADE_MS = 400;
export const IRON_WALK_MS = 4800;

export interface BanditPose { xShort: number; xTall: number; ironY: number; crumple: number; alpha: number; done: boolean }

/** The walk `t` ms in: where each is across the window (0..1), the iron's fall (0..1, −1: none), the crumple, the fade. */
export function banditPose(t: number, iron: boolean, out: BanditPose): BanditPose {
  let x = -0.2 + (BANDIT_STOP + 0.2) * easeInOut(clamp01(t / BANDIT_ENTER_MS));
  const leaveAt = BANDIT_ENTER_MS + BANDIT_PAUSE_MS;
  if (!iron && t > leaveAt) x = BANDIT_STOP + (1.35 - BANDIT_STOP) * easeInOut(clamp01((t - leaveAt) / (BANDIT_WALK_MS - leaveAt)));
  out.xShort = x;
  out.xTall = x - BANDIT_GAP;
  out.ironY = -1;
  out.crumple = 0;
  out.alpha = 1;
  if (iron && t >= BANDIT_ENTER_MS) {
    const d = t - BANDIT_ENTER_MS;
    out.ironY = clamp01(d / IRON_DROP_MS);
    out.crumple = clamp01((d - IRON_DROP_MS) / IRON_CRUMPLE_MS);
    out.alpha = 1 - clamp01((t - (IRON_WALK_MS - IRON_FADE_MS)) / IRON_FADE_MS);
  }
  out.done = t >= (iron ? IRON_WALK_MS : BANDIT_WALK_MS);
  return out;
}

/** The idle clock: running time with no input, and since the last walk began. */
export class BanditTimer {
  private idle = 0;
  private since = Number.POSITIVE_INFINITY;

  input(): void {
    this.idle = 0;
  }

  /** A walk began some other way (the probe's): the next waits BANDIT_EVERY_MS from now. */
  started(): void {
    this.since = 0;
  }

  /** `dt` ms more of running time; true when a walk should start now (and it counts from here). */
  step(dt: number, walking: boolean): boolean {
    this.idle += dt;
    this.since += dt;
    if (walking || this.idle < BANDIT_IDLE_MS || this.since < BANDIT_EVERY_MS) return false;
    this.since = 0;
    return true;
  }
}

type Kind = 'short' | 'tall' | 'iron';
/** `alpha`: the silhouette's opacity, applied after it is filled (no seams where parts overlap). `glow`: its rim light. */
interface Shape { color: string; alpha: number; glow: string; aspect: number; head?: readonly [number, number, number]; polys: readonly (readonly number[])[] }

const BANDIT = '#05070f';
/** Rim light, so the silhouettes read against the night glass and the dark rooftops behind them: cold, lit by the moon and the snow. */
const COLD = 'rgba(190,210,255,.5)';
/** Room round each sprite for its rim glow, as a fraction of the figure's height. */
export const FIG_PAD = 0.12;
const FIGURES: Readonly<Record<Kind, Shape>> = {
  // Harry: short and stocky, a brimmed hat.
  short: { color: BANDIT, alpha: 1, glow: COLD, aspect: BANDIT_FIG.short.aspect, head: [0, -0.8, 0.1], polys: [
    [-0.16, -0.88, 0.16, -0.88, 0.16, -0.85, -0.16, -0.85], [-0.09, -0.98, 0.09, -0.98, 0.1, -0.88, -0.1, -0.88],
    [-0.2, -0.7, 0.2, -0.7, 0.22, -0.32, 0.12, -0.3, 0.13, 0, 0.03, 0, 0, -0.22, -0.03, 0, -0.13, 0, -0.12, -0.3, -0.22, -0.32],
  ] },
  // Marv: tall and thin, long legs, a beanie.
  tall: { color: BANDIT, alpha: 1, glow: COLD, aspect: BANDIT_FIG.tall.aspect, head: [0, -0.9, 0.07], polys: [
    [-0.075, -0.95, 0.075, -0.95, 0.06, -1, -0.06, -1],
    [-0.1, -0.82, 0.1, -0.82, 0.11, -0.5, 0.07, -0.48, 0.08, 0, 0.02, 0, 0, -0.4, -0.02, 0, -0.08, 0, -0.07, -0.48, -0.11, -0.5],
  ] },
  // A clothes iron: sole plate and handle.
  iron: { color: BANDIT, alpha: 1, glow: COLD, aspect: 1.4, polys: [
    [-0.7, 0, 0.7, 0, 0.45, -0.45, -0.3, -0.55],
    [-0.2, -0.55, 0.3, -0.5, 0.3, -0.95, -0.25, -0.95, -0.25, -0.82, 0.17, -0.82, 0.17, -0.62, -0.2, -0.62],
  ] },
};
/** Each sprite's height as a multiple of the unit figure height (FIG_H of the window). */
const SCALE: readonly (readonly [Kind, number])[] = [['short', BANDIT_FIG.short.scale], ['tall', BANDIT_FIG.tall.scale], ['iron', 0.22]];

/** Adds the figure's parts to the current path as subpaths. */
function trace(x: CanvasRenderingContext2D, f: Shape, part: number): void {
  if (part < f.polys.length) {
    const p = f.polys[part];
    x.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length; i += 2) x.lineTo(p[i], p[i + 1]);
    x.closePath();
  } else if (f.head) {
    x.moveTo(f.head[0] + f.head[2], f.head[1]);
    x.arc(f.head[0], f.head[1], f.head[2], 0, Math.PI * 2);
  }
}

/**
 * One silhouette, `h` device px tall plus FIG_PAD of rim glow all round (feet FIG_PAD·h above the bottom edge); null
 * without a 2D context. Baked once per layout.
 */
function makeFigure(kind: Kind, h: number): HTMLCanvasElement | null {
  const f = FIGURES[kind];
  const pad = FIG_PAD * h;
  const c = document.createElement('canvas');
  c.height = Math.round(h + 2 * pad);
  c.width = Math.max(2, Math.round(h * f.aspect + 2 * pad));
  const x = c.getContext('2d');
  if (!x) return null;
  const parts = f.polys.length + (f.head ? 1 : 0);
  // The silhouette in one flat tone, part by part, then brought down to its opacity as a whole.
  x.setTransform(h, 0, 0, h, c.width / 2, h + pad);
  x.fillStyle = f.color;
  for (let k = 0; k < parts; k++) {
    x.beginPath();
    trace(x, f, k);
    x.fill();
  }
  if (f.alpha < 1) {
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = 'destination-in';
    x.fillStyle = `rgba(0,0,0,${f.alpha})`;
    x.fillRect(0, 0, c.width, c.height);
  }
  // The rim glow behind it: the whole figure as one path, filled off the canvas so only its blurred shadow lands here
  // (shadow offsets are in device px, untouched by the transform).
  const off = c.width + 16;
  x.setTransform(h, 0, 0, h, c.width / 2 - off, h + pad);
  x.globalCompositeOperation = 'destination-over';
  x.shadowColor = f.glow;
  x.shadowBlur = 0.6 * pad;
  x.shadowOffsetX = off;
  x.fillStyle = '#000';
  x.beginPath();
  for (let k = 0; k < parts; k++) trace(x, f, k);
  x.fill();
  return c;
}

export class WindowGags {
  private builtFor: Layout | null = null;
  private win: WindowRect | null = null;
  private figH = 0;
  private readonly bandit: BanditPose = { xShort: 0, xTall: 0, ironY: -1, crumple: 0, alpha: 1, done: false };
  private sprites: Partial<Record<Kind, HTMLCanvasElement>> = {};

  /** CSS px transform set by the caller. `walkMs` −1: no walk. Clipped to the glass; the mullions go back over the figures. */
  draw(c: CanvasRenderingContext2D, L: Layout, alpha: number, walkMs: number, iron: boolean): void {
    if (this.builtFor !== L) this.build(L);
    const win = this.win;
    if (!win || alpha <= 0) return;
    const track = win.y + FIG_TRACK * win.h;
    c.save();
    c.beginPath();
    c.rect(win.x, win.y, win.w, win.h);
    c.clip();
    c.globalAlpha = alpha;
    if (walkMs >= 0) {
      const b = banditPose(walkMs, iron, this.bandit);
      c.globalAlpha = alpha * b.alpha;
      this.blit(c, this.sprites.short, win.x + b.xShort * win.w, track, BANDIT_FIG.short.scale * this.figH, 0, 1);
      // The tall one crumples under the iron: squashed, tipping back.
      const xt = win.x + b.xTall * win.w;
      const lean = -0.35 * b.crumple;
      const squash = 1 - 0.55 * b.crumple;
      const tall = BANDIT_FIG.tall.scale * this.figH * squash;
      this.blit(c, this.sprites.tall, xt, track, BANDIT_FIG.tall.scale * this.figH, lean, squash);
      if (b.ironY >= 0) {
        // It falls to the top of his head, and rides it down as he goes.
        const headX = xt + tall * Math.sin(lean);
        const headY = track - tall * Math.cos(lean);
        this.blit(c, this.sprites.iron, headX, win.y + b.ironY * (headY - win.y), 0.22 * this.figH, 0, 1);
      }
    }
    // The mullions fade with the house (a cross-fade either way), not with a bandit.
    c.globalAlpha = alpha;
    paintMullions(c, win, L.s);
    c.globalAlpha = 1;
    c.restore();
  }

  /** One sprite, feet at (x, y), `h` CSS px tall, leaning `lean` rad about its feet, squashed to `squash` of its height. */
  private blit(c: CanvasRenderingContext2D, s: HTMLCanvasElement | undefined, x: number, y: number, h: number, lean: number, squash: number): void {
    if (!s) return;
    const H = h * (1 + 2 * FIG_PAD); // the sprite's rim glow round the figure
    const w = (H * s.width) / s.height;
    c.translate(x, y);
    c.rotate(lean);
    c.scale(1, squash);
    c.drawImage(s, -w / 2, -h * (1 + FIG_PAD), w, H);
    c.scale(1, 1 / squash);
    c.rotate(-lean);
    c.translate(-x, -y);
  }

  private build(L: Layout): void {
    for (const s of Object.values(this.sprites)) if (s) s.width = s.height = 0;
    this.sprites = {};
    this.builtFor = L;
    const win = homeWindow(L);
    this.win = win;
    this.figH = FIG_H * win.h;
    for (const [kind, scale] of SCALE) {
      const s = makeFigure(kind, Math.max(8, Math.round(this.figH * L.dpr * scale)));
      if (s) this.sprites[kind] = s;
    }
  }
}
