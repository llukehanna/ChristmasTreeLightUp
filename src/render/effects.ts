import type { Board } from '../core/board';
import { D, DIRS, OPPOSITE, type Dir } from '../core/dirs';
import { GRID, dirBetween, neighbor } from '../core/mask';
import { mulberry32 } from '../core/rng';
import { rgba } from './color';
import { EDGE, arcFor, isBend, pointAt } from './geometry';
import { X, Y, tileCenter, type Layout } from './layout';
import type { Scene } from './scenes';
import { FLASH_MS, TILE_FILL_MS, type Flash, type VisualState } from './visual-state';

const TAU = Math.PI * 2;

export const easeOutBack = (t: number): number => 1 + 2.5 * (t - 1) ** 3 + 1.5 * (t - 1) ** 2;
/** Rotation easing: fast start, ~3% overshoot, lands exactly on 1. */
export const easeSnap = (t: number): number => 1 + 2.15 * (t - 1) ** 3 + 1.15 * (t - 1) ** 2;

function dot(c: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.fill();
}

function radial(c: CanvasRenderingContext2D, x: number, y: number, r: number, stops: readonly (readonly [number, string])[]): void {
  if (r <= 0) return;
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  for (const [o, col] of stops) g.addColorStop(o, col);
  c.fillStyle = g;
  c.fillRect(x - r, y - r, 2 * r, 2 * r);
}

/* ---------- current: sparks running from the source outward along the lit tree (filament) ---------- */

interface Spark {
  tile: number;
  entry: Dir;
  exit: Dir | null;
  next: number;
  u: number;
  speed: number;
}

export class Current {
  private sparks: Spark[] = [];
  private lastSpawn = 0;

  clear(): void {
    this.sparks.length = 0;
  }

  step(board: Board, vis: VisualState, now: number, dt: number): void {
    const root = board.grid.root;
    const { lit, parent } = board.lighting;
    if (lit[root] && vis.litStart[root] >= 0 && now > vis.litStart[root] + TILE_FILL_MS && now - this.lastSpawn > 110) {
      this.lastSpawn = now;
      this.sparks.push(this.enter(board, root, D, 4.5 + Math.random() * 2));
    }
    for (let k = this.sparks.length - 1; k >= 0; k--) {
      const p = this.sparks[k];
      p.u += (dt / 1000) * p.speed;
      if (!lit[p.tile] || board.rotating.has(p.tile) || (p.exit === null && p.u >= 0.5)) {
        this.sparks.splice(k, 1);
        continue;
      }
      if (p.u < 1) continue;
      if (p.exit === null || p.next < 0 || !lit[p.next] || parent[p.next] !== p.tile) {
        this.sparks.splice(k, 1);
        continue;
      }
      const n = this.enter(board, p.next, OPPOSITE[p.exit], p.speed);
      n.u = p.u - 1;
      this.sparks[k] = n;
    }
  }

  draw(c: CanvasRenderingContext2D, board: Board, L: Layout, radius: number): void {
    c.fillStyle = '#fff';
    for (const p of this.sparks) {
      const [x, y] = this.point(board, L, p);
      dot(c, x, y, radius);
    }
  }

  private enter(board: Board, tile: number, entry: Dir, speed: number): Spark {
    const ch = board.lighting.children[tile];
    if (ch.length === 0) return { tile, entry, exit: null, next: -1, u: 0, speed };
    const next = ch[Math.floor(Math.random() * ch.length)];
    return { tile, entry, exit: dirBetween(board.grid, tile, next), next, u: 0, speed };
  }

