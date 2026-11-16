import { BOARD_TOP, type CareerResponse } from '../api/types';
import { careerStats, parseCareer, type CareerRun, type CareerStats } from '../core/career';
import { mountCharts } from './charts';
import { createLog } from './log';
import { fmtCount, fmtDay, fmtLongDay, fmtSecs, fmtTime, plural } from './format';

const DASH = '–';
const SIZES = [5, 12, 50, 100] as const;

/** The title, the back button and the Leaderboard | Career switch; `body` is where the page's content goes. */
export function shell(user: { name: string | null }): { el: HTMLElement; title: HTMLElement; eyebrow: HTMLElement; body: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'career';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'career-title');
  el.innerHTML = `<div class="page">
    <div class="top">
      <button type="button" class="back" title="Back to the tree">‹ Tree <kbd>Esc</kbd></button>
      <div class="heading"><div class="eyebrow"></div><h1 id="career-title" tabindex="-1">Your career</h1></div>
      <div class="tabs"><button type="button" data-tab="board">Leaderboard</button><button type="button" class="on" data-tab="career" aria-current="page">Career</button></div>
    </div>
    <div class="body"></div></div>`;
  const eyebrow = el.querySelector('.eyebrow') as HTMLElement;
  eyebrow.textContent = user.name ?? '';
  return { el, title: el.querySelector('h1')!, eyebrow, body: el.querySelector('.body')! };
}

/** "Luke · playing since November 3". */
export function eyebrowText(name: string | null, first: CareerRun | undefined): string {
  return [name, first ? `playing since ${fmtLongDay(first.at)}` : null].filter((s): s is string => !!s).join(' · ');
}

const stat = (v: string, k: string, d: string, gold = false): string =>
  `<div class="stat"><div class="v${gold ? ' gold' : ''}">${v}</div><div class="k">${k}</div><div class="d">${d}</div></div>`;

/** "▲ 1.3 s this week" (green when faster), "▼ …" (red), or nothing without a week-old figure. */
function delta(now: number, weekAgo: number | null, text: (diff: number) => string, still = 0): string {
  if (weekAgo === null) return '';
  const d = now - weekAgo;
  // `still`: a change under it shows as none (a count rounded to whole turns would read "▲ 0").
  if (still > 0 ? Math.abs(d) < still : d === 0) return '<span class="delta">no change</span> this week<br>';
  return `<span class="delta ${d < 0 ? 'up' : 'dn'}">${d < 0 ? '▲' : '▼'} ${text(Math.abs(d))}</span> this week<br>`;
}

/** What kind of run a faster-than-ranked career best is: paused, a Daily (or past day's) tree, or otherwise unranked. */
function runKind(r: CareerRun): string {
  if (r.reason === 'paused') return 'paused run';
  if (r.daily !== null || r.past || r.reason === 'daily' || r.reason === 'past') return 'Daily run';
  return 'unranked run';
}

function bestTile(res: CareerResponse, best: CareerRun | null): string {
  if (!best) return stat(DASH, 'Best', '', true);
  const lines = [fmtDay(best.at)];
  const ranked = res.best;
  if (ranked) {
    if (ranked.ms !== best.ms) lines.push(`${runKind(best)} · ranked best ${fmtTime(ranked.ms)}`);
    const place = ranked.rank !== null ? `#${fmtCount(ranked.rank)} of ${plural(res.total, 'run')}` : null;
    const top = `${fmtCount(res.inTop)} in the top ${BOARD_TOP}`;
    lines.push(place ? `${place} · ${top}` : top);
  }
  return stat(fmtTime(best.ms), 'Best', lines.join('<br>'), true);
}

function heroHtml(res: CareerResponse, s: CareerStats): string {
  const avg = (n: 5 | 12) => {
    const b = s.bestAvg[n];
    return stat(b ? fmtTime(b.ms) : DASH, `Best avg of ${n}`, b ? fmtDay(b.at.at) : '', true);
  };
  return [
    bestTile(res, s.best),
    avg(5),
    avg(12),
    stat(s.mean !== null ? fmtTime(s.mean) : DASH, 'Average', s.median !== null ? `${fmtTime(s.median)} median` : ''),
    stat(s.solved ? fmtCount(s.solved) : DASH, 'Solved', s.solved ? `${plural(s.daysPlayed, 'day')} played` : ''),
    stat(s.solved ? fmtCount(s.streak) : DASH, 'Day streak', s.solved ? `longest ${fmtCount(s.longestStreak)}` : ''),
  ].join('');
}

