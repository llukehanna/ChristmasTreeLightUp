import { describe, expect, it } from 'vitest';
import { UploadQueue, type QueueItem } from '../../../src/admin/queue';

interface Call {
  job: string;
  progress: (pct: number) => void;
  resolve: (v: string) => void;
  reject: (e: unknown) => void;
}

/** A queue whose uploads finish only when the test says so. */
function harness(opts: { concurrency?: number; requeueOn?: (e: unknown) => boolean } = {}) {
  const calls: Call[] = [];
  const done: string[] = [];
  const changes: QueueItem<string>[] = [];
  let running = 0;
  let maxRunning = 0;
  const q = new UploadQueue<string, string>({
    ...opts,
    run: (job, progress) =>
      new Promise<string>((resolve, reject) => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        const settle = <T>(f: (v: T) => void) => (v: T) => {
          running--;
          f(v);
        };
        calls.push({ job, progress, resolve: settle(resolve), reject: settle(reject) });
      }),
    onComplete: (item, result) => done.push(`${item.job}:${result}`),
    onChange: (item) => changes.push({ ...item }),
  });
  const call = (job: string): Call => {
    const found = [...calls].reverse().find((c) => c.job === job);
    if (!found) throw new Error(`${job} never started`);
    return found;
  };
  return { q, calls, done, changes, call, maxRunning: () => maxRunning, started: () => calls.map((c) => c.job) };
}
/** Lets settled promises run their handlers. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('UploadQueue', () => {
  it('adds finished uploads in the order they were queued, not the order they finish', async () => {
    const h = harness();
    h.q.add(['A', 'B', 'C']);
    expect(h.started()).toEqual(['A', 'B', 'C']);
    h.call('C').resolve('c');
    await flush();
    expect(h.done).toEqual([]); // C waits for A and B
    expect(h.q.items.find((i) => i.job === 'C')?.state).toBe('done');
    h.call('A').resolve('a');
    await flush();
    expect(h.done).toEqual(['A:a']); // B still blocks C
    h.call('B').resolve('b');
    await flush();
    expect(h.done).toEqual(['A:a', 'B:b', 'C:c']);
  });

  it('runs at most 3 at once, and files added later join the queue', async () => {
    const h = harness();
    h.q.add(['1', '2', '3', '4']);
    expect(h.started()).toEqual(['1', '2', '3']);
    expect(h.q.counts()).toEqual({ queued: 1, uploading: 3, done: 0, failed: 0 });
    h.q.add(['5', '6']);
    expect(h.started()).toEqual(['1', '2', '3']);
    h.call('2').resolve('');
    await flush();
    expect(h.started()).toEqual(['1', '2', '3', '4']);
    for (const j of ['1', '3', '4']) h.call(j).resolve('');
    await flush();
    for (const j of ['5', '6']) h.call(j).resolve('');
    await flush();
    expect(h.maxRunning()).toBe(3);
    expect(h.done).toEqual(['1:', '2:', '3:', '4:', '5:', '6:']);
    expect(h.q.busy).toBe(false);
  });

  it('reports progress and failures per file; a failure does not hold back later files', async () => {
    const h = harness();
    h.q.add(['A', 'B', 'C']);
    h.call('A').progress(42.4);
    expect(h.q.items[0]).toMatchObject({ state: 'uploading', pct: 42.4 });
    h.call('A').reject(new Error('The file is too large (30 MB max)'));
    h.call('B').resolve('b');
    await flush();
    expect(h.q.items[0]).toMatchObject({ state: 'failed', error: 'The file is too large (30 MB max)' });
    expect(h.done).toEqual(['B:b']);
    expect(h.changes.some((c) => c.job === 'A' && c.state === 'failed')).toBe(true);
  });

  it('re-queues a failed file on retry, after the files queued before the retry', async () => {
    const h = harness();
    const [a] = h.q.add(['A', 'B', 'C']);
    h.call('A').reject(new Error('Upload failed. Try again.'));
    await flush();
    expect(h.q.retry(a.id)).toBe(true);
    expect(h.q.items[0]).toMatchObject({ state: 'uploading', error: '', pct: 0 });
    expect(h.started()).toEqual(['A', 'B', 'C', 'A']);
    h.call('A').resolve('a');
    await flush();
    expect(h.done).toEqual([]); // B and C were queued first
    h.call('B').resolve('b');
    h.call('C').resolve('c');
    await flush();
    expect(h.done).toEqual(['B:b', 'C:c', 'A:a']);
    expect(h.q.retry(a.id)).toBe(false); // only failed files can be retried
  });

  it('a retried file that has not been passed yet keeps its place', async () => {
    const h = harness();
    const [, b] = h.q.add(['A', 'B', 'C']);
    h.call('B').reject(new Error('x')); // A is still uploading, so B has not been passed
    await flush();
    expect(h.q.retry(b.id)).toBe(true);
    h.call('C').resolve('c');
    h.call('B').resolve('b');
    await flush();
    expect(h.done).toEqual([]);
    h.call('A').resolve('a');
    await flush();
    expect(h.done).toEqual(['A:a', 'B:b', 'C:c']);
  });

  it('pauses on an error the caller marks as re-queueable, and resumes', async () => {
    const expired = new Error('expired');
    const h = harness({ concurrency: 1, requeueOn: (e) => e === expired });
    h.q.add(['A', 'B']);
    h.call('A').reject(expired);
    await flush();
    expect(h.q.paused).toBe(true);
    expect(h.q.items[0]).toMatchObject({ state: 'queued', error: '' });
    expect(h.started()).toEqual(['A']); // nothing new starts while paused
    expect(h.q.busy).toBe(true);
    h.q.resume();
    expect(h.started()).toEqual(['A', 'A']);
    h.call('A').resolve('a');
    await flush();
    h.call('B').resolve('b');
    await flush();
    expect(h.done).toEqual(['A:a', 'B:b']);
  });

  it('clears finished rows but keeps failed and running ones', async () => {
    const h = harness();
    h.q.add(['A', 'B', 'C', 'D']);
    h.call('A').resolve('a');
    h.call('B').reject(new Error('no'));
    await flush();
    expect(h.q.clearFinished()).toBe(1);
    expect(h.q.items.map((i) => `${i.job}:${i.state}`)).toEqual(['B:failed', 'C:uploading', 'D:uploading']);
  });

  it('a done file waiting for an earlier one is not cleared, and still lands in order', async () => {
    const h = harness();
    h.q.add(['A', 'B']);
    h.call('B').resolve('b');
    await flush();
    expect(h.q.clearFinished()).toBe(0);
    h.call('A').resolve('a');
    await flush();
    expect(h.done).toEqual(['A:a', 'B:b']);
  });
});
