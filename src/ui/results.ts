import type { AccountStats } from '../api/types';
import { formatTime } from '../core/score';
import { averageSeconds, type Stats } from '../store/stats';
import { el } from './dom';
import { count } from './format';

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

/**
 * The numbers for the tag (spec 2026-10-08 §6.2). Signed in, the account's, except while this device has solved more
 * games than the account holds: then all three come from the device, so a player's numbers don't drop on signing in.
 * No account stats (signed out, loading, offline): the device's.
 */
export const statsViewFor = (device: Stats, account: AccountStats | null): StatsView =>
  account && device.solved <= account.solved ? accountStatsView(account) : deviceStatsView(device);

export interface ResultsData {
  seconds: number;
  score: number;
  newBest: boolean;
  /** This device's stats: the badge's best. */
  stats: Stats;
  /** Solved, Average and Day streak as shown. */
  view: StatsView;
}

export class Results {
  private readonly root = el('results');

  constructor(h: { onNew(): void; onShare(): void; onKeep(): void }) {
    el('r-new').addEventListener('click', h.onNew);
    el('r-share').addEventListener('click', h.onShare);
    el('r-keep').addEventListener('click', h.onKeep);
  }

  show(d: ResultsData): void {
    el('r-time').textContent = `Lit in ${formatTime(d.seconds)}`;
    el('r-score').textContent = `Score ${d.score.toLocaleString('en-US')}`;
    const badge = el('r-badge');
    badge.textContent = d.newBest || d.stats.bestSeconds === null ? 'New best' : `Best ${formatTime(d.stats.bestSeconds)}`;
    badge.classList.toggle('quiet', !d.newBest);
    this.setStats(d.view);
    this.root.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => this.root.classList.add('show')));
  }

  /** Repaints Solved, Average and Day streak: also while the tag is hidden, so it is right when it appears. */
  setStats(v: StatsView): void {
    el('r-solved').textContent = count(v.solved);
    el('r-avg').textContent = formatTime(Number(v.averageSeconds));
    el('r-streak').textContent = count(v.streak);
  }

  hide(): void {
    this.root.classList.remove('show');
    this.root.hidden = true;
  }
}
