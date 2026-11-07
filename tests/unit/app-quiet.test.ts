// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { quietForWork, runInProgress, type RunFlags } from '../../src/app';

const NOW = 100_000;
/** The App's states. `moved` (the first move made) is not read by the gate: it is kept to show it changes nothing. */
const STATES: Record<string, RunFlags & { moved: boolean }> = {
  noBoard: { live: false, starting: false, moved: false, watching: false, winAt: null, paused: false, now: NOW },
  seedPending: { live: true, starting: true, moved: false, watching: false, winAt: null, paused: false, now: NOW },
  reveal: { live: true, starting: false, moved: false, watching: false, winAt: null, paused: false, now: NOW },
  clockRunningNoMove: { live: true, starting: false, moved: false, watching: false, winAt: null, paused: false, now: NOW },
  midRun: { live: true, starting: false, moved: true, watching: false, winAt: null, paused: false, now: NOW },
  paused: { live: true, starting: false, moved: true, watching: false, winAt: null, paused: true, now: NOW },
  wonJustNow: { live: true, starting: false, moved: true, watching: false, winAt: NOW - 100, paused: false, now: NOW },
  wonAndSettled: { live: true, starting: false, moved: true, watching: false, winAt: NOW - 2001, paused: false, now: NOW },
  // A replay on the stage sets the player's tree aside (paused mid-run, or won and settled): an animation the player watches.
  watchingPausedRun: { live: true, starting: false, moved: true, watching: true, winAt: null, paused: true, now: NOW },
  watchingWonRun: { live: true, starting: false, moved: true, watching: true, winAt: NOW - 2001, paused: false, now: NOW },
};

it("the radio's prewarm runs only with no board, a seed pending, behind the pause or once the win has settled", () => {
  const quiet = Object.fromEntries(Object.entries(STATES).map(([k, f]) => [k, quietForWork(f)]));
  expect(quiet).toEqual({
    noBoard: true,
    seedPending: true,
    reveal: false, // the reveal is animation the player watches
    clockRunningNoMove: false, // the clock runs from the reveal's end: a stall would stamp the first tap late
    midRun: false,
    paused: true,
    wonJustNow: false, // the confetti, the topper's flare and the results tag's arrival
    wonAndSettled: true,
    watchingPausedRun: false, // a replay is animation the player watches, over the paused tree
    watchingWonRun: false,
  });
});

it('a run is in progress from the first move to the win: only then does an unlock wait to show', () => {
  const inRun = Object.fromEntries(Object.entries(STATES).map(([k, f]) => [k, runInProgress(f)]));
  expect(inRun).toEqual({
    noBoard: false,
    seedPending: false,
    reveal: false,
    clockRunningNoMove: false,
    midRun: true,
    paused: true,
    wonJustNow: false,
    wonAndSettled: false,
    watchingPausedRun: true,
    watchingWonRun: false,
  });
});
