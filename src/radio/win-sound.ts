/** A win ad-lib not decoded this long after the win is dropped: late, it would talk over the results card. */
export const WIN_SOUND_LATE_MS = 3000;
/** A fetch and decode still unfinished after this long is given up (and forgotten, so a later try fetches again). */
export const WIN_SOUND_FETCH_MS = 15000;
/** After a failed fetch or decode, preloads (one per tile tap) leave that URL alone this long; the win itself still tries. */
export const WIN_SOUND_RETRY_MS = 60_000;

/**
 * The Secret station's win ad-lib (spec 2026-10-08 secret mode §4.6): fetched and decoded once per URL (the media host
 * allows CORS), then played once per win on the bus it is given. A failed or stalled fetch or decode is forgotten, so
 * the next try fetches again: a win at once, a preload after WIN_SOUND_RETRY_MS.
 */
export class WinSound {
  /** Seconds of the last ad-lib started (0 before any): the caller ducks the music that long. */
  lastDurationS = 0;
  private url: string | null = null;
  private decoded: Promise<AudioBuffer | null> | null = null;
  /** When each URL last failed (cleared by a success). */
  private readonly failedAt = new Map<string, number>();

  constructor(
    private readonly fetchFn: typeof fetch = (input, init) => fetch(input, init),
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** The last fetch or decode of `url` failed, and none has succeeded since. */
  failing(url: string): boolean {
    return this.failedAt.has(url);
  }

  /** Fetches and decodes `url` ahead of the win, unless it is under way, done, or failed less than a minute ago. */
  preload(url: string | null, ctx: AudioContext | null): void {
    const failed = url === null ? undefined : this.failedAt.get(url);
    if (failed !== undefined && this.now() - failed < WIN_SOUND_RETRY_MS) return;
    this.load(url, ctx);
  }

  private load(url: string | null, ctx: AudioContext | null): void {
    if (!url || !ctx || (url === this.url && this.decoded)) return;
    this.url = url;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A host that never answers would otherwise hold `decoded` pending for the whole session.
    const stalled = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abort.abort();
        reject(new Error('timed out'));
      }, WIN_SOUND_FETCH_MS);
    });
    const load = this.fetchFn(url, { mode: 'cors', signal: abort.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((bytes) => ctx.decodeAudioData(bytes));
    const job: Promise<AudioBuffer | null> = Promise.race([load, stalled])
      .then((buffer) => {
        this.failedAt.delete(url);
        return buffer;
      })
      .catch(() => {
        this.failedAt.set(url, this.now());
        if (this.decoded === job) this.decoded = null;
        return null;
      })
      .finally(() => clearTimeout(timer));
    this.decoded = job;
  }

  /**
   * Plays `url` once on `out` as soon as it is decoded, if that is within WIN_SOUND_LATE_MS and `still()` says the
   * moment hasn't passed (the win's tree is still in play). Resolves whether it played.
   */
  async play(
    url: string,
    ctx: AudioContext,
    out: AudioNode,
    clock: () => number = () => performance.now(),
    still: () => boolean = () => true,
  ): Promise<boolean> {
    const asked = clock();
    this.load(url, ctx);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), WIN_SOUND_LATE_MS);
    });
    const buffer = await Promise.race([this.decoded, late]);
    clearTimeout(timer);
    if (!buffer || this.url !== url || clock() - asked > WIN_SOUND_LATE_MS || !still()) return false;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(out);
    src.start();
    this.lastDurationS = buffer.duration;
    return true;
  }
}
