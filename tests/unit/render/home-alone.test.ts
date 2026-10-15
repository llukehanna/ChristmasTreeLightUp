// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { mulberry32 } from '../../../src/core/rng';
import { FADE_MS } from '../../../src/render/aurora';
import { PAINT_IN_MS } from '../../../src/render/home-alone-traps';
import { BANDIT_EVERY_MS, BANDIT_IDLE_MS, BANDIT_WALK_MS, IRON_WALK_MS } from '../../../src/render/home-alone-window';
import { HomeAloneLayer, homeAloneAlpha, type HomeAloneGate } from '../../../src/render/home-alone';
import { computeLayout } from '../../../src/render/layout';
import { HOME_ALONE, SCENES } from '../../../src/render/scenes';

const L = computeLayout(1280, 800, 2);
const garland = () => ({ geo: { n: 20, size: 14, bulbs: Array.from({ length: 20 }, (_, k) => ({ x: 40 + k * 60, y: 90, angle: 0 })) }, pickLit: vi.fn(() => 3), knock: vi.fn(), unknock: vi.fn() });
const gate = (over: Partial<HomeAloneGate> = {}): HomeAloneGate => ({ running: true, inPlay: true, reduced: false, ...over });
const run = (layer: HomeAloneLayer, ms: number, g: HomeAloneGate, from = 0) => {
  for (let t = from; t < from + ms; t += 50) layer.step(t, 50, g, L);
};

describe('homeAloneAlpha', () => {
  it('full in the house, faded with the cross-fade either way, never during the head\'s sweep or elsewhere', () => {
    expect(homeAloneAlpha(HOME_ALONE, null, null)).toBe(1);
    expect(homeAloneAlpha(SCENES.fireside, null, null)).toBe(0);
    expect(homeAloneAlpha(HOME_ALONE, { kind: 'fade', fromScene: SCENES.midnight }, { alpha: 0.3 })).toBeCloseTo(0.3);
    expect(homeAloneAlpha(SCENES.midnight, { kind: 'fade', fromScene: HOME_ALONE }, { alpha: 0.3 })).toBeCloseTo(0.7);
    expect(homeAloneAlpha(HOME_ALONE, { kind: 'sweep', fromScene: SCENES.midnight }, { alpha: 1 })).toBe(0);
    expect(FADE_MS).toBeGreaterThan(0);
  });
});

