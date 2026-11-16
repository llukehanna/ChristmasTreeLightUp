// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { careerStats, type CareerRun } from '../../../src/core/career';
import { histogramChart, hoursChart, mountCharts, scatterChart, trendChart } from '../../../src/career/charts';

const NOW = new Date(2026, 10, 15, 12, 0);
const DAY = 86_400_000;
const mk = (n: number, daysAgo: number, ms: number, extra: number | null = null, over: Partial<CareerRun> = {}): CareerRun => ({
  n, id: `r${n}`, at: NOW.getTime() - daysAgo * DAY, ms, turns: extra === null ? null : 50 + extra, minTurns: extra === null ? null : 50,
  extra, imported: false, replay: true, past: false, reason: null, daily: null, counts: true, ...over,
});
const many = (count: number, f: (i: number) => Partial<CareerRun> & { ms: number }): CareerRun[] =>
  Array.from({ length: count }, (_, i) => { const { ms, ...o } = f(i); return mk(i + 1, count - i, ms, (i * 7) % 40, o); });

const hosts: HTMLElement[] = [];
const host = (): HTMLElement => {
  const h = document.createElement('div');
  document.body.append(h);
  hosts.push(h);
  return h;
};
afterEach(() => { document.body.innerHTML = ''; hosts.length = 0; });
const dots = (h: HTMLElement) => [...h.querySelectorAll('circle.dot')];
const noNaN = (h: HTMLElement) => expect(h.innerHTML).not.toMatch(/NaN|Infinity|undefined/);

it('the trend spaces runs by number, not by time', () => {
  const runs = [mk(1, 10, 40_000), mk(2, 9, 39_000), mk(3, 8, 38_000), mk(4, 1, 37_000)];
  const h = host();
  trendChart(h, runs, { measure: 'time', range: 'all', now: NOW });
  const xs = dots(h).map((c) => Number(c.getAttribute('cx')));
  expect(xs).toHaveLength(4);
  const steps = xs.slice(1).map((x, i) => +(x - xs[i]).toFixed(3));
  expect(new Set(steps).size).toBe(1);
  expect(h.querySelector('path.avg-line')).toBeNull();
});

it('one run draws one dot and no NaN', () => {
  const h = host();
  trendChart(h, [mk(1, 1, 40_000, 4)], { measure: 'time', range: 'all', now: NOW });
  expect(dots(h)).toHaveLength(1);
  noNaN(h);
  trendChart(h, [mk(1, 1, 40_000, 4)], { measure: 'extra', range: 'all', now: NOW });
  noNaN(h);
});

it('the trend draws the gold path from the 50th counted run on', () => {
  const runs = many(60, (i) => ({ ms: 40_000 - i * 100 }));
  const h = host();
  trendChart(h, runs, { measure: 'time', range: 'all', now: NOW });
  const d = h.querySelector('path.avg-line')!.getAttribute('d')!;
  expect(d.match(/[ML]/g)).toHaveLength(11);
  expect(h.querySelector('path.pb-line')).not.toBeNull();
  noNaN(h);
});

it("the trend's range and measure", () => {
  const runs = [mk(1, 20, 40_000, 5), mk(2, 6, 39_000, null), mk(3, 5, 38_000, 3), mk(4, 1, 37_000, null)];
  const h = host();
  trendChart(h, runs, { measure: 'time', range: 7, now: NOW });
  expect(dots(h)).toHaveLength(3);
  trendChart(h, runs, { measure: 'extra', range: 'all', now: NOW });
  expect(dots(h)).toHaveLength(2);
  expect(h.querySelector('path.pb-line')).toBeNull();
});

it('the PB line keeps only the all-time PBs inside the range', () => {
  const old = [mk(1, 30, 40_000), mk(2, 20, 38_000), mk(3, 6, 39_000), mk(4, 2, 39_500)];
  const h = host();
  trendChart(h, old, { measure: 'time', range: 7, now: NOW });
  expect(h.querySelector('path.pb-line')).toBeNull();
  const one = [...old, mk(5, 1, 37_000)];
  trendChart(h, one, { measure: 'time', range: 7, now: NOW });
  const d = h.querySelector('path.pb-line')!.getAttribute('d')!;
  expect(d.match(/M/g)).toHaveLength(1);
  expect(d.match(/L/g)).toHaveLength(1);
});

