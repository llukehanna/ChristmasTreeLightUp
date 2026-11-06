import type { AccountStats } from '../api/types';
import { formatTime } from '../core/score';
import { averageSeconds, type Stats } from '../store/stats';
import { el } from './dom';
import { count, dailyLabel } from './format';

/** The three numbers under the badge: this device's, or (signed in) the account's (spec 2026-10-08 §6.2). */
export interface StatsView {
  solved: number;
  averageSeconds: number;
  streak: number;
}

export const deviceStatsView = (s: Stats): StatsView => ({ solved: s.solved, averageSeconds: averageSeconds(s), streak: s.streak });

export const accountStatsView = (a: AccountStats): StatsView => ({
  solved: a.solved,
  averageSeconds: a.averageMs === null ? 0 : Math.round(a.averageMs / 1000),
  streak: a.streak,
});

export interface ResultsData {
  seconds: number;
  newBest: boolean;
  /** This device's stats: the badge's best. */
  stats: Stats;
  /** Solved, Average and Day streak as shown. */
  view: StatsView;
  /** Home Alone mode's line in place of "Merry & bright" (spec 2026-10-14 §6). */
  line?: string | null;
  /** A Daily Tree's day (YYYY-MM-DD): its label is a small line above the time. Null or absent for a random tree. */
  daily?: string | null;
}

/** Home Alone mode's line under the time (spec 2026-10-14 §6), on the tag and the share image. */
export const HOME_ALONE_LINE = 'Keep the change, ya filthy animal.';
/** The tag's usual words under the time (index.html's #r-merry). */
export const MERRY = 'Merry & bright';

export class Results {
  private readonly root = el('results');

  constructor(h: { onNew(): void; onShare(): void; onKeep(): void }) {
    el('r-new').addEventListener('click', h.onNew);
    el('r-share').addEventListener('click', h.onShare);
    el('r-keep').addEventListener('click', h.onKeep);
  }

  show(d: ResultsData): void {
    el('r-time').textContent = `Lit in ${formatTime(d.seconds)}`;
    const badge = el('r-badge');
    badge.textContent = d.newBest || d.stats.bestSeconds === null ? 'New best' : `Best ${formatTime(d.stats.bestSeconds)}`;
    badge.classList.toggle('quiet', !d.newBest);
    this.setStats(d.view);
    this.setLine(d.line ?? null);
    this.setDaily(d.daily ?? null);
    this.root.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => this.root.classList.add('show')));
  }

  /** Repaints Solved, Average and Day streak: also while the tag is hidden, so it is right when it appears. */
  setStats(v: StatsView): void {
    el('r-solved').textContent = count(v.solved);
    el('r-avg').textContent = formatTime(Number(v.averageSeconds));
    el('r-streak').textContent = count(v.streak);
  }

  /** The words under the time: Home Alone's line, or the usual ones. Looked up lazily: older fixtures have no #r-merry. */
  setLine(line: string | null): void {
    const m = document.getElementById('r-merry');
    if (m) m.textContent = line ?? MERRY;
  }

  /** "Daily Tree · Nov 6" above the time, or nothing. Looked up lazily: older fixtures have no #r-daily. */
  private setDaily(day: string | null): void {
    const line = document.getElementById('r-daily');
    if (!line) return;
    line.textContent = day ? dailyLabel(day) : '';
    line.hidden = day === null;
  }

  hide(): void {
    this.root.classList.remove('show');
    this.root.hidden = true;
  }
}
