import type { Board } from '../core/board';
import { degree } from '../core/dirs';

export const TILE_FILL_MS = 30;
export const FADE_MS = 170;
export const SETTLE_MS = 240;
export const FLASH_MS = 480;

export interface Flash {
  tile: number;
  /** Direction bit of the edge where the connection was made. */
  edge: number;
  t: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Animation timestamps layered on top of the board's logical state (spec §4.5). */
export class VisualState {
  readonly litStart: number[];
  readonly fadeStart: number[];
  readonly settleAt: number[];
  flashes: Flash[] = [];

  constructor(size: number) {
    this.litStart = new Array<number>(size).fill(-1);
    this.fadeStart = new Array<number>(size).fill(-1);
    this.settleAt = new Array<number>(size).fill(-Infinity);
  }

  /** Schedules the flow for newly lit tiles (parent before child). Returns absolute bulb-pop times, sorted. */
  onLightingChanged(board: Board, newlyLit: readonly number[], lost: readonly number[], now: number, withFlashes: boolean): number[] {
    const fresh = new Set(newlyLit);
    const { order, parent, entry } = board.lighting;
    for (const i of order) {
      if (!fresh.has(i)) continue;
      const p = parent[i];
      const chained = p >= 0 && fresh.has(p);
      this.litStart[i] = chained ? this.litStart[p] + TILE_FILL_MS : now;
      this.fadeStart[i] = -1;
      if (withFlashes && !chained) this.flashes.push({ tile: i, edge: entry[i], t: this.litStart[i] });
    }
    for (const i of lost) {
      this.fadeStart[i] = now;
      this.litStart[i] = -1;
    }
    return newlyLit
      .filter((i) => degree(board.solution[i]) === 1)
      .map((i) => this.litStart[i] + TILE_FILL_MS)
      .sort((a, b) => a - b);
  }

  onRotateFinished(tile: number, now: number): void {
    this.settleAt[tile] = now;
  }

  /** q = fill progress 0..1 (light travelling through the tile), alpha = opacity of the lit layer. */
  fill(board: Board, i: number, now: number): { q: number; alpha: number } {
    if (board.rotating.has(i)) return { q: 0, alpha: 0 };
    if (board.lighting.lit[i] && this.litStart[i] >= 0) {
      const q = clamp01((now - this.litStart[i]) / TILE_FILL_MS);
      return { q, alpha: q > 0 ? 1 : 0 };
    }
    if (this.fadeStart[i] >= 0) return { q: 1, alpha: 1 - clamp01((now - this.fadeStart[i]) / FADE_MS) };
    return { q: 0, alpha: 0 };
  }

  /** Bulb pop: overshoots to ~1.8× then settles to 1. */
  bulbIntensity(i: number, now: number): number {
    const t = now - (this.litStart[i] + TILE_FILL_MS);
    return clamp01(t / 60) + 0.8 * Math.exp(-Math.max(0, t) / 200) * clamp01(t / 25);
  }

  settleScale(i: number, now: number): number {
    const t = (now - this.settleAt[i]) / SETTLE_MS;
    return t < 0 || t > 1 ? 1 : 1 + 0.1 * Math.sin(Math.PI * t) * (1 - t);
  }

  prune(now: number): void {
    this.flashes = this.flashes.filter((f) => now - f.t <= FLASH_MS);
  }

  /** When the last tile finishes filling (used to time the win sequence). */
  lastLitAt(board: Board): number {
    let m = 0;
    for (const i of board.lighting.order) m = Math.max(m, this.litStart[i]);
    return m + TILE_FILL_MS;
  }
}
