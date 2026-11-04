import { afterEach, describe, expect, it, vi } from 'vitest';
import { audio } from '../../../src/audio/context';
import { chimeSemitone, chimeStep, chimeSteps, Sfx, starTapSemitone } from '../../../src/audio/sfx';
import { GRID } from '../../../src/core/mask';

it('climbs a major pentatonic scale, octave by octave', () => {
  expect([0, 1, 2, 3, 4, 5, 6].map(chimeSemitone)).toEqual([0, 2, 4, 7, 9, 12, 14]);
});

it("the star's tap ticks rise a pentatonic step each tap, high above the wave's chimes", () => {
  const ticks = [0, 1, 2, 3].map(starTapSemitone);
  for (let k = 1; k < 4; k++) expect(ticks[k]).toBeGreaterThan(ticks[k - 1]);
  expect(ticks[0]).toBeGreaterThanOrEqual(12);
  expect(ticks[3] % 12).toBe(0); // the fourth lands on G, ready for the jingle
});

describe('chimeStep', () => {
  it('maps the bottom row to step 0 and the top row to step 9', () => {
    expect(chimeStep(GRID.h - 1, GRID.h)).toBe(0);
    expect(chimeStep(0, GRID.h)).toBe(9);
  });
  it('never falls as the row goes up', () => {
    for (let row = GRID.h - 1; row > 0; row--) {
      expect(chimeStep(row - 1, GRID.h)).toBeGreaterThanOrEqual(chimeStep(row, GRID.h));
    }
  });
  it('stays within 0..9 even for rows off the board', () => {
    expect(chimeStep(-3, GRID.h)).toBe(9);
    expect(chimeStep(GRID.h + 3, GRID.h)).toBe(0);
  });
});

describe('chimeSteps (no flat repeats)', () => {
  it('plays a bell one pentatonic step higher when it would repeat the one before', () => {
    expect(chimeSteps([3, 3])).toEqual([3, 4]);
    expect(chimeSteps([3, 3, 3])).toEqual([3, 4, 3]);
    expect(chimeSteps([2, 5, 5, 6])).toEqual([2, 5, 6, 7]);
  });
  it('leaves a climbing line alone', () => {
    expect(chimeSteps([0, 1, 4, 9])).toEqual([0, 1, 4, 9]);
  });
});

/** A fake AudioContext that records every oscillator's scheduled start and whether its gain was disconnected. */
function fakeAudio(now = 0) {
  const oscs: { when: number; stopped: number | null; gain: { disconnected: boolean } | null; hz: number }[] = [];
  const mk = () => ({ connect: vi.fn(), disconnect: vi.fn(), setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), value: 0 });
  const state = { now };
  const ctx = {
    state: 'running',
    sampleRate: 8000,
    get currentTime() {
      return state.now;
    },
    createBuffer: () => ({ getChannelData: () => new Float32Array(8) }),
    createBufferSource: () => ({ ...mk(), buffer: null, start: vi.fn(), stop: vi.fn() }),
    createBiquadFilter: () => ({ ...mk(), frequency: mk(), Q: mk() }),
    createGain: () => {
      const g = { ...mk(), gain: mk(), disconnected: false };
      g.disconnect = vi.fn(() => {
        g.disconnected = true;
      });
      return g;
    },
    createOscillator: () => {
      const o = {
        frequency: { value: 0 },
        type: '',
        connect: (g: { disconnected: boolean }) => {
          rec.gain = g;
        },
        start: (w: number) => {
          rec.when = w;
        },
        stop: (w: number) => {
          rec.stopped = w;
        },
      };
      const rec = { when: -1, stopped: null as number | null, gain: null as { disconnected: boolean } | null, get hz() { return o.frequency.value; } };
      oscs.push(rec);
      return o;
    },
  };
  audio.ctx = ctx as unknown as AudioContext;
  audio.sfx = { ...mk(), gain: { value: 0 } } as unknown as GainNode;
  /** Start times (ms) of the bells still going to ring: first partial of each, ignoring the cancelled. */
  const live = () => [...new Set(oscs.filter((o) => !o.gain?.disconnected).map((o) => Math.round(o.when * 1000)))].sort((a, b) => a - b);
  return { state, oscs, live };
}

describe('Sfx.hurryChimes', () => {
  afterEach(() => {
    audio.ctx = null;
    audio.sfx = null;
  });

  const three = [
    { delayMs: 100, step: 0 },
    { delayMs: 400, step: 2 },
    { delayMs: 800, step: 4 },
  ];

  it('pulls every bell still to ring four times closer to now', () => {
    const { live } = fakeAudio(0);
    const sfx = new Sfx();
    sfx.wave(3, three);
    expect(live()).toEqual([100, 400, 800]);
    sfx.hurryChimes(4);
    expect(live()).toEqual([25, 100, 200]);
  });

  it('leaves a bell that has already started alone', () => {
    const { state, live } = fakeAudio(0);
    const sfx = new Sfx();
    sfx.wave(3, three);
    state.now = 0.2; // the 100 ms bell is ringing
    sfx.hurryChimes(4);
    expect(live()).toEqual([100, 250, 350]); // 200 + (400-200)/4 and 200 + (800-200)/4
  });

  it('keeps the pitch of a bell it re-schedules', () => {
    const { oscs, live } = fakeAudio(0);
    const sfx = new Sfx();
    sfx.wave(1, [{ delayMs: 400, step: 3 }]);
    sfx.hurryChimes(4);
    const alive = oscs.filter((o) => !o.gain?.disconnected);
    const expected = 392 * 2 ** (chimeSemitone(3) / 12);
    expect(alive[0].hz).toBeCloseTo(expected, 6);
    expect(live()).toEqual([100]);
  });

  it('only hurries the most recent wave, and does nothing before any sound', () => {
    const { live } = fakeAudio(0);
    const sfx = new Sfx();
    sfx.hurryChimes(4); // no wave yet: a no-op
    sfx.wave(1, [{ delayMs: 400, step: 0 }]);
    sfx.wave(1, [{ delayMs: 800, step: 0 }]);
    sfx.hurryChimes(4);
    expect(live()).toEqual([200, 400]); // the earlier wave's bell is not touched; the latest wave's 800 became 200
  });
});
