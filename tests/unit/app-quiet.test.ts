// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { quietForWork, type RunFlags } from '../../src/app';

const NOW = 100_000;
/** The App's states. `moved` (the first move made) is not read by the gate: it is kept to show it changes nothing. */
const STATES: Record<string, RunFlags & { moved: boolean }> = {
  noBoard: { live: false, starting: false, moved: false, winAt: null, paused: false, now: NOW },
  seedPending: { live: true, starting: true, moved: false, winAt: null, paused: false, now: NOW },
  reveal: { live: true, starting: false, moved: false, winAt: null, paused: false, now: NOW },
  clockRunningNoMove: { live: true, starting: false, moved: false, winAt: null, paused: false, now: NOW },
  midRun: { live: true, starting: false, moved: true, winAt: null, paused: false, now: NOW },
  paused: { live: true, starting: false, moved: true, winAt: null, paused: true, now: NOW },
  wonJustNow: { live: true, starting: false, moved: true, winAt: NOW - 100, paused: false, now: NOW },
  wonAndSettled: { live: true, starting: false, moved: true, winAt: NOW - 2001, paused: false, now: NOW },
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
  });
});
