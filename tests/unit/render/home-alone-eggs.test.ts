// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { GRID } from '../../../src/core/mask';
import { mulberry32 } from '../../../src/core/rng';
import { HomeAloneLayer, type HomeAloneGate } from '../../../src/render/home-alone';
import { homeWindow } from '../../../src/render/home-alone-room';
import {
  BANDIT_IDLE_MS, BANDIT_EVERY_MS, BANDIT_STOP, BEAM_MAX, BEAM_MS, FIRE_MS, MARV_EVERY_MS, MARV_IDLE_MS, MARV_MS, TOOTH_GLINT_AT, TOOTH_GLINT_MS,
  TOOTH_MS, VAN_EVERY, VAN_MS, WINDOW_GAGS, firePose, gagMs, marvBox, marvPose, nextGag, toothPose, vanPose, type FirePose, type MarvPose,
  type ToothPose, type VanPose, type WindowGag,
} from '../../../src/render/home-alone-window';
import { computeLayout, tileCenter } from '../../../src/render/layout';

const L = computeLayout(1280, 800, 2);
const garland = () => ({ geo: { n: 20, size: 14, bulbs: Array.from({ length: 20 }, (_, k) => ({ x: 40 + k * 60, y: 90, angle: 0 })) }, pickLit: vi.fn(() => 3), knock: vi.fn(), unknock: vi.fn() });
const gate = (over: Partial<HomeAloneGate> = {}): HomeAloneGate => ({ running: true, inPlay: true, reduced: false, ...over });
/** Steps the layer `ms` in 50 ms frames from `from`; returns where it stopped. */
const run = (layer: HomeAloneLayer, ms: number, g: HomeAloneGate, from = 0): number => {
  for (let t = from; t < from + ms; t += 50) layer.step(t, 50, g, L);
  return from + ms;
};
const tp = (): ToothPose => ({ x: 0, dir: 1, front: 0, grin: 0, glint: -1, done: false });
const fp = (): FirePose => ({ x: 0, crouch: 0, dive: -1, rot: 0, fwd: 0, rise: 0, flame: 0, steam: -1, done: false });
const mp = (): MarvPose => ({ enter: 0, press: 1, contact: 0, fog: 0, fogAlpha: 0, drop: 0, done: false });
const vp = (): VanPose => ({ x: 0, beam: -1, done: false });

describe('the window rotation (spec §9.1)', () => {
  it('never plays the same gag twice running, and plays each of them', () => {
    const seen = new Set<WindowGag>();
    for (const last of [null, ...WINDOW_GAGS])
      for (let r = 0; r < 1; r += 0.01) {
        const g = nextGag(last, r);
        expect(g).not.toBe(last);
        seen.add(g);
      }
    expect([...seen].sort()).toEqual([...WINDOW_GAGS].sort());
  });

  it('each idle trigger plays one gag, never the last one again; the iron only ever on a walk-by', () => {
    const layer = new HomeAloneLayer(garland(), mulberry32(7));
    const played: WindowGag[] = [];
    let t = 0;
    let was: WindowGag | null = null;
    while (played.length < 12 && t < 3_600_000) {
      layer.step(t, 50, gate({ inPlay: false }), L);
      t += 50;
      const s = layer.state();
      if (s.gag && s.gag !== was) played.push(s.gag);
      if (s.iron) expect(s.gag).toBe('walk');
      was = s.gag;
    }
    expect(played).toHaveLength(12);
    for (let k = 1; k < played.length; k++) expect(played[k]).not.toBe(played[k - 1]);
    expect(new Set(played).size).toBe(3);
  });

  it('a forced gag counts as the last: the next idle one is a different gag, BANDIT_EVERY_MS later', () => {
    for (const kind of ['tooth', 'fire', 'bandits'] as const) {
      const layer = new HomeAloneLayer(garland(), mulberry32(3));
      layer.force(kind, 0, L);
      const first = layer.state().gag;
      expect(first).toBe(kind === 'bandits' ? 'walk' : kind);
      let t = 0;
      let next: WindowGag | null = null;
      let at = -1;
      while (t < BANDIT_EVERY_MS + 5000) {
        const busy = layer.state().gag !== null;
        layer.step(t, 50, gate({ inPlay: false }), L);
        if (!busy && layer.state().gag) {
          next = layer.state().gag;
          at = t;
          break;
        }
        t += 50;
      }
      expect(next).not.toBeNull();
      expect(next).not.toBe(first);
      expect(at).toBeGreaterThanOrEqual(BANDIT_EVERY_MS - 100);
    }
  });

  it('every gag ends by itself', () => {
    for (const g of WINDOW_GAGS) expect(gagMs(g, false)).toBeGreaterThan(3000);
    for (const kind of ['tooth', 'fire'] as const) {
      const layer = new HomeAloneLayer(garland(), mulberry32(3));
      layer.input();
      layer.force(kind, 0, L);
      run(layer, (kind === 'tooth' ? TOOTH_MS : FIRE_MS) + 100, gate({ inPlay: false }));
      expect(layer.state().gag).toBeNull();
    }
  });
});

