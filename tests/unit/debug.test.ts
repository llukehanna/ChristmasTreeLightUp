// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import type { App } from '../../src/app';
import { installDebugHook, testHookAllowed } from '../../src/debug';

type Probed = Window & { __aglow?: unknown };
const probe = () => (window as Probed).__aglow;
const at = (url: string) => new URL(url);
afterEach(() => {
  delete (window as Probed).__aglow;
});

it('the ?test hook is installed on a local host (e2e on :4173, og on :4174, a local preview)', () => {
  for (const url of ['http://localhost:4173/?test', 'http://localhost:4174/?test', 'http://127.0.0.1:8787/?test', 'http://[::1]:4173/?test']) {
    expect(testHookAllowed(at(url)), url).toBe(true);
  }
  installDebugHook({} as App, at('http://localhost:4173/?test'));
  expect(probe()).toBeDefined();
});

it('never on a public host, where it would hand out the solution and a ready-made tap log', () => {
  for (const url of ['https://aglow.lukeghanna.com/?test', 'https://localhost.evil.example/?test', 'https://aglow.workers.dev/?test=1']) {
    expect(testHookAllowed(at(url)), url).toBe(false);
  }
  installDebugHook({} as App, at('https://aglow.lukeghanna.com/?test'));
  expect(probe()).toBeUndefined();
});

it('not without ?test, even locally', () => {
  expect(testHookAllowed(at('http://localhost:4173/'))).toBe(false);
  installDebugHook({} as App, at('http://localhost:4173/'));
  expect(probe()).toBeUndefined();
});
