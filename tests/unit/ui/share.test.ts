import { describe, expect, it } from 'vitest';
import { AURORA, SCENES, type Scene } from '../../../src/render/scenes';
import { coverRect, shareInk, shareText } from '../../../src/ui/share';

it('writes the share line', () => {
  expect(shareText(84)).toBe('Lit the tree in 1:24 · aglow.lukeghanna.com');
});

it('crops the stage to a centred 4:5 cover rectangle without stretching', () => {
  expect(coverRect(1920, 1080, 0.8)).toEqual({ x: 528, y: 0, w: 864, h: 1080 });
  expect(coverRect(400, 1000, 0.8)).toEqual({ x: 0, y: 250, w: 400, h: 500 });
  const r = coverRect(1170, 2532, 0.8);
  expect(r.w / r.h).toBeCloseTo(0.8, 9);
});

describe('the caption ink', () => {
  /** WCAG relative luminance of a #rrggbb colour, scaled by `k` (the share image's brightness(0.8) veil). */
  const lum = (hex: string, k = 1): number => {
    const c = [1, 3, 5].map((i) => (k * parseInt(hex.slice(i, i + 2), 16)) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const contrast = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  /** The worst contrast of `ink` over a scene's sky and ground stops, veiled as the share image veils them. */
  const worst = (ink: string, s: Scene): number => Math.min(...[...s.sky, ...s.ground].map((c) => contrast(lum(ink), lum(c, 0.8))));

  it('reads clearly (7:1 or better) on every scene the stage can show, the aurora included', () => {
    for (const s of [...Object.values(SCENES), AURORA]) expect(worst(shareInk(s), s), s.id).toBeGreaterThanOrEqual(7);
    expect(shareInk(AURORA)).toBe('#eef0ff');
  });

  it("follows the stage's scene, not the hour's: Frost's day ink would vanish into the aurora", () => {
    expect(worst(shareInk(SCENES.frost), AURORA)).toBeLessThan(3);
  });
});
