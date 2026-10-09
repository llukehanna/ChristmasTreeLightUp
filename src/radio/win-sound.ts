/** A win ad-lib not decoded this long after the win is dropped: late, it would talk over the results card. */
export const WIN_SOUND_LATE_MS = 3000;

/**
 * The Secret station's win ad-lib (spec 2026-10-08 secret mode §4.6): fetched and decoded once per URL (the media host
 * allows CORS), then played once per win on the bus it is given. A failed fetch or decode is forgotten, so the next
 * try fetches again.
 */
export class WinSound {
  private url: string | null = null;
  private decoded: Promise<AudioBuffer | null> | null = null;

  constructor(private readonly fetchFn: typeof fetch = (input, init) => fetch(input, init)) {}

  preload(url: string | null, ctx: AudioContext | null): void {
    if (!url || !ctx || (url === this.url && this.decoded)) return;
    this.url = url;
    const job: Promise<AudioBuffer | null> = this.fetchFn(url, { mode: 'cors' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((bytes) => ctx.decodeAudioData(bytes))
      .catch(() => {
        if (this.decoded === job) this.decoded = null;
        return null;
      });
    this.decoded = job;
  }

  /** Plays `url` once on `out` as soon as it is decoded. Resolves whether it played. */
  async play(url: string, ctx: AudioContext, out: AudioNode, clock: () => number = () => performance.now()): Promise<boolean> {
    const asked = clock();
    this.preload(url, ctx);
    const buffer = await this.decoded;
    if (!buffer || this.url !== url || clock() - asked > WIN_SOUND_LATE_MS) return false;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(out);
    src.start();
    return true;
  }
}
