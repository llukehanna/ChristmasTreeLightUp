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
  /** The star-head egg: the star's centre on screen, whether the head is on top, and whether a flip is under way. */
  star(): { center: [number, number]; head: boolean; flipping: boolean };
  /** The game clock in ms (0 until the reveal ends), and the ms since the reveal ended (0 before): the clock is never ahead of it. */
  clock(): { ms: number; sinceReveal: number };
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * The hook hands out the solution and taps that go into the real log (a ready-made bot), so it exists only for ?test
 * on this machine: Playwright (:4173), scripts/og.mjs (:4174) and local previews. Never on a public host.
 */
export function testHookAllowed(loc: Pick<Location, 'search' | 'hostname'>): boolean {
  return new URLSearchParams(loc.search).has('test') && LOCAL_HOSTS.has(loc.hostname);
}

/** Test hook for Playwright. Only installed for ?test on a local host. */
export function installDebugHook(app: App, loc: Pick<Location, 'search' | 'hostname'> = location): void {
  if (!testHookAllowed(loc)) return;
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
    star: () => ({ center: app.starScreenCenter(), ...app.starHead }),
    clock: () => (app.started ? { ms: app.clockMs, sinceReveal: Math.max(0, performance.now() - app.interactiveAt) } : { ms: 0, sinceReveal: 0 }),
  };
  (window as Window & { __aglow?: AglowProbe }).__aglow = probe;
}
