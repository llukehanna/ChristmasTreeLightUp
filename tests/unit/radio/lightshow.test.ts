import { describe, expect, it, vi } from 'vitest';
import { BEAT } from '../../../src/radio/beat';
import { BEAT_FFT, BEAT_SMOOTHING, BeatDetector, FLUX, LightShow, TAP_DEAD_MS, bandEnergies, binHi, binLo, onsetFlux } from '../../../src/radio/lightshow';

it('splits spectrum energy into low / mid / high bands (0..1)', () => {
  const bins = new Uint8Array(512);
  for (let i = 0; i < 3; i++) bins[i] = 255; // ~0–129 Hz at 43 Hz per bin
  const e = bandEnergies(bins, 43);
  expect(e.low).toBeGreaterThan(0.5);
  expect(e.mid).toBe(0);
  expect(e.high).toBe(0);
});

it('detects beats as low-energy jumps, with a cooldown', () => {
  const d = new BeatDetector();
  let beats = 0;
  for (let t = 0; t < 2000; t += 20) {
    const kick = t % 500 < 40 ? 0.8 : 0.15;
    if (d.update(kick, t)) beats++;
  }
  expect(beats).toBeGreaterThanOrEqual(3);
  expect(beats).toBeLessThanOrEqual(4);
});

it('pulses bulbs bottom row first after a beat', () => {
  const show = new LightShow(() => null);
  show.beatAt = 1000;
  expect(show.extraBulb(8, 1000 + 30)).toBeGreaterThan(show.extraBulb(0, 1000 + 30));
  expect(show.extraBulb(8, 5000)).toBeLessThan(0.01);
});

it('binLo, binHi: the bins between two frequencies, clamped to the spectrum', () => {
  expect([binLo(43, 20), binHi(512, 43, 150)]).toEqual([0, 4]);
  expect([binLo(46.875, 150), binHi(512, 46.875, 2000)]).toEqual([3, 43]);
  expect([binLo(43, 2000), binHi(8, 43, 8000)]).toEqual([46, 8]); // empty
});

/**
 * Float spectra (dB) modelled on what Chromium's analyser showed for the synthesized mixes (spec §5.1): the beat tap's
 * 2048 points at 48 kHz. `at(hz)` gives each bin's level.
 */
const HZ = 48_000 / BEAT_FFT;
const N = BEAT_FFT / 2;
const spectrum = (at: (hz: number) => number): Float32Array => Float32Array.from({ length: N }, (_, i) => at(i * HZ));
/** The bin at `hz` is one of `band`'s, as onsetFlux reads it (binRange). */
const inBand = (hz: number, band: readonly [number, number]) => {
  const i = Math.round(hz / HZ);
  return i >= binLo(HZ, band[0]) && i < binHi(N, HZ, band[1]);
};
/** A quiet mix: everything at -90 dB. */
const quiet = () => -90;
/** A held 808 (49 Hz, saturated): loud below 120 Hz, its odd harmonics fading above. */
const held808 = (hz: number) => (hz < 120 ? -17 : hz < 260 ? -33 : -80);
/** A deterministic wobble of ±`db` per bin and frame (pads, detuned saws beating). */
function wobble(db: number) {
  let s = 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5) * 2 * db;
}

/** onsetFlux from `from` to `to`, the scratch sized as LightShow sizes it. */
function flux(from: Float32Array, to: Float32Array): number {
  const prev = new Float32Array(N).fill(Number.NaN);
  const sorted = new Float32Array(binHi(N, HZ, FLUX.duckBand[1]) - binLo(HZ, FLUX.duckBand[0]));
  onsetFlux(from, prev, sorted, HZ);
  return onsetFlux(to, prev, sorted, HZ);
}

