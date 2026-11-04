import type { GarlandGeometry } from './garland';
import { Y, type Layout } from './layout';

/** Spec 2026-10-14 §4: decoration only; nothing here sees or touches a tap's way to the game. */

const TAU = Math.PI * 2;

/** The traps' size unit (CSS px): the tile size, but never so small on a phone that the can and the spider are specks. */
export const trapUnit = (L: Pick<Layout, 's'>): number => Math.max(L.s, 30);

export const PAINT_EVERY = [30_000, 50_000] as const;
export const TARANTULA_EVERY = [40_000, 70_000] as const;

/**
 * A trap's next turn, in in-play ms (the caller steps it only while a tree is in play and the game runs): the first
 * `first` in (by default `range`), then every `range`.
 */
export class TrapScheduler {
  private left: number;

  constructor(private readonly range: readonly [number, number], private readonly rng: () => number, first: readonly [number, number] = range) {
    this.left = first[0] + this.rng() * (first[1] - first[0]);
  }

  /** `dt` ms more of in-play time; true when the trap is due (and the next one is armed). */
  step(dt: number): boolean {
    this.left -= dt;
    if (this.left > 0) return false;
    this.left = this.next();
    return true;
  }

  private next(): number {
    return this.range[0] + this.rng() * (this.range[1] - this.range[0]);
  }
}

export const PAINT_IN_MS = 900;
export const PAINT_MS = 2000;
/** The rope's angle off vertical at rest, before it lets go (rad): the can starts up by the top edge, to the left. */
export const PAINT_SWING = 1.25;

/** The rope's angle `t` ms into the swing: falling in like a pendulum to 0 (the bulb) at PAINT_IN_MS, then back out. */
export function paintCanAngle(t: number): number {
  if (t <= 0) return PAINT_SWING;
  if (t < PAINT_IN_MS) return PAINT_SWING * Math.cos((Math.PI / 2) * (t / PAINT_IN_MS));
  return PAINT_SWING * Math.sin((Math.PI / 2) * Math.min(1, (t - PAINT_IN_MS) / (PAINT_MS - PAINT_IN_MS)));
}

export class PaintCan {
  /** ms into the swing; −1: none. */
  t = -1;
  bulb = -1;
  private hit = false;

  get active(): boolean {
    return this.t >= 0;
  }

  start(bulb: number): void {
    this.t = 0;
    this.bulb = bulb;
    this.hit = false;
  }

  /** `dt` ms more; true on the step the can reaches its bulb. */
  step(dt: number): boolean {
    if (this.t < 0) return false;
    this.t += dt;
    if (!this.hit && this.t >= PAINT_IN_MS) {
      this.hit = true;
      return true;
    }
    if (this.t >= PAINT_MS) this.t = -1;
    return false;
  }

  cancel(): void {
    this.t = -1;
  }
}

export const CRAWL_MS = [6000, 8000] as const;
export const TARANTULA_SCARE_PX = 40;
export const SCURRY_PX_S = 1400;

/** The longest a scurry lasts on layout `L`: across the whole stage, and out past the margin where it ends. */
export const scurryMs = (L: Pick<Layout, 'w' | 'h' | 's'>): number => ((Math.hypot(L.w, L.h) + 2 * trapUnit(L)) / SCURRY_PX_S) * 1000;

export class Tarantula {
  mode: 'crawl' | 'scurry' | null = null;
  readonly pos = { x: 0, y: 0, heading: 0 };
  /** Leg phase: distance-driven while crawling, quick while scurrying. */
  gait = 0;
  private x0 = 0;
  private x1 = 0;
  private y0 = 0;
  private amp = 0;
  private ms = 1;
  private phase = 0;
  private t = 0;
  private vx = 0;
  private vy = 0;

  /** A crawl across the board area, side to side on a wandering path; from `at` (CSS px) when given (the probe). */
  start(L: Layout, rng: () => number, at?: readonly [number, number]): void {
    const dir = rng() < 0.5 ? 1 : -1;
    const half = 10.5 * L.s;
    this.ms = CRAWL_MS[0] + rng() * (CRAWL_MS[1] - CRAWL_MS[0]);
    this.x0 = at ? at[0] : L.ox - dir * half;
    this.x1 = (at ? at[0] : L.ox) + dir * half;
    this.y0 = at ? at[1] : Y(L, 2 + rng() * 6);
    this.amp = 0.7 * L.s;
    this.phase = rng() * TAU;
    this.t = 0;
    this.gait = 0;
    this.mode = 'crawl';
    this.pos.x = this.x0;
    this.pos.y = this.y0;
    this.pos.heading = dir > 0 ? 0 : Math.PI;
  }

