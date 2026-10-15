import { describe, expect, it } from 'vitest';
import type { RunOutcome } from '../../../src/api/outcome';
import type { FinishResult } from '../../../src/api/types';
import { HectorDesk, glares } from '../../../src/ui/hector';

const result = (over: Partial<FinishResult> = {}): FinishResult => ({ id: 'g', ranked: true, reason: null, ms: 81_000, rank: 12, total: 340, best: 81_000, newBest: false, ...over });
const ranked: RunOutcome = { kind: 'done', result: result() };
const unverified: RunOutcome = { kind: 'unverified' };
const saving: RunOutcome = { kind: 'saving' };
const NONE = { clip: null, glare: false };

/** A live win in the mode: its sound due, then its tag, the outcome as given at each step. */
function win(desk: HectorDesk, o: RunOutcome, newBest = false, mode = true) {
  desk.begin(newBest);
  desk.soundDue();
  const atSound = desk.step(mode, o);
  desk.tagShown();
  const atTag = desk.step(mode, o);
  return { atSound, atTag };
}

const clock: RunOutcome = { kind: 'done', result: result({ ranked: false, reason: 'clock', rank: null }) };

describe('glares: Hector for every unranked "couldn\'t verify" run the tag shows, in the mode', () => {
  it('the log not verified, or the clock not verified (sent late after a reload, too); never a ranked win', () => {
    for (const o of [unverified, clock]) {
      expect(glares(true, o)).toBe(true);
      expect(glares(false, o)).toBe(false);
    }
    for (const o of [ranked, saving, { kind: 'offline' }, { kind: 'failed' }, null] as (RunOutcome | null)[]) expect(glares(true, o)).toBe(false);
    // Ranked, whatever the reason field says: never.
    expect(glares(true, { kind: 'done', result: result({ ranked: true, reason: 'clock' }) })).toBe(false);
    // Unranked for reasons the tag doesn't call unverified (signed out, too fast, paused): not his business.
    for (const reason of ['anonymous', 'too_fast', 'paused'] as const) {
      expect(glares(true, { kind: 'done', result: result({ ranked: false, reason }) })).toBe(false);
    }
  });
});

