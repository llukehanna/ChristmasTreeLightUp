import type { RunOutcome } from './api/outcome';
import type { App } from './app';
import { GRID } from './core/mask';

export interface AglowProbe {
  state(): { bits: number[]; solution: number[]; litCount: number; won: boolean; rotating: number; interactive: boolean };
  tileCenter(i: number): [number, number];
  solve(): void;
  ids: number[];
  /** `lightShow`: the post-win light show drew the last frame (win, analysable source, setting on, no reduced motion). */
  radio(): { kind: string | null; playing: boolean; stations: string[]; catalogLoaded: boolean; lightShow: boolean };
  /** A real tap on tile i, through the game (logged, as a finger's would be). */
  tap(i: number): void;
  /** The server game behind the tree, what became of its run, and the log's length. */
  game(): { id: string | null; outcome: RunOutcome['kind'] | null; reason: string | null; ranked: boolean | null; log: number };
  newTree(): void;
}

/** Test hook for Playwright. Only installed when the URL contains ?test. */
export function installDebugHook(app: App): void {
  if (!new URLSearchParams(location.search).has('test')) return;
  const probe: AglowProbe = {
    state: () =>
      app.started
        ? {
            bits: [...app.board.bits],
            solution: [...app.board.solution],
            litCount: app.board.lighting.count,
            won: app.board.won,
            rotating: app.board.rotating.size,
            interactive: !app.isStarting && performance.now() >= app.interactiveAt,
          }
        : { bits: [], solution: [], litCount: 0, won: false, rotating: 0, interactive: false },
    tileCenter: (i) => app.tileScreenCenter(i),
    solve: () => app.debugSolve(),
    ids: [...GRID.ids],
    radio: () => {
      const v = app.radio.view();
      return { kind: v.kind, playing: v.playing, stations: v.stations.map((s) => s.id), catalogLoaded: app.radio.catalogLoaded, lightShow: app.lightShowOn };
    },
    tap: (i) => app.tapTile(i),
    game: () => {
      const o = app.runOutcome;
      const result = o?.kind === 'done' ? o.result : null;
      return { id: app.gameId, outcome: o?.kind ?? null, reason: result?.reason ?? null, ranked: result ? result.ranked : null, log: app.logLength };
    },
    newTree: () => app.newGame(),
  };
  (window as Window & { __aglow?: AglowProbe }).__aglow = probe;
}
