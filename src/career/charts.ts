/**
 * The career page's four charts, hand-built SVG ported from the approved mockup: the trend, the time-against-extra-turns
 * scatter, the histogram and the by-hour dots. Each draws into an empty host and, where its card has a data-slot, fills
 * the card's sentence or chips; mountCharts wires the switches and keeps them drawn at the host's width.
 */
import { rollingAverage, type CareerRun, type CareerStats } from '../core/career';
import { fmtClock, fmtDay, fmtSecs, fmtTime } from './format';

const NS = 'http://www.w3.org/2000/svg';
const DAY_MS = 86_400_000;
const GOLD = '#f3d492';
const GOLD_DIM = 'rgba(232,191,106,0.55)';
const GROUND = '#3d0c11';
const EMPTY = 'Not enough runs yet';

export type Measure = 'time' | 'extra';
export type Range = 'all' | 30 | 7;

interface Margin { l: number; r: number; t: number; b: number }
interface Frame { svg: SVGSVGElement; g(cls?: string): SVGGElement; iw: number; ih: number; W: number; H: number }

/** The width a chart draws at: its host's, less the host's padding; a host with no layout yet gets a plain default. */
const widthOf = (host: HTMLElement): number => Math.max(220, host.clientWidth - 28 || 600);

function el(parent: Element, tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  parent.appendChild(e);
  return e;
}

/** Clears the host and puts a sized SVG (and the host's tooltip) in it. */
function frame(host: HTMLElement, W: number, H: number, m: Margin, label: string): Frame {
  host.innerHTML = '';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('height', String(H));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  host.appendChild(svg);
  const tip = document.createElement('div');
  tip.className = 'tip';
  host.appendChild(tip);
  const g = (cls?: string): SVGGElement => {
    const e = document.createElementNS(NS, 'g');
    if (cls) e.setAttribute('class', cls);
    svg.appendChild(e);
    return e;
  };
  return { svg, g, iw: W - m.l - m.r, ih: H - m.t - m.b, W, H };
}

/** The quiet state of a chart with nothing to draw. */
function empty(host: HTMLElement): void {
  const f = frame(host, widthOf(host), 140, { l: 0, r: 0, t: 0, b: 0 }, EMPTY);
  el(f.g('axis'), 'text', { x: f.W / 2, y: 74, 'text-anchor': 'middle' }).textContent = EMPTY;
}

/** The slot of the card a host sits in, when it has one. */
const slot = (host: HTMLElement, name: string): HTMLElement | null => host.closest('[data-card]')?.querySelector<HTMLElement>(`[data-slot="${name}"]`) ?? null;

/** Shows the host's tooltip above (x, y), given in the SVG's rendered pixels, kept inside the host. */
function showTip(host: HTMLElement, f: Frame, x: number, y: number, html: string): void {
  const tip = host.querySelector<HTMLElement>('.tip');
  if (!tip) return;
  tip.innerHTML = html;
  tip.style.display = 'block';
  const at = f.svg.getBoundingClientRect();
  const from = host.getBoundingClientRect();
  const ox = at.left - from.left;
  const oy = at.top - from.top;
  tip.style.left = `${Math.max(0, Math.min(ox + x + 14, host.clientWidth - tip.offsetWidth - 4))}px`;
  const top = oy + y - tip.offsetHeight - 10;
  tip.style.top = `${top < 0 ? oy + y + 14 : top}px`;
}

function hideTip(host: HTMLElement): void {
  const tip = host.querySelector<HTMLElement>('.tip');
  if (tip) tip.style.display = 'none';
}

/** Runs the handler for a mouse or a finger over the element. */
function onPoint(target: Element, fn: (e: PointerEvent) => void, leave: () => void): void {
  target.addEventListener('pointermove', fn as EventListener);
  target.addEventListener('pointerdown', fn as EventListener);
  target.addEventListener('pointerleave', leave);
}

/** Round ticks from lo to hi, about `count` of them. */
export function niceTicks(lo: number, hi: number, count: number): number[] {
  const step0 = (hi - lo) / count;
  if (!(step0 > 0)) return [lo];
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 5, 10].map((k) => k * mag).find((s) => s >= step0)!;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

