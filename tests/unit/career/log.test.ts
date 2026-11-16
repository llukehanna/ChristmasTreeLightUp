// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { CAREER_DAILY_FIRST, CAREER_IMPORTED, CAREER_REPLAY, type CareerRow } from '../../../src/api/types';
import { parseCareer, type CareerRun } from '../../../src/core/career';
import { createLog } from '../../../src/career/log';

const D = new Date(2026, 10, 1, 9, 0).getTime();
const row = (i: number, over: Partial<{ ms: number; turns: number | null; min: number | null; flags: number; reason: CareerRow[6]; daily: string | null }> = {}): CareerRow => [
  `g${i}`,
  D + i * 60_000,
  over.ms ?? 40_000 + i,
  over.turns === undefined ? 60 : over.turns,
  over.min === undefined ? 50 : over.min,
  over.flags ?? CAREER_REPLAY,
  over.reason ?? null,
  over.daily ?? null,
];
const runsOf = (rows: CareerRow[]): CareerRun[] => parseCareer(rows);
const many = (n: number): CareerRun[] => runsOf(Array.from({ length: n }, (_, i) => row(i)));
const mount = (runs: CareerRun[], over: { pbs?: string[]; onWatch?: (id: string) => void } = {}) => {
  const log = createLog({ runs, pbs: new Set(over.pbs ?? []), onWatch: over.onWatch ?? (() => undefined) });
  document.body.append(log.el);
  return log.el;
};
const trs = (el: HTMLElement) => el.querySelectorAll('tbody tr');
const more = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('.more')!;
const filter = (el: HTMLElement, v: string) => el.querySelector<HTMLButtonElement>(`#career-filter button[data-v="${v}"]`)!.click();
const count = (el: HTMLElement) => el.querySelector('.sub')!.textContent;
const timeCol = (el: HTMLElement) => [...el.querySelectorAll('tbody td.time')].map((n) => n.textContent);

afterEach(() => (document.body.innerHTML = ''));

it('shows 50 rows, then 50 more, and hides the button at the end', () => {
  const el = mount(many(120));
  expect(trs(el)).toHaveLength(50);
  expect(count(el)).toBe('120 games');
  more(el).click();
  expect(trs(el)).toHaveLength(100);
  expect(more(el).hidden).toBe(false);
  more(el).click();
  expect(trs(el)).toHaveLength(120);
  expect(more(el).hidden).toBe(true);
});

it('a heavy account renders only its first 50 rows', () => {
  const el = mount(many(10_000));
  expect(trs(el)).toHaveLength(50);
  expect(count(el)).toBe('10,000 games');
});

it('filters: Ranked, Daily, Unranked and Imported', () => {
  const runs = runsOf([
    row(0),
    row(1, { daily: '2026-11-01' }),
    row(2, { reason: 'paused' }),
    row(3, { flags: CAREER_IMPORTED, turns: null, min: null }),
    row(4),
  ]);
  const el = mount(runs);
  const ids = () => [...el.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('td')!.textContent);
  expect(count(el)).toBe('5 games');
  filter(el, 'ranked');
  expect(count(el)).toBe('3 games');
  expect(ids().sort()).toEqual(['1', '2', '5']);
  filter(el, 'daily');
  expect(ids()).toEqual(['2']);
  expect(count(el)).toBe('1 game');
  filter(el, 'unranked');
  expect(ids()).toEqual(['3']);
  filter(el, 'import');
  expect(ids()).toEqual(['4']);
  filter(el, 'all');
  expect(count(el)).toBe('5 games');
});

