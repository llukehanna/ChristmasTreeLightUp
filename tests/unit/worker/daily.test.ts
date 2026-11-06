import { describe, expect, it } from 'vitest';
import { GEN_VERSION } from '../../../src/core/seeded';
import { fromBase64url, hmac } from '../../../worker/lib/crypto';
import { dailyClosesAt, dailySeed, liveDay, startsDark } from '../../../worker/lib/daily';
import { dayNumber, dayText } from '../../../worker/lib/days';

/** The k-th candidate for a day, worked out here independently of the module: the first 32 bits of the HMAC. */
async function candidate(secret: string, day: number, k: number): Promise<number> {
  const bytes = fromBase64url((await hmac(secret, `daily:${dayText(day)}:${k}`)).slice(0, 8));
  return new DataView(bytes.buffer).getUint32(0);
}

/** The first day from 2026-11-01 (within 5,000 days) whose k=0 candidate starts dark. */
async function firstDayWithDarkCandidate(secret: string): Promise<number> {
  const d0 = dayNumber('2026-11-01')!;
  for (let d = d0; d < d0 + 5000; d++) if (startsDark(await candidate(secret, d, 0), GEN_VERSION)) return d;
  throw new Error('no day within 5,000 has a dark k=0 candidate');
}

describe('dailySeed', () => {
  it('is the same seed for the same day and secret, and differs by day', async () => {
    const d = dayNumber('2026-12-03')!;
    expect(await dailySeed('s', d)).toBe(await dailySeed('s', d));
    expect(await dailySeed('s', d)).not.toBe(await dailySeed('s', d + 1));
    expect(await dailySeed('t', d)).not.toBe(await dailySeed('s', d));
  });
  it('is a uint32', async () => {
    const d = dayNumber('2026-12-03')!;
    const s = await dailySeed('s', d);
    expect(Number.isInteger(s) && s >= 0 && s <= 0xffffffff).toBe(true);
  });
  it('never starts fully dark: 200 days in a row all have light', async () => {
    const d0 = dayNumber('2026-11-01')!;
    for (let d = d0; d < d0 + 200; d++) expect(startsDark(await dailySeed('s', d), GEN_VERSION)).toBe(false);
  });
  it('skips a dark seed', async () => {
    const d = await firstDayWithDarkCandidate('s');
    const k0 = await candidate('s', d, 0);
    expect(startsDark(k0, GEN_VERSION)).toBe(true);
    expect(await dailySeed('s', d)).not.toBe(k0);
    const k1 = await candidate('s', d, 1);
    expect(await dailySeed('s', d)).toBe(startsDark(k1, GEN_VERSION) ? await candidate('s', d, 2) : k1);
  });
});

describe('liveDay', () => {
  const at = (iso: string) => Date.parse(iso);
  it('accepts the UTC date and one either side', () => {
    expect(liveDay('2026-11-07', at('2026-11-06T23:30:00Z'))).toBe(dayNumber('2026-11-07'));
    expect(liveDay('2026-11-05', at('2026-11-06T00:10:00Z'))).toBe(dayNumber('2026-11-05'));
  });
  it('refuses two days ahead or behind, before the first day, and non-dates', () => {
    expect(liveDay('2026-11-08', at('2026-11-06T23:30:00Z'))).toBeNull();
    expect(liveDay('2026-11-04', at('2026-11-06T00:10:00Z'))).toBeNull();
    expect(liveDay('2026-10-31', at('2026-11-01T00:00:00Z'))).toBeNull();
    for (const bad of ['2026-11-31', '11/06/2026', 20261106, null]) expect(liveDay(bad, at('2026-11-06T12:00:00Z'))).toBeNull();
  });
});

it('a day closes at UTC midnight two days on', () => {
  expect(dailyClosesAt(dayNumber('2026-11-06')!)).toBe(Date.parse('2026-11-08T00:00:00Z'));
});
