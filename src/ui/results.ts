import { formatTime } from '../core/score';
import { averageSeconds, type Stats } from '../store/stats';
import { el } from './dom';

export interface ResultsData {
  seconds: number;
  score: number;
  newBest: boolean;
  stats: Stats;
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
    el('r-solved').textContent = String(d.stats.solved);
    el('r-avg').textContent = formatTime(averageSeconds(d.stats));
    el('r-streak').textContent = String(d.stats.streak);
    this.root.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => this.root.classList.add('show')));
  }

  hide(): void {
    this.root.classList.remove('show');
    this.root.hidden = true;
  }
}
