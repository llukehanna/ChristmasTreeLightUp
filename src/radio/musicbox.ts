import { mulberry32, type Rng } from '../core/rng';
import { CAROLS, type Carol, type Chord } from './carols';
import { nextIndex, shuffled } from './queue';

/*
 * Music Box: public-domain carols played on a synthesized music box (spec §5.2). No audio files.
 *
 * The tone follows the physics of a music-box comb. Each tine is a clamped-free steel cantilever, whose
 * bending modes sit at 1 : 6.267 : 17.55 times the fundamental (the squares of 1.875, 4.694, 7.855).
 * Higher modes lose energy much faster, so a note is
 *  - a near-sine body (the fundamental plus a trace of 2nd/3rd harmonic from the comb and soundboard),
 *    with a 2 ms attack and an exponential decay of 1.5–3.4 s (lower tines ring longer);
 *  - the second mode at 6.267×, decaying about 8× faster: the metallic shimmer of the first ~0.3 s;
 *  - a ~12 ms "tine" transient: the third mode at 17.55× plus a tiny pre-rendered pin-pluck click.
 * A pluck on a tine that is still ringing damps it first, like the comb's dampers.
 * The arrangement is a bright melody over soft, warmer low tines (bass and inner chord tones),
 * spread slightly across the stereo field by pitch (as along a comb), with a light feedback-delay room.
 */

/** Cantilever mode ratios (Euler–Bernoulli, clamped-free). */
const MODE2 = 6.267;
const MODE3 = 17.55;
const MODE2_LEVEL = 0.22;
const MODE2_DECAY_FACTOR = 8;
const TINE_LEVEL = 0.18;
const TINE_DECAY_S = 0.012;
const ATTACK_S = 0.002;
/** No partials above this (they would only alias or waste a node). */
const MAX_PARTIAL_HZ = 16000;

const ROLE_GAIN: Readonly<Record<Role, number>> = { melody: 0.3, bass: 0.17, inner: 0.085 };
/** Station output level, set by measurement (RMS about −22 dBFS into the music bus at full volume). */
const LEVEL = 0.98;

const TICK_MS = 200;
/** Notes are laid down this far ahead on the audio clock; a late timer tick never leaves a gap. */
const LOOKAHEAD_S = 1.0;
/** Silence after the last notated beat of a carol, before the next one starts. */
const GAP_S = 1.6;
const FADE_IN_S = 1.0;
const FADE_OUT_S = 0.6;
const SKIP_FADE_S = 0.25;
/** Carols shorter than this play through twice. */
const MIN_PIECE_S = 40;
/** The last bars slow down like a music box winding down: the final beat is this much longer. */
const RITARDANDO = 0.35;
const RIT_BARS = 2;
const TIMING_JITTER_S = 0.006;
const VELOCITY_JITTER = 0.07;

const BASS_LO = 45; // A2
const INNER_LO = 55; // G3

export type Role = 'melody' | 'bass' | 'inner';

export interface ScoreEvent {
  /** Seconds from the start of the piece. */
  t: number;
  midi: number;
  /** 0–1 before the role's gain. */
  vel: number;
  role: Role;
}

export interface Score {
  events: ScoreEvent[];
  /** Seconds to the end of the last notated beat. */
  duration: number;
}

type Slot = 'bass' | 'fifth' | 'dyad' | 'arp5' | 'arp8' | 'arp3';

/** Accompaniment pattern per bar, at quarter-note offsets: oom-pah for duple, a waltz for 3/4, a rocking arpeggio for 6/8. */
const PATTERNS: Readonly<Record<Carol['meter'], readonly [number, Slot][]>> = {
  '2/4': [
    [0, 'bass'],
    [1, 'dyad'],
  ],
  '3/4': [
    [0, 'bass'],
    [1, 'dyad'],
    [2, 'dyad'],
  ],
  '4/4': [
    [0, 'bass'],
    [1, 'dyad'],
    [2, 'fifth'],
    [3, 'dyad'],
  ],
  '6/8': [
    [0, 'bass'],
    [0.5, 'arp5'],
    [1, 'arp8'],
    [1.5, 'arp3'],
    [2, 'arp8'],
    [2.5, 'arp5'],
  ],
};

const EPS = 1e-6;

/** The lowest MIDI note of pitch class `pc` at or above `lo`. */
const place = (pc: number, lo: number): number => lo + ((pc - (lo % 12) + 12) % 12);

export const mtof = (m: number): number => 440 * 2 ** ((m - 69) / 12);

