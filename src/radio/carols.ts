/**
 * Public-domain carols for the Music Box station, as data.
 *
 * Each carol is written the way it plays: concert pitch in the music-box register (melody roughly C5–F6),
 * durations in quarter-note beats, one `|` per bar. Melodies follow the sources named on each carol;
 * the chords are simple period-style harmonisations (the hymns follow their published SATB parts).
 *
 * Melody tokens: `NOTE:BEATS`, e.g. `F#5:1.5`, `Bb5:.5`; `r:BEATS` is a rest, `-:BEATS` ties onto the previous note.
 * Chord tokens:  `NAME:BEATS`, e.g. `G:4`, `Am:2`, `D7:1`, `C7/Bb:2` (slash = bass note); `r` = no accompaniment.
 * A first bar shorter than the metre is a pickup; the last bar then completes it.
 */

export type Meter = '2/4' | '3/4' | '4/4' | '6/8';

export interface Note {
  /** MIDI note number, or null for a rest. */
  midi: number | null;
  beats: number;
}

export interface Chord {
  /** Pitch classes (0 = C): root, third, fifth and, for sevenths, the seventh. Null = no accompaniment. */
  root: number | null;
  third: number;
  fifth: number;
  seventh: number | null;
  /** Pitch class of the bass note (the root unless a slash chord). */
  bass: number;
  beats: number;
}

export interface CarolSource {
  id: string;
  title: string;
  /** "traditional", or the composer. Shown in the credit line. */
  by: string;
  /** Where the tune comes from and when it was published (all before 1929). */
  origin: string;
  meter: Meter;
  /** Quarter-note beats per minute: a little slower than the carol is usually sung. */
  bpm: number;
  melody: string;
  chords: string;
}

export interface Carol extends CarolSource {
  notes: Note[];
  harmony: Chord[];
  /** Beats in one bar, in quarter notes (6/8 = 3). */
  barBeats: number;
  /** Beats before the first downbeat (0 if the carol starts on one). */
  pickup: number;
  /** Total length in beats. */
  beats: number;
}

const PC: Readonly<Record<string, number>> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Scientific pitch name → MIDI (C4 = 60). */
export function noteToMidi(name: string): number {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error(`bad note "${name}"`);
  const acc = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0;
  return 12 * (Number(m[3]) + 1) + PC[m[1]] + acc;
}

