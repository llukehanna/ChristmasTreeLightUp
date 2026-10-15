import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../../src/core/rng';
import {
  CRAWL_MS, PAINT_EVERY, PAINT_IN_MS, PAINT_MS, PAINT_SWING, PaintCan, TARANTULA_SCARE_PX, Tarantula, TrapScheduler, drawPaintCan,
  paintCanAngle,
} from '../../../src/render/home-alone-traps';
import { computeLayout } from '../../../src/render/layout';

const L = computeLayout(1280, 800, 2);

describe('TrapScheduler', () => {
  it('fires within its range of in-play time, then re-arms', () => {
    const s = new TrapScheduler(PAINT_EVERY, mulberry32(9));
    const at: number[] = [];
    for (let t = 0; t < 400_000; t += 50) if (s.step(50)) at.push(t + 50);
    expect(at.length).toBeGreaterThan(3);
    let prev = 0;
    for (const t of at) {
      expect(t - prev).toBeGreaterThanOrEqual(PAINT_EVERY[0]);
      expect(t - prev).toBeLessThanOrEqual(PAINT_EVERY[1] + 50);
      prev = t;
    }
  });
});

describe('the paint can', () => {
  it('swings in from up and to the side, reaches its bulb at PAINT_IN_MS, and swings back out', () => {
    expect(paintCanAngle(0)).toBeCloseTo(PAINT_SWING);
    expect(paintCanAngle(PAINT_IN_MS)).toBeCloseTo(0);
    expect(paintCanAngle(PAINT_MS)).toBeCloseTo(PAINT_SWING);
    for (let t = 50; t < PAINT_IN_MS; t += 50) expect(paintCanAngle(t)).toBeLessThan(paintCanAngle(t - 50));
  });

  it('swings in from the left for a bulb on the right half, mirrored from the right for one on the left half', () => {
    // Two bulbs the same distance either side of the centre, the rope's far end recorded at the start of the swing.
    const garland = { geo: { n: 2, size: 14, bulbs: [{ x: 200, y: 90, angle: 0 }, { x: L.w - 200, y: 90, angle: 0 }] }, pickLit: () => 0, knock: () => {}, unknock: () => {} };
    const end = (bulb: number, t: number): [number, number] => {
      let at: [number, number] = [NaN, NaN];
      const c = { beginPath() {}, moveTo() {}, stroke() {}, lineTo: (x: number, y: number) => (at = [x, y]) } as unknown as CanvasRenderingContext2D;
      const can = new PaintCan();
      can.start(bulb);
      can.t = t;
      drawPaintCan(c, L, can, garland, null);
      return at;
    };
    for (const t of [0, PAINT_IN_MS / 2, PAINT_MS - 100]) {
      const [lx, ly] = end(0, t);
      const [rx, ry] = end(1, t);
      expect(rx).toBeLessThan(L.w - 200); // right half: the can hangs to the bulb's left
      expect(lx).toBeGreaterThan(200); // left half: to its right, never off the screen's edge
      expect(lx - 200).toBeCloseTo(L.w - 200 - rx, 6);
      expect(ly).toBeCloseTo(ry, 6);
    }
    expect(end(0, PAINT_IN_MS)[0]).toBeCloseTo(200, 6); // straight down over its bulb at the hit
  });

  it('step says "hit" once, at PAINT_IN_MS, then the can is gone by PAINT_MS', () => {
    const can = new PaintCan();
    can.start(4);
    const hits: number[] = [];
    for (let t = 50; t <= PAINT_MS + 100; t += 50) if (can.step(50)) hits.push(t);
    expect(hits).toEqual([PAINT_IN_MS]);
    expect(can.active).toBe(false);
  });
});

describe('the tarantula', () => {
  it('crawls across the board in 6–8 s', () => {
    const t = new Tarantula();
    t.start(L, mulberry32(2));
    let ms = 0;
    while (t.mode === 'crawl' && ms < 20_000) {
      t.step(50, L);
      ms += 50;
    }
    expect(ms).toBeGreaterThanOrEqual(CRAWL_MS[0]);
    expect(ms).toBeLessThanOrEqual(CRAWL_MS[1] + 50);
  });

  it(`a tap within ${TARANTULA_SCARE_PX} px scares it; one farther does not; it scurries off-screen in under a second`, () => {
    const t = new Tarantula();
    t.start(L, mulberry32(2), [640, 400]);
    expect(t.pos).toMatchObject({ x: 640, y: 400 });
    expect(t.scare(640 + TARANTULA_SCARE_PX + 1, 400)).toBe(false);
    expect(t.mode).toBe('crawl');
    expect(t.scare(640 + 10, 400 + 10)).toBe(true);
    expect(t.mode).toBe('scurry');
    expect(t.scare(640, 400)).toBe(false); // already off
    let ms = 0;
    while (t.mode === 'scurry' && ms < 5000) {
      t.step(50, L);
      ms += 50;
    }
    expect(t.mode).toBeNull();
    expect(ms).toBeLessThan(1000);
  });

  it('a tap dead centre still sends it off sideways', () => {
    const t = new Tarantula();
    t.start(L, mulberry32(2), [640, 400]);
    expect(t.scare(640, 400)).toBe(true);
    t.step(50, L);
    expect(t.pos.x).not.toBe(640);
  });
});
