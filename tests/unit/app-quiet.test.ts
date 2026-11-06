// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { quietForWork, type RunFlags } from '../../src/app';

const at = (f: Partial<RunFlags>): boolean => quietForWork({ live: true, starting: false, moved: true, won: false, paused: false, ...f });

it("the radio's prewarm is held off mid-run, and allowed before the first move, behind the pause and after the win", () => {
  expect(at({})).toBe(false); // mid-run
  expect(at({ moved: false })).toBe(true); // the tree's first tap hasn't happened
  expect(at({ paused: true })).toBe(true); // the frosted pause
  expect(at({ won: true })).toBe(true); // results up
  expect(at({ live: false, moved: false })).toBe(true); // no tree yet
  expect(at({ starting: true })).toBe(true); // waiting for the next tree's seed
});