function pitchClass(name: string): number {
  const m = /^([A-G])([#b]?)$/.exec(name);
  if (!m) throw new Error(`bad pitch "${name}"`);
  return (PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
}

/** `G`, `Am`, `D7`, `Gm7`, `C7/Bb`, `F/C`, `B/D#` … */
export function parseChord(name: string, beats: number): Chord {
  if (name === 'r') return { root: null, third: 0, fifth: 0, seventh: null, bass: 0, beats };
  const m = /^([A-G][#b]?)(m?)(7?)(?:\/([A-G][#b]?))?$/.exec(name);
  if (!m) throw new Error(`bad chord "${name}"`);
  const root = pitchClass(m[1]);
  const minor = m[2] === 'm';
  return {
    root,
    third: (root + (minor ? 3 : 4)) % 12,
    fifth: (root + 7) % 12,
    seventh: m[3] ? (root + 10) % 12 : null, // dominant and minor sevenths both add a minor seventh
    bass: m[4] ? pitchClass(m[4]) : root,
    beats,
  };
}

const num = (s: string, tok: string): number => {
  const v = Number(s);
  if (!Number.isFinite(v) || v <= 0) throw new Error(`bad duration in "${tok}"`);
  return v;
};

/** Splits a line into bars of `NAME:BEATS` tokens. */
export function bars(src: string): [string, number][][] {
  return src
    .split('|')
    .map((bar) =>
      bar
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map((tok): [string, number] => {
          const i = tok.lastIndexOf(':');
          if (i <= 0) throw new Error(`bad token "${tok}"`);
          return [tok.slice(0, i), num(tok.slice(i + 1), tok)];
        }),
    )
    .filter((b) => b.length > 0);
}

export function parseMelody(src: string): Note[] {
  const out: Note[] = [];
  for (const [name, beats] of bars(src).flat()) {
    if (name === '-') {
      const prev = out[out.length - 1];
      if (!prev || prev.midi === null) throw new Error('tie without a note');
      prev.beats += beats;
    } else out.push({ midi: name === 'r' ? null : noteToMidi(name), beats });
  }
  return out;
}

export const BAR_BEATS: Readonly<Record<Meter, number>> = { '2/4': 2, '3/4': 3, '4/4': 4, '6/8': 3 };

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);

export function compileCarol(src: CarolSource): Carol {
  const barBeats = BAR_BEATS[src.meter];
  const first = bars(src.melody)[0] ?? [];
  const firstLen = sum(first.map(([, b]) => b));
  const notes = parseMelody(src.melody);
  const harmony = bars(src.chords)
    .flat()
    .map(([n, b]) => parseChord(n, b));
  return {
    ...src,
    notes,
    harmony,
    barBeats,
    pickup: firstLen < barBeats - 1e-9 ? firstLen : 0,
    beats: sum(notes.map((n) => n.beats)),
  };
}

export const CAROL_SOURCES: readonly CarolSource[] = [
  {
    id: 'jingle-bells',
    title: 'Jingle Bells',
    by: 'James Lord Pierpont',
    origin:
      'Pierpont, "The One Horse Open Sleigh" (Boston: Oliver Ditson, 1857; reissued as "Jingle Bells" 1859). ' +
      'Verse as published; the familiar refrain is the one in use by 1898 (Edison cylinder).',
    meter: '4/4',
    bpm: 120,
    melody: `
      D5:1 B5:1 A5:1 G5:1 | D5:3 D5:.5 D5:.5 | D5:1 B5:1 A5:1 G5:1 | E5:4 |
      E5:1 C6:1 B5:1 A5:1 | F#5:4 | D6:1 D6:1 C6:1 A5:1 | B5:4 |
      D5:1 B5:1 A5:1 G5:1 | D5:4 | D5:1 B5:1 A5:1 G5:1 | E5:3 r:.5 E5:.5 |
      E5:1 C6:1 B5:1 A5:1 | D6:1 D6:1 D6:1 D6:1 | E6:1 D6:1 C6:1 A5:1 | G5:2 r:2 |
      B5:1 B5:1 B5:2 | B5:1 B5:1 B5:2 | B5:1 D6:1 G5:1.5 A5:.5 | B5:4 |
      C6:1 C6:1 C6:1.5 C6:.5 | C6:1 B5:1 B5:1 B5:.5 B5:.5 | B5:1 A5:1 A5:1 B5:1 | A5:2 D6:2 |
      B5:1 B5:1 B5:2 | B5:1 B5:1 B5:2 | B5:1 D6:1 G5:1.5 A5:.5 | B5:4 |
      C6:1 C6:1 C6:1.5 C6:.5 | C6:1 B5:1 B5:1 B5:.5 B5:.5 | D6:1 D6:1 C6:1 A5:1 | G5:4`,
    chords: `
      G:4 | G:4 | G:4 | C:4 | Am:4 | D7:4 | D7:4 | G:4 |
      G:4 | G:4 | G:4 | C:4 | Am:4 | G:4 | Am:2 D7:2 | G:4 |
      G:4 | G:4 | G:4 | G:4 | C:4 | C:1 G:3 | A7:4 | D7:4 |
      G:4 | G:4 | G:4 | G:4 | C:4 | C:1 G:3 | D7:4 | G:4`,
  },
  {
    id: 'deck-the-halls',
    title: 'Deck the Halls',
    by: 'traditional',
    origin: 'Welsh air "Nos Galan" (Edward Jones, Musical and Poetical Relicks of the Welsh Bards, 1794); English words Oliphant, 1862.',
    meter: '4/4',
    bpm: 104,
    melody: `
      A5:1.5 G5:.5 F#5:1 E5:1 | D5:1 E5:1 F#5:1 D5:1 | E5:.5 F#5:.5 G5:.5 E5:.5 F#5:1.5 E5:.5 | D5:1 C#5:1 D5:2 |
      A5:1.5 G5:.5 F#5:1 E5:1 | D5:1 E5:1 F#5:1 D5:1 | E5:.5 F#5:.5 G5:.5 E5:.5 F#5:1.5 E5:.5 | D5:1 C#5:1 D5:2 |
      E5:1.5 F#5:.5 G5:1 E5:1 | F#5:1.5 G5:.5 A5:1 E5:1 | F#5:.5 G5:.5 A5:1 B5:.5 C#6:.5 D6:1 | C#6:1 B5:1 A5:2 |
      A5:1.5 G5:.5 F#5:1 E5:1 | D5:1 E5:1 F#5:1 D5:1 | B5:.5 B5:.5 B5:.5 B5:.5 A5:1.5 G5:.5 | F#5:1 E5:1 D5:2`,
    chords: `
      D:4 | D:1 A:1 D:2 | A7:2 D:2 | G:1 A7:1 D:2 |
      D:4 | D:1 A:1 D:2 | A7:2 D:2 | G:1 A7:1 D:2 |
      A7:4 | D:2 A:2 | D:2 Bm:2 | A:1 E7:1 A:2 |
      D:4 | D:1 A:1 D:2 | G:2 D:2 | D:1 A7:1 D:2`,
  },
  {
    id: 'o-christmas-tree',
    title: 'O Christmas Tree',
    by: 'traditional',
    origin: 'German folk tune "O Tannenbaum", as set by Ernst Anschütz (Leipzig, 1824).',
    meter: '3/4',
    bpm: 84,
    melody: `
      D5:.5 | G5:.75 G5:.25 G5:1 A5:1 | B5:.75 B5:.25 B5:1.5 B5:.5 | A5:.5 B5:.5 C6:1 F#5:1 | A5:1 G5:1.5 D6:.5 |
      D6:.5 B5:.5 E6:1.5 D6:.5 | D6:.5 C6:.5 C6:1.5 C6:.5 | C6:.5 A5:.5 D6:1.5 C6:.5 | C6:.5 B5:.5 B5:1.5 D5:.5 |
      G5:.75 G5:.25 G5:1 A5:1 | B5:.75 B5:.25 B5:1.5 B5:.5 | A5:.5 B5:.5 C6:1 F#5:1 | A5:1 G5:1.5`,
    chords: `
      r:.5 | G:2 D:1 | G:3 | Am:2 D7:1 | D7:1 G:2 |
      G7:1 C:2 | D7:3 | D7:3 | G:3 |
      G:2 D:1 | G:3 | Am:2 D7:1 | D7:1 G:1.5`,
  },
  {
    id: 'joy-to-the-world',
    title: 'Joy to the World',
    by: 'Lowell Mason',
    origin: 'Tune "Antioch", Lowell Mason, The Modern Psalmist (Boston, 1839), no. 144.',
    meter: '2/4',
    bpm: 84,
    melody: `
      D6:1 C#6:.75 B5:.25 | A5:1.5 G5:.5 | F#5:1 E5:1 | D5:1.5 A5:.5 |
      B5:1.5 B5:.5 | C#6:1.5 C#6:.5 | D6:2 | -:1.5 D6:.5 |
      D6:.5 C#6:.5 B5:.5 A5:.5 | A5:.75 G5:.25 F#5:.5 D6:.5 | D6:.5 C#6:.5 B5:.5 A5:.5 | A5:.75 G5:.25 F#5:.5 F#5:.5 |
      F#5:.5 F#5:.5 F#5:.5 F#5:.25 G5:.25 | A5:1.5 G5:.25 F#5:.25 | E5:.5 E5:.5 E5:.5 E5:.25 F#5:.25 | G5:1.5 F#5:.25 E5:.25 |
      F#5:.5 D6:1 B5:.5 | A5:.75 G5:.25 F#5:.5 G5:.5 | F#5:1 E5:1 | D5:2`,
    chords: `
      D:2 | D:1.5 Em/G:.5 | D/A:1 A7:1 | D:2 |
      G:2 | A:2 | D:2 | D:2 |
      D:2 | D:2 | D:2 | D:2 |
      D:2 | D:2 | A:2 | A7:2 |
      D:2 | D:1.5 G:.5 | D/A:1 A7:1 | D:2`,
  },
  {
    id: 'silent-night',
    title: 'Silent Night',
    by: 'Franz Xaver Gruber',
    origin: 'Gruber, "Stille Nacht" (Oberndorf, 1818), in the form sung since the mid-19th century.',
    meter: '6/8',
    bpm: 63,
    melody: `
      G5:.75 A5:.25 G5:.5 E5:1.5 | G5:.75 A5:.25 G5:.5 E5:1.5 | D6:1 D6:.5 B5:1.5 | C6:1 C6:.5 G5:1.5 |
      A5:1 A5:.5 C6:.75 B5:.25 A5:.5 | G5:.75 A5:.25 G5:.5 E5:1.5 | A5:1 A5:.5 C6:.75 B5:.25 A5:.5 | G5:.75 A5:.25 G5:.5 E5:1.5 |
      D6:1 D6:.5 F6:.75 D6:.25 B5:.5 | C6:1.5 E6:1.5 | C6:.75 G5:.25 E5:.5 G5:.75 F5:.25 D5:.5 | C5:3`,
    chords: `
      C:3 | C:3 | G7:3 | C:3 | F:3 | C:3 | F:3 | C:3 | G7:3 | C:3 | C:1.5 G7:1.5 | C:3`,
  },
  {
    id: 'hark-the-herald',
    title: 'Hark! The Herald Angels Sing',
    by: 'Felix Mendelssohn',
    origin: 'Mendelssohn, Festgesang (1840), adapted by William H. Cummings (1856).',
    meter: '4/4',
    bpm: 92,
    melody: `
      C5:1 F5:1 F5:1.5 E5:.5 | F5:1 A5:1 A5:1 G5:1 | C6:1 C6:1 C6:1.5 Bb5:.5 | A5:1 G5:1 A5:2 |
      C5:1 F5:1 F5:1.5 E5:.5 | F5:1 A5:1 A5:1 G5:1 | C6:1 G5:1 G5:1.5 E5:.5 | E5:1 D5:1 C5:2 |
      C6:1 C6:1 C6:1 F5:1 | Bb5:1 A5:1 A5:1 G5:1 | C6:1 C6:1 C6:1 F5:1 | Bb5:1 A5:1 A5:1 G5:1 |
      D6:1 D6:1 D6:1 C6:1 | Bb5:1 A5:1 Bb5:2 | G5:1 A5:.5 Bb5:.5 C6:1.5 F5:.5 | F5:1 G5:1 A5:2 |
      D6:1.5 D6:.5 D6:1 C6:1 | Bb5:1 A5:1 Bb5:2 | G5:1 A5:.5 Bb5:.5 C6:1.5 F5:.5 | F5:1 G5:1 F5:2`,
    chords: `
      F:4 | F/A:1 F:1 F/C:1 C:1 | F/A:1 Am:1 Bb:2 | F/C:1 C:1 F:2 |
      F:4 | Dm:1 F/C:1 G7/B:2 | Am:1 G/B:1 C:2 | F:1 G7:1 C:2 |
      C:3 F/A:1 | C7/E:1 F:1 F/C:1 C:1 | C:3 F/A:1 | C7/E:1 F:1 F/C:1 C:1 |
      Bb:4 | Gm/Bb:1 D7:1 Gm:2 | C7/Bb:2 F/A:1 F:1 | F/C:1 C:1 F:2 |
      Bb:4 | Gm/Bb:1 D:1 Gm:1 Gm/F:1 | C/E:1 C7/Bb:1 F/A:1 F:1 | F/C:1 C7:1 F:2`,
  },
  {
    id: 'god-rest-ye',
    title: 'God Rest Ye Merry, Gentlemen',
    by: 'traditional',
    origin: 'Traditional English; tune as in William Sandys, Christmas Carols Ancient and Modern (London, 1833).',
    meter: '4/4',
    bpm: 96,
    melody: `
      E5:1 | E5:1 B5:1 B5:1 A5:1 | G5:1 F#5:1 E5:1 D5:1 | E5:1 F#5:1 G5:1 A5:1 | B5:3 E5:1 |
      E5:1 B5:1 B5:1 A5:1 | G5:1 F#5:1 E5:1 D5:1 | E5:1 F#5:1 G5:1 A5:1 | B5:3 B5:1 |
      C6:1 A5:1 B5:1 C6:1 | D6:1 E6:1 B5:1 A5:1 | G5:1 E5:1 F#5:1 G5:1 | A5:2 G5:1 A5:1 |
      B5:2 C6:1 B5:1 | B5:1 A5:1 G5:1 F#5:1 | E5:2 G5:.5 F#5:.5 E5:1 | A5:2 G5:1 A5:1 |
      B5:1 C6:1 D6:1 E6:1 | B5:1 A5:1 G5:1 F#5:1 | E5:3`,
    chords: `
      Em:1 | Em:2 B/D#:1 B7:1 | Em:1 Bm:1 C:1 G:1 | C:1 B:1 Em:1 Am/C:1 | B:3 Em:1 |
      Em:2 B/D#:1 B7:1 | Em:1 Bm:1 C:1 G:1 | C:1 B:1 Em:1 Am/C:1 | B:3 E:1 |
      Am:1 D/F#:1 G:1 C:1 | G7/B:1 C:1 G:1 B7:1 | Em:1 A7/E:1 D:1 G/B:1 | D:1 D7:1 Em:1 D/F#:1 |
      G:2 C:1 G:1 | G:1 D7/A:1 Em/B:1 B:1 | Em:3 A7/E:1 | D:1 D7/C:1 G/B:1 D7/A:1 |
      G:1 C/E:1 G/B:1 C:1 | G:1 D7/A:1 Em/B:1 B:1 | Em:3`,
  },
  {
    id: 'the-first-noel',
    title: 'The First Noel',
    by: 'traditional',
    origin: 'Traditional Cornish; William Sandys, Christmas Carols Ancient and Modern (London, 1833).',
    meter: '3/4',
    bpm: 88,
    melody: `
      F#5:.5 E5:.5 | D5:1.5 E5:.5 F#5:.5 G5:.5 | A5:2 B5:.5 C#6:.5 | D6:1 C#6:1 B5:1 | A5:2 B5:.5 C#6:.5 |
      D6:1 C#6:1 B5:1 | A5:1 B5:1 C#6:1 | D6:1 A5:1 G5:1 | F#5:2 F#5:.5 E5:.5 |
      D5:1.5 E5:.5 F#5:.5 G5:.5 | A5:2 B5:.5 C#6:.5 | D6:1 C#6:1 B5:1 | A5:2 B5:.5 C#6:.5 |
      D6:1 C#6:1 B5:1 | A5:1 B5:1 C#6:1 | D6:1 A5:1 G5:1 | F#5:2 F#5:.5 E5:.5 |
      D5:1.5 E5:.5 F#5:.5 G5:.5 | A5:2 D6:.5 C#6:.5 | B5:2 B5:1 | A5:3 |
      D6:1 C#6:1 B5:1 | A5:1 B5:1 C#6:1 | D6:1 A5:1 G5:1 | F#5:2`,
    chords: `
      r:1 | D:3 | A:3 | D:1 A/C#:1 Bm:1 | D:3 |
      D:1 A/C#:1 Bm:1 | A:1 G:1 A7:1 | D:2 A7:1 | D:3 |
      D:3 | A:3 | D:1 A/C#:1 Bm:1 | D:3 |
      D:1 A/C#:1 Bm:1 | A:1 G:1 A7:1 | D:2 A7:1 | D:3 |
      D:3 | F#m:3 | G:3 | D:3 |
      D:1 A/C#:1 Bm:1 | A:1 G:1 A7:1 | D:2 A7:1 | D:2`,
  },
];

export const CAROLS: readonly Carol[] = CAROL_SOURCES.map(compileCarol);