it("a Daily first attempt reads as Daily alone; a repeat says it isn't your first go, and only it is Unranked", () => {
  const runs = runsOf([
    row(0, { daily: '2026-11-01', reason: 'daily', flags: CAREER_REPLAY | CAREER_DAILY_FIRST }),
    row(1, { daily: '2026-11-01', reason: 'daily' }),
  ]);
  const el = mount(runs);
  const tags = (n: number) => [...trs(el)[1 - n].querySelectorAll('.tag')].map((t) => t.textContent);
  expect(tags(0)).toEqual(['Daily']);
  expect(tags(1)).toEqual(['Daily', 'Unranked · not your first go']);
  const ids = () => [...el.querySelectorAll('tbody tr')].map((tr) => tr.querySelector('td')!.textContent);
  filter(el, 'daily');
  expect(ids()).toEqual(['2', '1']);
  filter(el, 'unranked');
  expect(ids()).toEqual(['2']);
});

it('sorts by a header, and again reverses; When is newest first by default', () => {
  const runs = runsOf([row(0, { ms: 30_000 }), row(1, { ms: 50_000 }), row(2, { ms: 40_000 })]);
  const el = mount(runs);
  expect(timeCol(el)).toEqual(['0:40.0', '0:50.0', '0:30.0']);
  const th = (k: string) => el.querySelector<HTMLElement>(`thead th[data-k="${k}"]`)!;
  th('ms').click();
  expect(timeCol(el)).toEqual(['0:30.0', '0:40.0', '0:50.0']);
  expect(th('ms').classList.contains('on')).toBe(true);
  th('ms').click();
  expect(timeCol(el)).toEqual(['0:50.0', '0:40.0', '0:30.0']);
  th('at').click();
  expect(timeCol(el)).toEqual(['0:40.0', '0:50.0', '0:30.0']);
});

it('a run without turns sorts last either way', () => {
  const runs = runsOf([row(0, { turns: null, min: null }), row(1, { turns: 70, min: 50 }), row(2, { turns: 55, min: 50 })]);
  const el = mount(runs);
  const extras = () => [...el.querySelectorAll('tbody tr')].map((tr) => tr.children[5].textContent);
  const th = el.querySelector<HTMLElement>('thead th[data-k="extra"]')!;
  th.click();
  expect(extras()).toEqual(['5', '20', '–']);
  th.click();
  expect(extras()).toEqual(['20', '5', '–']);
});

it('tags and Watch', () => {
  const onWatch = vi.fn();
  const runs = runsOf([
    row(0),
    row(1, { daily: '2026-11-01' }),
    row(2, { reason: 'paused' }),
    row(3, { reason: 'daily' }),
    row(4, { flags: CAREER_IMPORTED, turns: null, min: null }),
  ]);
  const el = mount(runs, { pbs: ['g0'], onWatch });
  const tags = (n: number) => [...trs(el)[4 - n].querySelectorAll('.tag')].map((t) => t.textContent);
  expect(tags(0)).toEqual(['PB']);
  expect(tags(1)).toEqual(['Daily']);
  expect(tags(2)).toEqual(['Unranked · paused too long']);
  expect(tags(3)).toEqual(['Unranked · not your first go']);
  expect(tags(4)).toEqual(['Imported']);
  const watch = (n: number) => trs(el)[4 - n].querySelector<HTMLButtonElement>('.watch')!;
  expect(watch(4).disabled).toBe(true);
  expect(watch(0).disabled).toBe(false);
  watch(0).click();
  expect(onWatch).toHaveBeenCalledWith('g0');
  watch(4).click();
  expect(onWatch).toHaveBeenCalledTimes(1);
});

it('the average of 5 shows from the fifth counted run; an uncounted run shows a dash', () => {
  const runs = runsOf([...Array.from({ length: 5 }, (_, i) => row(i, { ms: 40_000 })), row(5, { ms: 10_000, reason: 'too_fast' })]);
  const el = mount(runs);
  const ao = () => [...el.querySelectorAll('tbody tr')].map((tr) => tr.children[6].textContent);
  expect(ao()).toEqual(['–', '0:40.0', '–', '–', '–', '–']);
});

it('an empty career says so', () => {
  const el = mount([]);
  expect(el.textContent).toContain('No games yet');
  expect(trs(el).length).toBeLessThanOrEqual(1);
  expect(more(el).hidden).toBe(true);
});
