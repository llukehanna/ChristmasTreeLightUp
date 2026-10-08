import { afterEach, expect, it, vi } from 'vitest';
import { Session, type SessionState } from '../../../src/api/session';

afterEach(() => vi.unstubAllGlobals());

it('loads the user, tells subscribers, and treats an unreachable server as signed out', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ user: { name: 'Comet', isAdmin: false } })));
  const s = new Session();
  const seen: SessionState[] = [];
  const stop = s.subscribe((u) => seen.push(u));
  expect(s.current).toBeUndefined();
  expect(await s.load()).toEqual({ name: 'Comet', isAdmin: false });
  vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
  expect(await s.load()).toBeNull();
  stop();
  s.set({ name: 'X', isAdmin: false });
  expect(seen).toEqual([{ name: 'Comet', isAdmin: false }, null]);
});

it('signs out locally even when the server cannot be reached', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
  const s = new Session();
  s.set({ name: 'Comet', isAdmin: false });
  await s.signOut();
  expect(s.current).toBeNull();
});