/** Seconds for a tine to fall 60 dB: low tines ring longer. */
export const ringTime = (m: number): number => Math.min(3.4, Math.max(1.5, 3.4 - (m - BASS_LO) * 0.04));

export const playsFor = (c: Carol): number => ((c.beats * 60) / c.bpm < MIN_PIECE_S ? 2 : 1);

/**
 * Turns a carol into timed note events: the melody (accented by its place in the bar), a bass and
 * inner-voice accompaniment from the chords, and a ritardando over the last bars. Deterministic.
 */
export function arrange(c: Carol, plays = playsFor(c)): Score {
  const spb = 60 / c.bpm;
  const total = c.beats * plays;
  const ritLen = Math.min(RIT_BARS * c.barBeats, total);
  const ritFrom = total - ritLen;
  const time = (b: number): number => {
    if (b <= ritFrom) return b * spb;
    const x = b - ritFrom;
    return spb * (ritFrom + x + (RITARDANDO * x ** 3) / (3 * ritLen * ritLen));
  };
  const strong = c.meter === '6/8' ? [0, 1.5] : [0];
  const barPos = (b: number): number => (((b - c.pickup) % c.barBeats) + c.barBeats) % c.barBeats;
  const accent = (b: number): number => {
    const p = barPos(b);
    if (Math.abs(p) < EPS || Math.abs(p - c.barBeats) < EPS) return 1;
    if (strong.some((s) => Math.abs(p - s) < EPS)) return 0.94;
    return Math.abs(p - Math.round(p)) < EPS ? 0.88 : 0.8;
  };

  // Chord spans within one play.
  const spans: { from: number; to: number; chord: Chord }[] = [];
  let acc = 0;
  for (const ch of c.harmony) {
    spans.push({ from: acc, to: acc + ch.beats, chord: ch });
    acc += ch.beats;
  }
  const chordAt = (b: number) => spans.find((s) => b >= s.from - EPS && b < s.to - EPS);

  const events: ScoreEvent[] = [];
  const add = (b: number, midi: number, vel: number, role: Role) => events.push({ t: time(b), midi, vel, role });

  const accompany = (at: number, slot: Slot, ch: Chord, base: number) => {
    if (ch.root === null) return;
    const b = base + at;
    switch (slot) {
      case 'bass':
        add(b, place(ch.bass, BASS_LO), 0.9, 'bass');
        break;
      case 'fifth':
        add(b, place(ch.fifth, BASS_LO), 0.75, 'bass');
        break;
      case 'dyad': {
        const lo = place(ch.third, INNER_LO);
        add(b, lo, 0.8, 'inner');
        add(b, place(ch.seventh ?? ch.fifth, lo + 1), 0.72, 'inner');
        break;
      }
      default: {
        const f = place(ch.fifth, INNER_LO);
        const pc = slot === 'arp5' ? ch.fifth : slot === 'arp8' ? ch.root : (ch.seventh ?? ch.third);
        add(b, slot === 'arp5' ? f : place(pc, f + 1), slot === 'arp3' ? 0.78 : 0.7, 'inner');
      }
    }
  };

  for (let p = 0; p < plays; p++) {
    const base = p * c.beats;
    let b = 0;
    for (const n of c.notes) {
      if (n.midi !== null) add(base + b, n.midi, accent(base + b), 'melody');
      b += n.beats;
    }
    const slotTimes: number[] = [];
    for (let bar = c.pickup; bar < c.beats - EPS; bar += c.barBeats) {
      for (const [off, slot] of PATTERNS[c.meter]) {
        const at = bar + off;
        if (at >= c.beats - EPS) continue;
        slotTimes.push(at);
        const span = chordAt(at);
        if (!span) continue;
        const fresh = Math.abs(span.from - at) < EPS && off > 0;
        // A chord that changes mid-bar is announced by its bass note; a dyad slot keeps its dyad too.
        if (fresh && slot !== 'bass') accompany(at, 'bass', span.chord, base);
        if (!(fresh && (slot === 'fifth' || slot === 'arp5'))) accompany(at, slot, span.chord, base);
      }
    }
    // Chords that change between pattern slots (e.g. on an off-beat) still get their bass note.
    for (const s of spans) {
      if (s.from < c.beats - EPS && !slotTimes.some((t) => Math.abs(t - s.from) < EPS)) accompany(s.from, 'bass', s.chord, base);
    }
  }
  events.sort((x, y) => x.t - y.t);
  return { events, duration: time(total) };
}

/** Where the scheduler has got to in a piece: its start on the audio clock and the next event to schedule. */
export interface Cursor {
  start: number;
  index: number;
}

