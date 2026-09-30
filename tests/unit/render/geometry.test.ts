import { describe, expect, it } from 'vitest';
import { D, L, R, U } from '../../../src/core/dirs';
import { arcFor, heads, pointAt, pointsAlong, tileGeometry } from '../../../src/render/geometry';

const close = (a: [number, number], b: [number, number]) => {
  expect(a[0]).toBeCloseTo(b[0]);
  expect(a[1]).toBeCloseTo(b[1]);
};

describe('arcFor', () => {
  it('runs from the entry edge to the exit edge', () => {
    const a = arcFor(U | R, U);
    close(pointAt(a, 0), [0, -0.5]);
    close(pointAt(a, 1), [0.5, 0]);
    const b = arcFor(U | R, R);
    close(pointAt(b, 0), [0.5, 0]);
    close(pointAt(b, 1), [0, -0.5]);
    const c = arcFor(D | L, L);
    close(pointAt(c, 0), [-0.5, 0]);
    close(pointAt(c, 1), [0, 0.5]);
  });
  it('meets each edge perpendicular to it (smooth join with the next tile)', () => {
    const a = arcFor(U | R, U);
    const p0 = pointAt(a, 0);
    const p1 = pointAt(a, 0.001);
    expect(Math.abs(p1[0] - p0[0])).toBeLessThan(Math.abs(p1[1] - p0[1]));
  });
});

describe('tileGeometry', () => {
  it('draws an end tile as one spoke from its edge to the centre', () => {
    const [p] = tileGeometry(L, 0);
    expect(p).toMatchObject({ kind: 'line', x0: -0.5, y0: 0, x1: 0, y1: 0 });
  });
  it('flows in from the entry edge first, then out along the others', () => {
    const prims = tileGeometry(U | L | R, R);
    expect(prims[0]).toMatchObject({ kind: 'line', x0: 0.5, y0: 0, t0: 0, t1: 0.5 });
    expect(prims.slice(1).every((p) => p.t0 === 0.5 && p.t1 === 1)).toBe(true);
    expect(prims).toHaveLength(3);
  });
  it('uses a single arc for bends', () => {
    expect(tileGeometry(D | R, D)).toHaveLength(1);
    expect(tileGeometry(D | R, D)[0].kind).toBe('arc');
  });
});

describe('pointsAlong / heads', () => {
  it('only returns points on the lit part', () => {
    const prims = tileGeometry(U | D, D);
    expect(pointsAlong(prims, 1, 0.25).length).toBeGreaterThan(pointsAlong(prims, 0.3, 0.25).length);
  });
  it('reports the leading point while filling, none when full', () => {
    const prims = tileGeometry(U | D, D);
    expect(heads(prims, 0.25)).toHaveLength(1);
    expect(heads(prims, 1)).toHaveLength(0);
  });
});
