// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BANDIT_ENTER_MS, BANDIT_FIG, FIG_PAD, FIG_TRACK, BANDIT_PAUSE_MS, BANDIT_STOP, BANDIT_WALK_MS, GAG_EVERY, GAG_FIRST_MS, GagClock, MARV_EVERY, MARV_GAP_MS, MARV_IDLE_MS, MarvClock, WELCOME_MS, FIG_H, FIRE_DIVE_AT, FIRE_MS, IRON_DROP_MS, IRON_CRUMPLE_MS, IRON_WALK_MS, TOOTH_GLINT_AT, WindowGags, banditPose, type BanditPose, type GagFrame,
} from '../../../src/render/home-alone-window';
import { GRID } from '../../../src/core/mask';
import { homeWindow } from '../../../src/render/home-alone-room';
import { computeLayout, tileCenter } from '../../../src/render/layout';

afterEach(() => vi.restoreAllMocks());

const bp = (): BanditPose => ({ xShort: 0, xTall: 0, ironY: 0, crumple: 0, alpha: 0, done: false });

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
    // Figure sizes as drawn (BANDIT_FIG): each one's height a multiple of FIG_H of the window, its width a fraction of
    // that, plus a FIG_PAD rim glow each side; both stand on the track at FIG_TRACK of the window's height.
    for (const [w, h] of [[1280, 800], [412, 839], [390, 844]]) {
      const L = computeLayout(w, h, 2);
      const win = homeWindow(L);
      const figH = FIG_H * win.h;
      const track = win.y + FIG_TRACK * win.h;
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
      const tallH = BANDIT_FIG.tall.scale * figH;
      const tallW = BANDIT_FIG.tall.aspect * tallH;
      const xt = win.x + p.xTall * win.w;
      expect(xt - tallW / 2 - FIG_PAD * tallH).toBeGreaterThanOrEqual(win.x);
      expect(xt + tallW / 2).toBeLessThan(treeLeft(track - tallH, track));
      const shortH = BANDIT_FIG.short.scale * figH;
      const xs = win.x + p.xShort * win.w;
      expect(xs + (BANDIT_FIG.short.aspect * shortH) / 2).toBeLessThan(treeLeft(track - shortH, track - shortH / 2));
    }
  });

});

/** Steps `clock` in 50 ms frames until it says something (or `max` ms); returns [when, what]. */
function until(clock: GagClock, max: number, gag = false, glass = false, inPlay = true): [number, 'welcome' | 'next' | null] {
  for (let ms = 50; ms <= max; ms += 50) {
    const due = clock.step(50, gag, glass, inPlay);
    if (due) return [ms, due];
  }
  return [-1, null];
}

describe('the rotation clock (spec §9.1)', () => {
  it('the numbers: a welcome walk 3 s after switching on, the first gag 8 s into play, then one every 25–40 s', () => {
    expect(WELCOME_MS).toBe(3000);
    expect(GAG_FIRST_MS).toBe(8000);
    expect(GAG_EVERY).toEqual([25_000, 40_000]);
  });

  it('a page load in the mode: nothing before the first move, however long; the first gag 8 s of play after it, idle or not', () => {
    const c = new GagClock(() => 0.5);
    expect(until(c, 300_000, false, false, false)).toEqual([-1, null]);
    expect(until(c, 20_000)).toEqual([GAG_FIRST_MS, 'next']);
  });

  it('each next gag GAG_EVERY after the last one ended: only play time with no gag under way counts; it waits for Marv', () => {
    for (const [r, gap] of [[0, GAG_EVERY[0]], [0.5, (GAG_EVERY[0] + GAG_EVERY[1]) / 2], [0.999, GAG_EVERY[1]]] as const) {
      const c = new GagClock(() => r);
      c.started();
      expect(until(c, 600_000, true)).toEqual([-1, null]); // a gag under way: the clock stands still
      expect(until(c, 600_000, false, false, false)).toEqual([-1, null]); // between trees, or won: it stands still
      const [at, due] = until(c, 60_000);
      expect(due).toBe('next');
      expect(Math.abs(at - gap)).toBeLessThanOrEqual(50);
    }
    const c = new GagClock(() => 0);
    c.started();
    expect(until(c, GAG_EVERY[0] + 5000, false, true)).toEqual([-1, null]); // Marv at the glass: it waits for him
    expect(until(c, 100)).toEqual([50, 'next']);
  });

  it('welcome(): the walk-by WELCOME_MS later, before any move; it waits for the glass; a gag that starts first, or reset, drops it', () => {
    const c = new GagClock(() => 0.5);
    c.welcome();
    expect(until(c, 10_000, false, false, false)).toEqual([WELCOME_MS, 'welcome']);
    const busy = new GagClock(() => 0.5);
    busy.welcome();
    expect(until(busy, 10_000, false, true, false)).toEqual([-1, null]);
    expect(until(busy, 100, false, false, false)).toEqual([50, 'welcome']);
    const forced = new GagClock(() => 0.5);
    forced.welcome();
    forced.started();
    expect(until(forced, 10_000, false, false, false)).toEqual([-1, null]);
    const gone = new GagClock(() => 0.5);
    gone.started();
    gone.welcome();
    gone.reset(); // the house went: no welcome, and the next visit starts at GAG_FIRST_MS of play
    expect(until(gone, 20_000)).toEqual([GAG_FIRST_MS, 'next']);
  });
});

