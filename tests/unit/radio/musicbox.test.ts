// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mulberry32 } from '../../../src/core/rng';
import { CAROLS } from '../../../src/radio/carols';
import { arrange, CELESTA, creditFor, due, MUSIC_BOX, MusicBox, nextOrder, playsFor, ringTime } from '../../../src/radio/musicbox';

it('arranges a carol into sorted, finite events with melody, bass and inner voices', () => {
  for (const c of CAROLS) {
    const plays = playsFor(c);
    const s = arrange(c);
    const melody = s.events.filter((e) => e.role === 'melody');
    expect(melody.length).toBe(c.notes.filter((n) => n.midi !== null).length * plays);
    expect(s.events.some((e) => e.role === 'bass')).toBe(true);
    expect(s.events.some((e) => e.role === 'inner')).toBe(true);
    for (let i = 0; i < s.events.length; i++) {
      const e = s.events[i];
      expect(Number.isFinite(e.t) && e.t >= 0).toBe(true);
      if (i) expect(e.t).toBeGreaterThanOrEqual(s.events[i - 1].t);
      expect(e.midi).toBeGreaterThanOrEqual(45);
      expect(e.midi).toBeLessThanOrEqual(91);
      expect(e.vel).toBeGreaterThan(0);
      expect(e.vel).toBeLessThanOrEqual(1);
    }
    expect(s.duration).toBeGreaterThan(s.events[s.events.length - 1].t);
    // Long enough to settle into, short enough to keep the shuffle moving.
    expect(s.duration).toBeGreaterThan(40);
    expect(s.duration).toBeLessThan(90);
  }
});

it('keeps the accompaniment below the melody and on chord tones', () => {
  for (const c of CAROLS) {
    const s = arrange(c, 1);
    const spb = 60 / c.bpm;
    let acc = 0;
    const spans = c.harmony.map((h) => ({ from: (acc += h.beats) - h.beats, h }));
    for (const e of s.events.filter((x) => x.role !== 'melody')) {
      expect(e.midi).toBeLessThan(80);
      const beat = e.t / spb; // before the ritardando this is exact; after it the beat only grows, so look up by start
      const h = [...spans].reverse().find((x) => x.from <= beat + 1e-6)?.h;
      if (!h || h.root === null) continue;
      // During the closing ritardando times stretch, so only check events before it.
      if (beat > c.beats - 2 * c.barBeats) continue;
      expect([h.bass, h.root, h.third, h.fifth, h.seventh], `${c.id} @${beat}`).toContain(e.midi % 12);
    }
  }
});

it('slows down over the last two bars like a winding-down box', () => {
  const c = CAROLS.find((x) => x.id === 'silent-night');
  if (!c) throw new Error('missing');
  const s = arrange(c, 1);
  const mel = s.events.filter((e) => e.role === 'melody');
  // The first bar takes exactly 3 beats; the score's total is longer than the plain tempo would give.
  expect(s.duration).toBeGreaterThan((c.beats * 60) / c.bpm);
  expect(mel[0].t).toBe(0);
  expect(s.duration).toBeLessThan(((c.beats * 60) / c.bpm) * 1.1);
});

it('plays short carols twice', () => {
  for (const c of CAROLS) expect(playsFor(c)).toBe((c.beats * 60) / c.bpm < 40 ? 2 : 1);
});

it('due() lays down only the lookahead window and advances the cursor', () => {
  const times = [0, 0.5, 1, 1.5, 2, 2.5, 3];
  const cur = { start: 10, index: 0 };
  expect(due(times, cur, 9.5, 10.6)).toEqual([0, 2]);
  expect(due(times, cur, 9.7, 10.8)).toEqual([2, 2]);
  expect(due(times, cur, 10.2, 11.3)).toEqual([2, 3]);
  expect(cur.start).toBe(10);
});

it('due() re-anchors after a stall or resume instead of bursting old notes', () => {
  const times = [0, 0.5, 1, 1.5, 2, 2.5, 3];
  const cur = { start: 10, index: 2 }; // the next note was due at 11
  const [from, to] = due(times, cur, 14, 15); // 3 s late
  expect(from).toBe(2);
  // Only the next second's worth of notes, starting just after now: no pile-up.
  expect(to - from).toBe(2);
  expect(cur.start + times[from]).toBeCloseTo(14.03);
});

