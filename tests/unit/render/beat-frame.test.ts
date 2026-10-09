import { describe, expect, it } from 'vitest';
import { fillBeatFrame } from '../../../src/render/beat-frame';
import { beatPulse, garlandBob, nodPulse } from '../../../src/render/beat-fx';
import type { BeatFrame } from '../../../src/render/renderer';

describe('fillBeatFrame', () => {
  const tracker = { at: 1000, strength: 0.8, strong: 4 };
  const fresh = (): BeatFrame => ({ at: 0, strength: 0, hue: 0 });

  it('while the music drives it: the last onset, its strength and the palette step, in the same object', () => {
    const out = fresh();
    expect(fillBeatFrame(out, tracker, true, false)).toBe(out);
    expect(out).toEqual({ at: 1000, strength: 0.8, hue: 4 });
  });

  it('music paused: no onset (no pulse, nod or beat bob), but the palette step is held', () => {
    const out = fillBeatFrame(fresh(), tracker, false, false);
    expect(out.hue).toBe(4);
    const now = 1100; // within an onset's reach, had it been live
    expect(beatPulse(now - out.at, out.strength, false)).toBe(0);
    expect(out.strength * nodPulse(now - out.at)).toBe(0);
    expect(garlandBob(now, out.at, out.strength, false)).toBe(garlandBob(now, Number.NEGATIVE_INFINITY, 0, false));
    // And back with the music: the same step, no jump.
    expect(fillBeatFrame(out, tracker, true, false).hue).toBe(4);
  });

  it('no palette step under reduced motion, live or not', () => {
    expect(fillBeatFrame(fresh(), tracker, true, true).hue).toBe(0);
    expect(fillBeatFrame(fresh(), tracker, false, true).hue).toBe(0);
  });
});