/** A bar with its top corners rounded. */
export const roundTop = (x: number, y: number, w: number, h: number, r: number): string =>
  `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;

function gridY(ax: Element, f: Frame, m: Margin, ticks: number[], Y: (v: number) => number, label: (v: number) => string): void {
  for (const v of ticks) {
    el(ax, 'line', { x1: m.l, x2: f.W - m.r, y1: Y(v), y2: Y(v), class: 'grid-line' });
    el(ax, 'text', { x: m.l - 8, y: Y(v) + 3.5, 'text-anchor': 'end' }).textContent = label(v);
  }
}

const count = (runs: readonly CareerRun[]): CareerRun[] => runs.filter((r) => r.counts);

// ---------- trend ----------

/**
 * Every counted run as a dot, spaced by run number (nights and breaks take no room), with the average of 50 in gold and,
 * for times, the personal bests as a dashed step. Dots above the 98.5th percentile are left off the top.
 */
export function trendChart(host: HTMLElement, runs: readonly CareerRun[], opts: { measure: Measure; range: Range; now: Date }): void {
  const { measure } = opts;
  const sub = slot(host, 'sub');
  if (sub) sub.textContent = '';
  const since = opts.range === 'all' ? -Infinity : opts.now.getTime() - opts.range * DAY_MS;
  const val = (r: CareerRun): number => (measure === 'time' ? r.ms / 1000 : r.extra!);
  const idx: number[] = [];
  runs.forEach((r, i) => {
    if (r.counts && r.at >= since && (measure === 'time' || r.extra !== null)) idx.push(i);
  });
  if (idx.length === 0) return empty(host);

  const avg = rollingAverage(runs, 50, measure === 'time' ? undefined : (r) => r.extra);
  const W = widthOf(host);
  const H = 300;
  const m: Margin = { l: 44, r: 12, t: 12, b: 26 };
  const vals = idx.map((i) => val(runs[i])).sort((a, b) => a - b);
  const lo = Math.max(0, vals[0] - 2);
  let hi = vals[Math.floor(vals.length * 0.985)];
  if (!(hi > lo)) hi = lo + 1;
  const lastJ = idx.length - 1;
  // One run sits at the left edge; the spacing needs a span of at least 1.
  const last = Math.max(1, lastJ);
  const pos = new Map(idx.map((i, j) => [i, j]));
  const f = frame(host, W, H, m, measure === 'time' ? 'Your times, run by run' : 'Your extra turns, run by run');
  const xj = (j: number): number => m.l + (j / last) * f.iw;
  const x = (i: number): number => xj(pos.get(i)!);
  const y = (v: number): number => m.t + (1 - (Math.min(v, hi) - lo) / (hi - lo)) * f.ih;

  const ax = f.g('axis');
  gridY(ax, f, m, niceTicks(lo, hi, 5), y, (v) => (measure === 'time' ? `${v}s` : String(v)));
  const dayTicks = Math.min(6, lastJ);
  for (let k = 0; k <= dayTicks; k++) {
    const j = dayTicks === 0 ? 0 : Math.round((lastJ * k) / dayTicks);
    el(ax, 'text', { x: xj(j), y: H - 6, 'text-anchor': k === 0 ? 'start' : k === dayTicks ? 'end' : 'middle' }).textContent = fmtDay(runs[idx[j]].at);
  }

  const dots = f.g();
  for (const i of idx) {
    if (val(runs[i]) <= hi) el(dots, 'circle', { cx: x(i), cy: y(val(runs[i])), r: idx.length > 600 ? 1.6 : 2.6, fill: 'rgba(243,212,146,0.28)', class: 'dot' });
  }

  if (measure === 'time') {
    let best = Infinity;
    let d = '';
    let lastY: number | null = null;
    // The all-time running minimum; only the steps inside the range are drawn.
    runs.forEach((r, i) => {
      if (!r.counts || r.ms >= best) return;
      best = r.ms;
      if (!pos.has(i)) return;
      const yy = y(r.ms / 1000);
      d += `${d ? 'L' : 'M'}${x(i)},${lastY ?? yy}${d ? ` L${x(i)},${yy}` : ''}`;
      lastY = yy;
    });
    if (d) el(f.svg, 'path', { d: `${d} L${W - m.r},${lastY}`, fill: 'none', stroke: 'rgba(244,230,207,0.5)', 'stroke-width': 1.2, 'stroke-dasharray': '3 3', class: 'pb-line' });
  }

  const withAvg = idx.filter((i) => avg[i] !== null);
  const path = withAvg.map((i, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(measure === 'time' ? avg[i]! / 1000 : avg[i]!).toFixed(1)}`).join('');
  if (path) el(f.svg, 'path', { d: path, fill: 'none', stroke: GOLD, 'stroke-width': 2, 'stroke-linejoin': 'round', style: 'filter: drop-shadow(0 0 4px rgba(255,180,90,.45))', class: 'avg-line' });

  const cross = el(f.svg, 'line', { y1: m.t, y2: H - m.b, stroke: 'rgba(244,230,207,0.35)', 'stroke-width': 1, visibility: 'hidden' });
  const hit = el(f.svg, 'rect', { x: m.l, y: m.t, width: f.iw, height: f.ih, fill: 'transparent' });
  onPoint(
    hit,
    (e) => {
      const box = f.svg.getBoundingClientRect();
      const px = box.width > 0 ? ((e.clientX - box.left) / box.width) * W : 0;
      const i = idx[Math.max(0, Math.min(lastJ, Math.round(((px - m.l) / f.iw) * last)))];
      const r = runs[i];
      cross.setAttribute('x1', String(x(i)));
      cross.setAttribute('x2', String(x(i)));
      cross.setAttribute('visibility', 'visible');
      const lv = avg[i];
      const run = measure === 'time' ? fmtTime(r.ms) : `${r.extra} extra`;
      const mean = lv === null ? '' : `<div>Avg of 50 <b>${measure === 'time' ? fmtTime(lv) : lv.toFixed(0)}</b></div>`;
      showTip(host, f, (x(i) / W) * box.width, (y(val(r)) / H) * box.height + 8, `<div class="m">Run ${r.n} · ${fmtDay(r.at)} · ${fmtClock(r.at)}</div><div>Run <b>${run}</b></div>${mean}`);
    },
    () => {
      cross.setAttribute('visibility', 'hidden');
      hideTip(host);
    },
  );

  const first = withAvg[0];
  const end = withAvg[withAvg.length - 1];
  if (sub && first !== undefined) {
    const a = avg[first]!;
    const b = avg[end]!;
    const time = measure === 'time';
    const change = time ? `${fmtSecs(a - b)} s ${a >= b ? 'faster' : 'slower'}` : `${Math.abs(a - b).toFixed(0)} ${a >= b ? 'fewer' : 'more'}`;
    sub.textContent = `average of 50 ${time ? fmtTime(a) : a.toFixed(0)} → ${time ? fmtTime(b) : b.toFixed(0)} (${change})`;
  }
}