describe('HomeAloneLayer: the window', () => {
  it('under reduced motion the room stays still: no gag ever', () => {
    const still = new HomeAloneLayer(garland(), mulberry32(1));
    run(still, 400_000, gate({ reduced: true }));
    expect(still.state()).toMatchObject({ gag: null, bandits: false, marv: false, van: false });
  });

  it('a window gag comes after 20 s idle (in play or not), and ends by itself', () => {
    const layer = new HomeAloneLayer(garland(), () => 0.9); // never the iron
    run(layer, BANDIT_IDLE_MS + 100, gate({ inPlay: false }));
    expect(layer.state().gag).not.toBeNull();
    expect(layer.state().iron).toBe(false);
    run(layer, BANDIT_WALK_MS + 100, gate({ inPlay: false }), BANDIT_IDLE_MS + 100);
    expect(layer.state().gag).toBeNull();
  });

  it('input keeps them away', () => {
    const layer = new HomeAloneLayer(garland(), () => 0.9);
    for (let t = 0; t < 60_000; t += 50) {
      if (t % 10_000 === 0) layer.input();
      layer.step(t, 50, gate(), L);
    }
    expect(layer.state().bandits).toBe(false);
  });

  it('about 1 walk in 4 brings the iron, which ends it early; force starts either now; reset clears a walk', () => {
    const layer = new HomeAloneLayer(garland(), () => 0.1); // under IRON_ODDS
    run(layer, BANDIT_IDLE_MS + 100, gate());
    expect(layer.state()).toEqual(expect.objectContaining({ bandits: true, iron: true }));
    run(layer, IRON_WALK_MS + 100, gate(), BANDIT_IDLE_MS + 100);
    expect(layer.state().bandits).toBe(false);
    expect(layer.force('bandits', 0, L)).toBe(true);
    expect(layer.state()).toEqual(expect.objectContaining({ bandits: true, iron: false }));
    layer.reset();
    expect(layer.state().bandits).toBe(false);
    expect(layer.force('iron', 0, L)).toBe(true);
    expect(layer.state().iron).toBe(true);
  });

  it('input during a gag does not stop it', () => {
    const layer = new HomeAloneLayer(garland(), () => 0.9);
    run(layer, BANDIT_IDLE_MS + 100, gate());
    const gag = layer.state().gag;
    expect(gag).not.toBeNull();
    for (let t = 0; t < 2000; t += 50) {
      layer.input();
      layer.step(t, 50, gate(), L);
    }
    expect(layer.state().gag).toBe(gag);
  });

  it('reduced motion turned on mid-walk ends the walk', () => {
    const layer = new HomeAloneLayer(garland(), () => 0.9);
    layer.force('iron', 0, L);
    run(layer, 1000, gate());
    run(layer, 50, gate({ reduced: true }), 1000);
    expect(layer.state()).toEqual(expect.objectContaining({ bandits: false, iron: false }));
  });

  it('a forced walk counts as the last one: no idle walk follows it within BANDIT_EVERY_MS', () => {
    const layer = new HomeAloneLayer(garland(), () => 0.9);
    run(layer, BANDIT_IDLE_MS - 1000, gate()); // idle, not yet due
    layer.force('bandits', 0, L);
    let next = -1;
    for (let t = 0; t < BANDIT_EVERY_MS + 1000 && next < 0; t += 50) {
      const was = layer.state().gag;
      layer.step(t, 50, gate(), L);
      if (!was && layer.state().gag) next = t;
    }
    expect(next).toBeGreaterThanOrEqual(BANDIT_EVERY_MS - 100);
  });

  it('draws nothing under reduced motion', () => {
    const layer = new HomeAloneLayer(garland());
    const c = { save: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
    layer.drawWindow(c, L, 1, true);
    expect(c.save).not.toHaveBeenCalled();
  });
});

describe('HomeAloneLayer: the traps', () => {
  it('none before the first move, after the win, while paused, or under reduced motion', () => {
    for (const g of [gate({ inPlay: false }), gate({ running: false }), gate({ reduced: true })]) {
      const knock = garland();
      const layer = new HomeAloneLayer(knock, mulberry32(4));
      for (let t = 0; t < 300_000; t += 50) {
        layer.step(t, 50, g, L);
        expect(layer.state()).toMatchObject({ paint: false, tarantula: null });
      }
      expect(knock.knock).not.toHaveBeenCalled();
    }
  });

  it('in play the paint can comes within 90 s and knocks the bulb it picked as it arrives', () => {
    const knock = garland();
    const layer = new HomeAloneLayer(knock, mulberry32(4));
    let t = 0;
    while (!layer.state().paint && t < 91_000) {
      layer.step(t, 50, gate(), L);
      t += 50;
    }
    expect(layer.state().paint).toBe(true);
    const started = t;
    while (!knock.knock.mock.calls.length && t < started + 2000) {
      layer.step(t, 50, gate(), L);
      t += 50;
    }
    expect(knock.knock).toHaveBeenCalledWith(3, expect.any(Number));
    expect(t - started).toBeGreaterThanOrEqual(PAINT_IN_MS - 50);
  });

  it('in play the tarantula comes within 120 s', () => {
    const layer = new HomeAloneLayer(garland(), mulberry32(4));
    let t = 0;
    while (layer.state().tarantula === null && t < 121_000) {
      layer.step(t, 50, gate(), L);
      t += 50;
    }
    expect(layer.state().tarantula).toBe('crawl');
  });

  it('a win mid-trap clears both at once', () => {
    const layer = new HomeAloneLayer(garland(), mulberry32(4));
    expect(layer.force('paint', 0, L)).toBe(true);
    expect(layer.force('tarantula', 0, L, [600, 400])).toBe(true);
    layer.step(50, 50, gate(), L);
    expect(layer.state()).toMatchObject({ paint: true, tarantula: 'crawl', tarantulaAt: [expect.any(Number), expect.any(Number)] });
    layer.step(100, 50, gate({ inPlay: false }), L);
    expect(layer.state()).toMatchObject({ paint: false, tarantula: null, tarantulaAt: null });
  });

  it('a win or a reset mid-knock also brings the knocked bulb back at once: nothing sputters into the win blaze', () => {
    const knock = garland();
    const layer = new HomeAloneLayer(knock, mulberry32(4));
    layer.force('paint', 0, L);
    for (let t = 0; t <= PAINT_IN_MS; t += 50) layer.step(t, 50, gate(), L);
    expect(knock.knock).toHaveBeenCalledTimes(1);
    expect(knock.unknock).not.toHaveBeenCalled();
    layer.step(PAINT_IN_MS + 100, 50, gate({ inPlay: false }), L); // the win
    expect(knock.unknock).toHaveBeenCalled();
    knock.unknock.mockClear();
    layer.reset();
    expect(knock.unknock).toHaveBeenCalledTimes(1);
  });

  it('reduced motion turned on mid-trap cancels both at once, and the knock with them', () => {
    const knock = garland();
    const layer = new HomeAloneLayer(knock, mulberry32(4));
    layer.force('paint', 0, L);
    layer.force('tarantula', 0, L, [600, 400]);
    layer.step(50, 50, gate(), L);
    expect(layer.state()).toMatchObject({ paint: true, tarantula: 'crawl' });
    layer.step(100, 50, gate({ reduced: true }), L);
    expect(layer.state()).toMatchObject({ paint: false, tarantula: null, tarantulaAt: null });
    expect(knock.unknock).toHaveBeenCalled();
    // And none comes back while it stays on.
    for (let t = 150; t < 300_000; t += 50) layer.step(t, 50, gate({ reduced: true }), L);
    expect(layer.state()).toMatchObject({ paint: false, tarantula: null });
  });

  it('a tap near the tarantula scares it and says so; the layer never swallows the tap', () => {
    const layer = new HomeAloneLayer(garland(), mulberry32(4));
    layer.force('tarantula', 0, L, [600, 400]);
    expect(layer.scare(900, 400)).toBe(false);
    expect(layer.scare(610, 405)).toBe(true);
    expect(layer.state().tarantula).toBe('scurry');
  });

  it('forcing the paint can with nothing lit still swings at the middle bulb', () => {
    const knock = { ...garland(), pickLit: vi.fn(() => -1) };
    const layer = new HomeAloneLayer(knock, mulberry32(4));
    expect(layer.force('paint', 0, L)).toBe(true);
    for (let t = 0; t <= PAINT_IN_MS; t += 50) layer.step(t, 50, gate(), L);
    expect(knock.knock).toHaveBeenCalledWith(10, expect.any(Number));
  });
});