  private point(board: Board, L: Layout, p: Spark): [number, number] {
    const [cx, cy] = tileCenter(L, board.grid, p.tile);
    const b = board.bits[p.tile];
    const u = Math.min(p.u, 0.999);
    let lx = 0;
    let ly = 0;
    if (p.exit !== null && isBend(b)) [lx, ly] = pointAt(arcFor(b, p.entry), u);
    else if (u < 0.5) {
      const [ex, ey] = EDGE[p.entry];
      lx = ex * (1 - u * 2);
      ly = ey * (1 - u * 2);
    } else if (p.exit !== null) {
      const [ex, ey] = EDGE[p.exit];
      lx = ex * (u - 0.5) * 2;
      ly = ey * (u - 0.5) * 2;
    }
    return [cx + lx * L.s, cy + ly * L.s];
  }
}

/* ---------- snow and embers ---------- */

export class Snowfall {
  private readonly flakes = Array.from({ length: 160 }, (_, i) => {
    const r = mulberry32(99 + i);
    return { x: r(), y: r(), z: r(), p: r() * TAU };
  });

  /** `front` = large, soft foreground flakes; otherwise small background flakes. `density` 0..1. */
  draw(c: CanvasRenderingContext2D, L: Layout, sc: Scene, front: boolean, dt: number, now: number, density: number): void {
    if (!sc.snowAlpha) return;
    const n = Math.floor(this.flakes.length * density);
    for (let k = 0; k < n; k++) {
      const f = this.flakes[k];
      if (f.z > 0.72 !== front) continue;
      f.y += (dt / 1000) * (front ? 0.018 + f.z * 0.05 : 0.008 + f.z * 0.03);
      f.x += Math.sin(now * 0.0005 + f.p) * (front ? 0.00012 : 0.00006) * dt;
      if (f.y > 1.05) {
        f.y = -0.05;
        f.x = Math.random();
      }
      const x = f.x * L.w;
      const y = f.y * L.h;
      if (front) {
        const rad = 1.6 + f.z * 3.2;
        radial(c, x, y, rad * 1.6, [[0, `rgba(${sc.snow},${sc.snowAlpha * 0.35})`], [1, `rgba(${sc.snow},0)`]]);
      } else {
        c.fillStyle = `rgba(${sc.snow},${sc.snowAlpha * (0.25 + f.z * 0.5)})`;
        dot(c, x, y, 0.5 + f.z * 1.6);
      }
    }
  }
}

export class Embers {
  private readonly list: { x: number; y: number; vx: number; vy: number; life: number; max: number; p: number }[] = [];

  draw(c: CanvasRenderingContext2D, L: Layout, dt: number, now: number): void {
    if (this.list.length < 28 && Math.random() < dt / 90) {
      this.list.push({
        x: Math.random() * L.w * 0.28,
        y: L.h * (0.8 + Math.random() * 0.2),
        vx: 12 + Math.random() * 22,
        vy: -(20 + Math.random() * 35),
        life: 0,
        max: 3000 + Math.random() * 3000,
        p: Math.random() * 6,
      });
    }
    c.globalCompositeOperation = 'lighter';
    for (let k = this.list.length - 1; k >= 0; k--) {
      const e = this.list[k];
      e.life += dt;
      if (e.life > e.max) {
        this.list.splice(k, 1);
        continue;
      }
      e.x += ((e.vx + Math.sin(now * 0.002 + e.p) * 14) * dt) / 1000;
      e.y += (e.vy * dt) / 1000;
      const a = Math.sin((Math.PI * e.life) / e.max) * (0.55 + 0.45 * Math.sin(now * 0.02 + e.p));
      radial(c, e.x, e.y, 4, [[0, `rgba(255,190,110,${a})`], [1, 'rgba(255,90,30,0)']]);
    }
    c.globalCompositeOperation = 'source-over';
  }
}

/* ---------- scene lighting and feedback ---------- */

export function drawFirelight(c: CanvasRenderingContext2D, L: Layout, now: number): void {
  const f = 0.5 + 0.5 * (Math.sin(now * 0.0031) * 0.5 + Math.sin(now * 0.0077 + 1) * 0.3 + Math.sin(now * 0.013 + 2) * 0.2);
  c.globalCompositeOperation = 'lighter';
  radial(c, -L.w * 0.05, L.h * 0.92, L.w * 0.75, [[0, `rgba(255,120,40,${0.2 + f * 0.08})`], [1, 'rgba(255,120,40,0)']]);
  c.globalCompositeOperation = 'source-over';
}