describe('the gold tooth', () => {
  it('Harry walks in to the stop beside the tree, turns to the room, grins, glints for ~0.6 s, turns away and leaves', () => {
    expect(toothPose(0, tp()).x).toBeLessThan(0);
    const turned = toothPose(TOOTH_GLINT_AT, tp());
    expect(turned.x).toBeCloseTo(BANDIT_STOP);
    expect(turned.front).toBe(1);
    expect(turned.grin).toBe(1);
    expect(toothPose(TOOTH_GLINT_AT - 1, tp()).glint).toBe(-1);
    expect(toothPose(TOOTH_GLINT_AT + TOOTH_GLINT_MS / 2, tp()).glint).toBeCloseTo(0.5);
    expect(toothPose(TOOTH_GLINT_AT + TOOTH_GLINT_MS + 1, tp()).glint).toBe(-1);
    expect(TOOTH_GLINT_MS).toBeGreaterThanOrEqual(500);
    expect(TOOTH_GLINT_MS).toBeLessThanOrEqual(700);
    const end = toothPose(TOOTH_MS, tp());
    expect(end).toMatchObject({ done: true, front: 0, grin: 0 });
    expect(end.x).toBeLessThan(-0.1); // gone back off the glass
  });

  it('dings once per grin, as the glint starts; a paused or hidden game freezes it (no ding), reduced motion has none', () => {
    const layer = new HomeAloneLayer(garland(), mulberry32(3));
    const ding = vi.fn();
    layer.onDing = ding;
    layer.force('tooth', 0, L);
    run(layer, TOOTH_GLINT_AT - 100, gate());
    expect(ding).not.toHaveBeenCalled();
    run(layer, 5000, gate({ running: false }), TOOTH_GLINT_AT - 100); // paused: frozen
    expect(ding).not.toHaveBeenCalled();
    expect(layer.state().tooth).toBe(true);
    run(layer, 200, gate(), TOOTH_GLINT_AT);
    expect(ding).toHaveBeenCalledTimes(1);
    expect(layer.state().dings).toBe(1);
    run(layer, TOOTH_MS, gate(), TOOTH_GLINT_AT + 200);
    expect(ding).toHaveBeenCalledTimes(1);
    expect(layer.state().tooth).toBe(false);

    const still = new HomeAloneLayer(garland(), mulberry32(3));
    still.onDing = ding;
    still.force('tooth', 0, L);
    run(still, TOOTH_MS, gate({ reduced: true }));
    expect(ding).toHaveBeenCalledTimes(1);
    expect(still.state().tooth).toBe(false);
  });
});

describe('the hat on fire', () => {
  it('Harry sprints in from the far side, crouches, then dives head first into the snow below the track; steam rises and fades', () => {
    const p0 = firePose(0, fp());
    expect(p0.x).toBeGreaterThan(1); // off the glass, the far side from the stop
    expect(p0.flame).toBe(1);
    let crouched = -1;
    let dived = -1;
    let prevX = p0.x;
    for (let t = 0; t <= FIRE_MS; t += 10) {
      const p = firePose(t, fp());
      if (p.dive < 0) {
        expect(p.x).toBeLessThanOrEqual(prevX + 1e-9); // always toward the stop side
        prevX = p.x;
      }
      if (crouched < 0 && p.crouch >= 1) crouched = t;
      if (dived < 0 && p.dive >= 0) dived = t;
    }
    expect(crouched).toBeGreaterThan(0);
    expect(dived).toBeGreaterThanOrEqual(crouched); // anticipation first
    const landed = firePose(dived, fp());
    expect(landed.x).toBeLessThan(BANDIT_STOP); // beside the tree, on the stop side
    // At the end of the dive the whole of him (his centre ~0.5 of his height, his length 1) is under the snow.
    let p = firePose(dived, fp());
    for (let t = dived; p.dive >= 0 && p.dive < 1; t += 10) p = firePose(t, fp());
    expect(p.rise).toBeLessThan(-1.0);
    expect(p.rot).toBeGreaterThan(1.5); // head first
    // Steam: rises after he goes in, and is gone by the end.
    expect(firePose(dived, fp()).steam).toBe(-1);
    expect(firePose(FIRE_MS - 400, fp()).steam).toBeGreaterThan(0.5);
    expect(firePose(FIRE_MS, fp())).toMatchObject({ done: true });
  });
});