describe("Marv's clock (spec §9.2)", () => {
  it('the numbers: after 25 s idle, or else every 2–3 min of play; never within 90 s of the last', () => {
    expect(MARV_IDLE_MS).toBe(25_000);
    expect(MARV_GAP_MS).toBe(90_000);
    expect(MARV_EVERY).toEqual([120_000, 180_000]);
  });

  /** ms (in 50 ms frames) until he is due, with input every `inputEvery` ms (0: none); −1: not within `max`. */
  const due = (m: MarvClock, max: number, inPlay: boolean, inputEvery = 0, glass = false): number => {
    for (let ms = 50; ms <= max; ms += 50) {
      if (inputEvery && ms % inputEvery === 0) m.input();
      if (m.step(50, glass, inPlay)) return ms;
    }
    return -1;
  };

  it('idle (in play or not): after 25 s with no input, then at most once per 90 s', () => {
    for (const inPlay of [false, true]) {
      const m = new MarvClock(() => 0.999);
      expect(due(m, MARV_IDLE_MS - 50, inPlay)).toBe(-1);
      m.input(); // a tap just before: the 25 s start over
      expect(due(m, MARV_IDLE_MS + 1000, inPlay)).toBe(MARV_IDLE_MS);
      m.started();
      expect(due(m, MARV_GAP_MS + 1000, inPlay)).toBe(MARV_GAP_MS);
    }
  });

  it('a busy player still gets him every 2–3 min of play (only play time counts); never with a gag at the glass', () => {
    for (const [r, every] of [[0, MARV_EVERY[0]], [0.999, MARV_EVERY[1]]] as const) {
      const m = new MarvClock(() => r);
      expect(due(m, 600_000, false, 5000)).toBe(-1); // off play, never idle: never
      const at = due(m, 400_000, true, 5000);
      expect(Math.abs(at - every)).toBeLessThanOrEqual(50);
    }
    const m = new MarvClock(() => 0);
    expect(due(m, 400_000, true, 0, true)).toBe(-1);
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

  const frame = (over: Partial<GagFrame> = {}): GagFrame => ({ gag: null, t: -1, iron: false, marvT: -1, vanT: -1, vanDir: 1, ...over });

  it('bakes its sprites once per layout, then draws every gag clipped to the glass with no allocation per frame', () => {
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
    g.draw(recorder(names), L, 1, frame());
    const baked = made;
    expect(baked).toBeGreaterThan(0);
    expect(names).toContain('clip');
    expect(names.filter((n) => n === 'drawImage')).toHaveLength(0); // nothing at the glass
    for (const f of [
      frame({ gag: 'walk', t: 1500 }), frame({ gag: 'walk', t: 3500, iron: true }), frame({ gag: 'tooth', t: TOOTH_GLINT_AT + 200 }),
      frame({ gag: 'tooth', t: 1000 }), frame({ gag: 'fire', t: 1000 }), frame({ gag: 'fire', t: FIRE_DIVE_AT + 300 }), frame({ gag: 'fire', t: FIRE_MS - 1500 }),
      frame({ marvT: 2000 }), frame({ vanT: 3000 }),
    ]) {
      names.length = 0;
      g.draw(recorder(names), L, 1, f);
      g.drawBeam(recorder(names), L, 1, f);
      expect(made).toBe(baked);
      expect(names.filter((n) => n === 'drawImage').length).toBeGreaterThan(0);
      expect(names.filter((n) => n.startsWith('create'))).toEqual([]); // no gradients, no canvases
    }
    names.length = 0;
    g.drawBeam(recorder(names), L, 1, frame({ vanT: 3000 }));
    expect(names).toContain('drawImage');
    names.length = 0;
    g.drawBeam(recorder(names), L, 1, frame({ vanT: 500 })); // the van still far off: no beam yet
    expect(names).not.toContain('drawImage');
  });

  it("puts the mullions back over the figures at the layer's alpha (mid cross-fade, a bandit fading, Marv and the van there too), then alpha 1", () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => recorder([])) as never);
    const state: Record<string | symbol, unknown> = { globalAlpha: 1, globalCompositeOperation: 'source-over' };
    const bars: number[] = [];
    const c = new Proxy(state, {
      get: (t, k) => (k in t ? t[k] : k === 'fillRect' ? () => bars.push(t.globalAlpha as number) : () => (String(k).startsWith('create') ? { addColorStop() {} } : undefined)),
      set: (t, k, v) => ((t[k] = v), true),
    }) as unknown as CanvasRenderingContext2D;
    new WindowGags().draw(c, computeLayout(1280, 800, 2), 0.4, { gag: 'walk', t: IRON_WALK_MS - 100, iron: true, marvT: 2000, vanT: 3000, vanDir: -1 });
    expect(bars.length).toBeGreaterThan(0);
    for (const a of bars) expect(a).toBeCloseTo(0.4);
    expect(state.globalAlpha).toBe(1);
  });
});
