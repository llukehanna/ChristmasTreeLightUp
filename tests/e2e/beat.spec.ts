import { expect, test, type Page } from '@playwright/test';
import { build } from 'vite';

/**
 * Secret mode's beat in real Chromium (spec 2026-10-08 secret mode §5.1): synthesized mixes rendered in an
 * OfflineAudioContext, wired as the radio wires the music bus (src/radio/radio.ts: the bus to the speakers, and an
 * analyser of 1024 points, smoothing 0.6, as a dead-end tap), and the real LightShow sampling it once per frame at 60 and
 * 30 fps, with a browser's jitter. Needs no server: the page is about:blank.
 */

interface Mix {
  name: string;
  bpm: number;
  /** Beats per pattern; every list below is in beats within it. */
  len: number;
  kicks: number[];
  /** 808 notes, each held until the next (or the pattern's end). */
  b808: number[];
  hats: number[];
  snares: number[];
  /** A pad of detuned saws, a new chord every `padChange` s (attack 0.4 s). */
  pad: number;
  padChange: number;
  bus: number;
  /** A loud master: compressor, makeup and limiter. */
  master: boolean;
  /** Levels (defaults 0.9, 0.8, 0.25). */
  kickLevel?: number;
  b808Level?: number;
  hatLevel?: number;
  /** A rapped voice at this level: formant-filtered saw syllables every 120–180 ms, with consonants and breaths. */
  vocal?: number;
  /** A legato 808 line, gliding (80 ms) to each beat's note in Hz: pitch moves, nothing attacks. */
  slide?: number[];
  /** [least kicks found, as a fraction of those after the warm-up; most false beats], per frame rate. */
  expect: { 60: [number, number]; 30: [number, number] };
  /** A kick mix: at least half its beats should be strong (the palette steps on them). */
  strong?: boolean;
}

const eighths = (xs: number[]) => xs.map((x) => x / 2);
const NONE = { len: 4, kicks: [], b808: [], hats: [], snares: [], pad: 0, padChange: 0 };
const FOUR = { len: 4, kicks: [0, 1, 2, 3], b808: [], hats: [], snares: [], pad: 0, padChange: 0 };
const TRAP = { len: 8, kicks: eighths([0, 3, 10, 13]), b808: eighths([0, 3, 10, 13]), hats: [...eighths([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]), 7, 7.25, 7.5, 7.75], snares: [4], pad: 0.15, padChange: 4 };
const SLIDE = [49, 62, 55, 49, 65.4, 58.3, 49, 73.4];
const MIXES: Mix[] = [
  { name: 'a clean kick', bpm: 120, ...FOUR, bus: 0.6, master: false, expect: { 60: [1, 0], 30: [1, 0] }, strong: true },
  { name: 'a kick over a held 808 at near-kick level', bpm: 120, ...FOUR, b808: [0], bus: 0.6, master: false, expect: { 60: [1, 0], 30: [0.9, 0] }, strong: true },
  { name: 'trap at 140, half-time: kick, 808, hats, snare', bpm: 140, ...TRAP, bus: 0.6, master: false, expect: { 60: [0.85, 1], 30: [0.8, 1] }, strong: true },
  { name: 'the same trap, loud mastered', bpm: 140, ...TRAP, bus: 1.6, master: true, expect: { 60: [0.85, 1], 30: [0.6, 1] }, strong: true },
  { name: 'the same trap, very quiet (bus 0.03)', bpm: 140, ...TRAP, bus: 0.03, master: false, expect: { 60: [0.8, 1], 30: [0.7, 1] }, strong: true },
  { name: 'pads only', bpm: 120, ...NONE, pad: 0.5, padChange: 2, bus: 0.6, master: false, expect: { 60: [1, 0], 30: [1, 0] } },
  { name: 'pads only, loud mastered', bpm: 120, ...NONE, pad: 0.6, padChange: 2, bus: 1.6, master: true, expect: { 60: [1, 0], 30: [1, 0] } },
  // A rapped voice: its fundamental sits in the kick band, its syllables are sharp onsets (spec §5.1).
  { name: 'a rapped voice alone', bpm: 140, ...NONE, bus: 0.6, master: false, vocal: 1, expect: { 60: [1, 4], 30: [1, 4] } },
  { name: 'a rapped voice alone, loud mastered', bpm: 140, ...NONE, bus: 1.6, master: true, vocal: 1, expect: { 60: [1, 4], 30: [1, 4] } },
  { name: 'a rapped voice over the trap', bpm: 140, ...TRAP, bus: 0.6, master: false, vocal: 1, expect: { 60: [0.6, 2], 30: [0.5, 2] } },
  { name: 'a rapped voice over the loud trap', bpm: 140, ...TRAP, bus: 1.6, master: true, vocal: 1, expect: { 60: [0.5, 2], 30: [0.5, 2] } },
  // An 808 that slides between notes: pitch moves through the kick band, but nothing attacks.
  { name: 'a sliding 808 alone', bpm: 120, ...NONE, bus: 0.6, master: false, slide: SLIDE, expect: { 60: [1, 2], 30: [1, 2] } },
  { name: 'kicks over a sliding 808', bpm: 120, ...FOUR, bus: 0.6, master: false, slide: SLIDE, expect: { 60: [0.9, 1], 30: [0.6, 1] }, strong: true },
  // Holdouts, never tuned on: softer bars.
  {
    name: 'holdout: trap at 150, another pattern, mastered', bpm: 150, len: 8, kicks: eighths([0, 5, 8, 11, 14]), b808: eighths([0, 5, 8, 14]),
    hats: eighths([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]), snares: [2, 6], pad: 0.2, padChange: 3.2, bus: 0.8, master: true,
    kickLevel: 0.8, b808Level: 0.85, hatLevel: 0.3, expect: { 60: [0.6, 2], 30: [0.6, 2] }, strong: true,
  },
  {
    name: 'holdout: kick over a held 808 at 95, hats and snares', bpm: 95, len: 4, kicks: [0, 1, 2, 3], b808: [0, 2], hats: [0.5, 1.5, 2.5, 3.5],
    snares: [1, 3], pad: 0, padChange: 0, bus: 0.6, master: false, kickLevel: 0.85, b808Level: 0.85, hatLevel: 0.2, expect: { 60: [0.8, 2], 30: [0.8, 2] }, strong: true,
  },
];
const SECS = 8;

