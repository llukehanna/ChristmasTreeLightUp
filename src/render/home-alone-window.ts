import {
  DIVE_PIVOT, HARRY_CYCLE, MARV_CYCLE, SILHOUETTE, SPRINT_CYCLE, SPRINT_FRAMES, VAN_HEADLIGHT, VAN_LEN, VAN_TAIL, WALK_FRAMES, bakeBeam, bakeCone,
  bakeFigures, bakeFlame, bakeGlint, bakeIron, bakeMarvFace, bakeMarvHand, bakeSoft, bakeVan, blit, type FigureSprites, type Sprite,
} from './home-alone-figures';
import { homeWindow, paintMullions, traceSnowbank, type WindowRect } from './home-alone-room';
import type { Layout } from './layout';

/** Spec 2026-10-14 §3, §9: the window gags behind the tree, from sprites baked once per layout (home-alone-figures.ts). */

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

  constructor(private readonly idleMs = BANDIT_IDLE_MS, private readonly everyMs = BANDIT_EVERY_MS) {}

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
    if (walking || this.idle < this.idleMs || this.since < this.everyMs) return false;
    this.since = 0;
    return true;
  }
}

/* ---------- spec §9: the rotation, Harry's gold tooth and hat on fire, Marv at the glass, the van ---------- */

/** What an idle trigger plays (spec §9.1), one at a time, never the same twice running. */
export type WindowGag = 'walk' | 'tooth' | 'fire';
export const WINDOW_GAGS: readonly WindowGag[] = ['walk', 'tooth', 'fire'];

/** The next gag after `last` for a random `r` in [0, 1): any of them at first, then either of the other two. */
export function nextGag(last: WindowGag | null, r: number): WindowGag {
  if (!last) return WINDOW_GAGS[Math.min(2, Math.floor(r * 3))];
  return WINDOW_GAGS[(WINDOW_GAGS.indexOf(last) + 1 + Math.min(1, Math.floor(r * 2))) % 3];
}