describe('Marv at the glass (spec §9.2)', () => {
  it('leans in, presses with a little overshoot, fogs the glass over ~1 s, holds ~1.5 s, slides down; the fog fades over ~2 s', () => {
    const peak = Math.max(...Array.from({ length: 60 }, (_, k) => marvPose(k * 20, mp()).press));
    expect(peak).toBeGreaterThan(1.02); // the overshoot
    let bloomed = -1;
    let dropping = -1;
    let gone = -1;
    for (let t = 0; t <= MARV_MS; t += 10) {
      const p = marvPose(t, mp());
      if (bloomed < 0 && p.fog >= 0.999) bloomed = t;
      if (dropping < 0 && p.drop > 0) dropping = t;
      if (gone < 0 && p.drop >= 1) gone = t;
    }
    const start = Array.from({ length: 200 }, (_, k) => k * 10).find((t) => marvPose(t, mp()).fog > 0) ?? -1;
    expect(bloomed - start).toBeGreaterThanOrEqual(800);
    expect(bloomed - start).toBeLessThanOrEqual(1200);
    expect(dropping - bloomed).toBeGreaterThanOrEqual(1300); // the hold
    expect(dropping - bloomed).toBeLessThanOrEqual(1700);
    expect(marvPose(dropping, mp()).fogAlpha).toBeCloseTo(1, 1);
    // The fog outlasts him on the glass and fades over ~2 s.
    expect(marvPose(gone, mp()).fogAlpha).toBeGreaterThan(0.3);
    expect(MARV_MS - dropping).toBeGreaterThanOrEqual(1800);
    expect(marvPose(MARV_MS, mp())).toMatchObject({ done: true, fogAlpha: 0 });
  });

  it('comes after 60 s idle, at most once per 3 min, and input during it does not stop it', () => {
    const layer = new HomeAloneLayer(garland(), mulberry32(5));
    let t = 0;
    let first = -1;
    while (t < MARV_IDLE_MS + 30_000 && first < 0) {
      layer.step(t, 50, gate({ inPlay: false }), L);
      t += 50;
      if (layer.state().marv) first = t;
    }
    expect(first).toBeGreaterThanOrEqual(MARV_IDLE_MS);
    for (let k = 0; k < 40; k++) {
      layer.input();
      layer.step(t, 50, gate({ inPlay: false }), L);
      t += 50;
    }
    expect(layer.state().marv).toBe(true);
    // Still idle from here on: the next is at least 3 min after the first.
    let second = -1;
    while (t < first + MARV_EVERY_MS + 120_000 && second < 0) {
      const was = layer.state().marv;
      layer.step(t, 50, gate({ inPlay: false }), L);
      t += 50;
      if (!was && layer.state().marv) second = t;
    }
    expect(second - first).toBeGreaterThanOrEqual(MARV_EVERY_MS - 100);
    expect(MARV_IDLE_MS).toBe(60_000);
    expect(MARV_EVERY_MS).toBe(180_000);
  });

  it('input keeps him away; he never plays at the same time as a rotation gag and does not count toward the rotation', () => {
    const busy = new HomeAloneLayer(garland(), mulberry32(5));
    for (let t = 0; t < 300_000; t += 50) {
      if (t % 30_000 === 0) busy.input();
      busy.step(t, 50, gate(), L);
      expect(busy.state().marv).toBe(false);
    }
    const layer = new HomeAloneLayer(garland(), mulberry32(9));
    const order: string[] = [];
    let was = '';
    for (let t = 0; t < 400_000; t += 50) {
      layer.step(t, 50, gate({ inPlay: false }), L);
      const s = layer.state();
      expect(s.marv && s.gag !== null).toBe(false);
      const now = s.marv ? 'marv' : (s.gag ?? '');
      if (now && now !== was) order.push(now);
      was = now;
    }
    expect(order).toContain('marv');
    const gags = order.filter((g) => g !== 'marv');
    for (let k = 1; k < gags.length; k++) expect(gags[k]).not.toBe(gags[k - 1]);
  });

  it('presses on the side pane away from the trunk: face and hands clear of every tile', () => {
    for (const [w, h] of [[1280, 800], [412, 839], [390, 844], [1440, 900], [768, 1024]]) {
      const LL = computeLayout(w, h, 2);
      const win = homeWindow(LL);
      const b = marvBox(LL);
      expect(b.x0).toBeGreaterThan(LL.ox); // the right-hand side
      expect((b.x0 + b.x1) / 2).toBeGreaterThan(win.x + (3 * win.w) / 4); // centred on the outer pane
      expect(b.y0).toBeGreaterThanOrEqual(win.y);
      for (const i of GRID.ids) {
        const [x, y] = tileCenter(LL, GRID, i);
        const clear = x + LL.s / 2 <= b.x0 || x - LL.s / 2 >= b.x1 || y + LL.s / 2 <= b.y0 || y - LL.s / 2 >= b.y1;
        expect(clear, `${w}×${h} tile ${i}`).toBe(true);
      }
    }
  });

  it('reduced motion: never; forced, he shows', () => {
    const still = new HomeAloneLayer(garland(), mulberry32(5));
    run(still, 400_000, gate({ reduced: true, inPlay: false }));
    expect(still.state().marv).toBe(false);
    const layer = new HomeAloneLayer(garland(), mulberry32(5));
    expect(layer.force('marv', 0, L)).toBe(true);
    expect(layer.state().marv).toBe(true);
    run(layer, MARV_MS + 100, gate());
    expect(layer.state().marv).toBe(false);
  });
});

