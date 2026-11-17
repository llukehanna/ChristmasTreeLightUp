import { expect, it } from 'vitest';
import { doorItem } from '../../../src/core/advent';
import { nextStep, type NextStepInput } from '../../../src/ui/next-step';

// Noon UTC on December 5: doors 1–3 have closed (UTC midnight two days on), door 4 is still live somewhere.
const DEC5 = Date.UTC(2026, 11, 5, 12);
const ownsDoors = (...ds: number[]) => (id: string) => ds.some((d) => doorItem(d).id === id);
const input = (p: Partial<NextStepInput>): NextStepInput => ({
  today: '2026-11-17', nowMs: Date.UTC(2026, 10, 17, 12), dailyPlayed: true, signedIn: true, owns: () => false, ...p,
});

it('no row once the Daily is played, outside December', () => {
  expect(nextStep(input({}))).toBeNull();
});

it("a new day's Daily, unplayed: Today's Daily Tree with its date", () => {
  expect(nextStep(input({ dailyPlayed: false }))).toEqual({ kind: 'daily', word: "Today's Daily Tree", meta: 'Nov 17' });
});

it("in Advent, the unplayed Daily is today's door", () => {
  expect(nextStep(input({ today: '2026-12-05', nowMs: DEC5, dailyPlayed: false }))).toEqual({ kind: 'daily', word: 'Advent · door 5', meta: "Today's Daily" });
});

it('in Advent, signed in: closed doors still shut are there to catch up', () => {
  expect(nextStep(input({ today: '2026-12-05', nowMs: DEC5, owns: ownsDoors(1) }))).toEqual({ kind: 'catch-up', word: 'Advent', meta: '2 to catch up' });
});

it('guests get no catch-up row', () => {
  expect(nextStep(input({ today: '2026-12-05', nowMs: DEC5, signedIn: false }))).toBeNull();
});

it('no catch-up row when every closed door is open', () => {
  expect(nextStep(input({ today: '2026-12-05', nowMs: DEC5, owns: ownsDoors(1, 2, 3) }))).toBeNull();
});

it('no catch-up row after December 24', () => {
  expect(nextStep(input({ today: '2026-12-26', nowMs: Date.UTC(2026, 11, 26, 12) }))).toBeNull();
});