export function drawHover(c: CanvasRenderingContext2D, L: Layout, tile: number, sc: Scene): void {
  const [x, y] = tileCenter(L, GRID, tile);
  radial(c, x, y, L.s * 0.8, [[0, `rgba(${sc.hover},.16)`], [1, `rgba(${sc.hover},0)`]]);
}

/** Loose ends of the lit network pulse: where light is trying to go next (spec §4.5 item 6). */
export function drawFrontier(c: CanvasRenderingContext2D, board: Board, L: Layout, tile: number, now: number, sc: Scene, core: boolean): void {
  const b = board.bits[tile];
  const [cx, cy] = tileCenter(L, board.grid, tile);
  for (const d of DIRS) {
    if (!(b & d)) continue;
    if (tile === board.grid.root && d === D) continue; // plugged into the source
    const j = neighbor(board.grid, tile, d);
    if (j >= 0 && board.lighting.lit[j] && board.bits[j] & OPPOSITE[d] && !board.rotating.has(j)) continue;
    const pulse = 0.5 + 0.5 * Math.sin(now * 0.0055 + tile * 1.7);
    const [ex, ey] = EDGE[d];
    const x = cx + ex * L.s;
    const y = cy + ey * L.s;
    if (core) {
      c.globalAlpha = 0.55 + 0.45 * pulse;
      c.fillStyle = '#fff';
      dot(c, x, y, L.s * (0.045 + 0.02 * pulse));
      c.globalAlpha = 1;
    } else {
      radial(c, x, y, L.s * (0.3 + 0.12 * pulse), [[0, rgba(sc.glow, 0.9)], [1, rgba(sc.glow, 0)]]);
    }
  }
}

function flashPoint(L: Layout, f: Flash): [number, number] {
  const [cx, cy] = tileCenter(L, GRID, f.tile);
  const [ex, ey] = EDGE[f.edge as Dir];
  return [cx + ex * L.s, cy + ey * L.s];
}

export function drawFlashGlows(c: CanvasRenderingContext2D, vis: VisualState, L: Layout, now: number, sc: Scene): void {
  for (const f of vis.flashes) {
    const t = now - f.t;
    if (t < 0 || t > FLASH_MS) continue;
    const k = t / FLASH_MS;
    const [x, y] = flashPoint(L, f);
    radial(c, x, y, L.s * (0.5 + 1.3 * k), [
      [0, `rgba(255,255,255,${(1 - k) * 0.95})`],
      [0.3, rgba(sc.glow, (1 - k) * 0.6)],
      [1, rgba(sc.glow, 0)],
    ]);
  }
}

export function drawFlashRings(c: CanvasRenderingContext2D, vis: VisualState, L: Layout, now: number): void {
  c.strokeStyle = '#fff';
  for (const f of vis.flashes) {
    const t = now - f.t;
    if (t < 0 || t > FLASH_MS) continue;
    const k = t / FLASH_MS;
    const [x, y] = flashPoint(L, f);
    c.globalAlpha = (1 - k) * 0.8;
    c.lineWidth = Math.max(1, L.s * 0.025 * (1 - k));
    c.beginPath();
    c.arc(x, y, L.s * (0.12 + 0.64 * easeOutBack(k)), 0, TAU);
    c.stroke();
  }
  c.globalAlpha = 1;
}

export function drawSourceGlow(c: CanvasRenderingContext2D, L: Layout, sc: Scene): void {
  const x = X(L, 0);
  const y = Y(L, 9.72);
  c.strokeStyle = sc.glow;
  c.lineWidth = L.s * 0.16;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(x, Y(L, 9));
  c.lineTo(x, y);
  c.stroke();
  c.fillStyle = sc.glow;
  dot(c, x, y, L.s * 0.5);
}

