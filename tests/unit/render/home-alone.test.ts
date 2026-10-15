// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { mulberry32 } from '../../../src/core/rng';
import { FADE_MS } from '../../../src/render/aurora';
import { BANDIT_IDLE_MS, BANDIT_WALK_MS, IRON_WALK_MS } from '../../../src/render/home-alone-window';
import { HomeAloneLayer, homeAloneAlpha, type HomeAloneGate } from '../../../src/render/home-alone';
import { computeLayout } from '../../../src/render/layout';
import { HOME_ALONE, SCENES } from '../../../src/render/scenes';

const L = computeLayout(1280, 800, 2);
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
  it('the party runs while the game runs, stands still while paused, and never under reduced motion', () => {
    const layer = new HomeAloneLayer(mulberry32(1));
    run(layer, 1000, gate());
    expect(layer.partyMs).toBe(1000);
    run(layer, 1000, gate({ running: false }));
    expect(layer.partyMs).toBe(1000);
    const still = new HomeAloneLayer(mulberry32(1));
    run(still, 120_000, gate({ reduced: true }));
    expect(still.partyMs).toBe(0);
    expect(still.state().bandits).toBe(false);
  });

  it('the bandits come after 20 s idle (in play or not), and a walk ends by itself', () => {
    const layer = new HomeAloneLayer(() => 0.9); // never the iron
    run(layer, BANDIT_IDLE_MS + 100, gate({ inPlay: false }));
    expect(layer.state()).toEqual(expect.objectContaining({ bandits: true, iron: false }));
    run(layer, BANDIT_WALK_MS + 100, gate({ inPlay: false }), BANDIT_IDLE_MS + 100);
    expect(layer.state().bandits).toBe(false);
  });

  it('input keeps them away', () => {
    const layer = new HomeAloneLayer(() => 0.9);
    for (let t = 0; t < 60_000; t += 50) {
      if (t % 10_000 === 0) layer.input();
      layer.step(t, 50, gate(), L);
    }
    expect(layer.state().bandits).toBe(false);
  });

  it('about 1 walk in 4 brings the iron, which ends it early; force starts either now; reset clears a walk', () => {
    const layer = new HomeAloneLayer(() => 0.1); // under IRON_ODDS
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

  it('draws nothing under reduced motion', () => {
    const layer = new HomeAloneLayer();
    const c = { save: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
    layer.drawWindow(c, L, 1, 0, true);
    expect(c.save).not.toHaveBeenCalled();
  });
});
