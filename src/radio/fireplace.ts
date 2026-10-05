/** Endless procedural fire: low rumble, wandering wind and random crackles (spec §5.2). No audio files. */
export class Fireplace {
  private sources: AudioScheduledSourceNode[] = [];
  private timer = 0;
  private gain: GainNode | null = null;

  get running(): boolean {
    return this.gain !== null;
  }

  start(ctx: AudioContext, out: AudioNode): void {
    if (this.gain) return;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(1, ctx.currentTime + 1.5);
    g.connect(out);
    this.gain = g;
    const brown = brownNoise(ctx, 6);

    const rumble = ctx.createBufferSource();
    rumble.buffer = brown;
    rumble.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    const rg = ctx.createGain();
    rg.gain.value = 0.5;
    rumble.connect(lp).connect(rg).connect(g);

    const wind = ctx.createBufferSource();
    wind.buffer = brown;
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
    wg.gain.value = 0.18;
    wind.connect(bp).connect(wg).connect(g);

    rumble.start();
    wind.start();
    lfo.start();
    this.sources = [rumble, wind, lfo];
    this.timer = window.setInterval(() => {
      const t = ctx.currentTime;
      for (let k = 0; k < 3; k++) if (Math.random() < 0.28) crackle(ctx, g, t + Math.random() * 0.06, Math.random() < 0.06);
    }, 70);
  }

  stop(ctx: AudioContext | null): void {
    window.clearInterval(this.timer);
    const g = this.gain;
    const sources = this.sources;
    this.gain = null;
    this.sources = [];
    if (!g || !ctx) return;
    g.gain.cancelScheduledValues(ctx.currentTime);
    g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
    window.setTimeout(() => {
      sources.forEach((s) => s.stop());
      g.disconnect();
    }, 700);
  }
}

function brownNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    d[i] = last * 3.5;
  }
  return b;
}

function crackle(ctx: AudioContext, out: AudioNode, when: number, big: boolean): void {
  const dur = big ? 0.05 : 0.004 + Math.random() * 0.02;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = ctx.createBufferSource();
  src.buffer = b;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1500 + Math.random() * 3500;
  bp.Q.value = 0.8;
  const g = ctx.createGain();
  g.gain.value = big ? 0.5 : 0.12 + Math.random() * 0.2;
  src.connect(bp).connect(g).connect(out);
  src.start(when);
}
