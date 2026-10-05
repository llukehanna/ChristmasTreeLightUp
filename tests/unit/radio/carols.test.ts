import { describe, expect, it } from 'vitest';
import { bars, CAROL_SOURCES, CAROLS, noteToMidi, parseChord, parseMelody, type Carol } from '../../../src/radio/carols';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

it('parses note names, ties and chords', () => {
  expect(noteToMidi('C4')).toBe(60);
  expect(noteToMidi('A4')).toBe(69);
  expect(noteToMidi('F#5')).toBe(78);
  expect(noteToMidi('Bb5')).toBe(82);
  expect(() => noteToMidi('H4')).toThrow();
  expect(parseMelody('D6:2 | -:1.5 D6:.5 r:1')).toEqual([
    { midi: 86, beats: 3.5 },
    { midi: 86, beats: 0.5 },
    { midi: null, beats: 1 },
  ]);
  expect(parseChord('C7/Bb', 2)).toEqual({ root: 0, third: 4, fifth: 7, seventh: 10, bass: 10, beats: 2 });
  expect(parseChord('F#m', 3)).toMatchObject({ root: 6, third: 9, fifth: 1, seventh: null, bass: 6 });
  expect(() => parseChord('Cmaj9', 1)).toThrow();
});

it('has 6–8 public-domain carols with unique ids, a tempo and a source', () => {
  expect(CAROLS.length).toBeGreaterThanOrEqual(6);
  expect(CAROLS.length).toBeLessThanOrEqual(8);
  expect(new Set(CAROLS.map((c) => c.id)).size).toBe(CAROLS.length);
  for (const c of CAROLS) {
    expect(c.title.length).toBeGreaterThan(0);
    expect(c.origin).toMatch(/1[78]\d\d/); // published well before 1929
    expect(c.bpm).toBeGreaterThanOrEqual(50);
    expect(c.bpm).toBeLessThanOrEqual(130);
  }
});

describe.each(CAROLS.map((c) => [c.id, c] as [string, Carol]))('%s', (_id, c) => {
  it('has notes with positive durations in the music-box register', () => {
    expect(c.notes.length).toBeGreaterThan(20);
    for (const n of c.notes) expect(n.beats).toBeGreaterThan(0);
    const pitches = c.notes.flatMap((n) => (n.midi === null ? [] : [n.midi]));
    expect(Math.min(...pitches)).toBeGreaterThanOrEqual(72); // C5
    expect(Math.max(...pitches)).toBeLessThanOrEqual(91); // G6
    // A melody never leaps more than an octave and a bit between notes.
    for (let i = 1; i < pitches.length; i++) expect(Math.abs(pitches[i] - pitches[i - 1])).toBeLessThanOrEqual(15);
  });

  it('fills every bar exactly, and melody and chords end together', () => {
    const src = CAROL_SOURCES.find((s) => s.id === c.id);
    if (!src) throw new Error('missing source');
    for (const line of [src.melody, src.chords]) {
      const lens = bars(line).map((b) => sum(b.map(([, beats]) => beats)));
      const inner = lens.slice(1, -1);
      for (const len of inner) expect(len).toBeCloseTo(c.barBeats, 9);
      expect(lens[0]).toBeCloseTo(c.pickup || c.barBeats, 9);
      expect(lens[lens.length - 1]).toBeCloseTo(c.barBeats - c.pickup, 9);
    }
    expect(sum(c.harmony.map((h) => h.beats))).toBeCloseTo(c.beats, 9);
  });

  it('puts a chord tone under every downbeat (bar the listed appoggiaturas)', () => {
    const allowed: Record<string, number[]> = {
      'jingle-bells': [23], // "one horse o-": the 9th over A7, as usually harmonised
      'o-christmas-tree': [8], // C over G: the folk tune's accented passing note
      'hark-the-herald': [8], // E over F: Mendelssohn's Fmaj7
    };
    let at = 0;
    let acc = 0;
    const spans = c.harmony.map((h) => ({ from: (acc += h.beats) - h.beats, h }));
    for (const n of c.notes) {
      const pos = (at - c.pickup) / c.barBeats;
      if (n.midi !== null && at >= c.pickup && Math.abs(pos - Math.round(pos)) < 1e-9) {
        const bar = Math.round(pos) + 1;
        const h = [...spans].reverse().find((s) => s.from <= at + 1e-9)?.h;
        if (h && h.root !== null && !(allowed[c.id] ?? []).includes(bar)) {
          const tones = [h.root, h.third, h.fifth, h.seventh];
          expect(tones, `bar ${bar}`).toContain(n.midi % 12);
        }
      }
      at += n.beats;
    }
  });
});

/** Opening phrases as scale degrees, written independently of the note data (an incipit check). */
const INCIPITS: Record<string, { tonic: string; minor?: boolean; degrees: number[] }> = {
  'jingle-bells': { tonic: 'G', degrees: [5, 3, 2, 1, 5, 5, 5, 5, 3, 2, 1, 6] }, // Dashing through the snow, in a one-horse open sleigh
  'deck-the-halls': { tonic: 'D', degrees: [5, 4, 3, 2, 1, 2, 3, 1, 2, 3, 4, 2, 3, 2, 1, 7, 1] },
  'o-christmas-tree': { tonic: 'G', degrees: [5, 1, 1, 1, 2, 3, 3, 3, 3, 2, 3, 4, 7, 2, 1] },
  'joy-to-the-world': { tonic: 'D', degrees: [1, 7, 6, 5, 4, 3, 2, 1, 5, 6, 6, 7, 7, 1] },
  'silent-night': { tonic: 'C', degrees: [5, 6, 5, 3, 5, 6, 5, 3, 2, 2, 7, 1, 1, 5] },
  'hark-the-herald': { tonic: 'F', degrees: [5, 1, 1, 7, 1, 3, 3, 2, 5, 5, 5, 4, 3, 2, 3] },
  'god-rest-ye': { tonic: 'E', minor: true, degrees: [1, 1, 5, 5, 4, 3, 2, 1, 7, 1, 2, 3, 4, 5] },
  'the-first-noel': { tonic: 'D', degrees: [3, 2, 1, 2, 3, 4, 5, 6, 7, 1, 7, 6, 5] },
};

it('opens each carol with the right tune', () => {
  const major = [1, 0, 2, 0, 3, 4, 0, 5, 0, 6, 0, 7];
  const minor = [1, 0, 2, 3, 0, 4, 0, 5, 6, 0, 7, 0];
  for (const c of CAROLS) {
    const inc = INCIPITS[c.id];
    expect(inc, c.id).toBeDefined();
    const tonic = noteToMidi(`${inc.tonic}4`) % 12;
    const map = inc.minor ? minor : major;
    const got = c.notes
      .flatMap((n) => (n.midi === null ? [] : [n.midi]))
      .slice(0, inc.degrees.length)
      .map((m) => map[(m - tonic + 120) % 12]);
    expect(got, c.id).toEqual(inc.degrees);
  }
});
