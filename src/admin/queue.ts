/**
 * The admin's upload queue: no DOM, so it is unit-tested with a fake upload function.
 *
 * - At most `concurrency` uploads run at once (3 by default); files added at any time join the end of the queue.
 * - Results are handed to `onComplete` in the order the files were queued, not the order they finish: a finished file
 *   waits until every file queued before it is done or has failed.
 * - A failed file stays in the list with its error until it is retried; a retry re-queues it.
 * - An error `requeueOn` accepts (an expired session) puts the file back in the queue and pauses the queue until
 *   `resume()`, so nothing is lost while the admin signs in again.
 */

export type ItemState = 'queued' | 'uploading' | 'done' | 'failed';

export interface QueueItem<J> {
  readonly id: number;
  readonly job: J;
  state: ItemState;
  /** Upload progress, 0–100, while uploading. */
  pct: number;
  /** Why it failed ('' unless failed). */
  error: string;
}

export interface QueueOptions<J, T> {
  run: (job: J, onProgress: (pct: number) => void) => Promise<T>;
  /** Each finished file's result, in queue order. */
  onComplete: (item: QueueItem<J>, result: T) => void;
  /** Any change to an item's state, progress or error. */
  onChange?: (item: QueueItem<J>) => void;
  /** True for errors that should pause the queue and re-queue the file instead of failing it. */
  requeueOn?: (error: unknown) => boolean;
  concurrency?: number;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e)) || 'Upload failed';

export class UploadQueue<J, T> {
  private list: QueueItem<J>[] = [];
  /** Items not yet handed to onComplete (or skipped as failed), in queue order. */
  private waiting: QueueItem<J>[] = [];
  private results = new Map<number, T>();
  private running = 0;
  private nextId = 1;
  private isPaused = false;
  private readonly concurrency: number;

  constructor(private readonly opts: QueueOptions<J, T>) {
    this.concurrency = opts.concurrency ?? 3;
  }

  /** Every item still listed (cleared ones are gone), in the order they were added. */
  get items(): readonly QueueItem<J>[] {
    return this.list;
  }

  get paused(): boolean {
    return this.isPaused;
  }

  /** Files are queued, uploading, or finished but waiting for an earlier file. */
  get busy(): boolean {
    return this.waiting.some((i) => i.state === 'queued' || i.state === 'uploading');
  }

  counts(): Record<ItemState, number> {
    const c: Record<ItemState, number> = { queued: 0, uploading: 0, done: 0, failed: 0 };
    for (const i of this.list) c[i.state]++;
    return c;
  }

  add(jobs: readonly J[]): QueueItem<J>[] {
    const added = jobs.map((job): QueueItem<J> => ({ id: this.nextId++, job, state: 'queued', pct: 0, error: '' }));
    this.list.push(...added);
    this.waiting.push(...added);
    for (const item of added) this.opts.onChange?.(item);
    this.pump();
    return added;
  }

  /** Re-queues a failed file. A file already passed over joins the end of the queue; otherwise it keeps its place. */
  retry(id: number): boolean {
    const item = this.list.find((i) => i.id === id);
    if (!item || item.state !== 'failed') return false;
    item.state = 'queued';
    item.error = '';
    item.pct = 0;
    if (!this.waiting.includes(item)) this.waiting.push(item);
    this.opts.onChange?.(item);
    this.pump();
    return true;
  }

  /** Removes finished files that have been handed over. Returns how many were removed. */
  clearFinished(): number {
    const before = this.list.length;
    this.list = this.list.filter((i) => i.state !== 'done' || this.waiting.includes(i));
    return before - this.list.length;
  }

  pause(): void {
    this.isPaused = true;
  }

  resume(): void {
    this.isPaused = false;
    this.pump();
  }

  private pump(): void {
    while (!this.isPaused && this.running < this.concurrency) {
      const next = this.waiting.find((i) => i.state === 'queued');
      if (!next) return;
      this.start(next);
    }
  }

  private start(item: QueueItem<J>): void {
    this.running++;
    item.state = 'uploading';
    item.pct = 0;
    this.opts.onChange?.(item);
    const progress = (pct: number): void => {
      if (item.state !== 'uploading') return;
      item.pct = pct;
      this.opts.onChange?.(item);
    };
    let task: Promise<T>;
    try {
      task = this.opts.run(item.job, progress);
    } catch (e) {
      task = Promise.reject(e);
    }
    task.then(
      (result) => {
        this.running--;
        item.state = 'done';
        item.pct = 100;
        this.results.set(item.id, result);
        this.opts.onChange?.(item);
        this.release();
        this.pump();
      },
      (e: unknown) => {
        this.running--;
        if (this.opts.requeueOn?.(e)) {
          item.state = 'queued';
          item.pct = 0;
          this.isPaused = true;
        } else {
          item.state = 'failed';
          item.error = message(e);
        }
        this.opts.onChange?.(item);
        this.release();
        this.pump();
      },
    );
  }

  /** Hands over finished files from the front of the queue, skipping failed ones, up to the first unfinished one. */
  private release(): void {
    while (this.waiting.length) {
      const head = this.waiting[0];
      if (head.state === 'queued' || head.state === 'uploading') return;
      this.waiting.shift();
      if (head.state === 'done') {
        const result = this.results.get(head.id) as T;
        this.results.delete(head.id);
        this.opts.onComplete(head, result);
      }
    }
  }
}