/**
 * Lookahead step. Returns the indices [from, to) of events due before `horizon` and advances `cur`.
 * If the next event is already late (a stalled timer, or a context that was suspended or interrupted),
 * the piece's start is pushed forward so it carries on from there instead of firing a burst of old notes.
 */
export function due(times: readonly number[], cur: Cursor, now: number, horizon: number, lead = 0.03): [number, number] {
  const from = cur.index;
  if (from < times.length && cur.start + times[from] < now + lead) cur.start = now + lead - times[from];
  let to = from;
  while (to < times.length && cur.start + times[to] < horizon) to++;
  cur.index = to;
  return [from, to];
}

/** A new shuffled play order that doesn't start with `avoid` (the carol that just played). */
export function nextOrder(n: number, rng: Rng, avoid: number): number[] {
  const order = shuffled(
    Array.from({ length: n }, (_, i) => i),
    rng,
  );
  if (n > 1 && order[0] === avoid) {
    const j = 1 + Math.floor(rng() * (n - 1));
    [order[0], order[j]] = [order[j], order[0]];
  }
  return order;
}

export const creditFor = (c: Carol): string => `"${c.title}" — ${c.by} / public domain, arranged for Aglow`;

export interface NowPlaying {
  id: string;
  title: string;
  credit: string;
  /** Seconds. */
  duration: number;
  position: number;
}

interface Piece {
  /** Index into the carol list. */
  idx: number;
  carol: Carol;
  score: Score;
  times: number[];
  cur: Cursor;
  out: GainNode;
  pans: AudioNode[];
}

const PAN = [-0.3, -0.15, 0, 0.15, 0.3];
const panIndex = (m: number): number => Math.min(PAN.length - 1, Math.max(0, Math.round((m - 69) / 8) + 2));

/** Endless shuffled carols on a synthesized music box. Same lifecycle as `Fireplace`. */
export class MusicBox {
  /** Fires when the audible carol changes. */
  onChange: (() => void) | null = null;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private input: GainNode | null = null;
  private room: AudioNode[] = [];
  private timer = 0;
  private piece: Piece | null = null;
  private shown: Piece | null = null;
  private retiring: { piece: Piece; at: number }[] = [];
  private order: number[] = [];
  /** Position in `order` of the latest carol taken from it. */
  private pos = 0;
  /** Carols as they became audible, most recent last (for `prev`). */
  private history: number[] = [];
  private bright: PeriodicWave | null = null;
  private warm: PeriodicWave | null = null;
  private click: AudioBuffer | null = null;
  private readonly ringing = new Map<number, { g: GainNode; until: number }>();

  constructor(
    private readonly carols: readonly Carol[] = CAROLS,
    private readonly rng: Rng = Math.random,
  ) {}

  get running(): boolean {
    return this.master !== null;
  }

  start(ctx: AudioContext, out: AudioNode): void {
    if (this.master || this.carols.length === 0) return;
    this.ctx = ctx;
    const t = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0, t);
    master.gain.linearRampToValueAtTime(1, t + FADE_IN_S);
    master.connect(out);
    const input = ctx.createGain();
    input.gain.value = LEVEL;
    input.connect(master);
    this.master = master;
    this.input = input;
    this.room = buildRoom(ctx, input, master);
    this.bright = ctx.createPeriodicWave(new Float32Array(4), Float32Array.from([0, 1, 0.08, 0.02]));
    this.warm = ctx.createPeriodicWave(new Float32Array(5), Float32Array.from([0, 1, 0.3, 0.1, 0.04]));
    this.click = pinClick(ctx);
    this.ringing.clear();
    this.order = nextOrder(this.carols.length, this.rng, -1);
    this.pos = 0;
    this.history = [];
    this.show(this.begin(t + 0.12, this.order[0]));
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  /** `ctx` is optional: the context given to `start` is remembered. */
  stop(ctx?: AudioContext | null): void {
    window.clearInterval(this.timer);
    const c = ctx ?? this.ctx;
    const master = this.master;
    const nodes: AudioNode[] = [...this.room];
    if (this.input) nodes.push(this.input);
    for (const p of [this.piece, this.shown, ...this.retiring.map((r) => r.piece)]) if (p) nodes.push(p.out, ...p.pans);
    this.master = null;
    this.input = null;
    this.room = [];
    this.piece = null;
    this.shown = null;
    this.retiring = [];
    this.ringing.clear();
    this.ctx = null;
    if (!master) return;
    if (c) {
      master.gain.cancelScheduledValues(c.currentTime);
      master.gain.setValueAtTime(master.gain.value, c.currentTime);
      master.gain.linearRampToValueAtTime(0, c.currentTime + FADE_OUT_S);
    }
    window.setTimeout(() => {
      master.disconnect();
      for (const n of nodes) n.disconnect();
    }, FADE_OUT_S * 1000 + 100);
  }