  step(dt: number, L: Layout): void {
    if (this.mode === 'crawl') {
      this.t += dt;
      if (this.t >= this.ms) {
        this.mode = null;
        return;
      }
      const k = this.t / this.ms;
      const x = this.x0 + (this.x1 - this.x0) * k;
      const y = this.y0 + this.amp * (Math.sin(TAU * 1.6 * k + this.phase) - Math.sin(this.phase));
      this.gait += Math.hypot(x - this.pos.x, y - this.pos.y);
      this.pos.heading = Math.atan2(y - this.pos.y, x - this.pos.x);
      this.pos.x = x;
      this.pos.y = y;
    } else if (this.mode === 'scurry') {
      this.pos.x += this.vx * dt;
      this.pos.y += this.vy * dt;
      this.gait += SCURRY_PX_S * (dt / 1000);
      const m = trapUnit(L);
      if (this.pos.x < -m || this.pos.x > L.w + m || this.pos.y < -m || this.pos.y > L.h + m) this.mode = null;
    }
  }

  /** A tap at (x, y), CSS px: within TARANTULA_SCARE_PX of a crawling tarantula it scurries off, away from the finger. */
  scare(x: number, y: number): boolean {
    if (this.mode !== 'crawl') return false;
    const dx = this.pos.x - x;
    const dy = this.pos.y - y;
    const d = Math.hypot(dx, dy);
    if (d > TARANTULA_SCARE_PX) return false;
    const ux = d > 0.5 ? dx / d : this.x1 >= this.x0 ? 1 : -1;
    const uy = d > 0.5 ? dy / d : 0;
    this.vx = (ux * SCURRY_PX_S) / 1000;
    this.vy = (uy * SCURRY_PX_S) / 1000;
    this.pos.heading = Math.atan2(uy, ux);
    this.mode = 'scurry';
    return true;
  }

  cancel(): void {
    this.mode = null;
  }
}

export interface KnockTarget {
  readonly geo: Pick<GarlandGeometry, 'bulbs' | 'size' | 'n'>;
  pickLit(u: number): number;
  knock(k: number, now: number): void;
  unknock(): void;
}

/* ---------- drawing (screen space, CSS px transform; path ops and the cached can sprite only) ---------- */

/** The can's size in trap units (about a tile): 0.7 s wide, 0.8 s tall, the handle's top (where the rope ties) at the top centre. */
const CAN_W = 0.7;
const CAN_H = 0.8;

/** The paint can, baked once per layout (device px); null without a 2D context. */
export function makePaintCan(L: Layout): HTMLCanvasElement | null {
  const W = CAN_W * trapUnit(L);
  const H = CAN_H * trapUnit(L);
  const cv = document.createElement('canvas');
  cv.width = Math.max(2, Math.round(W * L.dpr));
  cv.height = Math.max(2, Math.round(H * L.dpr));
  const c = cv.getContext('2d');
  if (!c) return null;
  c.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
  const bx = 0.1 * W;
  const bw = 0.8 * W;
  const lidY = 0.34 * H;
  const lidR = 0.07 * H;
  const bottom = 0.97 * H;
  // The wire handle: an arc from the body's sides up to the top centre.
  c.strokeStyle = '#444';
  c.lineWidth = Math.max(1, 0.025 * W / CAN_W);
  c.beginPath();
  c.moveTo(bx + 0.04 * W, lidY + 0.02 * H);
  c.quadraticCurveTo(W / 2, -0.28 * H, bx + bw - 0.04 * W, lidY + 0.02 * H);
  c.stroke();
  // The body.
  const body = c.createLinearGradient(bx, 0, bx + bw, 0);
  body.addColorStop(0, '#7f8790');
  body.addColorStop(0.45, '#c9d0d7');
  body.addColorStop(1, '#8a929b');
  c.fillStyle = body;
  c.beginPath();
  c.moveTo(bx, lidY);
  c.lineTo(bx, bottom - lidR);
  c.ellipse(W / 2, bottom - lidR, bw / 2, lidR, 0, Math.PI, 0, true);
  c.lineTo(bx + bw, lidY);
  c.closePath();
  c.fill();
  // Rolled rims round the body.
  c.strokeStyle = 'rgba(60,66,72,.55)';
  c.lineWidth = Math.max(0.75, 0.012 * W / CAN_W);
  for (const f of [0.52, 0.8]) {
    c.beginPath();
    c.ellipse(W / 2, f * H, bw / 2, lidR, 0, 0, Math.PI);
    c.stroke();
  }
  // The lid.
  c.fillStyle = '#aeb6be';
  c.beginPath();
  c.ellipse(W / 2, lidY, bw / 2, lidR, 0, 0, TAU);
  c.fill();
  c.strokeStyle = 'rgba(70,76,82,.7)';
  c.stroke();
  // A red paint drip down one side, over the lip.
  c.fillStyle = '#c62828';
  c.beginPath();
  c.moveTo(bx + 0.08 * W, lidY + 0.3 * lidR);
  c.quadraticCurveTo(bx + 0.2 * W, lidY + 0.8 * lidR, bx + 0.32 * W, lidY + 0.6 * lidR);
  c.lineTo(bx + 0.31 * W, lidY + 0.22 * H);
  c.arc(bx + 0.27 * W, lidY + 0.22 * H, 0.04 * W, 0, Math.PI);
  c.lineTo(bx + 0.22 * W, lidY + 0.12 * H);
  c.arc(bx + 0.18 * W, lidY + 0.12 * H, 0.04 * W, 0, Math.PI);
  c.closePath();
  c.fill();
  return cv;
}

