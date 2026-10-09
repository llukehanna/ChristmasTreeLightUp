import { cacheHeight, cacheWidth, dimmed, resample } from './topper';

/** Each place a face shows keeps its own size. */
export type FaceSlot = 'ornament' | 'garland' | 'confetti' | 'paper';

interface Cached {
  h: number;
  lit: HTMLCanvasElement;
  dim: HTMLCanvasElement;
}

/**
 * Secret mode's faces (spec 2026-10-08 secret mode §3), from the topper's sticker: per slot a lit and a dimmed (night)
 * copy at the size it is drawn, in 8 px steps like the topper's own, so frames reuse them and a zoom rebuilds rarely.
 */
export class FaceSprites {
  private readonly cache = new Map<FaceSlot, Cached>();
  private source: HTMLImageElement | null = null;
  /** Building a copy failed (no 2D context): faces fall back for good, as the topper does. */
  private broken = false;

  constructor(private readonly image: () => HTMLImageElement | null) {}

  get ready(): boolean {
    return !this.broken && this.image() !== null;
  }

  /** The sticker `size` device px tall (capped at its own), lit or dimmed; null until it has loaded. */
  get(slot: FaceSlot, size: number, lit: boolean): HTMLCanvasElement | null {
    const img = this.image();
    if (!img || this.broken) return null;
    if (img !== this.source) {
      for (const c of this.cache.values()) c.lit.width = c.lit.height = c.dim.width = c.dim.height = 0;
      this.cache.clear();
      this.source = img;
    }
    const h = cacheHeight(img, size);
    let c = this.cache.get(slot);
    if (!c || c.h !== h) {
      try {
        const l = resample(img, cacheWidth(img, h), h);
        const next = { h, lit: l, dim: dimmed(l, false) };
        if (c) c.lit.width = c.lit.height = c.dim.width = c.dim.height = 0;
        this.cache.set(slot, next);
        c = next;
      } catch {
        this.broken = true;
        return null;
      }
    }
    return lit ? c.lit : c.dim;
  }
}