const easeOut = (t: number) => 1 - (1 - t) * (1 - t);
const easeOutBack = (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;

/** Harry's gold tooth: in from the left to the stop, a turn to the room, the grin and its glint, a turn away, and back off. */
export const TOOTH_ENTER_MS = 2600;
export const TOOTH_TURN_MS = 300;
export const TOOTH_GRIN_MS = 150;
export const TOOTH_GLINT_AT = TOOTH_ENTER_MS + TOOTH_TURN_MS + TOOTH_GRIN_MS;
export const TOOTH_GLINT_MS = 600;
export const TOOTH_TURN_BACK_AT = 4100;
export const TOOTH_LEAVE_AT = TOOTH_TURN_BACK_AT + TOOTH_TURN_MS;
export const TOOTH_MS = 6400;

/** `x`: across the window (0..1); `dir`: the way his profile faces; `front`: 0 profile .. 1 facing the room; `glint`: −1 or 0..1. */
export interface ToothPose { x: number; dir: 1 | -1; front: number; grin: number; glint: number; done: boolean }

export function toothPose(t: number, out: ToothPose): ToothPose {
  if (t < TOOTH_ENTER_MS) out.x = -0.2 + (BANDIT_STOP + 0.2) * easeInOut(t / TOOTH_ENTER_MS);
  else if (t < TOOTH_LEAVE_AT) out.x = BANDIT_STOP;
  else out.x = BANDIT_STOP - (BANDIT_STOP + 0.25) * easeInOut(clamp01((t - TOOTH_LEAVE_AT) / (TOOTH_MS - TOOTH_LEAVE_AT)));
  out.front = t < TOOTH_TURN_BACK_AT ? easeInOut(clamp01((t - TOOTH_ENTER_MS) / TOOTH_TURN_MS)) : 1 - easeInOut(clamp01((t - TOOTH_TURN_BACK_AT) / TOOTH_TURN_MS));
  out.dir = t < TOOTH_TURN_BACK_AT + TOOTH_TURN_MS / 2 ? 1 : -1;
  const into = TOOTH_ENTER_MS + TOOTH_TURN_MS;
  out.grin = t < TOOTH_TURN_BACK_AT ? clamp01((t - into) / TOOTH_GRIN_MS) : 1 - clamp01((t - TOOTH_TURN_BACK_AT) / TOOTH_GRIN_MS);
  out.glint = t >= TOOTH_GLINT_AT && t <= TOOTH_GLINT_AT + TOOTH_GLINT_MS ? (t - TOOTH_GLINT_AT) / TOOTH_GLINT_MS : -1;
  out.done = t >= TOOTH_MS;
  return out;
}

/** Harry's hat on fire: a sprint in from the right, a crouch, a dive head first into the snow by the stop, then steam. */
export const FIRE_FROM = 1.3;
export const FIRE_DIVE_X = 0.19;
export const FIRE_RUN_MS = 2000;
export const FIRE_CROUCH_MS = 220;
export const FIRE_DIVE_AT = FIRE_RUN_MS + FIRE_CROUCH_MS;
export const FIRE_DIVE_MS = 600;
export const FIRE_STEAM_AT = FIRE_DIVE_AT + 0.75 * FIRE_DIVE_MS;
export const FIRE_MS = 5600;

/**
 * `x`: where his feet left the snow (0..1 across); `crouch`: the anticipation (0..1); `dive`: −1, or 0..1 through the air.
 * In the air, in his heights from his take-off: `rot` (rad, head first), `fwd` (on, the way he runs) and `rise` (his
 * middle, up). `flame` 0..1, `steam`: −1 or 0..1.
 */
export interface FirePose { x: number; crouch: number; dive: number; rot: number; fwd: number; rise: number; flame: number; steam: number; done: boolean }

export function firePose(t: number, out: FirePose): FirePose {
  const u = clamp01(t / FIRE_RUN_MS);
  // Full tilt in, slowing only as he plants his feet.
  out.x = FIRE_FROM - (FIRE_FROM - FIRE_DIVE_X) * (1 - (1 - u) ** 1.4);
  out.crouch = easeOut(clamp01((t - FIRE_RUN_MS) / FIRE_CROUCH_MS));
  const p = t < FIRE_DIVE_AT ? -1 : clamp01((t - FIRE_DIVE_AT) / FIRE_DIVE_MS);
  out.dive = p;
  const q = Math.max(0, p);
  // Up off the snow, then over: head first and down, his legs last in.
  out.rot = p < 0 ? 0 : 0.3 + 2.6 * q ** 0.9;
  out.fwd = 0.6 * q;
  out.rise = 1.4 * q - 2.8 * q * q;
  out.flame = p >= 1 ? 0 : 1;
  out.steam = t < FIRE_STEAM_AT ? -1 : clamp01((t - FIRE_STEAM_AT) / (FIRE_MS - FIRE_STEAM_AT));
  out.done = t >= FIRE_MS;
  return out;
}

export const gagMs = (g: WindowGag, iron: boolean): number => (g === 'tooth' ? TOOTH_MS : g === 'fire' ? FIRE_MS : iron ? IRON_WALK_MS : BANDIT_WALK_MS);

/** Marv at the glass (spec §9.2): his own idle clock, outside the rotation. */
export const MARV_IDLE_MS = 60_000;
export const MARV_EVERY_MS = 180_000;
export const MARV_IN_MS = 520;
export const MARV_PRESS_AT = 380;
export const MARV_PRESS_MS = 380;
export const MARV_FOG_AT = 600;
export const MARV_FOG_MS = 1000;
export const MARV_DROP_AT = MARV_FOG_AT + MARV_FOG_MS + 1500;
export const MARV_DROP_MS = 800;
export const MARV_FADE_MS = 2000;
export const MARV_MS = MARV_DROP_AT + MARV_FADE_MS;

/**
 * `enter`: 0 (off the window's edge) .. 1 (in place), overshooting a little; `press`: his scale as his face meets the
 * glass; `contact`: the squashed nose and palms (0..1); `fog`: the breath's size (0..1) and `fogAlpha`; `drop`: 0..1 down out of view.
 */
export interface MarvPose { enter: number; press: number; contact: number; fog: number; fogAlpha: number; drop: number; done: boolean }

export function marvPose(t: number, out: MarvPose): MarvPose {
  out.enter = t < MARV_IN_MS ? easeOutBack(clamp01(t / MARV_IN_MS)) : 1;
  const q = clamp01((t - MARV_PRESS_AT) / MARV_PRESS_MS);
  out.press = 1 + 0.05 * Math.sin(Math.PI * q) * (1 - 0.4 * q);
  out.contact = clamp01((t - MARV_PRESS_AT) / 180);
  out.fog = t < MARV_FOG_AT ? 0 : easeOut(clamp01((t - MARV_FOG_AT) / MARV_FOG_MS));
  out.fogAlpha = t < MARV_FOG_AT ? 0 : t < MARV_DROP_AT ? clamp01((t - MARV_FOG_AT) / 300) : 1 - clamp01((t - MARV_DROP_AT) / MARV_FADE_MS);
  const d = clamp01((t - MARV_DROP_AT) / MARV_DROP_MS);
  out.drop = d * d;
  out.done = t >= MARV_MS;
  return out;
}

/** The van (spec §9.3): every 2–4 min in play, ~6 s across; its beam sweeps the room for 1.5 s as it passes the middle. */
export const VAN_EVERY = [120_000, 240_000] as const;
export const VAN_MS = 6000;
export const VAN_FROM = -0.25;
export const VAN_TO = 1.25;
export const BEAM_MS = 1500;
export const BEAM_MAX = 0.2;
const BEAM_AT = (VAN_MS * (0.5 - VAN_FROM)) / (VAN_TO - VAN_FROM) - BEAM_MS / 2;

/** `x`: the van's middle across the window (0..1, driving left to right; the caller mirrors it); `beam`: −1 or 0..1. */
export interface VanPose { x: number; beam: number; done: boolean }

export function vanPose(t: number, out: VanPose): VanPose {
  out.x = VAN_FROM + (VAN_TO - VAN_FROM) * (t / VAN_MS);
  out.beam = t >= BEAM_AT && t <= BEAM_AT + BEAM_MS ? (t - BEAM_AT) / BEAM_MS : -1;
  out.done = t >= VAN_MS;
  return out;
}

/** Marv's face at the glass, CSS px: on the outer pane on the right (away from the trunk), high up, clear of the tree. */
export interface MarvGeom { cx: number; cy: number; faceH: number; faceW: number; handW: number; handH: number; handDx: number; handDy: number }

export function marvGeom(L: Layout, out: MarvGeom = { cx: 0, cy: 0, faceH: 0, faceW: 0, handW: 0, handH: 0, handDx: 0, handDy: 0 }): MarvGeom {
  const win = homeWindow(L);
  out.faceH = 0.46 * win.h;
  out.faceW = 0.74 * out.faceH;
  out.cx = win.x + (7 / 8) * win.w;
  out.cy = win.y + 0.1 * win.h + out.faceH / 2;
  out.handW = 0.3 * out.faceH;
  out.handH = 0.38 * out.faceH;
  out.handDx = out.faceW / 2 + 0.55 * out.handW;
  out.handDy = -0.02 * out.faceH;
  return out;
}

/** What his face, neck and hands cover at the hold, CSS px. */
export function marvBox(L: Layout): { x0: number; y0: number; x1: number; y1: number } {
  const g = marvGeom(L);
  const half = g.handDx + 0.5 * g.handW;
  return { x0: g.cx - half, y0: g.cy - 0.5 * g.faceH, x1: g.cx + half, y1: g.cy + 0.62 * g.faceH };
}

/** Room round each figure sprite for its rim glow, as a fraction of the figure's height. */
export const FIG_PAD = 0.12;
/** The van's height, as a fraction of the window's; its tyres on the street at VAN_ROAD, behind the snowbank's top. */
export const VAN_H = 0.1;
export const VAN_ROAD = 0.8;
/** Harry's flame, in his heights. */
const FLAME = 0.34;

/** What the window draws this frame (the layer's, reused): the gag and its ms (−1: none), Marv's ms, the van's ms and way. */
export interface GagFrame { gag: WindowGag | null; t: number; iron: boolean; marvT: number; vanT: number; vanDir: 1 | -1 }

/** Steam off Harry's head in the snow: [delay ms, drift (his heights), rise, growth, life ms, strength]; the first few are snow kicked up. */
const PUFFS: readonly (readonly [number, number, number, number, number, number])[] = [
  [0, -0.32, 0.1, 0.22, 550, 0.7], [0, 0.28, 0.08, 0.2, 500, 0.6], [30, 0.04, 0.18, 0.2, 600, 0.6],
  [100, -0.06, 1.3, 0.3, 1700, 0.55], [220, 0.08, 1.6, 0.36, 1900, 0.5], [360, -0.12, 1.5, 0.4, 2000, 0.45],
  [520, 0.04, 1.9, 0.45, 2100, 0.42], [700, 0.14, 1.7, 0.42, 2000, 0.36], [900, -0.04, 2.0, 0.5, 2000, 0.3],
];

const frameAt = (d: number, cycle: number, n: number): number => {
  const f = Math.floor((d / cycle) * n) % n;
  return f < 0 ? f + n : f;
};

export class WindowGags {
  private builtFor: Layout | null = null;
  private win: WindowRect | null = null;
  private figH = 0;
  private figs: FigureSprites | null = null;
  private iron: Sprite | null = null;
  private face: Sprite | null = null;
  private hand: Sprite | null = null;
  private van: Sprite | null = null;
  private flameOuter: Sprite | null = null;
  private flameCore: Sprite | null = null;
  private warm: Sprite | null = null;
  private glint: Sprite | null = null;
  private puff: Sprite | null = null;
  private fog: Sprite | null = null;
  private lamp: Sprite | null = null;
  private tail: Sprite | null = null;
  private cone: Sprite | null = null;
  private beam: Sprite | null = null;
  private readonly bandit: BanditPose = { xShort: 0, xTall: 0, ironY: -1, crumple: 0, alpha: 1, done: false };
  private readonly tooth: ToothPose = { x: 0, dir: 1, front: 0, grin: 0, glint: -1, done: false };
  private readonly fire: FirePose = { x: 0, crouch: 0, dive: -1, rot: 0, fwd: 0, rise: 0, flame: 0, steam: -1, done: false };
  private readonly marvP: MarvPose = { enter: 0, press: 1, contact: 0, fog: 0, fogAlpha: 0, drop: 0, done: false };
  private readonly vanP: VanPose = { x: 0, beam: -1, done: false };
  private readonly mg: MarvGeom = { cx: 0, cy: 0, faceH: 0, faceW: 0, handW: 0, handH: 0, handDx: 0, handDy: 0 };
  /** How far on from his take-off Harry goes into the snow, in his heights. */
  private steamFwd = 0;

  /** CSS px transform set by the caller. Clipped to the glass; the mullions go back over everything at the layer's alpha. */
  draw(c: CanvasRenderingContext2D, L: Layout, alpha: number, f: GagFrame): void {
    if (this.builtFor !== L) this.build(L);
    const win = this.win;
    if (!win || alpha <= 0) return;
    c.save();
    c.beginPath();
    c.rect(win.x, win.y, win.w, win.h);
    c.clip();
    c.globalAlpha = alpha;
    if (f.vanT >= 0) this.drawVan(c, win, alpha, f.vanT, f.vanDir);
    if (f.gag === 'walk' && f.t >= 0) this.drawWalk(c, win, alpha, f.t, f.iron);
    else if (f.gag === 'tooth' && f.t >= 0) this.drawTooth(c, win, alpha, f.t);
    else if (f.gag === 'fire' && f.t >= 0) this.drawFire(c, win, alpha, f.t);
    if (f.marvT >= 0) this.drawMarv(c, win, alpha, f.marvT);
    // The mullions fade with the house (a cross-fade either way), not with a gag.
    c.globalAlpha = alpha;
    c.globalCompositeOperation = 'source-over';
    paintMullions(c, win, L.s);
    c.globalAlpha = 1;
    c.restore();
  }

  /** The van's headlights through the window, sweeping the room the other way (spec §9.3): additive, ≤ BEAM_MAX. */
  drawBeam(c: CanvasRenderingContext2D, L: Layout, alpha: number, f: GagFrame): void {
    if (this.builtFor !== L) this.build(L);
    if (f.vanT < 0 || !this.beam) return;
    const p = vanPose(f.vanT, this.vanP);
    if (p.beam < 0) return;
    const bw = 0.34 * L.w;
    const k = 0.22 * f.vanDir; // the band leans, the light coming in low and from the side
    const travel = L.w + bw + Math.abs(k) * L.h;
    const cx = f.vanDir > 0 ? L.w + bw / 2 + Math.abs(k) * L.h - p.beam * travel : -bw / 2 - Math.abs(k) * L.h + p.beam * travel;
    c.save();
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = alpha * BEAM_MAX * Math.sin(Math.PI * p.beam);
    c.transform(1, 0, -k, 1, cx, 0);
    c.drawImage(this.beam.c, -bw / 2, 0, bw, L.h);
    c.restore();
  }

  private drawWalk(c: CanvasRenderingContext2D, win: WindowRect, alpha: number, t: number, iron: boolean): void {
    const figs = this.figs;
    if (!figs) return;
    const b = banditPose(t, iron, this.bandit);
    const track = win.y + FIG_TRACK * win.h;
    const hu = BANDIT_FIG.short.scale * this.figH;
    const mu = BANDIT_FIG.tall.scale * this.figH;
    c.globalAlpha = alpha * b.alpha;
    // Harry, then Marv behind him; their legs go by the distance walked, so they plant their feet as they stop.
    const xs = win.x + b.xShort * win.w;
    const ds = xs - (win.x + BANDIT_STOP * win.w);
    blit(c, Math.abs(ds) < 0.5 ? figs.harryStand : figs.harryWalk[frameAt(ds, HARRY_CYCLE * hu, WALK_FRAMES)], xs, track, hu);
    const xt = win.x + b.xTall * win.w;
    const dt = xt - (win.x + (BANDIT_STOP - BANDIT_GAP) * win.w);
    const lean = -0.35 * b.crumple;
    const squash = 1 - 0.55 * b.crumple;
    const still = Math.abs(dt) < 0.5 || b.crumple > 0;
    blit(c, still ? figs.marvStand : figs.marvWalk[frameAt(dt, MARV_CYCLE * mu, WALK_FRAMES)], xt, track, mu, lean, 1, squash);
    if (b.ironY < 0) return;
    // The iron falls to the top of his head on its cord (pulled through from upstairs), and rides it down.
    const tall = mu * squash;
    const headX = xt + tall * Math.sin(-lean);
    const headY = track - tall * Math.cos(lean);
    const iy = win.y + b.ironY * (headY - win.y);
    const iu = 0.22 * this.figH;
    c.strokeStyle = SILHOUETTE;
    c.lineWidth = Math.max(1, 0.012 * this.figH);
    c.beginPath();
    c.moveTo(headX + 0.6 * iu, iy - 0.35 * iu);
    c.quadraticCurveTo(headX + 1.4 * iu, (iy + win.y) / 2, headX + 0.9 * iu, win.y);
    c.stroke();
    blit(c, this.iron, headX, iy, iu, lean * 0.6);
  }

  private drawTooth(c: CanvasRenderingContext2D, win: WindowRect, alpha: number, t: number): void {
    const figs = this.figs;
    if (!figs) return;
    const p = toothPose(t, this.tooth);
    const track = win.y + FIG_TRACK * win.h;
    const hu = BANDIT_FIG.short.scale * this.figH;
    const x = win.x + p.x * win.w;
    // Turning: the profile narrows to edge-on and the front opens out from it (and back), solid all the way.
    const w = 0.5 + 0.5 * Math.abs(Math.cos(Math.PI * p.front));
    c.globalAlpha = alpha;
    if (p.front < 0.5) {
      const d = x - (win.x + BANDIT_STOP * win.w);
      const s = Math.abs(d) < 0.5 ? figs.harryStand : figs.harryWalk[frameAt(p.dir * d, HARRY_CYCLE * hu, WALK_FRAMES)];
      blit(c, s, x, track, hu, 0, p.dir * w);
    } else {
      // A little lift of the chin as the grin lands; the grin itself comes up over the plain face.
      const lift = 0.012 * hu * Math.sin(Math.PI * Math.min(1, p.grin * 1.6));
      blit(c, figs.harryFront, x, track - lift, hu, 0, w);
      if (p.grin > 0) {
        c.globalAlpha = alpha * p.grin;
        blit(c, figs.harryGrin, x, track - lift, hu, 0, w);
        c.globalAlpha = alpha;
      }
    }
    if (p.glint >= 0) {
      const g = p.glint;
      const s = Math.sin(Math.PI * g) ** 0.6;
      const gx = x + figs.tooth[0] * hu;
      const gy = track + figs.tooth[1] * hu;
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = alpha * s;
      blit(c, this.warm, gx, gy, 0.1 * hu * (0.6 + s));
      blit(c, this.glint, gx, gy, 0.15 * hu * s, 0.5 * g);
      blit(c, this.glint, gx, gy, 0.08 * hu * s, Math.PI / 4 - 0.3 * g);
      c.globalCompositeOperation = 'source-over';
    }
  }

  private drawFire(c: CanvasRenderingContext2D, win: WindowRect, alpha: number, t: number): void {
    const figs = this.figs;
    if (!figs) return;
    const p = firePose(t, this.fire);
    const track = win.y + FIG_TRACK * win.h;
    const hu = BANDIT_FIG.short.scale * this.figH;
    const x0 = win.x + p.x * win.w;
    const tops = figs.sprintTops;
    c.globalAlpha = alpha;
    if (p.dive < 0) {
      // Running left: his legs go by the distance run; the crouch gathers him before the dive.
      let top = 2 * SPRINT_FRAMES;
      if (p.crouch > 0) blit(c, figs.harryCrouch, x0, track, hu, 0, -1, 1.06 - 0.06 * p.crouch);
      else {
        const f = frameAt(win.x + FIRE_FROM * win.w - x0, SPRINT_CYCLE * hu, SPRINT_FRAMES);
        top = 2 * f;
        blit(c, figs.harrySprint[f], x0, track, hu, 0, -1);
      }
      this.flame(c, x0 - tops[top] * hu, track + tops[top + 1] * hu, hu, 0.55, t, alpha);
    } else if (p.flame > 0) {
      // In the air, head first, about his middle; whatever is under the snow's surface is gone.
      const cx = x0 - p.fwd * hu;
      const cy = track - (DIVE_PIVOT + p.rise) * hu;
      const rot = -p.rot;
      const push = p.dive < 0.12;
      const k = push ? 2 * SPRINT_FRAMES : 2 * SPRINT_FRAMES + 2;
      c.save();
      c.beginPath();
      c.rect(win.x, win.y, win.w, track + 0.03 * hu - win.y);
      c.clip();
      c.translate(cx, cy);
      c.rotate(rot);
      blit(c, push ? figs.harryCrouch : figs.harryDive, 0, DIVE_PIVOT * hu, hu, 0, -1);
      const tx = -tops[k] * hu;
      const ty = (tops[k + 1] + DIVE_PIVOT) * hu;
      c.rotate(-rot);
      this.flame(c, tx * Math.cos(rot) - ty * Math.sin(rot), tx * Math.sin(rot) + ty * Math.cos(rot), hu, 0.55 + p.rot * 0.6, t, alpha);
      c.restore();
    }
    if (p.steam >= 0) this.drawSteam(c, x0 - this.steamFwd * hu, track, hu, p.steam * (FIRE_MS - FIRE_STEAM_AT), alpha);
  }

  /** Harry's burning hat: a warm halo, three flickering tongues and a bright core, trailing `lean` rad (+: to the right). */
  private flame(c: CanvasRenderingContext2D, x: number, y: number, hu: number, lean: number, t: number, alpha: number): void {
    const size = FLAME * hu;
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = alpha * (0.32 + 0.06 * Math.sin(t * 0.03));
    blit(c, this.warm, x, y - 0.3 * size, 1.5 * size);
    for (let k = 0; k < 3; k++) {
      const sy = (0.8 + 0.18 * Math.sin(t * 0.021 + k * 2.1) + 0.08 * Math.sin(t * 0.057 + k * 4.3)) * (1 - 0.12 * k);
      const sx = (0.85 + 0.15 * Math.sin(t * 0.017 + k * 1.3)) * (1 - 0.1 * k);
      const rot = lean * (0.8 + 0.12 * k) + 0.14 * Math.sin(t * 0.033 + k * 2.9);
      c.globalAlpha = alpha * (0.75 - 0.15 * k);
      blit(c, this.flameOuter, x + (k - 1) * 0.05 * size, y, size * sy, rot, sx / sy);
    }
    c.globalAlpha = alpha * 0.7;
    blit(c, this.flameCore, x, y + 0.04 * size, 0.42 * size * (0.9 + 0.1 * Math.sin(t * 0.045)), lean * 0.7);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = alpha;
  }

  /** Snow kicked up, then steam rising off his head and spreading as it thins. `ms` since he went in. */
  private drawSteam(c: CanvasRenderingContext2D, x: number, y: number, hu: number, ms: number, alpha: number): void {
    for (let i = 0; i < PUFFS.length; i++) {
      const q = PUFFS[i];
      const drift = q[1];
      const rise = q[2];
      const grow = q[3];
      const strength = q[5];
      const u = (ms - q[0]) / q[4];
      if (u <= 0 || u >= 1) continue;
      const e = 1 - (1 - u) * (1 - u);
      // Wisps: taller than wide, swaying as they climb, thinning out as they spread.
      c.globalAlpha = alpha * strength * Math.min(1, u / 0.12) * (1 - u) ** 1.6;
      blit(c, this.puff, x + (drift * e + 0.07 * Math.sin(u * 6 + i * 1.7)) * hu, y - rise * e * hu, (0.06 + grow * e) * hu, 0, 0.7 + 0.3 * u);
    }
    c.globalAlpha = alpha;
  }

  private drawMarv(c: CanvasRenderingContext2D, win: WindowRect, alpha: number, t: number): void {
    const p = marvPose(t, this.marvP);
    const g = this.mg;
    const half = g.handDx + 0.6 * g.handW;
    // In from beyond the window's right edge, a lean that overshoots a touch; at the end, down the glass and out of view.
    const x = g.cx + (1 - p.enter) * (win.x + win.w - (g.cx - half));
    const y = g.cy + p.drop * (win.y + win.h - (g.cy - 0.55 * g.faceH));
    const s = p.press;
    c.globalAlpha = alpha;
    // Pressed: a touch wider than tall.
    blit(c, this.face, x, y, g.faceH * s, -0.1 * (1 - p.enter), 1 + 0.6 * (s - 1) * p.contact);
    const hs = (0.9 + 0.1 * p.contact) * s;
    blit(c, this.hand, x - g.handDx * s, y + g.handDy, g.handH * hs, -0.08, 1);
    blit(c, this.hand, x + g.handDx * s, y + g.handDy, g.handH * hs, 0.08, -1);
    if (p.fogAlpha > 0) {
      // The breath stays on the glass where it was, spreading a little as it fades.
      const r = g.faceH * (0.07 + 0.17 * p.fog) * (1 + 0.2 * (p.drop > 0 ? 1 - p.fogAlpha : 0));
      c.globalAlpha = alpha * 0.8 * p.fogAlpha;
      blit(c, this.fog, g.cx, g.cy + 0.3 * g.faceH, r, 0, 1.5);
    }
  }

  private drawVan(c: CanvasRenderingContext2D, win: WindowRect, alpha: number, t: number, dir: 1 | -1): void {
    const p = vanPose(t, this.vanP);
    const u = VAN_H * win.h;
    const road = win.y + VAN_ROAD * win.h;
    const mid = win.x + (dir > 0 ? p.x : 1 - p.x) * win.w;
    const rear = mid - dir * (VAN_LEN / 2) * u;
    const hx = rear + dir * VAN_HEADLIGHT[0] * u;
    const hy = road + VAN_HEADLIGHT[1] * u;
    c.save();
    c.beginPath();
    traceSnowbank(c, win, win.y);
    c.clip();
    c.globalCompositeOperation = 'lighter';
    c.globalAlpha = alpha * 0.8;
    blit(c, this.cone, hx, hy + 0.05 * u, 2.8 * u, 0, dir, 1);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = alpha;
    blit(c, this.van, rear, road, u, 0, dir);
    c.globalCompositeOperation = 'lighter';
    blit(c, this.lamp, hx, hy, 0.42 * u);
    c.globalAlpha = alpha * 0.6;
    blit(c, this.lamp, hx - dir * 0.08 * u, hy - 0.05 * u, 0.26 * u);
    c.globalAlpha = alpha * 0.8;
    blit(c, this.tail, rear + dir * VAN_TAIL[0] * u, road + VAN_TAIL[1] * u, 0.14 * u);
    c.restore();
  }

  private build(L: Layout): void {
    for (const s of this.sprites()) if (s) s.c.width = s.c.height = 0;
    this.builtFor = L;
    const win = homeWindow(L);
    this.win = win;
    this.figH = FIG_H * win.h;
    const d = L.dpr;
    const hu = BANDIT_FIG.short.scale * this.figH;
    const mu = BANDIT_FIG.tall.scale * this.figH;
    this.figs = bakeFigures(Math.max(8, Math.round(hu * d)), Math.max(8, Math.round(mu * d)), BANDIT_FIG.short.aspect, BANDIT_FIG.tall.aspect);
    this.iron = bakeIron(Math.max(4, Math.round(0.22 * this.figH * d)));
    marvGeom(L, this.mg);
    this.face = bakeMarvFace(Math.max(8, Math.round(this.mg.faceH * d)));
    this.hand = bakeMarvHand(Math.max(8, Math.round(this.mg.handH * d)));
    const vu = VAN_H * win.h * d;
    this.van = bakeVan(Math.max(6, Math.round(vu)));
    this.flameOuter = bakeFlame(FLAME * hu * d, 'rgba(255,214,120,.95)', 'rgba(255,128,36,.75)', 'rgba(190,40,10,0)');
    this.flameCore = bakeFlame(0.5 * FLAME * hu * d, 'rgba(255,252,230,1)', 'rgba(255,220,130,.85)', 'rgba(255,170,60,0)');
    this.warm = bakeSoft(0.6 * hu * d, [[0, 'rgba(255,190,110,.7)'], [0.4, 'rgba(255,150,60,.25)'], [1, 'rgba(255,130,40,0)']]);
    this.glint = bakeGlint(0.4 * hu * d);
    this.puff = bakeSoft(0.6 * hu * d, [[0, 'rgba(232,238,246,.75)'], [0.45, 'rgba(225,232,242,.4)'], [1, 'rgba(220,228,240,0)']]);
    this.fog = bakeSoft(0.8 * this.mg.faceH * d, [[0, 'rgba(222,230,240,.62)'], [0.5, 'rgba(218,226,238,.38)'], [1, 'rgba(214,222,236,0)']]);
    this.lamp = bakeSoft(0.8 * vu, [[0, 'rgba(255,252,236,1)'], [0.12, 'rgba(255,240,200,.9)'], [0.4, 'rgba(255,220,160,.3)'], [1, 'rgba(255,210,150,0)']]);
    this.tail = bakeSoft(0.3 * vu, [[0, 'rgba(255,90,70,.9)'], [0.4, 'rgba(220,30,20,.35)'], [1, 'rgba(200,20,10,0)']]);
    this.cone = bakeCone(2.8 * vu);
    this.beam = bakeBeam();
    this.steamFwd = firePose(FIRE_STEAM_AT, this.fire).fwd + 0.25;
  }

  private sprites(): (Sprite | null)[] {
    const f = this.figs;
    const figs = f ? [...f.harryWalk, ...f.marvWalk, ...f.harrySprint, f.harryStand, f.marvStand, f.harryCrouch, f.harryDive, f.harryFront, f.harryGrin] : [];
    return [...figs, this.iron, this.face, this.hand, this.van, this.flameOuter, this.flameCore, this.warm, this.glint, this.puff, this.fog, this.lamp, this.tail, this.cone, this.beam];
  }
}
