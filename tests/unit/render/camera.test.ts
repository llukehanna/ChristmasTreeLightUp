import { expect, it } from 'vitest';
import { IDENTITY, MAX_ZOOM, clampCamera, isZoomed, toScreen, toWorld, zoomAt } from '../../../src/render/camera';

it('keeps the focal point fixed while zooming', () => {
  const c = zoomAt(IDENTITY, 2, 300, 200);
  const [wx, wy] = toWorld(c, 300, 200);
  expect(wx).toBeCloseTo(300);
  expect(wy).toBeCloseTo(200);
  expect(toScreen(c, wx, wy)).toEqual([300, 200]);
});
it('clamps zoom between 1 and MAX_ZOOM', () => {
  expect(zoomAt(IDENTITY, 0.5, 0, 0).scale).toBe(1);
  expect(zoomAt(IDENTITY, 10, 0, 0).scale).toBe(MAX_ZOOM);
});
it('never pans the world away from the viewport', () => {
  const c = clampCamera({ scale: 2, tx: 500, ty: -5000 }, 800, 600);
  expect(c.tx).toBe(0);
  expect(c.ty).toBe(-600);
  expect(isZoomed(IDENTITY)).toBe(false);
  expect(isZoomed(c)).toBe(true);
});
