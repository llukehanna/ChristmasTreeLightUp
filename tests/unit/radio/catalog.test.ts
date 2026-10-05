import { afterEach, expect, it, vi } from 'vitest';
import { FETCH_TIMEOUT_MS, loadCatalog, STATIONS_URL } from '../../../src/radio/catalog';
import type { Track } from '../../../src/radio/schema';

const t = (id: string): Track => ({ id, url: `/a/${id}.m4a`, title: id, artist: '', credit: 'CC0', duration: 1 });
const FILE = {
  version: 1,
  stations: [
    { id: 'christmas-jazz', name: 'Christmas Jazz', description: '', tracks: [t('j')] },
    { id: 'christmas-classics', name: 'Christmas Classics', description: '', tracks: [t('c')] },
  ],
};

afterEach(() => vi.useRealTimers());

it('returns the remote stations in order, from one request only', async () => {
  const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(FILE)));
  const c = await loadCatalog(fetchFn as unknown as typeof fetch);
  expect(c.remoteOk).toBe(true);
  expect(c.stations.map((s) => s.id)).toEqual(['christmas-jazz', 'christmas-classics']);
  expect(fetchFn).toHaveBeenCalledTimes(1);
  expect(fetchFn.mock.calls[0][0]).toBe(STATIONS_URL);
});

it('returns no stations when the list fails or is malformed', async () => {
  const down = await loadCatalog((async () => new Response('nope', { status: 503 })) as unknown as typeof fetch);
  expect(down).toEqual({ stations: [], remoteOk: false });
  const junk = await loadCatalog((async () => new Response('{"version":1,"stations":[{"id":"BAD ID"}]}')) as unknown as typeof fetch);
  expect(junk).toEqual({ stations: [], remoteOk: false });
  const thrown = await loadCatalog((async () => {
    throw new TypeError('offline');
  }) as unknown as typeof fetch);
  expect(thrown).toEqual({ stations: [], remoteOk: false });
});

it('treats a missing endpoint (404) as no remote stations, not as a failure', async () => {
  const missing = await loadCatalog((async () => new Response('Not found', { status: 404 })) as unknown as typeof fetch);
  expect(missing).toEqual({ stations: [], remoteOk: true });
});

it('still reports a failure for server errors and other non-OK statuses', async () => {
  for (const status of [500, 502, 403, 410]) {
    const c = await loadCatalog((async () => new Response('', { status })) as unknown as typeof fetch);
    expect(c, `status ${status}`).toEqual({ stations: [], remoteOk: false });
  }
});

it(`gives up on a hung endpoint after ${FETCH_TIMEOUT_MS / 1000}s`, async () => {
  vi.useFakeTimers();
  const hung = (_url: string, init?: RequestInit) =>
    new Promise<Response>((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
  let done: { stations: unknown[]; remoteOk: boolean } | null = null;
  void loadCatalog(hung as unknown as typeof fetch).then((c) => (done = c));
  await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS - 1);
  expect(done).toBeNull();
  await vi.advanceTimersByTimeAsync(1);
  expect(done).toEqual({ stations: [], remoteOk: false });
});