// ---------- scatter ----------

/** Time against extra turns for every counted run with turns, the fitted line, and where the last 100 runs sit on it. */
export function scatterChart(host: HTMLElement, runs: readonly CareerRun[], fit: CareerStats['fit']): void {
  const insight = slot(host, 'insight');
  if (insight) insight.textContent = '';
  const pts = count(runs).filter((r) => r.extra !== null);
  if (!fit || pts.length < 2) return empty(host);

  const W = widthOf(host);
  const H = 250;
  const m: Margin = { l: 40, r: 10, t: 10, b: 30 };
  const xsS = pts.map((r) => r.extra!).sort((a, b) => a - b);
  const ysS = pts.map((r) => r.ms / 1000).sort((a, b) => a - b);
  const x0 = 0;
  const x1 = Math.max(1, xsS[Math.floor(xsS.length * 0.99)]);
  const y0 = Math.max(0, Math.floor(ysS[0] - 2));
  let y1 = ysS[Math.floor(ysS.length * 0.99)];
  if (!(y1 > y0)) y1 = y0 + 1;
  const f = frame(host, W, H, m, 'Time against extra turns');
  const X = (v: number): number => m.l + ((v - x0) / (x1 - x0)) * f.iw;
  const Y = (v: number): number => m.t + (1 - (Math.min(Math.max(v, y0), y1) - y0) / (y1 - y0)) * f.ih;

  const ax = f.g('axis');
  gridY(ax, f, m, niceTicks(y0, y1, 4), Y, (v) => `${v}s`);
  for (const v of niceTicks(x0, x1, 5)) el(ax, 'text', { x: X(v), y: H - 12, 'text-anchor': 'middle' }).textContent = String(v);
  el(ax, 'text', { x: W - m.r, y: H, 'text-anchor': 'end' }).textContent = 'extra turns →';
  const g = f.g();
  for (const r of pts) if (r.extra! <= x1) el(g, 'circle', { cx: X(r.extra!), cy: Y(r.ms / 1000), r: 1.7, fill: 'rgba(243,212,146,0.22)', class: 'dot' });
  el(f.svg, 'line', { x1: X(0), y1: Y(fit.intercept), x2: X(x1), y2: Y(fit.intercept + fit.slope * x1), stroke: GOLD, 'stroke-width': 2, class: 'fit' });
  // The marker's halo is the ground colour around it, so it reads over the dots.
  el(f.svg, 'circle', { cx: X(fit.recentExtra), cy: Y(fit.recentS), r: 6, fill: GOLD, stroke: GROUND, 'stroke-width': 2, class: 'you' });
  el(f.g('axis'), 'text', { x: X(fit.recentExtra) + 10, y: Y(fit.recentS) - 8, style: `fill: var(--gold); paint-order: stroke; stroke: ${GROUND}; stroke-width: 4px` }).textContent = 'you, last 100 runs';

  if (insight) {
    const cost = fit.slope > 0 ? `Each extra turn costs you about <b>${fit.slope.toFixed(2)} s</b>. ` : 'Extra turns have not slowed you down yet. ';
    insight.innerHTML = `${cost}Your last 100 runs average <b>${fit.recentExtra.toFixed(0)} extra turns</b>, about <b>${Math.max(0, fit.recentExtra * fit.slope).toFixed(0)} s</b> of your ${fit.recentS.toFixed(0)} s.`;
  }
}