let bundle = '';
test.beforeAll(async () => {
  const out = await build({
    configFile: false,
    logLevel: 'silent',
    build: { write: false, minify: false, lib: { entry: 'src/radio/lightshow.ts', formats: ['iife'], name: 'AglowBeat', fileName: 'beat' } },
  });
  const first = Array.isArray(out) ? out[0] : out;
  if (!('output' in first)) throw new Error('vite build returned a watcher');
  bundle = first.output[0].type === 'chunk' ? first.output[0].code : '';
});

interface Run {
  kicks: number[];
  snares: number[];
  beats: { t: number; strength: number }[];
  rmsDb: number;
}

async function run(page: Page, mix: Mix, fps: number): Promise<Run> {
  await page.goto('about:blank');
  await page.addScriptTag({ content: bundle });
  return page.evaluate(
    async ({ mix, fps, secs }) => {
      const { LightShow } = (window as unknown as { AglowBeat: typeof import('../../src/radio/lightshow') }).AglowBeat;
      const sr = 48000;
      const ctx = new OfflineAudioContext(1, sr * secs, sr);
      const bus = ctx.createGain();
      bus.gain.value = mix.bus;
      let out: AudioNode = bus;
      if (mix.master) {
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.knee.value = 4;
        comp.ratio.value = 8;
        comp.attack.value = 0.003;
        comp.release.value = 0.12;
        const makeup = ctx.createGain();
        makeup.gain.value = 10 ** (4 / 20);
        const lim = ctx.createDynamicsCompressor();
        lim.threshold.value = -3;
        lim.knee.value = 0;
        lim.ratio.value = 20;
        lim.attack.value = 0.001;
        lim.release.value = 0.06;
        bus.connect(comp).connect(makeup).connect(lim);
        out = lim;
      }
      out.connect(ctx.destination);
      // As src/radio/radio.ts: a dead-end analyser on the music bus, and the light show reading it.
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      an.smoothingTimeConstant = 0.6;
      out.connect(an);
      const show = new LightShow(() => an);

      const noise = ctx.createBuffer(1, sr, sr);
      const nd = noise.getChannelData(0);
      let seed = 7;
      const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
      for (let i = 0; i < nd.length; i++) nd[i] = rnd() * 2 - 1;
      const burst = (t: number, dur: number, level: number, type: BiquadFilterType, f: number, decay: number) => {
        const s = ctx.createBufferSource();
        s.buffer = noise;
        const fl = ctx.createBiquadFilter();
        fl.type = type;
        fl.frequency.value = f;
        fl.Q.value = type === 'bandpass' ? 0.8 : 0.7;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(level, t + 0.001);
        g.gain.setTargetAtTime(0, t + 0.001, decay);
        s.connect(fl).connect(g).connect(bus);
        s.start(t, (t * 7.31) % 0.8, dur);
      };
      // The 808: a 49 Hz sine through a soft saturator (its odd harmonics), as trap 808s are.
      const sat = ctx.createWaveShaper();
      const curve = new Float32Array(1025);
      for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh((i / 512 - 1) * 2.5) / Math.tanh(2.5);
      sat.curve = curve;
      sat.connect(bus);

      const beat = 60 / mix.bpm;
      const kicks: number[] = [];
      const snares: number[] = [];
      for (let p = 0; p * mix.len * beat < secs; p++) {
        const p0 = p * mix.len * beat;
        for (const k of mix.kicks) {
          const t = p0 + k * beat;
          if (t >= secs - 0.5) continue;
          kicks.push(t * 1000);
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.frequency.setValueAtTime(150, t);
          o.frequency.exponentialRampToValueAtTime(45, t + 0.1);
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(mix.kickLevel ?? 0.9, t + 0.002);
          g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
          o.connect(g).connect(bus);
          o.start(t);
          o.stop(t + 0.45);
          burst(t, 0.02, (mix.kickLevel ?? 0.9) / 3, 'bandpass', 3500, 0.006); // the beater's click
        }
        mix.b808.forEach((s, i) => {
          const t = p0 + s * beat;
          if (t >= secs) return;
          const end = p0 + (i + 1 < mix.b808.length ? mix.b808[i + 1] : mix.len) * beat;
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.frequency.value = 49;
          g.gain.setValueAtTime(0, t);
          const lvl = mix.b808Level ?? 0.8;
          g.gain.linearRampToValueAtTime(lvl, t + 0.006);
          g.gain.setTargetAtTime(0.7 * lvl, t + 0.006, 1.2);
          g.gain.setValueAtTime(0.7 * lvl, end - 0.025);
          g.gain.linearRampToValueAtTime(0, end - 0.002);
          o.connect(g).connect(sat);
          o.start(t);
          o.stop(end);
        });
        for (const h of mix.hats) {
          const t = p0 + h * beat;
          if (t < secs - 0.2) burst(t, 0.06, mix.hatLevel ?? 0.25, 'highpass', 7000, 0.012);
        }
        for (const sn of mix.snares) {
          const t = p0 + sn * beat;
          if (t >= secs - 0.3) continue;
          snares.push(t * 1000);
          burst(t, 0.2, 0.5, 'bandpass', 1800, 0.06);
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.frequency.value = 190;
          g.gain.setValueAtTime(0, t);
          g.gain.linearRampToValueAtTime(0.4, t + 0.002);
          g.gain.setTargetAtTime(0, t + 0.002, 0.04);
          o.connect(g).connect(bus);
          o.start(t);
          o.stop(t + 0.3);
        }
      }
      if (mix.slide) {
        const notes = mix.slide;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.setValueAtTime(notes[0], 0);
        for (let k = 1, t = beat; t < secs; k++, t += beat) {
          o.frequency.setValueAtTime(notes[(k - 1) % notes.length], t);
          o.frequency.exponentialRampToValueAtTime(notes[k % notes.length], t + 0.08);
        }
        g.gain.setValueAtTime(0, 0);
        g.gain.linearRampToValueAtTime(0.75, 0.05);
        o.connect(g).connect(sat);
        o.start(0);
      }
      if (mix.vocal) {
        const vowels = [[730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240]];
        let vs = 11;
        const vr = () => (vs = (vs * 1664525 + 1013904223) >>> 0) / 2 ** 32;
        const voice = ctx.createGain();
        voice.gain.value = mix.vocal;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 90;
        voice.connect(hp).connect(bus);
        let sinceBreath = 0;
        for (let t = 0.15; t < secs - 0.3; ) {
          const step = 0.12 + vr() * 0.06;
          const dur = step * (0.6 + vr() * 0.3);
          const p0 = 105 + vr() * 60;
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.setValueAtTime(p0, t);
          o.frequency.linearRampToValueAtTime(Math.max(100, Math.min(170, p0 + (vr() - 0.5) * 40)), t + dur);
          const env = ctx.createGain();
          const stress = vr() < 0.3 ? 1 : 0.6;
          env.gain.setValueAtTime(0, t);
          env.gain.linearRampToValueAtTime(0.5 * stress, t + 0.012);
          env.gain.setValueAtTime(0.45 * stress, t + dur - 0.03);
          env.gain.linearRampToValueAtTime(0, t + dur);
          o.connect(env);
          for (const [k, f] of vowels[Math.floor(vr() * vowels.length)].entries()) {
            const bp = ctx.createBiquadFilter();
            bp.type = 'bandpass';
            bp.frequency.value = f;
            bp.Q.value = 6;
            const fg = ctx.createGain();
            fg.gain.value = [4.2, 2.4, 1.2][k];
            env.connect(bp).connect(fg).connect(voice);
          }
          const body = ctx.createGain(); // the fundamental and low harmonics, as a close mic gives them
          body.gain.value = 0.35;
          env.connect(body).connect(voice);
          o.start(t);
          o.stop(t + dur + 0.01);
          const c = vr();
          if (c < 0.25) burst(t, 0.015, 0.5 * mix.vocal * stress, 'bandpass', 2500, 0.004); // t, k
          else if (c < 0.4) burst(t, 0.02, 0.6 * mix.vocal * stress, 'lowpass', 300, 0.008); // b, p: a plosive's thump
          else if (c < 0.6) burst(t, 0.08, 0.25 * mix.vocal * stress, 'highpass', 4500, 0.03); // s, sh
          t += step;
          sinceBreath += step;
          if (sinceBreath > 1.8 + vr()) {
            t += 0.25 + vr() * 0.15;
            sinceBreath = 0;
          }
        }
      }
      if (mix.pad > 0) {
        const chords = [
          [73.42, 110, 146.83, 220],
          [65.41, 98, 130.81, 196],
          [55, 82.41, 110, 164.81],
          [61.74, 92.5, 123.47, 185],
        ];
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 1400;
        lp.connect(bus);
        const step = mix.padChange || secs;
        for (let c = 0, t = 0; t < secs; c++, t += step)
          for (const f of chords[c % chords.length])
            for (const det of [-3, 3]) {
              const o = ctx.createOscillator();
              o.type = 'sawtooth';
              o.frequency.value = f;
              o.detune.value = det;
              const g = ctx.createGain();
              const lvl = mix.pad / 8;
              g.gain.setValueAtTime(0, t);
              g.gain.linearRampToValueAtTime(lvl, t + 0.4);
              g.gain.setValueAtTime(lvl, t + step - 0.05);
              g.gain.linearRampToValueAtTime(0, t + step + 0.35);
              o.connect(g).connect(lp);
              o.start(t);
              o.stop(t + step + 0.4);
            }
      }

      // Frames as a browser delivers them: an arbitrary phase against the music and a few ms of jitter.
      const beats: { t: number; strength: number }[] = [];
      let js = 99;
      const jitter = () => ((js = (js * 1664525 + 1013904223) >>> 0) / 2 ** 32 - 0.5) * 0.006;
      for (let i = 1; i < secs * fps; i++) {
        const at = Math.min(secs - 0.01, i / fps + 0.0137 + jitter());
        void ctx.suspend(at).then(() => {
          const before = show.beat.at;
          show.sample(at * 1000);
          if (show.beat.at !== before) beats.push({ t: show.beat.at, strength: show.beat.strength });
          void ctx.resume();
        });
      }
      const rendered = await ctx.startRendering();
      const d = rendered.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < d.length; i++) sum += d[i] * d[i];
      return { kicks, snares, beats, rmsDb: 10 * Math.log10(sum / d.length) };
    },
    { mix, fps, secs: SECS },
  );
}

