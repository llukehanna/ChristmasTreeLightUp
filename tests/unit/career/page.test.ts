// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CAREER_PAST, CAREER_REPLAY, type CareerResponse, type CareerRow } from '../../../src/api/types';
import { openCareer, type CareerOptions, type CareerPage } from '../../../src/career';

const NOW = new Date(2026, 10, 15, 12, 0);
const at = (daysAgo: number, h = 9) => new Date(2026, 10, 15 - daysAgo, h, 0).getTime();
const row = (id: string, daysAgo: number, ms: number, turns: number | null = 60, min: number | null = 50): CareerRow => [id, at(daysAgo), ms, turns, min, CAREER_REPLAY, null, null];
const fixture: CareerResponse = {
  runs: [row('a', 5, 31_400), row('b', 3, 29_700), row('c', 1, 33_000)],
  best: { id: 'b', ms: 29_700, rank: 1 },
  inTop: 2,
  total: 3,
};
const empty: CareerResponse = { runs: [], best: null, inTop: 0, total: 0 };

let page: CareerPage | null = null;
const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const open = (load: CareerOptions['load'], over: Partial<CareerOptions> = {}) =>
  (page = openCareer({ user: { name: 'Luke' }, load, onClose: () => undefined, onLeaderboard: () => undefined, onWatch: () => undefined, now: () => NOW, ...over }));
const tiles = () => [...document.querySelectorAll('.hero .stat')].map((s) => s.textContent ?? '');