// ---------- histogram ----------

/** Counted runs under 100 s in 2 s bars; the bar holding `currentMs` (the average of 50) is bright. */
export function histogramChart(host: HTMLElement, bins: CareerStats['histogram'], currentMs: number | null): void {
  const top = bins.reduce((a, b) => Math.max(a, b.count), 0);
  if (bins.length === 0 || top === 0) return empty(host);

  const W = widthOf(host);
  const H = 250;
  const m: Margin = { l: 40, r: 10, t: 10, b: 30 };
  const k0 = bins[0].fromS;
  const k1 = bins[bins.length - 1].fromS + 2;
  const f = frame(host, W, H, m, 'How many runs fall in each 2-second bin');
  const X = (v: number): number => m.l + ((v - k0) / (k1 - k0)) * f.iw;
  const Y = (v: number): number => m.t + (1 - v / top) * f.ih;
  const ax = f.g('axis');
  gridY(ax, f, m, niceTicks(0, top, 4), Y, String);
  for (let v = Math.ceil(k0 / 10) * 10; v <= k1; v += 10) el(ax, 'text', { x: X(v), y: H - 12, 'text-anchor': 'middle' }).textContent = `${v}s`;
  const bw = f.iw / ((k1 - k0) / 2);
  const current = currentMs === null ? null : Math.floor(currentMs / 2000) * 2;
  for (const { fromS: k, count: c } of bins) {
    if (c === 0) continue;
    const h = H - m.b - Y(c);
    const bar = el(f.svg, 'path', { d: roundTop(X(k) + 1, Y(c), bw - 2, h, Math.min(3, (bw - 2) / 2)), fill: k === current ? GOLD : GOLD_DIM, class: k === current ? 'bar now' : 'bar' });
    onPoint(
      bar,
      () => {
        const box = f.svg.getBoundingClientRect();
        showTip(host, f, ((X(k) + bw / 2) / W) * box.width, (Y(c) / H) * box.height + 8, `<b>${c}</b> runs <span class="m">in ${k}–${k + 2} s</span>`);
      },
      () => hideTip(host),
    );
  }
}

// ---------- hours ----------

const hourName = (h: number): string => new Date(2026, 0, 1, h).toLocaleTimeString(undefined, { hour: 'numeric' });

/** The trimmed mean time per hour of the day as dots (the scale doesn't start at zero, so a bar would lie). */
export function hoursChart(host: HTMLElement, byHour: CareerStats['byHour']): void {
  const insight = slot(host, 'insight');
  if (insight) insight.textContent = '';
  const present = byHour.filter((v): v is number => v !== null).map((v) => v / 1000);
  if (present.length === 0) return empty(host);

  const W = widthOf(host);
  const H = 250;
  const m: Margin = { l: 40, r: 10, t: 10, b: 30 };
  const lo = Math.floor(Math.min(...present) - 3);
  const hi = Math.ceil(Math.max(...present) + 1);
  const f = frame(host, W, H, m, 'Your average time by hour of the day');
  const bw = f.iw / 24;
  const X = (h: number): number => m.l + h * bw;
  const Y = (v: number): number => m.t + (1 - (v - lo) / (hi - lo)) * f.ih;
  const ax = f.g('axis');
  gridY(ax, f, m, niceTicks(lo, hi, 4), Y, (v) => `${v}s`);
  for (const h of [0, 6, 12, 18]) el(ax, 'text', { x: X(h) + bw / 2, y: H - 12, 'text-anchor': 'middle' }).textContent = h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`;

  let fastest = byHour.findIndex((v) => v !== null);
  let slowest = fastest;
  byHour.forEach((v, h) => {
    if (v === null) return;
    if (v < byHour[fastest]!) fastest = h;
    if (v > byHour[slowest]!) slowest = h;
  });
  byHour.forEach((ms, h) => {
    if (ms === null) return;
    const dot = el(f.svg, 'circle', { cx: X(h) + bw / 2, cy: Y(ms / 1000), r: h === fastest ? 5 : 4, fill: h === fastest ? GOLD : 'rgba(232,191,106,0.7)', stroke: GROUND, 'stroke-width': 2 });
    onPoint(
      dot,
      () => {
        const box = f.svg.getBoundingClientRect();
        showTip(host, f, ((X(h) + bw / 2) / W) * box.width, (Y(ms / 1000) / H) * box.height + 8, `<b>${fmtTime(ms)}</b> <span class="m">· ${hourName(h)}</span>`);
      },
      () => hideTip(host),
    );
  });

  if (insight) {
    const fast = `You're fastest around <b>${hourName(fastest)}</b> (${fmtTime(byHour[fastest]!)})`;
    insight.innerHTML = fastest === slowest ? `${fast}.` : `${fast} and slowest around <b>${hourName(slowest)}</b> (${fmtTime(byHour[slowest]!)}).`;
  }
}

