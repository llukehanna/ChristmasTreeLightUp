// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { mulberry32 } from '../../../src/core/rng';
import { FADE_MS } from '../../../src/render/aurora';
import { PAINT_EVERY, PAINT_IN_MS, TARANTULA_EVERY } from '../../../src/render/home-alone-traps';
import { BANDIT_WALK_MS, GAG_EVERY, GAG_FIRST_MS, IRON_WALK_MS, WELCOME_MS, gagMs } from '../../../src/render/home-alone-window';
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

  it('a page load in the mode: no gag before the first move; the first 8 s of play after it; it ends by itself', () => {
    const layer = new HomeAloneLayer(garland(), () => 0.9); // never the iron
    for (let t = 0; t < 300_000; t += 50) {
      layer.step(t, 50, gate({ inPlay: false }), L);
      expect(layer.state().gag).toBeNull();
    }
    run(layer, GAG_FIRST_MS - 100, gate());
    expect(layer.state().gag).toBeNull();
    run(layer, 200, gate());
    expect(layer.state().gag).not.toBeNull();
    expect(layer.state().iron).toBe(false);
    run(layer, BANDIT_WALK_MS + 100, gate());
    expect(layer.state().gag).toBeNull();
  });

  it('a busy player sees them: input never keeps them away, one every 25–40 s after the last ended', () => {
    const layer = new HomeAloneLayer(garland(), mulberry32(11));
    const starts: number[] = [];
    const ends: number[] = [];
    let was: string | null = null;
    for (let t = 0; t < 600_000; t += 50) {
      if (t % 1000 === 0) layer.input();
      layer.step(t, 50, gate(), L);
      const now = layer.state().gag;
      if (now && !was) starts.push(t + 50);
      if (!now && was) ends.push(t + 50);
      was = now;
    }
    expect(starts[0]).toBeLessThanOrEqual(GAG_FIRST_MS + 50);
    // Over 10 min of play: at least one every 47 s (the longest wait, plus the longest gag), give or take Marv.
    expect(starts.length).toBeGreaterThanOrEqual(11);
    for (let k = 1; k < starts.length; k++) {
      const gap = starts[k] - ends[k - 1];
      expect(gap).toBeGreaterThanOrEqual(GAG_EVERY[0] - 50);
      expect(gap).toBeLessThanOrEqual(GAG_EVERY[1] + 6000); // Marv at the glass can hold one back by his ~5 s
    }
  });

  it('switched on by typing: Harry and Marv walk by ~3 s later, before any move, without the iron; the next one 25–40 s into play after', () => {
    const layer = new HomeAloneLayer(garland(), () => 0.1); // the iron, if a walk could have it
    layer.welcome();
    run(layer, WELCOME_MS - 100, gate({ inPlay: false }));
    expect(layer.state().gag).toBeNull();
    run(layer, 200, gate({ inPlay: false }));
    expect(layer.state()).toMatchObject({ gag: 'walk', bandits: true, iron: false });
    run(layer, BANDIT_WALK_MS, gate({ inPlay: false }));
    expect(layer.state().gag).toBeNull();
    run(layer, 120_000, gate({ inPlay: false }));
    expect(layer.state().gag).toBeNull();
    let at = -1;
    for (let t = 0; t < 60_000 && at < 0; t += 50) {
      layer.step(t, 50, gate(), L);
      if (layer.state().gag) at = t + 50;
    }
    expect(at).toBeGreaterThanOrEqual(GAG_EVERY[0]);
    expect(at).toBeLessThanOrEqual(GAG_EVERY[1] + 50);
    expect(layer.state().gag).not.toBe('walk'); // never twice running
  });

  it('the welcome walk: frozen while paused, none under reduced motion, none once the house has gone', () => {
    const paused = new HomeAloneLayer(garland(), () => 0.9);
    paused.welcome();
    run(paused, 60_000, gate({ running: false, inPlay: false }));
    expect(paused.state().gag).toBeNull();
    run(paused, WELCOME_MS + 50, gate({ inPlay: false }));
    expect(paused.state().gag).toBe('walk');
    const still = new HomeAloneLayer(garland(), () => 0.9);
    still.welcome();
    run(still, 50, gate({ reduced: true, inPlay: false }));
    run(still, 60_000, gate({ inPlay: false }));
    expect(still.state().gag).toBeNull();
    const gone = new HomeAloneLayer(garland(), () => 0.9);
    gone.welcome();
    gone.reset();
    run(gone, 60_000, gate({ inPlay: false }));
    expect(gone.state().gag).toBeNull();
  });

  it('about 1 walk in 4 brings the iron, which ends it early; force starts either now; reset clears a walk', () => {
    const layer = new HomeAloneLayer(garland(), () => 0.1); // under IRON_ODDS
    run(layer, GAG_FIRST_MS + 100, gate());
    expect(layer.state()).toEqual(expect.objectContaining({ bandits: true, iron: true }));
    run(layer, IRON_WALK_MS + 100, gate(), GAG_FIRST_MS + 100);
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
    run(layer, GAG_FIRST_MS + 100, gate());
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

  it('a forced walk counts as the last one: the next gag waits GAG_EVERY after it ends', () => {
    const layer = new HomeAloneLayer(garland(), () => 0.9);
    run(layer, GAG_FIRST_MS - 1000, gate()); // in play, not yet due
    layer.force('bandits', 0, L);
    let next = -1;
    for (let t = 0; t < 120_000 && next < 0; t += 50) {
      const was = layer.state().gag;
      layer.step(t, 50, gate(), L);
      if (!was && layer.state().gag) next = t;
    }
    expect(next).toBeGreaterThanOrEqual(gagMs('walk', false) + GAG_EVERY[0] - 100);
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

  it('in play the paint can comes within 50 s and knocks the bulb it picked as it arrives', () => {
    const knock = garland();
    const layer = new HomeAloneLayer(knock, mulberry32(4));
    let t = 0;
    while (!layer.state().paint && t < PAINT_EVERY[1] + 1000) {
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

  it('in play the tarantula comes within 70 s', () => {
    const layer = new HomeAloneLayer(garland(), mulberry32(4));
    let t = 0;
    while (layer.state().tarantula === null && t < TARANTULA_EVERY[1] + 1000) {
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