describe('the Oh-K Plumbing van (spec §9.3)', () => {
  it('crosses the street in ~6 s; the headlight beam sweeps the room for ~1.5 s as it passes the middle, never over 0.25', () => {
    expect(VAN_MS).toBeGreaterThanOrEqual(5000);
    expect(VAN_MS).toBeLessThanOrEqual(7000);
    const a = vanPose(0, vp());
    const b = vanPose(VAN_MS, vp());
    expect(a.x).toBeLessThan(-0.1);
    expect(b).toMatchObject({ done: true });
    expect(b.x).toBeGreaterThan(1.1);
    let on = 0;
    let first = -1;
    for (let t = 0; t <= VAN_MS; t += 10) {
      const p = vanPose(t, vp());
      if (p.beam >= 0) {
        on += 10;
        if (first < 0) first = t;
      }
    }
    expect(on).toBeGreaterThanOrEqual(BEAM_MS - 20);
    expect(on).toBeLessThanOrEqual(BEAM_MS + 20);
    expect(BEAM_MS).toBe(1500);
    // Centred on the van crossing the window's middle.
    expect(vanPose(first + BEAM_MS / 2, vp()).x).toBeCloseTo(0.5, 1);
    expect(BEAM_MAX).toBeLessThanOrEqual(0.25);
  });

  it('every 2–4 min while a tree is in play; never before the first move, after the win, paused or under reduced motion', () => {
    for (const seed of [1, 2, 3]) {
      const layer = new HomeAloneLayer(garland(), mulberry32(seed));
      let t = 0;
      let at = -1;
      while (t < VAN_EVERY[1] + 1000 && at < 0) {
        layer.input(); // no idle gags in the way
        layer.step(t, 50, gate(), L);
        t += 50;
        if (layer.state().van) at = t;
      }
      expect(at).toBeGreaterThanOrEqual(VAN_EVERY[0]);
      expect(at).toBeLessThanOrEqual(VAN_EVERY[1] + 50);
    }
    for (const g of [gate({ inPlay: false }), gate({ running: false }), gate({ reduced: true })]) {
      const layer = new HomeAloneLayer(garland(), mulberry32(4));
      for (let t = 0; t < 600_000; t += 50) {
        layer.step(t, 50, g, L);
        expect(layer.state().van).toBe(false);
      }
    }
  });

  it('a win mid-crossing clears it (and its beam) at once', () => {
    const layer = new HomeAloneLayer(garland(), mulberry32(4));
    expect(layer.force('van', 0, L)).toBe(true);
    run(layer, VAN_MS / 2, gate());
    expect(layer.state()).toMatchObject({ van: true, beam: true });
    layer.step(VAN_MS, 50, gate({ inPlay: false }), L);
    expect(layer.state()).toMatchObject({ van: false, beam: false });
  });
});

describe('frozen while paused', () => {
  it('nothing in the window moves on while the game is paused', () => {
    const layer = new HomeAloneLayer(garland(), mulberry32(4));
    layer.force('fire', 0, L);
    layer.force('marv', 0, L);
    layer.force('van', 0, L);
    run(layer, 1000, gate());
    run(layer, 600_000, gate({ running: false }), 1000);
    expect(layer.state()).toMatchObject({ fire: true, marv: true, van: true });
    expect(BANDIT_IDLE_MS).toBeLessThan(BANDIT_EVERY_MS);
  });
});
