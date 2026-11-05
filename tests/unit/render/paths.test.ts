import { expect, it } from 'vitest';
import { D, L, R, U } from '../../../src/core/dirs';
import { bulbAngle } from '../../../src/render/bulbs';
import { easeSnap } from '../../../src/render/effects';
import { tileGeometry } from '../../../src/render/geometry';
import { PATH_STYLES, TwinkleClock, drawLitCore, drawLitGlow, twinklePhase } from '../../../src/render/paths';
import { SCENES } from '../../../src/render/scenes';

it('offers exactly the three approved light paths', () => {
  expect(PATH_STYLES).toEqual(['filament', 'fairy', 'neon']);
});
/** A context that records the line width and alpha of each stroke, and ignores the rest. */
function strokeLog(): { c: CanvasRenderingContext2D; strokes: { w: number; a: number; style: unknown }[] } {
  const strokes: { w: number; a: number; style: unknown }[] = [];
  const state: Record<string, unknown> = { lineWidth: 1, globalAlpha: 1, strokeStyle: '' };
  const c = new Proxy(state, {
    get: (t, k: string) => (k === 'stroke' ? () => strokes.push({ w: t.lineWidth as number, a: t.globalAlpha as number, style: t.strokeStyle }) : k in t ? t[k] : () => undefined),
    set: (t, k: string, v) => ((t[k] = v), true),
  }) as unknown as CanvasRenderingContext2D;
  return { c, strokes };
}
it('neon is the Soft level: a 0.26 glow at 70%, a 0.16 tube', () => {
  const sc = SCENES.fireside;
  const prims = tileGeometry(R | L, R);
  const args = { q: 1, alpha: 1, seed: 0, now: 0, twinkleT: 0 };
  const glow = strokeLog();
  drawLitGlow(glow.c, prims, 100, sc, 'neon', args);
  expect(glow.strokes[0]).toMatchObject({ w: 26, style: sc.neon });
  expect(glow.strokes[0].a).toBeCloseTo(0.7);
  const core = strokeLog();
  drawLitCore(core.c, prims, 100, sc, 'neon', args);
  expect(core.strokes.map((s) => s.w)).toEqual([16, 7.5]);
  expect(core.strokes[0].style).toBe(sc.neonMid);
  expect(core.strokes[0].a).toBe(1);
});
it('points a bulb socket along its wire', () => {
  expect(bulbAngle(U)).toBeCloseTo(-Math.PI / 2);
  expect(bulbAngle(D)).toBeCloseTo(Math.PI / 2);
  expect(bulbAngle(L)).toBeCloseTo(Math.PI);
  expect(bulbAngle(R)).toBe(0);
});
it('snap easing ends exactly at 1 with a slight overshoot before', () => {
  expect(easeSnap(1)).toBeCloseTo(1);
  expect(Math.max(...[0.6, 0.7, 0.8, 0.9].map(easeSnap))).toBeGreaterThan(1);
});
it('the twinkle clock runs at real time with no highs, so the show starting changes nothing', () => {
  const c = new TwinkleClock();
  for (let k = 0; k < 10; k++) c.step(16, 0);
  expect(c.t).toBeCloseTo(160);
});
it('at highs = 1 the twinkle phase advances 2.5 times as fast as at highs = 0', () => {
  const slow = new TwinkleClock();
  const fast = new TwinkleClock();
  for (let k = 0; k < 60; k++) {
    slow.step(16, 0);
    fast.step(16, 1);
  }
  expect(twinklePhase(fast.t, 3, 5) - twinklePhase(0, 3, 5)).toBeCloseTo(2.5 * (twinklePhase(slow.t, 3, 5) - twinklePhase(0, 3, 5)));
});
it('a sudden highs change from 0 to 1 moves the twinkle phase continuously: no jump over a frame’s worth', () => {
  const c = new TwinkleClock();
  c.step(16, 0);
  const before = twinklePhase(c.t, 3, 5);
  const after = twinklePhase(c.step(16, 1), 3, 5);
  expect(after - before).toBeLessThanOrEqual(16 * 2.5 * 0.0035 + 1e-9);
  expect(after).toBeGreaterThan(before);
  // A minute in, the phase still steps by a frame's worth, not by now * 0.0035 * dTwinkle.
  for (let k = 0; k < 3750; k++) c.step(16, 0);
  const b = twinklePhase(c.t, 3, 5);
  expect(twinklePhase(c.step(16, 1), 3, 5) - b).toBeLessThanOrEqual(16 * 2.5 * 0.0035 + 1e-9);
});