it('nextOrder is a full shuffle that never repeats the carol that just played', () => {
  const rng = mulberry32(3);
  for (let k = 0; k < 200; k++) {
    const o = nextOrder(8, rng, 5);
    expect([...o].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(o[0]).not.toBe(5);
  }
  expect(nextOrder(1, rng, 0)).toEqual([0]);
});

it('credits each carol as public domain, arranged for Aglow', () => {
  const deck = CAROLS.find((c) => c.id === 'deck-the-halls');
  if (!deck) throw new Error('missing');
  expect(creditFor(deck)).toBe('"Deck the Halls" — traditional / public domain, arranged for Aglow');
});

it('rings low tines longer than high ones, within 1.5–3.4 s', () => {
  expect(ringTime(45)).toBeCloseTo(3.4);
  expect(ringTime(86)).toBeLessThan(ringTime(60));
  expect(ringTime(100)).toBe(1.5);
});

/* ---------- lifecycle against a minimal fake AudioContext ---------- */

class Param {
  value = 0;
  setValueAtTime(v: number) {
    this.value = v;
  }
  linearRampToValueAtTime() {}
  setTargetAtTime() {}
  cancelScheduledValues() {}
}
let started = 0;
let disconnected = 0;
const node = () => ({
  gain: new Param(),
  pan: new Param(),
  frequency: new Param(),
  delayTime: new Param(),
  playbackRate: new Param(),
  Q: new Param(),
  type: '',
  buffer: null as unknown,
  connect(n: unknown) {
    return n;
  },
  disconnect() {
    disconnected++;
  },
  start() {
    started++;
  },
  stop() {},
  setPeriodicWave() {},
});
function fakeCtx() {
  return {
    currentTime: 0,
    state: 'running',
    sampleRate: 48000,
    createGain: node,
    createOscillator: node,
    createBufferSource: node,
    createBiquadFilter: node,
    createDelay: node,
    createStereoPanner: node,
    createPeriodicWave: () => ({}),
    createBuffer: (_c: number, len: number) => ({ getChannelData: () => new Float32Array(len) }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  started = 0;
  disconnected = 0;
});
afterEach(() => vi.useRealTimers());

it('starts, shows the carol, schedules ahead and stops cleanly', () => {
  const ctx = fakeCtx();
  const mb = new MusicBox(CAROLS, mulberry32(1));
  const ac = ctx as unknown as AudioContext;
  mb.start(ac, node() as unknown as AudioNode);
  expect(mb.running).toBe(true);
  const now = mb.current();
  expect(now?.title).toBe(CAROLS.find((c) => c.id === now?.id)?.title);
  expect(now?.credit).toContain('public domain, arranged for Aglow');
  const first = started;
  expect(first).toBeGreaterThan(0); // the first second of notes is already scheduled
  vi.advanceTimersByTime(1000); // the clock didn't move, so nothing more is due
  expect(started).toBe(first);
  ctx.currentTime = 2;
  vi.advanceTimersByTime(200);
  expect(started).toBeGreaterThan(first);
  mb.stop();
  expect(mb.running).toBe(false);
  expect(mb.current()).toBeNull();
  const after = started;
  ctx.currentTime = 10;
  vi.advanceTimersByTime(1000);
  expect(started).toBe(after); // no more scheduling once stopped
  expect(disconnected).toBeGreaterThan(0);
});

it('skips ticks while the context is suspended', () => {
  const ctx = fakeCtx();
  const mb = new MusicBox(CAROLS, mulberry32(2));
  mb.start(ctx as unknown as AudioContext, node() as unknown as AudioNode);
  const s0 = started;
  ctx.state = 'suspended';
  ctx.currentTime = 30;
  vi.advanceTimersByTime(2000);
  expect(started).toBe(s0);
  ctx.state = 'running';
  vi.advanceTimersByTime(200);
  // On resume it carries on with about a second of notes, not the 30 s it "missed".
  const notes = started - s0;
  expect(notes).toBeGreaterThan(0);
  expect(notes).toBeLessThan(80);
  mb.stop();
});

it('survives start/stop/start in quick succession', () => {
  const ctx = fakeCtx();
  const mb = new MusicBox(CAROLS, mulberry32(4));
  const out = node() as unknown as AudioNode;
  mb.start(ctx as unknown as AudioContext, out);
  mb.start(ctx as unknown as AudioContext, out); // second start is a no-op
  mb.stop();
  mb.start(ctx as unknown as AudioContext, out);
  expect(mb.running).toBe(true);
  expect(mb.current()).not.toBeNull();
  vi.advanceTimersByTime(800); // the first stop's cleanup runs and must not touch the new graph
  expect(mb.running).toBe(true);
  mb.stop();
  mb.stop();
  expect(mb.running).toBe(false);
});

it('next() moves to a different carol and prev() goes back to it', () => {
  const ctx = fakeCtx();
  const mb = new MusicBox(CAROLS, mulberry32(5));
  mb.start(ctx as unknown as AudioContext, node() as unknown as AudioNode);
  const a = mb.current()?.id;
  const changes = vi.fn();
  mb.onChange = changes;
  mb.next();
  const b = mb.current()?.id;
  expect(b).not.toBe(a);
  expect(changes).toHaveBeenCalled();
  mb.prev(); // within 3 s: back to the previous carol
  expect(mb.current()?.id).toBe(a);
  ctx.currentTime = 10;
  mb.prev(); // well into it: restart the same carol
  expect(mb.current()?.id).toBe(a);
  mb.stop();
});

describe('the celesta (secret mode)', () => {
  it('plays the same carols slower: the tempo stretches every time', () => {
    const c = CAROLS[0];
    const a = arrange(c, 1);
    const b = arrange(c, 1, CELESTA.tempo);
    expect(b.duration).toBeCloseTo(a.duration / CELESTA.tempo, 6);
    expect(b.events.map((e) => e.midi)).toEqual(a.events.map((e) => e.midi));
    expect(b.events[5].t).toBeCloseTo(a.events[5].t / CELESTA.tempo, 6);
  });
  it('the music box keeps its own sound; the celesta is softer, purer and wetter', () => {
    expect(MUSIC_BOX).toMatchObject({ mode2: 6.267, mode2Level: 0.22, mode2Decay: 8, mode3: 17.55, tineLevel: 0.18, tineDecayS: 0.012, attackS: 0.002, ringScale: 1, tempo: 1, level: 0.98 });
    expect(MUSIC_BOX.room).toEqual({ send: 0.2, tone: 3800, taps: [[0.067, 0.3, -0.5], [0.103, 0.28, 0.5]] });
    expect(CELESTA).toMatchObject({ mode2: 2.756, mode2Level: 0.08, mode2Decay: 5, mode3: 5.404, tineLevel: 0.05, tineDecayS: 0.02, attackS: 0.006, ringScale: 1.35, tempo: 0.8, level: 0.9 });
    expect(CELESTA.room).toEqual({ send: 0.42, tone: 3000, taps: [[0.137, 0.46, -0.6], [0.211, 0.42, 0.6]] });
  });
  it('a MusicBox given the celesta timbre plays with it: level, room and a free bar second mode', () => {
    const run = (timbre?: typeof CELESTA) => {
      const gains: ReturnType<typeof node>[] = [];
      const oscs: ReturnType<typeof node>[] = [];
      const ctx = {
        ...fakeCtx(),
        createGain: () => {
          const n = node();
          gains.push(n);
          return n;
        },
        createOscillator: () => {
          const n = node();
          oscs.push(n);
          return n;
        },
      };
      const mb = new MusicBox(CAROLS, mulberry32(1), timbre);
      mb.start(ctx as unknown as AudioContext, node() as unknown as AudioNode);
      mb.stop();
      const freqs = oscs.map((o) => o.frequency.value);
      const hasRatio = (k: number) => freqs.some((a) => freqs.some((b) => Math.abs(b / a - k) < 1e-9));
      // Gains in creation order: master, input (the level), then the room's send.
      return { level: gains[1].gain.value, send: gains[2].gain.value, hasRatio };
    };
    const celesta = run(CELESTA);
    expect(celesta.level).toBe(0.9);
    expect(celesta.send).toBe(0.42);
    expect(celesta.hasRatio(2.756)).toBe(true);
    expect(celesta.hasRatio(6.267)).toBe(false);
    const box = run();
    expect(box.level).toBe(0.98);
    expect(box.send).toBe(0.2);
    expect(box.hasRatio(6.267)).toBe(true);
  });
});
