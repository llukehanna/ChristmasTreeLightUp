// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BANDIT_ENTER_MS, BANDIT_EVERY_MS, BANDIT_IDLE_MS, BANDIT_PAUSE_MS, BANDIT_STOP, BANDIT_WALK_MS, BanditTimer, CUTOUT,
  CUTOUT_MS, FIG_H, IRON_DROP_MS, IRON_CRUMPLE_MS, IRON_WALK_MS, WindowGags, banditPose, partyCount, partyPose, type BanditPose, type Pose,
} from '../../../src/render/home-alone-window';
import { GRID } from '../../../src/core/mask';
import { homeWindow } from '../../../src/render/home-alone-room';
import { computeLayout, tileCenter } from '../../../src/render/layout';

afterEach(() => vi.restoreAllMocks());

const pose = (): Pose => ({ x: 0, lift: 0, lean: 0 });
const bp = (): BanditPose => ({ xShort: 0, xTall: 0, ironY: 0, crumple: 0, alpha: 0, done: false });

describe('the fake party', () => {
  it('the cardboard cut-out slides stiffly back and forth: no bob, no lean', () => {
    expect(partyPose(CUTOUT, 0, pose()).x).toBeCloseTo(0.18);
    expect(partyPose(CUTOUT, CUTOUT_MS / 2, pose()).x).toBeCloseTo(0.82);
    expect(partyPose(CUTOUT, CUTOUT_MS, pose()).x).toBeCloseTo(0.18);
    for (let t = 0; t < 20_000; t += 333) expect(partyPose(CUTOUT, t, pose())).toMatchObject({ lift: 0, lean: 0 });
  });

  it('the dancers bob and sway as they cross the panes, wrapping round the loop', () => {
    const xs = new Set<number>();
    for (let t = 0; t < 9000; t += 250) {
      for (let k = 0; k < CUTOUT; k++) {
        const p = partyPose(k, t, pose());
        expect(p.x).toBeGreaterThanOrEqual(-0.1);
        expect(p.x).toBeLessThanOrEqual(1.1);
        expect(p.lift).toBeGreaterThanOrEqual(0);
        expect(p.lift).toBeLessThanOrEqual(0.05);
        xs.add(Math.round(p.x * 100));
      }
    }
    expect(xs.size).toBeGreaterThan(20);
  });

  it('fewer figures on the slower quality tiers', () => {
    expect([0, 1, 2, 3].map(partyCount)).toEqual([4, 4, 2, 1]);
  });
});

