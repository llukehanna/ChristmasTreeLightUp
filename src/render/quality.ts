/**
 * Adaptive quality (spec §4.6): drop a tier after ~1s of frames over 22ms, recover after ~5s under 18ms.
 * Tier 1: two bloom passes. Tier 2: + half particles/snow. Tier 3: + no reflection/embers.
 *
 * The rAF interval is the primary signal: most of the cost (blur, composites) runs deferred on the GPU, so the
 * frame's own JS work time alone would miss a GPU-bound device. The work time only excuses a steady 30 Hz cap
 * (iOS Low Power Mode): an interval in the cap band with light work is not a slow device, and counts as smooth.
 */
const CAP_MIN = 30;
const CAP_MAX = 36.5;

export class QualityGovernor {
  tier = 0;
  private slow = 0;
  private fast = 0;

  /** `intervalMs` is the rAF interval (also the wall time counted towards the windows); `workMs` the frame's JS work. */
  sample(intervalMs: number, workMs = 0): number {
    const capped = intervalMs >= CAP_MIN && intervalMs <= CAP_MAX && workMs < 12;
    if (intervalMs > 22 && !capped) {
      this.slow += intervalMs;
      this.fast = 0;
      if (this.slow > 1000 && this.tier < 3) {
        this.tier++;
        this.slow = 0;
      }
    } else if (intervalMs < 18 || (capped && workMs < 8)) {
      this.fast += intervalMs;
      this.slow = 0;
      if (this.fast > 5000 && this.tier > 0) {
        this.tier--;
        this.fast = 0;
      }
    } else {
      this.slow = 0;
      this.fast = 0;
    }
    return this.tier;
  }
}

/**
 * While only ambient motion is moving (snow, twinkle, flicker), frames come at most this often: 30 Hz on a 60 or
 * 120 Hz display. The puzzle spends most of its time here, while the player thinks.
 */
export const CALM_FRAME_MS = 28;
/** Full rate holds this long after the last thing the player caused, so nothing steps down mid-settle. */
export const CALM_AFTER_MS = 1200;

/** Whether a frame is due `sinceLastMs` after the last one drawn. Busy frames are never skipped (no cap at any refresh rate). */
export const frameDue = (sinceLastMs: number, calm: boolean): boolean => !calm || sinceLastMs >= CALM_FRAME_MS;

/** What decides whether the main loop's frame may be a calm (30 Hz) one. */
export interface CalmState {
  now: number;
  /** Full rate holds until this time (the player's last motion plus CALM_AFTER_MS). */
  busyUntil: number;
  paused: boolean;
  /** The post-win light show, or secret mode's beat, is running: they follow the music, frame by frame. */
  musicDriven: boolean;
  /** A sky sweep is under way. */
  sweeping: boolean;
  /** A topper flip (or a sticker still loading) needs frames. */
  topperNeedsFrame: boolean;
}

/**
 * Whether the frame is ambient-only (so at most one every CALM_FRAME_MS). A sweep or a flip is the player's and never
 * calm. While paused the stage is a single blurred frame (the frost animates on its own rAF only while it moves), so
 * a paused loop is calm: it wakes at 30 Hz at most, not at every vsync. Otherwise calm needs the grace period over and
 * no music driving the frames.
 */
export const isCalm = (c: CalmState): boolean =>
  !c.sweeping && !c.topperNeedsFrame && (c.paused || (c.now >= c.busyUntil && !c.musicDriven));
