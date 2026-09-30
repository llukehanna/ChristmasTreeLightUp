import type { App } from './app';
import { GRID } from './core/mask';

export interface AglowProbe {
  state(): { bits: number[]; solution: number[]; litCount: number; won: boolean; rotating: number; interactive: boolean };
  tileCenter(i: number): [number, number];
  solve(): void;
  ids: number[];
}

/** Test hook for Playwright. Only installed when the URL contains ?test. */
export function installDebugHook(app: App): void {
  if (!new URLSearchParams(location.search).has('test')) return;
  const probe: AglowProbe = {
    state: () => ({
      bits: [...app.board.bits],
      solution: [...app.board.solution],
      litCount: app.board.lighting.count,
      won: app.board.won,
      rotating: app.board.rotating.size,
      interactive: performance.now() >= app.interactiveAt,
    }),
    tileCenter: (i) => app.tileScreenCenter(i),
    solve: () => app.debugSolve(),
    ids: [...GRID.ids],
  };
  (window as Window & { __aglow?: AglowProbe }).__aglow = probe;
}