describe('the Wet Bandits', () => {
  it('creep in from off the window, pause, and leave the other side by BANDIT_WALK_MS', () => {
    const start = banditPose(0, false, bp());
    expect(start.xShort).toBeLessThan(0);
    expect(start.xTall).toBeLessThan(start.xShort); // the tall one follows
    for (const t of [BANDIT_ENTER_MS, BANDIT_ENTER_MS + BANDIT_PAUSE_MS / 2, BANDIT_ENTER_MS + BANDIT_PAUSE_MS]) {
      expect(banditPose(t, false, bp()).xShort).toBeCloseTo(BANDIT_STOP);
    }
    expect(banditPose(BANDIT_WALK_MS - 1, false, bp()).done).toBe(false);
    const end = banditPose(BANDIT_WALK_MS, false, bp());
    expect(end.done).toBe(true);
    expect(end.xTall).toBeGreaterThan(1);
    expect(end.ironY).toBe(-1);
  });

  it('the iron drops on the tall one at the pause; he crumples and the walk ends early', () => {
    expect(banditPose(BANDIT_ENTER_MS - 1, true, bp()).ironY).toBe(-1);
    expect(banditPose(BANDIT_ENTER_MS + IRON_DROP_MS / 2, true, bp()).ironY).toBeCloseTo(0.5);
    const hit = banditPose(BANDIT_ENTER_MS + IRON_DROP_MS + IRON_CRUMPLE_MS, true, bp());
    expect(hit.crumple).toBe(1);
    expect(hit.xShort).toBeCloseTo(BANDIT_STOP); // nobody walks on
    const end = banditPose(IRON_WALK_MS, true, bp());
    expect(end).toMatchObject({ done: true, alpha: 0 });
    expect(IRON_WALK_MS).toBeLessThan(BANDIT_WALK_MS);
  });

  it('pause beside the tree, not behind it: the tall one (who takes the iron) clear of every tile, the short one\'s head and shoulders too', () => {
    // Figure sizes as drawn: the tall one 1.1 × FIG_H of the window high, 0.42 of that wide, plus a 0.12 h rim glow
    // each side; the short one 0.8 × FIG_H high, 0.6 of that wide; both stand on a track at 0.9 of the window's height.
    for (const [w, h] of [[1280, 800], [412, 839], [390, 844]]) {
      const L = computeLayout(w, h, 2);
      const win = homeWindow(L);
      const figH = FIG_H * win.h;
      const track = win.y + 0.9 * win.h;
      const p = banditPose(BANDIT_ENTER_MS + BANDIT_PAUSE_MS / 2, true, bp());
      /** The tree's left edge (CSS px) across the screen rows y0..y1: the leftmost tile in any row they touch. */
      const treeLeft = (y0: number, y1: number): number => {
        let left = Infinity;
        for (const i of GRID.ids) {
          const [x, y] = tileCenter(L, GRID, i);
          if (y + L.s / 2 > y0 && y - L.s / 2 < y1) left = Math.min(left, x - L.s / 2);
        }
        return left;
      };
      const tallH = 1.1 * figH;
      const tallW = 0.42 * tallH;
      const xt = win.x + p.xTall * win.w;
      expect(xt - tallW / 2 - 0.12 * tallH).toBeGreaterThanOrEqual(win.x);
      expect(xt + tallW / 2).toBeLessThan(treeLeft(track - tallH, track));
      const shortH = 0.8 * figH;
      const xs = win.x + p.xShort * win.w;
      expect(xs + (0.6 * shortH) / 2).toBeLessThan(treeLeft(track - shortH, track - shortH / 2));
    }
  });

  it('come after 20 s with no input, at most once per 60 s; input during a walk does not stop it', () => {
    const t = new BanditTimer();
    let due = 0;
    for (let ms = 0; ms < BANDIT_IDLE_MS - 50; ms += 50) if (t.step(50, false)) due++;
    expect(due).toBe(0);
    t.input(); // a tap just before: the 20 s start over
    for (let ms = 0; ms < BANDIT_IDLE_MS - 50; ms += 50) if (t.step(50, false)) due++;
    expect(due).toBe(0);
    for (let ms = 0; ms < 100; ms += 50) if (t.step(50, false)) due++;
    expect(due).toBe(1);
    // Still idle: the next walk waits for 60 s from the last.
    let at = -1;
    for (let ms = 100; ms < BANDIT_EVERY_MS + 1000; ms += 50) if (t.step(50, false) && at < 0) at = ms;
    expect(at).toBeGreaterThanOrEqual(BANDIT_EVERY_MS - 100);
    // While a walk is under way, nothing new starts.
    const busy = new BanditTimer();
    for (let ms = 0; ms < 200_000; ms += 50) expect(busy.step(50, true)).toBe(false);
  });
});

describe('WindowGags', () => {
  /** A context that logs call names. */
  function recorder(names: string[]): CanvasRenderingContext2D {
    const state: Record<string | symbol, unknown> = { globalAlpha: 1, globalCompositeOperation: 'source-over' };
    return new Proxy(state, {
      get: (t, k) => (k in t ? t[k] : (..._: unknown[]) => (names.push(String(k)), String(k).startsWith('create') ? { addColorStop() {} } : undefined)),
      set: (t, k, v) => ((t[k] = v), true),
    }) as unknown as CanvasRenderingContext2D;
  }

  it('bakes its silhouettes once per layout, then draws them clipped to the glass with no allocation per frame', () => {
    const create = document.createElement.bind(document);
    let made = 0;
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag === 'canvas') made++;
      return create(tag);
    }) as typeof document.createElement);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => recorder([])) as never);
    const L = computeLayout(1280, 800, 2);
    const g = new WindowGags();
    const names: string[] = [];
    g.draw(recorder(names), L, 1, 0, 1000, -1, false);
    const baked = made;
    expect(baked).toBeGreaterThan(0);
    expect(names).toContain('clip');
    expect(names.filter((n) => n === 'drawImage')).toHaveLength(4); // four party figures
    names.length = 0;
    g.draw(recorder(names), L, 1, 0, 1500, 3500, true); // and the bandits, with the iron
    expect(made).toBe(baked);
    expect(names.filter((n) => n === 'drawImage')).toHaveLength(4 + 3);
  });
});
