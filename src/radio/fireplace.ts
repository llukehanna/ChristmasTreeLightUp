import { seamlessBrownNoise } from './dsp';

/** Different loop lengths so the rumble and the wind never realign into an audible repeat. */
const RUMBLE_LOOP_S = 13;
const WIND_LOOP_S = 17;
const POOL = 16;
const BIG_IN_POOL = 2;
const TICK_MS = 250;
/** Crackles are scheduled this far ahead on the audio clock, so a late timer tick never leaves a gap. */
const LOOKAHEAD_S = 0.8;
/** Average crackles per second (random gaps, so the pattern never repeats). */
const CRACKLE_RATE = 12;

/** Endless procedural fire: low rumble, wandering wind and random crackles (spec §5.2). No audio files. */
export class Fireplace {
  private sources: AudioScheduledSourceNode[] = [];
  private timer = 0;
  private gain: GainNode | null = null;
  private ctx: AudioContext | null = null;
  private pool: AudioBuffer[] = [];
  private cursor = 0;
  private nextDrift = 0;

  get running(): boolean {
    return this.gain !== null;
  }

  start(ctx: AudioContext, out: AudioNode): void {
    if (this.gain) return;
    this.ctx = ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.5);
    g.connect(out);
    this.gain = g;

    const rumble = ctx.createBufferSource();
    rumble.buffer = noiseBuffer(ctx, RUMBLE_LOOP_S);
    rumble.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    const rg = ctx.createGain();
    rg.gain.value = 0.2;
    rumble.connect(lp).connect(rg).connect(g);

    const wind = ctx.createBufferSource();
    wind.buffer = noiseBuffer(ctx, WIND_LOOP_S);
    wind.loop = true;
    wind.playbackRate.value = 0.7;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 500;
    bp.Q.value = 0.7;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const depth = ctx.createGain();
    depth.gain.value = 260;
    lfo.connect(depth).connect(bp.frequency);
    const wg = ctx.createGain();
    wg.gain.value = 0.12;
    wind.connect(bp).connect(wg).connect(g);

    rumble.start();
    wind.start();
    lfo.start();
    this.sources = [rumble, wind, lfo];

    this.pool = crackleBuffers(ctx);
    this.cursor = 0;
    this.nextDrift = ctx.currentTime + 4;
    this.timer = window.setInterval(() => this.tick(ctx, g, lfo), TICK_MS);
    this.tick(ctx, g, lfo);
  }

  /** `ctx` is optional: the context given to `start` is remembered. */
  stop(ctx?: AudioContext | null): void {
    window.clearInterval(this.timer);
    const c = ctx ?? this.ctx;
    const g = this.gain;
    const sources = this.sources;
    this.gain = null;
    this.sources = [];
    this.pool = [];
    this.ctx = null;
    if (!g) return;
    if (c) {
      g.gain.cancelScheduledValues(c.currentTime);
      g.gain.setValueAtTime(g.gain.value, c.currentTime);
      g.gain.linearRampToValueAtTime(0, c.currentTime + 0.6);
    }
    window.setTimeout(() => {
      sources.forEach((s) => {
        try {
          s.stop();
        } catch {
          /* already stopped */
        }
      });
      g.disconnect();
    }, 700);
  }

  /** Lookahead scheduler: lay down the next ~0.8s of crackles on the audio clock, skipping while the context is suspended. */
  private tick(ctx: AudioContext, out: AudioNode, lfo: OscillatorNode): void {
    if (ctx.state !== 'running') {
      this.cursor = 0; // after an iOS interruption, restart from "now" instead of piling up old crackles
      return;
    }
    const now = ctx.currentTime;
    if (this.cursor < now) this.cursor = now;
    while (this.cursor < now + LOOKAHEAD_S) {
      this.cursor += -Math.log(1 - Math.random()) / CRACKLE_RATE;
      const k = Math.random() < 0.06 ? Math.floor(Math.random() * BIG_IN_POOL) : BIG_IN_POOL + Math.floor(Math.random() * (POOL - BIG_IN_POOL));
      crackle(ctx, out, this.pool[k], this.cursor, k < BIG_IN_POOL);
    }
    if (now > this.nextDrift) {
      lfo.frequency.setTargetAtTime(0.04 + Math.random() * 0.07, now, 2); // the wind wanders at its own pace
      this.nextDrift = now + 5 + Math.random() * 5;
    }
  }
}

function noiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  b.copyToChannel(seamlessBrownNoise(len, Math.random), 0);
  return b;
}

/** A small pool of pre-rendered crackle bursts (the first BIG_IN_POOL are the loud, longer pops). */
function crackleBuffers(ctx: AudioContext): AudioBuffer[] {
  const pool: AudioBuffer[] = [];
  for (let n = 0; n < POOL; n++) {
    const dur = n < BIG_IN_POOL ? 0.05 : 0.004 + Math.random() * 0.02;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    pool.push(b);
  }
  return pool;
}

function crackle(ctx: AudioContext, out: AudioNode, buffer: AudioBuffer, when: number, big: boolean): void {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1500 + Math.random() * 3500;
  bp.Q.value = 0.8;
  const g = ctx.createGain();
  g.gain.value = big ? 0.5 : 0.12 + Math.random() * 0.2;
  src.connect(bp).connect(g).connect(out);
  src.start(when);
}
