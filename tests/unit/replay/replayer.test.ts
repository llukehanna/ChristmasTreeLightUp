// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReplayResponse } from '../../../src/api/types';
import type { Sfx } from '../../../src/audio/sfx';
import { replay } from '../../../src/core/replay';
import { GEN_VERSION, seededBoard } from '../../../src/core/seeded';
import { Replayer } from '../../../src/replay/replayer';
import { solvingTaps, withPause } from '../core/solver';

const SEED = 3;
const board = () => {
  const b = seededBoard(SEED, GEN_VERSION);
  if (!b) throw new Error('no board');
  return b;
};
/** A solving run with a minute's pause in the middle, as the server hands it out. */
const run = (): ReplayResponse => {
  const log = withPause(solvingTaps(board()), 10, 60_000);
  if (!replay(seededBoard(SEED, GEN_VERSION, true)!, log)) throw new Error('the log does not solve');
  return { id: 'run-1', seed: SEED, genVersion: GEN_VERSION, log, ms: 62_400, name: 'Comet', mine: false, finishedAt: 0, daily: null };
};

let host: HTMLElement;
let sfx: { tick: ReturnType<typeof vi.fn>; wave: ReturnType<typeof vi.fn>; hurryChimes: ReturnType<typeof vi.fn> };
let onDone: ReturnType<typeof vi.fn<() => void>>;
let r: Replayer;
beforeEach(() => {
  document.body.innerHTML = '<div id="replay-bar" hidden></div>';
  host = document.getElementById('replay-bar')!;
  sfx = { tick: vi.fn(), wave: vi.fn(), hurryChimes: vi.fn() };
  onDone = vi.fn<() => void>();
  r = new Replayer(host, { sfx: sfx as unknown as Sfx, busy: vi.fn(), flashes: () => false, onDone });
});
const toggle = () => host.querySelector<HTMLButtonElement>('.rb-toggle')!;
/** Frames of 50 ms (the loop's cap) from `t`, until the run has played out or `max` frames; returns the time reached. */
const playOut = (t: number, max = 20_000): number => {
  for (let k = 0; k < max && r.run && !r.run.ended; k++) r.frame((t += 50), 50);
  return t;
};

it('plays a run to its solve: ticks and chimes, the win at winAt, and the bar says Watch again', () => {
  expect(r.play(run(), 0)).toBe(true);
  expect(host.hidden).toBe(false);
  expect(host.querySelector('.rb-cap')?.textContent).toBe('Comet · 1:02.4');
  const end = playOut(0);
  const p = r.run!;
  expect(p.ended).toBe(true);
  expect(p.playing).toBe(false);
  expect(p.board.won).toBe(true);
  expect(p.winAt).not.toBeNull();
  expect(p.winAt).toBeLessThanOrEqual(end);
  expect(p.playback.cursor).toBe(p.playback.solvedAt);
  // The minute's pause is skipped: the replay took about the run's active time, not a minute more.
  expect(end).toBeLessThan(p.playback.solvedAt! - 50_000);
  expect(sfx.tick).toHaveBeenCalled();
  expect(sfx.wave).toHaveBeenCalled();
  expect(sfx.hurryChimes).toHaveBeenCalledTimes(1);
  expect(toggle().textContent).toBe('Watch again');
});

it('Pause holds the playhead, Play moves it on; 2× moves it twice as far', () => {
  r.play(run(), 0);
  r.frame(50, 50);
  const at = r.run!.playback.cursor;
  toggle().click();
  expect(toggle().textContent).toBe('Play');
  r.frame(100, 50);
  expect(r.run!.playback.cursor).toBe(at);
  toggle().click();
  r.frame(150, 50);
  expect(r.run!.playback.cursor).toBe(at + 50);
  host.querySelector<HTMLButtonElement>('.rb-fast')!.click();
  expect(r.run!.speed).toBe(2);
  r.frame(200, 50);
  expect(r.run!.playback.cursor).toBe(at + 150);
});

it('Watch again starts the run over on a fresh board, at the speed chosen', () => {
  r.play(run(), 0);
  host.querySelector<HTMLButtonElement>('.rb-fast')!.click();
  const first = r.run!;
  playOut(0);
  toggle().click(); // Watch again
  const again = r.run!;
  expect(again).not.toBe(first);
  expect(again.board).not.toBe(first.board);
  expect(again.playback.cursor).toBe(0);
  expect(again.winAt).toBeNull();
  expect(again).toMatchObject({ playing: true, ended: false, speed: 2 });
  expect(toggle().textContent).toBe('Pause');
});

it('keys: Space and P toggle (Space on a button is left to the button), Escape asks for Done; the bar has its Done', () => {
  r.play(run(), 0);
  const key = (k: string, target: EventTarget = document.body) => {
    const e = new KeyboardEvent('keydown', { key: k, cancelable: true });
    Object.defineProperty(e, 'target', { value: target });
    return { done: r.key(e), prevented: e.defaultPrevented };
  };
  expect(key(' ')).toEqual({ done: false, prevented: true });
  expect(r.run!.playing).toBe(false);
  expect(key('p')).toEqual({ done: false, prevented: true });
  expect(r.run!.playing).toBe(true);
  expect(key(' ', toggle())).toEqual({ done: false, prevented: false });
  expect(r.run!.playing).toBe(true);
  expect(key('n')).toEqual({ done: false, prevented: false });
  expect(key('Escape')).toEqual({ done: true, prevented: true });
  host.querySelector<HTMLButtonElement>('.rb-done')!.click();
  expect(onDone).toHaveBeenCalledTimes(1);
});

it("stop() takes the run and the bar away; a tree this build can't make is refused", () => {
  r.play(run(), 0);
  r.stop();
  expect(r.run).toBeNull();
  expect(host.hidden).toBe(true);
  expect(r.play({ ...run(), genVersion: 999 }, 0)).toBe(false);
  expect(r.run).toBeNull();
});