it('dots above the 98.5th percentile are not drawn', () => {
  const runs = many(200, (i) => ({ ms: i === 100 ? 600_000 : 40_000 + i * 10 }));
  const h = host();
  trendChart(h, runs, { measure: 'time', range: 'all', now: NOW });
  // 200 runs: the top 1.5% (the 600 s run and the next slowest) are off the chart.
  expect(dots(h)).toHaveLength(198);
});

it('the histogram highlights the bin holding the current average', () => {
  const bins = [{ fromS: 30, count: 3 }, { fromS: 32, count: 0 }, { fromS: 34, count: 5 }, { fromS: 36, count: 2 }];
  const h = host();
  histogramChart(h, bins, 34_800);
  const fills = [...h.querySelectorAll('path.bar')].map((p) => p.getAttribute('fill'));
  expect(fills).toEqual(['rgba(232,191,106,0.55)', '#f3d492', 'rgba(232,191,106,0.55)']);
  expect(h.querySelectorAll('path.now')).toHaveLength(1);
});

it('hours draws dots, not bars', () => {
  const byHour = Array.from({ length: 24 }, (_, i) => (i >= 9 && i < 13 ? 34_000 + i * 300 : null));
  const h = host();
  hoursChart(h, byHour);
  expect(h.querySelectorAll('svg circle')).toHaveLength(4);
  expect(h.querySelectorAll('svg rect, svg path')).toHaveLength(0);
  noNaN(h);
});

it('empty inputs draw an empty state', () => {
  const none: (h: HTMLElement) => void = (h) => {
    expect(h.textContent).toContain('Not enough runs yet');
    expect(h.querySelector('svg')).not.toBeNull();
    noNaN(h);
  };
  const a = host(); trendChart(a, [], { measure: 'time', range: 'all', now: NOW }); none(a);
  const b = host(); scatterChart(b, [], null); none(b);
  const c = host(); scatterChart(c, [mk(1, 1, 40_000, 3)], null); none(c);
  const d = host(); histogramChart(d, [], null); none(d);
  const e = host(); hoursChart(e, new Array(24).fill(null)); none(e);
});

it('mountCharts fills the switches, redraws on resize and stops after dispose', async () => {
  const runs = many(120, (i) => ({ ms: 45_000 - i * 50 }));
  const root = document.createElement('div');
  root.innerHTML = `<section data-card="trend"><span data-slot="sub"></span><span data-slot="controls"></span><div data-slot="legend"></div><div data-chart="trend"></div></section>
    <section data-card="scatter"><div data-chart="scatter"></div><div data-slot="insight"></div></section>
    <section data-card="hist"><div data-chart="hist"></div><div data-slot="chips"></div></section>
    <section data-card="hours"><div data-chart="hours"></div><div data-slot="insight"></div></section>`;
  document.body.append(root);
  const stats = careerStats(runs, NOW);
  const dispose = mountCharts(root, runs, stats, NOW);
  const trend = root.querySelector<HTMLElement>('[data-chart="trend"]')!;
  expect(root.querySelectorAll('.seg button')).toHaveLength(5);
  expect(root.querySelector('[data-slot="sub"]')!.textContent).toContain('average of 50');
  expect(root.querySelector('[data-slot="legend"]')!.textContent).toContain('Personal best');
  expect(root.querySelector('[data-slot="insight"]')!.textContent).toContain('extra turn');
  expect(root.querySelector('[data-slot="chips"]')!.textContent).toContain('sub-30');
  const before = dots(trend).length;
  (root.querySelector('button[data-v="7"]') as HTMLElement).click();
  expect(dots(trend).length).toBeLessThan(before);
  (root.querySelector('button[data-v="extra"]') as HTMLElement).click();
  expect(root.querySelector('[data-slot="legend"]')!.textContent).not.toContain('Personal best');
  trend.innerHTML = '';
  window.dispatchEvent(new Event('resize'));
  await new Promise((r) => setTimeout(r, 150));
  expect(trend.querySelector('svg')).not.toBeNull();
  dispose();
  trend.innerHTML = '';
  window.dispatchEvent(new Event('resize'));
  await new Promise((r) => setTimeout(r, 150));
  expect(trend.querySelector('svg')).toBeNull();
});
