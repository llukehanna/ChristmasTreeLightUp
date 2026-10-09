/** A win ad-lib not decoded this long after the win is dropped: late, it would talk over the results card. */
export const WIN_SOUND_LATE_MS = 3000;
/** A fetch and decode still unfinished after this long is given up (and forgotten, so a later try fetches again). */
export const WIN_SOUND_FETCH_MS = 15000;

/**
 * The Secret station's win ad-lib (spec 2026-10-08 secret mode §4.6): fetched and decoded once per URL (the media host
 * allows CORS), then played once per win on the bus it is given. A failed or stalled fetch or decode is forgotten, so
 * the next try fetches again.
 */
export class WinSound {
  /** Seconds of the last ad-lib started (0 before any): the caller ducks the music that long. */
  lastDurationS = 0;
  private url: string | null = null;
  private decoded: Promise<AudioBuffer | null> | null = null;

  constructor(private readonly fetchFn: typeof fetch = (input, init) => fetch(input, init)) {}

  preload(url: string | null, ctx: AudioContext | null): void {
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
      .catch(() => {
        if (this.decoded === job) this.decoded = null;
        return null;
      })
      .finally(() => clearTimeout(timer));
    this.decoded = job;
  }

  /** Plays `url` once on `out` as soon as it is decoded, if that is within WIN_SOUND_LATE_MS. Resolves whether it played. */
  async play(url: string, ctx: AudioContext, out: AudioNode, clock: () => number = () => performance.now()): Promise<boolean> {
    const asked = clock();
    this.preload(url, ctx);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), WIN_SOUND_LATE_MS);
    });
    const buffer = await Promise.race([this.decoded, late]);
    clearTimeout(timer);
    if (!buffer || this.url !== url || clock() - asked > WIN_SOUND_LATE_MS) return false;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(out);
    src.start();
    this.lastDurationS = buffer.duration;
    return true;
  }
}