  /** Skip to the next carol in the shuffle (or, in the gap between carols, start the coming one now). */
  next(): void {
    if (!this.ctx || !this.shown) return;
    const coming = this.piece && this.piece !== this.shown ? this.piece : null;
    if (coming) {
      this.jump(coming.idx);
      return;
    }
    this.pos = this.advanceIndex();
    this.jump(this.order[this.pos]);
  }

  /** Restart the carol after its first 3 seconds; otherwise go back to the one heard before it. */
  prev(): void {
    const ctx = this.ctx;
    const shown = this.shown;
    if (!ctx || !shown) return;
    const current = this.history.pop() ?? shown.idx;
    const back = ctx.currentTime - shown.cur.start > 3 ? undefined : this.history.pop();
    this.jump(back ?? current);
  }

  current(): NowPlaying | null {
    const ctx = this.ctx;
    const p = this.shown;
    if (!ctx || !p) return null;
    return {
      id: p.carol.id,
      title: p.carol.title,
      credit: creditFor(p.carol),
      duration: p.score.duration,
      position: Math.min(p.score.duration, Math.max(0, ctx.currentTime - p.cur.start)),
    };
  }

  private advanceIndex(): number {
    if (this.pos + 1 >= this.order.length) {
      this.order = nextOrder(this.carols.length, this.rng, this.order[this.pos]);
      return 0;
    }
    return nextIndex(this.pos, this.order.length);
  }

  /** Fade out whatever is playing and start carol `i` shortly after. */
  private jump(i: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    for (const p of new Set([this.piece, this.shown])) {
      if (!p) continue;
      p.out.gain.cancelScheduledValues(now);
      p.out.gain.setValueAtTime(p.out.gain.value, now);
      p.out.gain.linearRampToValueAtTime(0, now + SKIP_FADE_S);
      this.retire(p, now + SKIP_FADE_S + 0.1);
    }
    this.ringing.clear();
    this.show(this.begin(now + SKIP_FADE_S + 0.05, i));
    this.tick();
  }

  private show(p: Piece): void {
    this.shown = p;
    this.history.push(p.idx);
    if (this.history.length > 32) this.history.shift();
    this.onChange?.();
  }

  private begin(at: number, idx: number): Piece {
    const ctx = this.ctx as AudioContext;
    const carol = this.carols[idx];
    const score = arrange(carol);
    const out = ctx.createGain();
    out.connect(this.input as GainNode);
    const pans = PAN.map((v) => panner(ctx, v));
    for (const p of pans) p.connect(out);
    const piece: Piece = { idx, carol, score, times: score.events.map((e) => e.t), cur: { start: at, index: 0 }, out, pans };
    this.piece = piece;
    return piece;
  }

  private retire(p: Piece, at: number): void {
    if (!this.retiring.some((r) => r.piece === p)) this.retiring.push({ piece: p, at });
    if (this.piece === p) this.piece = null;
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    // Suspended or interrupted: the audio clock is frozen, so wait. On resume, `due` re-anchors any late notes.
    if (ctx.state !== 'running') return;
    const now = ctx.currentTime;
    this.retiring = this.retiring.filter((r) => {
      if (r.at > now) return true;
      r.piece.out.disconnect();
      return false;
    });
    for (let guard = 0; guard < 4; guard++) {
      const p = this.piece;
      if (!p) break;
      const [a, b] = due(p.times, p.cur, now, now + LOOKAHEAD_S);
      for (let i = a; i < b; i++) this.voice(p, p.score.events[i], p.cur.start + p.times[i], now);
      if (p.cur.index < p.times.length) break;
      const nextAt = p.cur.start + p.score.duration + GAP_S;
      if (nextAt > now + LOOKAHEAD_S) break;
      // Let the last notes ring out before disconnecting the finished piece.
      this.retire(p, p.cur.start + p.score.duration + ringTime(BASS_LO) + 0.5);
      this.pos = this.advanceIndex();
      this.begin(Math.max(nextAt, now + 0.05), this.order[this.pos]);
    }
    const p = this.piece;
    if (p && p !== this.shown && p.cur.start <= now) this.show(p);
  }