beforeEach(() => vi.stubGlobal('scrollTo', () => undefined));
afterEach(() => {
  page?.close();
  page = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

it('renders the loading state, then the tiles', async () => {
  let resolve!: (r: CareerResponse) => void;
  const p = open(() => new Promise<CareerResponse>((r) => (resolve = r)));
  expect(p.el.parentElement).toBe(document.body);
  expect(p.el.getAttribute('role')).toBe('dialog');
  expect(p.el.getAttribute('aria-modal')).toBe('true');
  expect(document.activeElement?.id).toBe('career-title');
  expect(p.el.textContent).toContain('Loading your career…');
  resolve(fixture);
  await flush();
  expect(p.el.textContent).not.toContain('Loading your career…');
  const best = tiles()[0];
  expect(best).toContain('0:29.7');
  expect(best).toContain('#1 of 3 runs');
  expect(best).toContain('2 in the top 50');
  expect(best).not.toContain('paused run');
  expect(p.el.querySelector('.eyebrow')!.textContent).toContain('Luke');
});

/** The fixture with its fastest run (b) carrying the given reason, Daily day and flags. */
const withBest = (reason: CareerRow[6], daily: string | null = null, flags = CAREER_REPLAY): CareerResponse => ({
  ...fixture,
  runs: [row('a', 5, 31_400), ['b', at(3), 29_700, 60, 50, flags, reason, daily], row('c', 1, 33_000)],
});

it('a career best faster than the ranked best says what kind of run it was', async () => {
  const kinds: [string, CareerResponse][] = [
    ['paused run', withBest('paused')],
    ['Daily run', withBest(null, '2026-11-12')],
    ['Daily run', withBest('daily', '2026-11-12')],
    ['Daily run', withBest('past', '2026-11-01', CAREER_REPLAY | CAREER_PAST)],
    ['unranked run', withBest('anonymous')],
  ];
  for (const [kind, res] of kinds) {
    const p = open(async () => ({ ...res, best: { id: 'a', ms: 31_400, rank: 2 } }));
    await flush();
    expect(tiles()[0]).toContain(`${kind} · ranked best 0:31.4`);
    expect(p.el.textContent).toContain('0:29.7');
    p.close();
    document.body.innerHTML = '';
  }
});

it('with no ranked run the best tile shows only the career best', async () => {
  open(async () => ({ ...fixture, best: null, inTop: 0, total: 0 }));
  await flush();
  expect(tiles()[0]).toContain('0:29.7');
  expect(tiles()[0]).not.toContain('#');
  expect(tiles()[0]).not.toContain('top 50');
});

it('an error shows a retry, and Retry loads again', async () => {
  const load = vi.fn<CareerOptions['load']>().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(fixture);
  const p = open(load);
  await flush();
  const retry = p.el.querySelector<HTMLButtonElement>('.retry')!;
  expect(retry.textContent).toBe('Retry');
  retry.click();
  expect(load).toHaveBeenCalledTimes(2);
  expect(p.el.textContent).toContain('Loading your career…');
  await flush();
  expect(tiles()[0]).toContain('0:29.7');
});

it('a response that cannot be rendered shows the error and Retry, with no unhandled rejection', async () => {
  const unhandled = vi.fn();
  process.on('unhandledRejection', unhandled);
  const load = vi.fn<CareerOptions['load']>().mockResolvedValueOnce({ runs: null } as unknown as CareerResponse).mockResolvedValueOnce(fixture);
  const p = open(load);
  await flush();
  await new Promise((r) => setTimeout(r, 0));
  process.off('unhandledRejection', unhandled);
  expect(unhandled).not.toHaveBeenCalled();
  expect(p.el.textContent).not.toContain('Loading your career…');
  p.el.querySelector<HTMLButtonElement>('.retry')!.click();
  await flush();
  expect(tiles()[0]).toContain('0:29.7');
});

it("an empty career reads '–' everywhere", async () => {
  const p = open(async () => empty);
  await flush();
  const values = [...document.querySelectorAll('.stat .v')].map((v) => v.textContent);
  expect(values).toHaveLength(11);
  expect(values.every((v) => v === '–')).toBe(true);
  expect(p.el.textContent).toContain('No games yet');
  expect(p.el.textContent).not.toMatch(/NaN|Infinity|undefined/);
});

it('one run, and runs without turns, never print NaN', async () => {
  const p = open(async () => ({ runs: [row('a', 0, 40_000, null, null)], best: null, inTop: 0, total: 0 }));
  await flush();
  expect(p.el.textContent).not.toMatch(/NaN|Infinity|undefined|null/);
  expect(tiles()[0]).toContain('0:40.0');
  expect(tiles()[1]).toContain('–');
});

it('Esc and ‹ Tree call onClose; Leaderboard calls onLeaderboard', async () => {
  const onClose = vi.fn();
  const onLeaderboard = vi.fn();
  const p = open(async () => fixture, { onClose, onLeaderboard });
  await flush();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(onClose).toHaveBeenCalledTimes(1);
  p.el.querySelector<HTMLButtonElement>('.back')!.click();
  expect(onClose).toHaveBeenCalledTimes(2);
  p.el.querySelector<HTMLButtonElement>('.tabs button:not(.on)')!.click();
  expect(onLeaderboard).toHaveBeenCalledTimes(1);
  expect(p.el.querySelector('.tabs button.on')!.textContent).toBe('Career');
});

it('closing removes the page, and data that arrives later paints nothing', async () => {
  let resolve!: (r: CareerResponse) => void;
  const onClose = vi.fn();
  const p = open(() => new Promise<CareerResponse>((r) => (resolve = r)), { onClose });
  p.close();
  expect(document.querySelector('.career')).toBeNull();
  resolve(fixture);
  await flush();
  expect(document.querySelector('.hero')).toBeNull();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(onClose).not.toHaveBeenCalled();
});

it('leaves a chart host in each chart card, and records, form and the log', async () => {
  const p = open(async () => fixture);
  await flush();
  expect([...p.el.querySelectorAll('.chart')].map((c) => (c as HTMLElement).dataset.chart)).toEqual(['trend', 'scatter', 'hist', 'hours']);
  expect([...p.el.querySelectorAll('.chart')].every((c) => c.childElementCount === 0)).toBe(true);
  expect(p.el.querySelector('#career-form .stat')).not.toBeNull();
  expect(p.el.querySelectorAll('.records .rec').length).toBeGreaterThan(0);
  expect(p.el.querySelectorAll('tbody tr')).toHaveLength(3);
});
