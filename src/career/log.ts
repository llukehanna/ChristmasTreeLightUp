import { rollingAverage, type CareerRun } from '../core/career';
import { esc, fmtClock, fmtCount, fmtDay, fmtTime, plural, unrankedLabel } from './format';

type Filter = 'all' | 'ranked' | 'daily' | 'unranked' | 'import';
type SortKey = 'at' | 'ms' | 'turns' | 'min' | 'extra' | 'ao5';

interface Row {
  run: CareerRun;
  ao5: number | null;
}

export interface LogOptions {
  runs: readonly CareerRun[];
  /** Ids of the runs that were a new personal best when they were played. */
  pbs: ReadonlySet<string>;
  onWatch(id: string): void;
}

const PAGE = 50;
const FILTERS: [Filter, string][] = [['all', 'All'], ['ranked', 'Ranked'], ['daily', 'Daily'], ['unranked', 'Unranked'], ['import', 'Imported']];
const COLUMNS: { key: SortKey | 'n' | null; label: string; left?: boolean; cls?: string; head?: string }[] = [
  { key: 'n', label: '#', left: true },
  { key: 'at', label: 'When', left: true },
  { key: 'ms', label: 'Time' },
  { key: 'turns', label: 'Turns' },
  { key: 'min', label: 'Minimum', cls: 'c-min' },
  { key: 'extra', label: 'Extra turns', left: true },
  { key: 'ao5', label: 'Avg of 5', cls: 'c-ao5' },
  { key: null, label: '&nbsp;', left: true },
  { key: null, label: '' },
];

/** Unranked, as the log tags it: a Daily first attempt is on its day's board, so its reason ('daily') is no tag. */
const unranked = (r: CareerRun): boolean => r.reason !== null && !(r.dailyFirst && r.reason === 'daily');

const pass: Record<Filter, (r: CareerRun) => boolean> = {
  all: () => true,
  ranked: (r) => r.reason === null && !r.imported,
  daily: (r) => r.daily !== null,
  unranked,
  import: (r) => r.imported,
};

const sortValue = (row: Row, key: SortKey): number | null => {
  switch (key) {
    case 'at': return row.run.at;
    case 'ms': return row.run.ms;
    case 'turns': return row.run.turns;
    case 'min': return row.run.minTurns;
    case 'extra': return row.run.extra;
    case 'ao5': return row.ao5;
  }
};

/** Every game of the account: filters, a sortable table that draws 50 rows at a time, tags and Watch. */
export function createLog(opts: LogOptions): { el: HTMLElement } {
  const rolling = rollingAverage(opts.runs, 5);
  const rows: Row[] = opts.runs.map((run, i) => ({ run, ao5: rolling[i] }));
  const maxExtra = opts.runs.reduce((m, r) => Math.max(m, r.extra ?? 0), 0);
  let filter: Filter = 'all';
  let sortKey: SortKey = 'at';
  let dir = -1;
  let shown = PAGE;

  const el = document.createElement('section');
  el.className = 'card';
  el.id = 'career-log';
  el.innerHTML = `<div class="card-h"><h2>Every game</h2><span class="sub"></span><span class="spacer"></span>
      <div class="seg" id="career-filter">${FILTERS.map(([v, l]) => `<button type="button" data-v="${v}"${v === 'all' ? ' class="on"' : ''}>${l}</button>`).join('')}</div></div>
    <div class="log-gap"></div>
    <div class="log-wrap"><table><thead><tr>${COLUMNS.map((c) => `<th${c.key ? ` data-k="${c.key}"` : ''} class="${[c.left ? 'l' : '', c.cls ?? ''].join(' ').trim()}">${c.label}</th>`).join('')}</tr></thead>
      <tbody></tbody></table></div>
    <button type="button" class="more">Show 50 more</button>`;
  const sub = el.querySelector('.sub') as HTMLElement;
  const body = el.querySelector('tbody') as HTMLElement;
  const more = el.querySelector('.more') as HTMLButtonElement;

  const cell = (v: number | null): string => (v === null ? '<span class="dim">–</span>' : String(v));

  function rowHtml({ run: r, ao5 }: Row): string {
    const tags =
      (opts.pbs.has(r.id) ? '<span class="tag pb">PB</span>' : '') +
      (r.daily !== null ? '<span class="tag daily">Daily</span>' : '') +
      (unranked(r) ? `<span class="tag un">${esc(unrankedLabel(r.reason!))}</span>` : '') +
      (r.imported ? '<span class="tag un">Imported</span>' : '');
    const bar = r.extra !== null && maxExtra > 0 ? `<span class="extra-bar" style="width:${Math.round((r.extra / maxExtra) * 70)}px"></span>` : '';
    return `<tr>
      <td class="l dim">${r.n}</td>
      <td class="l"><span class="when">${fmtDay(r.at)}</span> <span class="day">${fmtClock(r.at)}</span></td>
      <td class="time">${fmtTime(r.ms)}</td>
      <td>${cell(r.turns)}</td>
      <td class="dim c-min">${r.minTurns ?? '–'}</td>
      <td class="l">${r.extra !== null ? `${bar}${r.extra}` : '<span class="dim">–</span>'}</td>
      <td class="dim c-ao5">${ao5 !== null ? fmtTime(ao5) : '–'}</td>
      <td class="l tags">${tags}</td>
      <td><button type="button" class="watch" data-id="${esc(r.id)}" ${r.replay ? 'title="Watch"' : 'disabled title="No replay"'} aria-label="Watch game ${r.n}">▶</button></td></tr>`;
  }

  function draw(): void {
    const list = rows.filter((row) => pass[filter](row.run));
    list.sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      // A run without the value goes last whichever way the column runs.
      if (va === null || vb === null) return va === vb ? 0 : va === null ? 1 : -1;
      return (va - vb) * dir || (a.run.n - b.run.n) * dir;
    });
    sub.textContent = plural(list.length, 'game');
    body.innerHTML = list.length
      ? list.slice(0, shown).map(rowHtml).join('')
      : `<tr><td class="empty" colspan="${COLUMNS.length}">${opts.runs.length ? 'No games match' : 'No games yet'}</td></tr>`;
    more.hidden = shown >= list.length;
    more.textContent = `Show ${fmtCount(Math.max(0, Math.min(PAGE, list.length - shown)))} more`;
    for (const th of el.querySelectorAll<HTMLElement>('thead th[data-k]')) {
      const on = th.dataset.k === sortKey;
      th.classList.toggle('on', on);
      th.querySelector('.arr')?.remove();
      if (on) th.insertAdjacentHTML('beforeend', `<span class="arr">${dir > 0 ? '▲' : '▼'}</span>`);
    }
  }

  el.querySelector('thead')!.addEventListener('click', (e) => {
    const th = (e.target as Element).closest<HTMLElement>('th[data-k]');
    if (!th) return;
    // The '#' header sorts like When: both are the run's place in time.
    const key = th.dataset.k === 'n' ? 'at' : (th.dataset.k as SortKey);
    if (key === sortKey) dir = -dir;
    else {
      sortKey = key;
      dir = key === 'at' ? -1 : 1;
    }
    shown = PAGE;
    draw();
  });
  el.querySelector('#career-filter')!.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button[data-v]');
    if (!b) return;
    filter = b.dataset.v as Filter;
    shown = PAGE;
    for (const x of b.parentElement!.children) x.classList.toggle('on', x === b);
    draw();
  });
  more.addEventListener('click', () => {
    shown += PAGE;
    draw();
  });
  body.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('button.watch');
    if (b && !b.disabled) opts.onWatch(b.dataset.id!);
  });

  draw();
  return { el };
}