describe('onsetFlux', () => {
  it('reads 0 on the first frame, and keeps each frame (floored) for the next', () => {
    const prev = new Float32Array(N).fill(Number.NaN);
    const sorted = new Float32Array(32);
    const s = spectrum((hz) => (hz < 100 ? Number.NEGATIVE_INFINITY : -40));
    expect(onsetFlux(s, prev, sorted, HZ)).toBe(0);
    expect(prev[0]).toBe(FLUX.floorDb); // silence reads the floor
    expect(prev[N - 1]).toBe(-40);
  });

  it('a clean kick: the kick band and its click rise together, far over the floor', () => {
    const kick = spectrum((hz) => (inBand(hz, FLUX.kickBand) ? -50 : inBand(hz, FLUX.clickBand) ? -70 : -90));
    const e = flux(spectrum(quiet), kick);
    expect(e).toBeGreaterThan(3 * BEAT.floor);
    // Kick +40 (capped), click +20, and most of the new power low: the click's 20 dB is little power.
    expect(e).toBeLessThanOrEqual(40 * (1 + (FLUX.clickWeight * 20) / FLUX.capDb));
  });

  it('a rapped syllable: its formants take the new power, so its low rise is no beat', () => {
    // Before: a quiet mix. After: the voice's low harmonics up 10 dB, its formants (250 Hz – 4 kHz) up 25 dB.
    const syllable = spectrum((hz) => (inBand(hz, FLUX.kickBand) ? -60 : inBand(hz, FLUX.voiceBand) ? -45 : -70));
    expect(flux(spectrum(() => -70), syllable)).toBeLessThan(BEAT.floor / 10);
    // The same low rise with the voice holding steady (a kick under a held word) is a beat.
    const held = (hz: number) => (inBand(hz, FLUX.voiceBand) && !inBand(hz, FLUX.kickBand) ? -45 : -70);
    const kick = spectrum((hz) => (inBand(hz, FLUX.kickBand) ? -60 : held(hz)));
    expect(flux(spectrum(held), kick)).toBeGreaterThan(BEAT.floor);
  });

  it('a kick over a held 808: the 808 owns the bins below 120 Hz, the kick still shows above them', () => {
    const kick = spectrum((hz) => (inBand(hz, FLUX.kickBand) ? -23 : held808(hz)));
    expect(flux(spectrum(held808), kick)).toBeGreaterThan(BEAT.floor); // +10 dB of punch
    // The 808 alone, wobbling a little: nothing.
    const w = wobble(1);
    expect(flux(spectrum(held808), spectrum((hz) => held808(hz) + w()))).toBeLessThan(BEAT.floor);
  });

  it('hats alone (a click with no kick under it) count for nothing', () => {
    const hat = spectrum((hz) => (inBand(hz, FLUX.clickBand) ? -60 : held808(hz)));
    expect(flux(spectrum(held808), hat)).toBe(0);
  });

  it('a loud master: the kick is measured against the limiter ducking the rest of the mix', () => {
    // The limiter pulls everything down 3 dB on the kick; the kick band ends only 2 dB up, 5 dB over the duck.
    const before = spectrum((hz) => (inBand(hz, FLUX.kickBand) ? -30 : -20));
    const after = spectrum((hz) => (inBand(hz, FLUX.kickBand) ? -28 : -23));
    expect(flux(before, after)).toBeCloseTo(5);
    expect(flux(before, after)).toBeGreaterThanOrEqual(BEAT.floor);
    // Without the duck, the same kick would read 2 dB.
    const level = spectrum((hz) => (inBand(hz, FLUX.kickBand) ? -28 : -20));
    expect(flux(before, level)).toBeCloseTo(2);
  });

  it('follows a duck by at most duckMaxDb: a hard 10 dB drop of the whole mix is no kick', () => {
    // Everything falls 10 dB in a frame (a cut, an unramped duck) while the kick band happens to tick up 1 dB.
    const after = spectrum((hz) => (inBand(hz, FLUX.kickBand) ? -19 : -30));
    const e = flux(spectrum(() => -20), after);
    expect(e).toBeCloseTo(1 + FLUX.duckMaxDb); // not 1 + 10
    expect(e).toBeLessThan(BEAT.floor);
  });

  it('pads wobbling ±3 dB per bin never reach the floor', () => {
    const w = wobble(3);
    const pad = (hz: number) => (hz < 1400 ? -25 : -60);
    let prevSpec = spectrum(pad);
    let max = 0;
    for (let k = 0; k < 500; k++) {
      const next = spectrum((hz) => pad(hz) + w());
      max = Math.max(max, flux(prevSpec, next));
      prevSpec = next;
    }
    expect(max).toBeLessThan(BEAT.floor);
  });

  it('caps each bin’s rise, so silence turning to sound can’t outweigh the rest', () => {
    const from = spectrum(() => Number.NEGATIVE_INFINITY);
    const to = spectrum((hz) => (inBand(hz, FLUX.kickBand) ? 0 : Number.NEGATIVE_INFINITY));
    expect(flux(from, to)).toBeCloseTo(FLUX.capDb); // the kick band +100 dB, capped
  });
});