function formHtml(s: CareerStats): string {
  const tiles = SIZES.map((n) => {
    const cur = s.current[n];
    const top = s.bestAvg[n];
    if (!cur) return stat(DASH, `Avg of ${n}`, '');
    return stat(fmtTime(cur.ms), `Avg of ${n}`, `${delta(cur.ms, cur.weekAgo, (d) => `${fmtSecs(d)} s`)}${top ? `best ${fmtTime(top.ms)}` : ''}`);
  });
  const x = s.extra;
  tiles.push(
    x
      ? stat(x.last50.toFixed(0), 'Extra turns', `${delta(x.last50, x.weekAgo, (d) => d.toFixed(0), 0.5)}average, last 50 runs`)
      : stat(DASH, 'Extra turns', ''),
  );
  return tiles.join('');
}

const none = '<div class="rec none">–</div>';

function recordsHtml(s: CareerStats): [string, string, string] {
  const head = (t: string) => `<div class="eyebrow">${t}</div>`;
  const pb = s.pbs.slice(-6).reverse().map((p) => `<div class="rec"><span class="t">${fmtTime(p.run.ms)}</span><span class="w">${fmtDay(p.run.at)} · run ${p.run.n}</span>${p.gain !== null ? `<span class="g">−${fmtSecs(p.gain)} s</span>` : ''}</div>`);
  const firsts = s.firsts.map((f) => `<div class="rec mile"><span class="t">sub-${f.underS}</span><span class="w">${fmtDay(f.run.at)} · run ${f.run.n}</span><span>${fmtTime(f.run.ms)}</span></div>`);
  const turns = s.fewestExtra.map((r) => `<div class="rec"><span class="t">${r.extra}</span><span class="w">${fmtDay(r.at)} · ${r.turns} turns, par ${r.minTurns}</span><span>${fmtTime(r.ms)}</span></div>`);
  return [
    head('Personal bests') + (pb.join('') || none),
    head('Firsts') + (firsts.join('') || none),
    head('Fewest extra turns') + (turns.join('') || none),
  ];
}

/**
 * The page's content once the data is in: the tiles, current form, the chart cards (empty hosts the charts draw into),
 * records and the log. Every figure comes from careerStats. `dispose` stops the charts' redraw on resize.
 */
export function renderBody(host: HTMLElement, res: CareerResponse, now: Date, onWatch: (id: string) => void): { runs: CareerRun[]; stats: CareerStats; dispose: () => void } {
  const runs = parseCareer(res.runs);
  const stats = careerStats(runs, now);
  host.innerHTML = `
    <section class="card hero" id="career-hero">${heroHtml(res, stats)}</section>
    <section class="card">
      <div class="card-h"><h2>Current form</h2><span class="sub">Averages drop the fastest and slowest runs, the way speedcubers count them.</span></div>
      <div class="form" id="career-form">${formHtml(stats)}</div>
    </section>
    <section class="card" data-card="trend">
      <div class="card-h"><h2>Getting faster</h2><span class="sub" data-slot="sub"></span><span class="spacer"></span><span data-slot="controls" style="display:contents"></span></div>
      <div class="legend" data-slot="legend"></div>
      <div class="chart" data-chart="trend"></div>
    </section>
    <div class="grid g3">
      <section class="card" data-card="scatter">
        <div class="card-h stack"><h2>Where your time goes</h2><span class="sub">time against extra turns, every run with turns</span></div>
        <div class="chart" data-chart="scatter"></div>
        <div class="insight" data-slot="insight"></div>
      </section>
      <section class="card" data-card="hist">
        <div class="card-h stack"><h2>Your times</h2><span class="sub">every finished run, 2-second bins</span></div>
        <div class="chart" data-chart="hist"></div>
        <div class="chips" data-slot="chips"></div>
        <div class="caption">The bright bar is where your average of 50 sits now.</div>
      </section>
      <section class="card" data-card="hours">
        <div class="card-h stack"><h2>When you're fastest</h2><span class="sub">by hour, last 600 runs</span></div>
        <div class="chart" data-chart="hours"></div>
        <div class="insight" data-slot="insight"></div>
      </section>
    </div>
    <section class="card">
      <div class="card-h"><h2>Records</h2></div>
      <div class="records">${recordsHtml(stats).map((h) => `<div>${h}</div>`).join('')}</div>
    </section>`;
  const pbs = new Set(stats.pbs.map((p) => p.run.id));
  host.append(createLog({ runs, pbs, onWatch }).el);
  return { runs, stats, dispose: mountCharts(host, runs, stats, now) };
}
