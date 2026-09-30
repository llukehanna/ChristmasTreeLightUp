import { D, L, R, U, dirsOf, type Dir } from '../core/dirs';

/** Wire primitives in tile units (tile centre = 0,0; tile size = 1). t0..t1 = when this piece lights during the fill. */
export type Prim =
  | { kind: 'line'; x0: number; y0: number; x1: number; y1: number; t0: number; t1: number; len: number }
  | { kind: 'arc'; cx: number; cy: number; a0: number; a1: number; t0: number; t1: number; len: number };

export const EDGE: Readonly<Record<Dir, readonly [number, number]>> = {
  [U]: [0, -0.5],
  [D]: [0, 0.5],
  [L]: [-0.5, 0],
  [R]: [0.5, 0],
};

export const isBend = (b: number): boolean => b === (U | L) || b === (U | R) || b === (D | L) || b === (D | R);

/** Quarter arc of radius 0.5 centred on the shared corner, from the `from` edge to the other edge. */
export function arcFor(b: number, from: Dir): Prim {
  const sx = b & R ? 1 : -1;
  const sy = b & D ? 1 : -1;
  const angV = sx > 0 ? Math.PI : 0; // angle (seen from the corner) of the U/D edge midpoint
  const angH = sy > 0 ? -Math.PI / 2 : Math.PI / 2; // angle of the L/R edge midpoint
  const fromVertical = from === U || from === D;
  const a0 = fromVertical ? angV : angH;
  let d = (fromVertical ? angH : angV) - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return { kind: 'arc', cx: sx * 0.5, cy: sy * 0.5, a0, a1: a0 + d, t0: 0, t1: 1, len: Math.PI / 4 };
}

/** Geometry for a tile. `entry` (0 = unknown) orders the pieces so light can flow in from that edge. */
export function tileGeometry(b: number, entry: number): Prim[] {
  const dirs = dirsOf(b);
  if (dirs.length === 0) return [];
  const from: Dir = (entry & b) !== 0 ? (entry as Dir) : dirs[0];
  if (dirs.length === 2 && isBend(b)) return [arcFor(b, from)];
  if (dirs.length === 1) {
    const [x, y] = EDGE[dirs[0]];
    return [{ kind: 'line', x0: x, y0: y, x1: 0, y1: 0, t0: 0, t1: 1, len: 0.5 }];
  }
  const [ex, ey] = EDGE[from];
  const out: Prim[] = [{ kind: 'line', x0: ex, y0: ey, x1: 0, y1: 0, t0: 0, t1: 0.5, len: 0.5 }];
  for (const d of dirs) {
    if (d === from) continue;
    const [x, y] = EDGE[d];
    out.push({ kind: 'line', x0: 0, y0: 0, x1: x, y1: y, t0: 0.5, t1: 1, len: 0.5 });
  }
  return out;
}

export const primProgress = (p: Prim, q: number): number =>
  q >= 1 ? 1 : Math.min(1, Math.max(0, (q - p.t0) / (p.t1 - p.t0)));

export function pointAt(p: Prim, k: number): [number, number] {
  if (p.kind === 'line') return [p.x0 + (p.x1 - p.x0) * k, p.y0 + (p.y1 - p.y0) * k];
  const a = p.a0 + (p.a1 - p.a0) * k;
  return [p.cx + Math.cos(a) * 0.5, p.cy + Math.sin(a) * 0.5];
}

/** Evenly spaced points along the lit part (fairy-light LEDs). `seed` varies per point for twinkle phase. */
export function pointsAlong(prims: readonly Prim[], q: number, spacing: number): { x: number; y: number; seed: number }[] {
  const out: { x: number; y: number; seed: number }[] = [];
  prims.forEach((p, pi) => {
    const k = primProgress(p, q);
    const n = Math.max(1, Math.round(p.len / spacing));
    const startsAtCentre = p.kind === 'line' && p.x0 === 0 && p.y0 === 0;
    for (let j = startsAtCentre ? 1 : 0; j <= n; j++) {
      const f = j / n;
      if (f > k + 1e-6) break;
      const [x, y] = pointAt(p, f);
      out.push({ x, y, seed: pi * 17 + j * 3.1 });
    }
  });
  return out;
}

/** Leading points of light while a tile is filling (the "hot head"). */
export function heads(prims: readonly Prim[], q: number): [number, number][] {
  if (q <= 0 || q >= 1) return [];
  return prims.flatMap((p) => {
    const k = primProgress(p, q);
    return k > 0 && k < 1 ? [pointAt(p, k)] : [];
  });
}

/** Appends the first `k` (0..1) of a primitive to the current path, scaled to tile size `s`. */
export function tracePrim(path: CanvasPath, p: Prim, k: number, s: number): void {
  const [sx, sy] = pointAt(p, 0);
  path.moveTo(sx * s, sy * s);
  if (p.kind === 'line') {
    const [x, y] = pointAt(p, k);
    path.lineTo(x * s, y * s);
  } else {
    path.arc(p.cx * s, p.cy * s, s * 0.5, p.a0, p.a0 + (p.a1 - p.a0) * k, p.a1 < p.a0);
  }
}