/** The radio's analyser and the context, for LightShow: `tapDb()` is what the beat tap reads each frame. */
function fakeRadio(tapDb: () => Float32Array, { tap = true } = {}) {
  const made: { fftSize: number; smoothingTimeConstant: number }[] = [];
  const context = {
    sampleRate: 48_000,
    createAnalyser() {
      if (!tap) throw new Error('no analysers here');
      const t = {
        fftSize: 0,
        smoothingTimeConstant: 0,
        context,
        get frequencyBinCount() {
          return this.fftSize / 2;
        },
        getFloatFrequencyData: (out: Float32Array) => out.set(tapDb()),
      };
      made.push(t);
      return t;
    },
  };
  const radio = {
    frequencyBinCount: 512,
    fftSize: 1024,
    context,
    getByteFrequencyData: (out: Uint8Array) => out.fill(100),
    getFloatFrequencyData: vi.fn((out: Float32Array) => out.fill(-60)),
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  return { radio: radio as unknown as AnalyserNode, connect: radio.connect, disconnect: radio.disconnect, radioFloat: radio.getFloatFrequencyData, made };
}

describe('LightShow: secret mode’s beat', () => {
  /** 4 s at 60 fps of kicks every 500 ms (`kick` on the kick's frame, `rest` otherwise); the beats found. */
  function kicks(kick: Float32Array, rest: Float32Array) {
    let now = 0;
    const r = fakeRadio(() => (now % 500 < 1000 / 60 ? kick : rest));
    const show = new LightShow(() => r.radio);
    const beats: number[] = [];
    for (let k = 0; k < 240; k++) {
      now = (k * 1000) / 60;
      const at = show.beat.at;
      show.sample(now);
      if (show.beat.at !== at) beats.push(now);
    }
    return { beats, show, r };
  }

  it('hangs its own analyser off the radio’s, once: 2048 points, light smoothing', () => {
    const { r } = kicks(spectrum(quiet), spectrum(quiet));
    expect(r.made).toHaveLength(1);
    expect(r.made[0]).toMatchObject({ fftSize: BEAT_FFT, smoothingTimeConstant: BEAT_SMOOTHING });
    expect(r.connect).toHaveBeenCalledOnce();
    expect(r.connect).toHaveBeenCalledWith(r.made[0]);
    expect(r.radioFloat).not.toHaveBeenCalled();
  });

  it('finds a kick over a held 808 on its first frame, every time, and nothing between', () => {
    const { beats, show } = kicks(spectrum((hz) => (inBand(hz, FLUX.kickBand) ? -23 : held808(hz))), spectrum(held808));
    expect(beats).toHaveLength(7); // 500 … 3500: the kick at 0 is in the warm-up
    for (const [k, t] of beats.entries()) expect(Math.abs(t - 500 * (k + 1))).toBeLessThanOrEqual(1000 / 60);
    expect(show.beat.strong).toBe(7); // equal kicks: each is the song's peak
  });

  it('finds the kicks in a loud master, through the limiter’s duck', () => {
    const { beats } = kicks(spectrum((hz) => (inBand(hz, FLUX.kickBand) ? -28 : -23)), spectrum((hz) => (inBand(hz, FLUX.kickBand) ? -30 : -20)));
    // Each kick frame is followed by a recovery frame (the duck lifting: +6 dB everywhere but the kick band); only kicks count.
    expect(beats).toHaveLength(7);
  });

  it('falls back to the radio’s own analyser when it can’t make one', () => {
    const r = fakeRadio(() => spectrum(quiet), { tap: false });
    const show = new LightShow(() => r.radio);
    show.sample(0);
    show.sample(17);
    expect(r.radioFloat).toHaveBeenCalledTimes(2);
  });

  it('drops a tap that hears nothing while the radio hears music, for the radio’s own analyser', () => {
    const r = fakeRadio(() => spectrum(() => Number.NEGATIVE_INFINITY));
    const show = new LightShow(() => r.radio);
    for (let t = 0; t < TAP_DEAD_MS; t += 1000 / 60) show.sample(t);
    expect(r.radioFloat).not.toHaveBeenCalled();
    show.sample(TAP_DEAD_MS + 20);
    expect(r.disconnect).toHaveBeenCalledWith(r.made[0]);
    show.sample(TAP_DEAD_MS + 40);
    expect(r.radioFloat).toHaveBeenCalled();
  });

  it('a new analyser from the radio: the old tap is unhooked and a new one made', () => {
    const one = fakeRadio(() => spectrum(quiet));
    const two = fakeRadio(() => spectrum(quiet));
    let radio = one.radio;
    const show = new LightShow(() => radio);
    show.sample(0);
    radio = two.radio;
    show.sample(17);
    expect(one.disconnect).toHaveBeenCalledWith(one.made[0]);
    expect(two.made).toHaveLength(1);
    expect(two.connect).toHaveBeenCalledWith(two.made[0]);
  });

  it('starts the flux afresh after a gap: a stale spectrum is no beat', () => {
    let db = spectrum(quiet);
    const r = fakeRadio(() => db);
    const show = new LightShow(() => r.radio);
    const update = vi.spyOn(show.beat, 'update');
    for (let t = 0; t <= 1000; t += 1000 / 60) show.sample(t);
    db = spectrum(() => -20); // the music back, much louder, after the tab was hidden
    show.sample(4000);
    expect(update).toHaveBeenLastCalledWith(0, 4000);
    show.sample(4017);
    expect(update).toHaveBeenLastCalledWith(0, 4017); // and steady from there
  });
});
