/** One AudioContext for the whole app: game sounds (with a small room reverb) and the music bus (Plan 2). */
export class AudioEngine {
  ctx: AudioContext | null = null;
  sfx: GainNode | null = null;
  music: GainNode | null = null;

  /** Creates/resumes the context. Must first be called inside a user gesture (browsers block audio before one). */
  unlock(): AudioContext | null {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      const ctx = new Ctor();
      const out = ctx.createDynamicsCompressor();
      out.connect(ctx.destination);
      const sfx = ctx.createGain();
      sfx.connect(out);
      const music = ctx.createGain();
      music.connect(out);
      const room = ctx.createGain();
      room.gain.value = 0.32;
      sfx.connect(room);
      for (const [delay, feedback] of [
        [0.113, 0.4],
        [0.171, 0.36],
      ] as const) {
        const d = ctx.createDelay();
        d.delayTime.value = delay;
        const fb = ctx.createGain();
        fb.gain.value = feedback;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 2600;
        room.connect(d);
        d.connect(lp);
        lp.connect(fb);
        fb.connect(d);
        lp.connect(out);
      }
      this.ctx = ctx;
      this.sfx = sfx;
      this.music = music;
    }
    // iOS also leaves the context 'interrupted' (calls, Siri, other audio); resume anything that isn't running.
    // Outside a gesture (sfx from rAF or a timer) resume() can reject: that is expected, not an error.
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    return this.ctx;
  }
}

export const audio = new AudioEngine();