describe('HectorDesk: which clip on which Home Alone win', () => {
  it('a ranked win, not a best: the filthy animal at the sound, no glare', () => {
    const d = new HectorDesk();
    const { atSound, atTag } = win(d, ranked);
    expect(atSound).toEqual({ clip: 'filthy-animal', glare: false });
    expect(atTag).toEqual(NONE);
  });

  it('a new personal best (this device\'s, or the account\'s ranked best): "I love you" instead', () => {
    expect(win(new HectorDesk(), ranked, true).atSound).toEqual({ clip: 'hector-love', glare: false });
    expect(win(new HectorDesk(), { kind: 'done', result: result({ newBest: true }) }, false).atSound).toEqual({ clip: 'hector-love', glare: false });
    // Signed out, offline or unsaved, a device best still counts.
    expect(win(new HectorDesk(), { kind: 'done', result: result({ ranked: false, reason: 'anonymous' }) }, true).atSound.clip).toBe('hector-love');
    expect(win(new HectorDesk(), { kind: 'offline' }, true).atSound.clip).toBe('hector-love');
    expect(win(new HectorDesk(), { kind: 'failed' }, false).atSound.clip).toBe('filthy-animal');
  });

  it('unverified: silent at the sound; the glare and his line when the tag shows, alternating per glare', () => {
    const d = new HectorDesk();
    const first = win(d, unverified);
    expect(first.atSound).toEqual(NONE);
    expect(first.atTag).toEqual({ clip: 'hector-credit-card', glare: true });
    expect(win(d, unverified).atTag).toEqual({ clip: 'hector-mistaken', glare: true });
    expect(win(d, unverified).atTag).toEqual({ clip: 'hector-credit-card', glare: true });
    // A ranked win in between doesn't move his turn.
    win(d, ranked);
    expect(win(d, unverified).atTag.clip).toBe('hector-mistaken');
  });

  it('the clock unverified (a run that spanned reloads): the glare and his line too, in the same turn, not the filthy animal', () => {
    const d = new HectorDesk();
    const first = win(d, clock);
    expect(first.atSound).toEqual(NONE);
    expect(first.atTag).toEqual({ clip: 'hector-credit-card', glare: true });
    expect(win(d, unverified).atTag).toEqual({ clip: 'hector-mistaken', glare: true });
    expect(win(d, clock, true).atTag).toEqual({ clip: 'hector-credit-card', glare: true });
  });

  it('an unverified new best: the glare\'s clip wins over "I love you"', () => {
    const { atSound, atTag } = win(new HectorDesk(), unverified, true);
    expect(atSound).toEqual(NONE);
    expect(atTag).toEqual({ clip: 'hector-credit-card', glare: true });
  });

  it('never outside the mode: no clip, no glare, and his turn stays put', () => {
    const d = new HectorDesk();
    for (const o of [ranked, unverified]) {
      const { atSound, atTag } = win(d, o, true, false);
      expect(atSound).toEqual(NONE);
      expect(atTag).toEqual(NONE);
    }
    expect(win(d, unverified).atTag.clip).toBe('hector-credit-card');
  });

  it('the answer still on its way at the sound: waits; settled before the tag, decides then', () => {
    const d = new HectorDesk();
    d.begin(false);
    d.soundDue();
    expect(d.step(true, saving)).toEqual(NONE);
    expect(d.step(true, null)).toEqual(NONE);
    expect(d.step(true, ranked)).toEqual({ clip: 'filthy-animal', glare: false });
    expect(d.step(true, ranked)).toEqual(NONE); // once per win

    d.begin(true);
    d.soundDue();
    expect(d.step(true, saving)).toEqual(NONE);
    expect(d.step(true, unverified)).toEqual(NONE); // the glare will speak, with the tag
    d.tagShown();
    expect(d.step(true, unverified)).toEqual({ clip: 'hector-credit-card', glare: true });
  });

  it('still waiting when the tag shows: the usual clip then; a glare after that is silent and keeps his turn', () => {
    const d = new HectorDesk();
    d.begin(true);
    d.soundDue();
    expect(d.step(true, saving)).toEqual(NONE);
    d.tagShown();
    expect(d.step(true, saving)).toEqual({ clip: 'hector-love', glare: false });
    expect(d.step(true, unverified)).toEqual({ clip: null, glare: true });
    expect(d.step(true, unverified)).toEqual(NONE);
    expect(win(d, unverified).atTag.clip).toBe('hector-credit-card');
  });

  it('the tag before the sound (a restored order): the glare waits for nothing but the tag', () => {
    const d = new HectorDesk();
    d.begin(false);
    d.tagShown();
    expect(d.step(true, unverified)).toEqual({ clip: 'hector-credit-card', glare: true });
    d.soundDue();
    expect(d.step(true, unverified)).toEqual(NONE);
  });

  it('once per win, and nothing after the win is over or before one', () => {
    const d = new HectorDesk();
    expect(d.step(true, unverified)).toEqual(NONE);
    d.begin(false);
    d.soundDue();
    d.tagShown();
    expect(d.step(true, unverified).glare).toBe(true);
    expect(d.step(true, unverified)).toEqual(NONE);
    d.begin(false);
    d.end();
    d.soundDue();
    d.tagShown();
    expect(d.step(true, unverified)).toEqual(NONE);
    expect(d.step(true, ranked)).toEqual(NONE);
  });

  it('the mode switched off before the sound: that win stays silent even if it comes back on', () => {
    const d = new HectorDesk();
    d.begin(false);
    d.soundDue();
    expect(d.step(false, ranked)).toEqual(NONE);
    expect(d.step(true, ranked)).toEqual(NONE);
  });
});
