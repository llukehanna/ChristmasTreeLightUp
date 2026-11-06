// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { quietForWork, type RunFlags } from '../../src/app';

/** The App's states. `moved` (the first move made) is not read by the gate: it is kept to show it changes nothing. */
const STATES: Record<string, RunFlags & { moved: boolean }> = {
  noBoard: { live: false, starting: false, moved: false, won: false, paused: false },
  seedPending: { live: true, starting: true, moved: false, won: false, paused: false },
  reveal: { live: true, starting: false, moved: false, won: false, paused: false },
  clockRunningNoMove: { live: true, starting: false, moved: false, won: false, paused: false },
  midRun: { live: true, starting: false, moved: true, won: false, paused: false },
  paused: { live: true, starting: false, moved: true, won: false, paused: true },
  won: { live: true, starting: false, moved: true, won: true, paused: false },
};

it("the radio's prewarm runs only with no board, a seed pending, behind the pause or after the win", () => {
  const quiet = Object.fromEntries(Object.entries(STATES).map(([k, f]) => [k, quietForWork(f)]));
  expect(quiet).toEqual({
    noBoard: true,
    seedPending: true,
    reveal: false, // the reveal is animation the player watches
    clockRunningNoMove: false, // the clock runs from the reveal's end: a stall would stamp the first tap late
    midRun: false,
    paused: true,
    won: true,
  });
});