  /** One plucked tine: ~3 oscillators, a click and 3 gains, all scheduled and self-stopping. */
  private voice(p: Piece, ev: ScoreEvent, when: number, now: number): void {
    const ctx = this.ctx as AudioContext;
    const rng = this.rng;
    const jitter = Math.max(-2.5, Math.min(2.5, (rng() + rng() + rng() - 1.5) * 2)) * TIMING_JITTER_S;
    const t = Math.max(now + 0.005, when + jitter);
    const f = mtof(ev.midi);
    const vel = Math.min(1, ev.vel * (1 + (rng() * 2 - 1) * VELOCITY_JITTER));
    const amp = ROLE_GAIN[ev.role] * vel ** 1.6;
    const ring = ringTime(ev.midi);
    const dest = p.pans[panIndex(ev.midi)];

    // The comb's damper stops a tine that is still ringing just before it is plucked again.
    const prev = this.ringing.get(ev.midi);
    if (prev && prev.until > t) prev.g.gain.setTargetAtTime(0, t - 0.004, 0.006);

    const body = ctx.createOscillator();
    body.setPeriodicWave((ev.role === 'melody' ? this.bright : this.warm) as PeriodicWave);
    body.frequency.value = f;
    const gb = ctx.createGain();
    gb.gain.setValueAtTime(0, t);
    gb.gain.linearRampToValueAtTime(amp, t + ATTACK_S);
    gb.gain.setTargetAtTime(0, t + ATTACK_S, ring / 6.91);
    body.connect(gb).connect(dest);
    body.start(t);
    body.stop(t + ring + 0.1);
    this.ringing.set(ev.midi, { g: gb, until: t + ring });

    if (f * MODE2 < MAX_PARTIAL_HZ) {
      const ring2 = ring / MODE2_DECAY_FACTOR;
      const m2 = ctx.createOscillator();
      m2.frequency.value = f * MODE2;
      const g2 = ctx.createGain();
      g2.gain.setValueAtTime(0, t);
      g2.gain.linearRampToValueAtTime(amp * MODE2_LEVEL, t + ATTACK_S);
      g2.gain.setTargetAtTime(0, t + ATTACK_S, ring2 / 6.91);
      m2.connect(g2).connect(dest);
      m2.start(t);
      m2.stop(t + ring2 + 0.05);
    }

    // The tine transient: the pin's click plus the fast-dying third mode, sharing one envelope.
    const gt = ctx.createGain();
    gt.gain.setValueAtTime(amp * TINE_LEVEL, t);
    gt.gain.setTargetAtTime(0, t, TINE_DECAY_S);
    gt.connect(dest);
    const pick = ctx.createBufferSource();
    pick.buffer = this.click;
    pick.playbackRate.value = 0.75 + Math.max(0, ev.midi - BASS_LO) / 80;
    pick.connect(gt);
    pick.start(t);
    if (f * MODE3 < MAX_PARTIAL_HZ) {
      const m3 = ctx.createOscillator();
      m3.frequency.value = f * MODE3;
      m3.connect(gt);
      m3.start(t);
      m3.stop(t + TINE_DECAY_S * 8);
    }
  }
}

/** A stereo panner, or a plain gain where StereoPannerNode is missing. */
function panner(ctx: AudioContext, pan: number): AudioNode {
  if (typeof ctx.createStereoPanner !== 'function') return ctx.createGain();
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  return p;
}

/** A light room: two damped feedback delays, panned apart. Returns the nodes to disconnect on stop. */
function buildRoom(ctx: AudioContext, input: AudioNode, out: AudioNode): AudioNode[] {
  const send = ctx.createGain();
  send.gain.value = 0.2;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 3800;
  input.connect(send).connect(tone);
  const nodes: AudioNode[] = [send, tone];
  for (const [delay, feedback, pan] of [
    [0.067, 0.3, -0.5],
    [0.103, 0.28, 0.5],
  ] as const) {
    const d = ctx.createDelay(1);
    d.delayTime.value = delay;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    const fb = ctx.createGain();
    fb.gain.value = feedback;
    tone.connect(d);
    d.connect(lp);
    lp.connect(fb);
    fb.connect(d);
    const side = panner(ctx, pan);
    lp.connect(side).connect(out);
    nodes.push(d, lp, fb, side);
  }
  return nodes;
}

/** ~12 ms of high-passed noise with a 1.8 ms decay: the steel pin catching the tine. Rendered once. */
function pinClick(ctx: AudioContext): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(sr * 0.012));
  const b = ctx.createBuffer(1, len, sr);
  const d = b.getChannelData(0);
  const rnd = mulberry32(0x7135);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const n = rnd() * 2 - 1;
    d[i] = 0.9 * (n - last) * 0.5 * Math.exp(-i / (sr * 0.0018));
    last = n;
  }
  return b;
}
