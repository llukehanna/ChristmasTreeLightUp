import { D, DIRS, OPPOSITE, rotCW } from './dirs';
import { generateSolution } from './generate';
import { neighbor, type Grid } from './mask';
import type { Rng } from './rng';
import { randomColors, scramble } from './scramble';

export interface Lighting {
  lit: boolean[];
  /** BFS parent of each lit tile (-1 for the root / unlit). */
  parent: number[];
  /** Direction (bit) through which each lit tile receives power. */
  entry: number[];
  /** Lit tiles in BFS order. */
  order: number[];
  children: number[][];
  count: number;
}

/** Faithful port of the original Game.og/Ke: BFS from the root, neighbours in U,D,L,R order. */
export function computeLighting(g: Grid, bits: readonly number[]): Lighting {
  const n = g.w * g.h;
  const lit = new Array<boolean>(n).fill(false);
  const parent = new Array<number>(n).fill(-1);
  const entry = new Array<number>(n).fill(0);
  const children: number[][] = Array.from({ length: n }, () => []);
  const order: number[] = [];
  if (bits[g.root] & D) {
    lit[g.root] = true;
    entry[g.root] = D;
    order.push(g.root);
  }
  for (let h = 0; h < order.length; h++) {
    const i = order[h];
    for (const d of DIRS) {
      if (!(bits[i] & d)) continue;
      const j = neighbor(g, i, d);
      if (j < 0 || lit[j]) continue;
      const o = OPPOSITE[d];
      if (bits[j] & o) {
        lit[j] = true;
        parent[j] = i;
        entry[j] = o;
        children[i].push(j);
        order.push(j);
      }
    }
  }
  return { lit, parent, entry, order, children, count: order.length };
}

/** Original: 200ms linear. Shortened for a snappier feel (spec §2.7). */
export const ROTATE_MS = 120;
/** Rapid taps on a turning tile are buffered into one fluid spin (spec §2.7). */
export const MAX_QUEUE = 3;

export interface Rotation {
  from: number;
  to: number;
  t0: number;
  queued: number;
}

export interface BoardState {
  solution: number[];
  bits: number[];
  colors: number[];
}

export type BoardEvent =
  | { type: 'rotateStarted'; tile: number }
  | { type: 'tapBuffered'; tile: number }
  | { type: 'rotateFinished'; tile: number }
  | { type: 'lightingChanged'; newlyLit: number[]; lost: number[] }
  | { type: 'won' };

export class Board {
  readonly grid: Grid;
  readonly solution: readonly number[];
  readonly colors: readonly number[];
  readonly rotateMs: number;
  bits: number[];
  lighting: Lighting;
  readonly rotating = new Map<number, Rotation>();
  won = false;

  constructor(grid: Grid, state: BoardState, rotateMs = ROTATE_MS) {
    this.grid = grid;
    this.solution = [...state.solution];
    this.colors = [...state.colors];
    this.bits = [...state.bits];
    this.rotateMs = rotateMs;
    this.lighting = computeLighting(grid, this.bits);
  }

  static random(grid: Grid, rng: Rng): Board {
    const solution = generateSolution(grid, rng);
    return new Board(grid, { solution, bits: scramble(grid, solution, rng), colors: randomColors(grid, rng) });
  }

  /** A click/tap on tile `i`. Mid-turn taps are buffered; taps after the win are ignored. */
  tap(i: number, now: number): BoardEvent[] {
    if (this.won || !this.grid.cells[i]) return [];
    const r = this.rotating.get(i);
    if (r) {
      if (r.queued >= MAX_QUEUE) return []; // dropped: no click or buzz for a tap that does nothing
      r.queued++;
      return [{ type: 'tapBuffered', tile: i }];
    }
    const from = this.bits[i];
    this.rotating.set(i, { from, to: rotCW(from), t0: now, queued: 0 });
    this.bits[i] = 0; // original: Lb = 0 while turning, so the tile and everything downstream go dark
    return [{ type: 'rotateStarted', tile: i }, ...this.relight()];
  }

  /** Advance time: finish turns whose duration has elapsed and check for the win. */
  tick(now: number): BoardEvent[] {
    const events: BoardEvent[] = [];
    let finished = false;
    for (const [i, r] of this.rotating) {
      if (now - r.t0 < this.rotateMs) continue;
      if (r.queued > 0) {
        this.rotating.set(i, { from: r.to, to: rotCW(r.to), t0: r.t0 + this.rotateMs, queued: r.queued - 1 });
      } else {
        this.bits[i] = r.to;
        this.rotating.delete(i);
        events.push({ type: 'rotateFinished', tile: i });
        finished = true;
      }
    }
    if (finished) {
      events.push(...this.relight());
      events.push(...this.checkWin());
    }
    return events;
  }

  /** Bits to draw: a turning tile shows the shape it is turning from. */
  displayBits(i: number): number {
    return this.rotating.get(i)?.from ?? this.bits[i];
  }

  /** Bits as they will be once every turn (including buffered ones) completes. Used for saving. */
  settledBits(): number[] {
    return this.bits.map((b, i) => {
      const r = this.rotating.get(i);
      if (!r) return b;
      let x = r.to;
      for (let k = 0; k < r.queued; k++) x = rotCW(x);
      return x;
    });
  }

  /**
   * Claims the win for a board that is already fully lit, e.g. one restored from a save made during the final turn
   * (the constructor never checks for a win). Returns the same events as a winning turn would.
   */
  settleWin(): BoardEvent[] {
    return this.checkWin();
  }

  /** Test/debug only: snap to the solution. */
  debugSolve(): BoardEvent[] {
    this.rotating.clear();
    this.bits = [...this.solution];
    return [...this.relight(), ...this.checkWin()];
  }

  private relight(): BoardEvent[] {
    const prev = this.lighting;
    const next = computeLighting(this.grid, this.bits);
    this.lighting = next;
    const newlyLit = next.order.filter((i) => !prev.lit[i]);
    const lost = prev.order.filter((i) => !next.lit[i]);
    return newlyLit.length || lost.length ? [{ type: 'lightingChanged', newlyLit, lost }] : [];
  }

  private checkWin(): BoardEvent[] {
    if (this.won || this.lighting.count !== this.grid.ids.length) return [];
    this.won = true;
    return [{ type: 'won' }];
  }
}
