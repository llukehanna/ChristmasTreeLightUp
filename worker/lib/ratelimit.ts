/** Key for a limiter that counts all callers together (use a separate, looser limiter for it). */
export const GLOBAL_KEY = '*';

/** Basic per-instance limiter (spec §7: "a basic rate limit applies to login attempts"). */
export class RateLimiter {
  private readonly hits = new Map<string, { n: number; reset: number }>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  /** Number of tracked keys (for tests and monitoring). */
  get size(): number {
    return this.hits.size;
  }

  allow(key: string, now: number): boolean {
    const h = this.hits.get(key);
    if (!h || now > h.reset) {
      // Delete first so a reused key moves to the end of the insertion order (oldest-first eviction).
      this.hits.delete(key);
      this.hits.set(key, { n: 1, reset: now + this.windowMs });
      if (this.hits.size > this.maxKeys) this.shrink(now);
      return true;
    }
    h.n++;
    return h.n <= this.max;
  }

  /** Drop expired entries; if still over the bound, drop the oldest keys. Never clears the whole map. */
  private shrink(now: number): void {
    for (const [k, h] of this.hits) if (now > h.reset) this.hits.delete(k);
    for (const k of this.hits.keys()) {
      if (this.hits.size <= this.maxKeys) break;
      this.hits.delete(k);
    }
  }
}
