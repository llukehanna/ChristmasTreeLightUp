import type { App } from './app';
import { GRID } from './core/mask';

export interface AglowProbe {
  state(): { bits: number[]; solution: number[]; litCount: number; won: boolean; rotating: number; interactive: boolean };
  tileCenter(i: number): [number, number];
  solve(): void;
  ids: number[];
  /** `lightShow`: the post-win light show drew the last frame (win, analysable source, setting on, no reduced motion). */
  radio(): { kind: string | null; playing: boolean; stations: string[]; catalogLoaded: boolean; lightShow: boolean };
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
    radio: () => {
      const v = app.radio.view();
      return { kind: v.kind, playing: v.playing, stations: v.stations.map((s) => s.id), catalogLoaded: app.radio.catalogLoaded, lightShow: app.lightShowOn };
    },
  };
  (window as Window & { __aglow?: AglowProbe }).__aglow = probe;
}
