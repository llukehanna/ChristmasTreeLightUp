import type { BeatFrame } from './renderer';

/** What the frame needs from the beat tracker (src/radio/beat.ts). */
export interface BeatSource {
  readonly at: number;
  readonly strength: number;
  readonly strong: number;
}

/**
 * Secret mode's beat for this frame (spec 2026-10-08 secret mode §5.2), written into `out` (no allocation). While the
 * music drives it (`live`), the tracker's last onset, strength and palette step. Otherwise no onset (no pulse, nod or
 * beat bob) but the palette step held, so pausing the music never snaps every bulb back to its base hue and jumping
 * them forward again on resume. No palette step under reduced motion.
 */
export function fillBeatFrame(out: BeatFrame, b: BeatSource, live: boolean, reduced: boolean): BeatFrame {
  out.at = live ? b.at : Number.NEGATIVE_INFINITY;
  out.strength = live ? b.strength : 0;
  out.hue = reduced ? 0 : b.strong;
  return out;
}