export function drawSourceCore(c: CanvasRenderingContext2D, L: Layout, sc: Scene): void {
  const x = X(L, 0);
  const y = Y(L, 9.72);
  c.strokeStyle = sc.core;
  c.lineWidth = Math.max(1.3, L.s * 0.05);
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(x, Y(L, 9));
  c.lineTo(x, y);
  c.stroke();
  c.fillStyle = sc.core;
  dot(c, x, y, L.s * 0.12);
  c.strokeStyle = rgba(sc.glow, 0.5);
  c.lineWidth = 1;
  c.beginPath();
  c.arc(x, y, L.s * 0.24, 0, TAU);
  c.stroke();
}

/** The snow/floor under the tree catches the light (spec §4.5 item 9). */
export function drawGroundPool(c: CanvasRenderingContext2D, L: Layout, sc: Scene, amount: number): void {
  if (amount <= 0) return;
  c.save();
  c.translate(X(L, 0), Y(L, 10.1));
  c.scale(1, 0.16);
  radial(c, 0, 0, L.s * 10, [[0, rgba(sc.glow, 0.35 * Math.min(1.5, amount))], [1, rgba(sc.glow, 0)]]);
  c.restore();
}

export interface StarState {
  glow: number;
  on: number;
}

export function starState(now: number, winAt: number | null, litFrac: number): StarState {
  if (winAt !== null) {
    const t = Math.min(1, Math.max(0, (now - winAt) / 900));
    return { glow: easeOutBack(t) * (1 + 0.06 * Math.sin(now * 0.003)), on: t };
  }
  return { glow: litFrac ** 5 * 0.35, on: 0 };
}

export function drawStarGlow(c: CanvasRenderingContext2D, L: Layout, sc: Scene, st: StarState, won: boolean): void {
  if (st.glow <= 0) return;
  const x = X(L, 0);
  const y = Y(L, -1.3);
  radial(c, x, y, L.s * 3.2 * st.glow, [[0, rgba(sc.glow, 0.9)], [0.25, rgba(sc.glow, 0.3)], [1, rgba(sc.glow, 0)]]);
  if (!won) return;
  c.globalAlpha = Math.min(1, st.glow * 0.8);
  const fl = c.createLinearGradient(x - L.s * 7, 0, x + L.s * 7, 0);
  fl.addColorStop(0, rgba(sc.glow, 0));
  fl.addColorStop(0.5, rgba(sc.glow, 1));
  fl.addColorStop(1, rgba(sc.glow, 0));
  c.fillStyle = fl;
  c.fillRect(x - L.s * 7, y - L.s * 0.05, L.s * 14, L.s * 0.1);
  c.globalAlpha = 1;
}

/** Eight-point starburst above row 0. Dim until the win, then it ignites (spec §4.5 item 10). */
export function drawStar(c: CanvasRenderingContext2D, L: Layout, sc: Scene, st: StarState, won: boolean): void {
  c.save();
  c.translate(X(L, 0), Y(L, -1.3));
  if (won) {
    const k = 0.8 + 0.2 * easeOutBack(st.on);
    c.scale(k, k);
  }
  const path = () => {
    c.beginPath();
    for (let k = 0; k < 16; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 8;
      const rad = k % 2 ? L.s * 0.1 : k % 4 === 0 ? L.s * 0.78 : L.s * 0.42;
      c.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    c.closePath();
  };
  path();
  c.fillStyle = sc.starOff;
  c.fill();
  c.strokeStyle = sc.starEdge;
  c.lineWidth = 1;
  c.stroke();
  if (st.on > 0) {
    path();
    const g = c.createRadialGradient(0, 0, 0, 0, 0, L.s * 0.8);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.4, sc.core);
    g.addColorStop(1, sc.glow);
    c.globalAlpha = st.on;
    c.fillStyle = g;
    c.fill();
  }
  c.restore();
}
