import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, FINISH_RETRY_MS, finishWithRetry, setUnauthorizedHandler, signInHref, START_TIMEOUT_MS } from '../../../src/api/client';
import type { FinishResult } from '../../../src/api/types';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setUnauthorizedHandler(null);
});

describe('api client', () => {
  it('sends same-origin JSON and reads JSON', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ id: 'x', seed: 1, genVersion: 1, claim: null }));
    vi.stubGlobal('fetch', fetch);
    expect(await api.start()).toEqual({ id: 'x', seed: 1, genVersion: 1, claim: null });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/games');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  });

  it('turns an error answer into ApiError(status, code, message), and an unreachable server into status 0', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'taken', message: 'That name is taken.' }, { status: 409 })));
    await expect(api.setName('Comet')).rejects.toMatchObject({ status: 409, code: 'taken', message: 'That name is taken.' });
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('offline'))));
    await expect(api.me()).rejects.toMatchObject({ status: 0, code: 'offline' });
  });

  it('gives up on a start after 1.5 s', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))),
    );
    const caught = api.start().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(START_TIMEOUT_MS);
    expect(await caught).toMatchObject({ status: 0 });
  });

  it('a 401 calls the signed-out handler', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'signed_out', message: 'Sign in first.' }, { status: 401 })));
    await expect(api.myGames()).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('links to sign-in with a return path', () => {
    expect(signInHref('/?x=1')).toBe('/api/auth/google?return=%2F%3Fx%3D1');
  });
});

describe('finishWithRetry', () => {
  const result: FinishResult = { id: 'g', ranked: true, reason: null, ms: 1, rank: 1, total: 1, best: 1, newBest: true };

  it('retries once, 800 ms later, after a network error or a 5xx', async () => {
    const waits: number[] = [];
    const firsts = [async () => Promise.reject(new TypeError('offline')), async () => Response.json({ error: 'unavailable' }, { status: 503 })];
    for (const first of firsts) {
      const fetch = vi.fn().mockImplementationOnce(first).mockImplementationOnce(async () => Response.json(result));
      vi.stubGlobal('fetch', fetch);
      expect(await finishWithRetry('g', [], async (ms) => void waits.push(ms))).toEqual(result);
      expect(fetch).toHaveBeenCalledTimes(2);
    }
    expect(waits).toEqual([FINISH_RETRY_MS, FINISH_RETRY_MS]);
  });

  it('calls beforeSend ahead of each attempt, the automatic retry included', async () => {
    const calls: string[] = [];
    const fetch = vi.fn().mockImplementationOnce(async () => Promise.reject(new TypeError('offline'))).mockImplementationOnce(async () => Response.json(result));
    vi.stubGlobal('fetch', fetch);
    const wait = async (): Promise<void> => void calls.push('wait');
    await finishWithRetry('g', [], wait, () => void calls.push('send'));
    expect(calls).toEqual(['send', 'wait', 'send']);
  });

  it('never retries an answer (422 unverified), and gives up after a second failure', async () => {
    const refused = vi.fn(async () => Response.json({ error: 'unverified', message: "This run couldn't be verified." }, { status: 422 }));
    vi.stubGlobal('fetch', refused);
    await expect(finishWithRetry('g', [], async () => undefined)).rejects.toMatchObject({ status: 422 });
    expect(refused).toHaveBeenCalledTimes(1);
    const down = vi.fn(async () => Promise.reject(new TypeError('offline')));
    vi.stubGlobal('fetch', down);
    await expect(finishWithRetry('g', [], async () => undefined)).rejects.toMatchObject({ status: 0 });
    expect(down).toHaveBeenCalledTimes(2);
  });
});