// ---------- the page's charts ----------

const LEGEND_TIME =
  '<span><i class="dot" style="background:rgba(243,212,146,.35)"></i>Each run</span><span><i style="background:var(--gold)"></i>Average of 50</span><span><i style="background:rgba(244,230,207,.45);height:1px;border-top:1px dashed rgba(244,230,207,.6)"></i>Personal best</span>';
const LEGEND_EXTRA = '<span><i class="dot" style="background:rgba(243,212,146,.35)"></i>Each run</span><span><i style="background:var(--gold)"></i>Average of 50</span>';
const SUBS = [30, 35, 40, 45, 50];

function seg<T extends string>(label: string, options: [T, string][], initial: T, set: (v: T) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'seg';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', label);
  for (const [v, text] of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.v = v;
    b.textContent = text;
    b.classList.toggle('on', v === initial);
    b.setAttribute('aria-pressed', String(v === initial));
    wrap.append(b);
  }
  wrap.addEventListener('click', (e) => {
    const b = (e.target as Element).closest('button');
    if (!b || !wrap.contains(b)) return;
    for (const x of wrap.children) {
      x.classList.toggle('on', x === b);
      x.setAttribute('aria-pressed', String(x === b));
    }
    set(b.dataset.v as T);
  });
  return wrap;
}

/**
 * Draws the four charts into the page's hosts, fills the trend's switches, legend and the histogram's chips, and
 * redraws (debounced) when the window resizes. The returned function removes the resize listener.
 */
export function mountCharts(root: HTMLElement, runs: readonly CareerRun[], stats: CareerStats, now: Date): () => void {
  const host = (name: string): HTMLElement => root.querySelector<HTMLElement>(`[data-chart="${name}"]`)!;
  const trend = host('trend');
  const scatter = host('scatter');
  const hist = host('hist');
  const hours = host('hours');
  let measure: Measure = 'time';
  let range: Range = 'all';

  const drawTrend = (): void => {
    const legend = root.querySelector<HTMLElement>('[data-card="trend"] [data-slot="legend"]');
    if (legend) legend.innerHTML = measure === 'time' ? LEGEND_TIME : LEGEND_EXTRA;
    trendChart(trend, runs, { measure, range, now });
  };
  const drawAll = (): void => {
    drawTrend();
    scatterChart(scatter, runs, stats.fit);
    histogramChart(hist, stats.histogram, stats.current[50]?.ms ?? null);
    hoursChart(hours, stats.byHour);
  };

  const controls = root.querySelector<HTMLElement>('[data-card="trend"] [data-slot="controls"]');
  controls?.append(
    seg<Measure>('Measure', [['time', 'Time'], ['extra', 'Extra turns']], 'time', (v) => {
      measure = v;
      drawTrend();
    }),
    seg<string>('Range', [['all', 'All'], ['30', '30 days'], ['7', '7 days']], 'all', (v) => {
      range = v === 'all' ? 'all' : (Number(v) as 30 | 7);
      drawTrend();
    }),
  );

  const chips = root.querySelector<HTMLElement>('[data-card="hist"] [data-slot="chips"]');
  const counted = count(runs);
  if (chips) chips.innerHTML = SUBS.map((t) => `<span>sub-${t} <b>${counted.filter((r) => r.ms < t * 1000).length}</b></span>`).join('');

  drawAll();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onResize = (): void => {
    clearTimeout(timer);
    timer = setTimeout(drawAll, 100);
  };
  window.addEventListener('resize', onResize);
  return () => {
    clearTimeout(timer);
    window.removeEventListener('resize', onResize);
  };
}