/** The can on its rope, swinging in from above the top edge to its bulb and back out. */
export function drawPaintCan(c: CanvasRenderingContext2D, L: Layout, can: PaintCan, garland: KnockTarget, sprite: HTMLCanvasElement | null): void {
  const b = garland.geo.bulbs[can.bulb];
  if (!b || !can.active) return;
  const u = trapUnit(L);
  const py = -0.6 * u;
  const R = b.y + 0.7 * garland.geo.size + 0.6 * u;
  // From the left, or from the right for a bulb on the left half, so it never comes in from off the screen's edge.
  const th = (b.x < L.w / 2 ? -1 : 1) * paintCanAngle(can.t);
  const ex = b.x - R * Math.sin(th);
  const ey = py + R * Math.cos(th);
  c.strokeStyle = 'rgba(220,200,160,.9)';
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(b.x, py);
  c.lineTo(ex, ey);
  c.stroke();
  if (!sprite) return;
  const W = CAN_W * trapUnit(L);
  const H = CAN_H * trapUnit(L);
  // Hanging along the rope: the can's "down" is the rope's direction, (−sin θ, cos θ).
  c.save();
  c.translate(ex, ey);
  c.rotate(th);
  c.drawImage(sprite, -W / 2, 0, W, H);
  c.restore();
}

const SPIDER = '#1b120e';
const SPIDER_LEG = '#140d0a';
const SHEEN = 'rgba(150,110,80,.35)';

/** A small tarantula at its position, facing its heading, its legs walking with its gait. */
export function drawTarantula(c: CanvasRenderingContext2D, L: Layout, t: Tarantula): void {
  if (!t.mode) return;
  const r = 0.32 * trapUnit(L);
  c.save();
  c.translate(t.pos.x, t.pos.y);
  c.rotate(t.pos.heading);
  // Eight legs, four a side, from the cephalothorax: front pair reaching forward, back pair trailing.
  c.strokeStyle = SPIDER_LEG;
  c.lineWidth = Math.max(1.5, 0.14 * r);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  const ax = 0.25 * r;
  for (let side = -1; side <= 1; side += 2) {
    for (let k = 0; k < 4; k++) {
      const swing = 0.35 * Math.sin(t.gait / (0.6 * r) + (k * Math.PI) / 2 + side * Math.PI);
      const a = side * (0.55 + 0.55 * k) + swing;
      const kx = ax + Math.cos(a) * r;
      const ky = Math.sin(a) * r;
      // The lower leg bends back toward the body's long axis: front legs forward, back legs back.
      const fa = a + side * (k < 2 ? -0.55 : 0.45);
      c.beginPath();
      c.moveTo(ax, 0);
      c.lineTo(kx, ky);
      c.lineTo(kx + Math.cos(fa) * 0.75 * r, ky + Math.sin(fa) * 0.75 * r);
      c.stroke();
    }
  }
  c.fillStyle = SPIDER;
  c.beginPath();
  c.ellipse(-0.55 * r, 0, 0.6 * r, 0.5 * r, 0, 0, TAU);
  c.fill();
  c.strokeStyle = SHEEN;
  c.lineWidth = Math.max(0.75, 0.08 * r);
  c.stroke();
  c.beginPath();
  c.ellipse(0.25 * r, 0, 0.38 * r, 0.32 * r, 0, 0, TAU);
  c.fill();
  c.stroke();
  c.restore();
}
