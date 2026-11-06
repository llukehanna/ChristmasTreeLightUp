/**
 * Test doubles for the scenes that paint their own room (the Sash, the Town square, the Parlour): a 2D context that
 * records what it is asked to do, and the Path2D and DOMMatrix that jsdom lacks.
 */

export interface Call {
  name: string;
  args: unknown[];
}

/** jsdom has no Path2D: one that accepts every call the rooms make (glass panes, arches, the square's figures). */
export class FakePath {
  rect(): void {}
  ellipse(): void {}
  arc(): void {}
  moveTo(): void {}
  lineTo(): void {}
  quadraticCurveTo(): void {}
  closePath(): void {}
  addPath(): void {}
}

/** jsdom has no DOMMatrix either: one that counts how many are made. */
export const matrices = { made: 0 };
export class FakeMatrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;
  constructor() {
    matrices.made++;
  }
}

/** A 2D context that records every call and every property it is set to (as `set:name`), and keeps save/restore state. */
export function recorder(log: Call[], canvas: { width: number; height: number }): CanvasRenderingContext2D {
  const state: Record<string | symbol, unknown> = { globalAlpha: 1, globalCompositeOperation: 'source-over', canvas };
  const stack: Record<string | symbol, unknown>[] = [];
  const methods: Record<string, (...a: number[]) => unknown> = {
    save: () => (log.push({ name: 'save', args: [] }), stack.push({ ...state })),
    restore: () => (log.push({ name: 'restore', args: [] }), Object.assign(state, stack.pop())),
    createLinearGradient: () => (log.push({ name: 'createLinearGradient', args: [] }), { addColorStop() {} }),
    createRadialGradient: () => (log.push({ name: 'createRadialGradient', args: [] }), { addColorStop() {} }),
    createPattern: () => ({
      // The matrix is reused: record what it says at the time.
      setTransform: (m: { a: number; d: number; e: number; f: number }) => log.push({ name: 'pattern', args: [m.a, m.d, m.e, m.f] }),
    }),
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
  };
  return new Proxy(state, {
    get(t, k) {
      if (typeof k === 'string' && k in methods) return methods[k];
      if (k in t) return t[k];
      return (...args: unknown[]) => log.push({ name: String(k), args });
    },
    set(t, k, v) {
      t[k] = v;
      log.push({ name: `set:${String(k)}`, args: [v] });
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

/** Each drawImage's destination rectangle (x, y, w, h) and the globalAlpha it was drawn at, in log order. */
export function drawn(log: readonly Call[]): { x: number; y: number; w: number; h: number; a: number }[] {
  const out: { x: number; y: number; w: number; h: number; a: number }[] = [];
  let a = 1;
  const saved: number[] = [];
  for (const c of log) {
    if (c.name === 'set:globalAlpha') a = c.args[0] as number;
    else if (c.name === 'save') saved.push(a);
    else if (c.name === 'restore') a = saved.pop() ?? a;
    else if (c.name === 'drawImage') {
      const [x, y, w, h] = c.args.slice(1) as number[];
      out.push({ x, y, w, h, a });
    }
  }
  return out;
}