for (const mix of MIXES)
  for (const fps of [60, 30] as const) {
    test(`the beat in real Chromium: ${mix.name}, ${fps} fps`, async ({ page }) => {
      test.setTimeout(120_000);
      const r = await run(page, mix, fps);
      const near = (t: number, hits: number[]) => hits.some((h) => t - h >= -10 && t - h <= 90);
      const kicks = r.kicks.filter((k) => k > 350);
      const found = kicks.filter((k) => r.beats.some((b) => b.t - k >= -10 && b.t - k <= 90)).length;
      const other = r.beats.filter((b) => !near(b.t, r.kicks) && !near(b.t, r.snares)).length;
      const snares = r.snares.filter((s) => r.beats.some((b) => b.t - s >= -10 && b.t - s <= 90)).length;
      const strong = r.beats.filter((b) => b.strength >= 0.6).length;
      console.log(`BEAT | ${mix.name} | ${fps} | kicks ${found}/${kicks.length} | snares ${snares}/${r.snares.length} | false ${other} | strong ${strong}/${r.beats.length} | rms ${r.rmsDb.toFixed(1)} dBFS`);
      const [least, most] = mix.expect[fps];
      expect(found).toBeGreaterThanOrEqual(Math.ceil(least * kicks.length));
      expect(other).toBeLessThanOrEqual(most);
      if (mix.strong) expect(strong).toBeGreaterThanOrEqual(r.beats.length / 2);
    });
  }
