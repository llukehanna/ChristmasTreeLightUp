import type { AccountStats } from '../api/types';
import { formatTime } from '../core/score';
import type { TagStyle } from '../store/look';
import { averageSeconds, type Stats } from '../store/stats';
import { el } from './dom';
import { count, dailyLabel } from './format';
import type { NextStep } from './next-step';
import type { UnlockLine } from './unlock-ribbon';

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
  /** The server's count of the run's turns and how many were over par: a quiet line under the time. Null or absent for none. */
  turns?: TurnsLine | null;
}

/** A run's turns and its extra ones (turns over the tree's par, never below zero), as the tag says them. */
export interface TurnsLine {
  turns: number;
  extra: number;
}

/** Home Alone mode's line under the time (spec 2026-10-14 §6), on the tag and the share image. */
export const HOME_ALONE_LINE = 'Keep the change, ya filthy animal.';
/** The tag's usual words under the time (index.html's #r-merry). */
export const MERRY = 'Merry & bright';

/** Within this of the ghost's time (ms) the race is a tie. */
const LEVEL_MS = 50;

/**
 * The tag's line for a race against your ghost (C4 decision 10): `deltaMs` is your clock at the win minus the ghost's
 * time, so a negative one is a win.
 */
export function ghostLine(deltaMs: number): string {
  if (Math.abs(deltaMs) < LEVEL_MS) return 'Level with your ghost';
  const s = (Math.abs(deltaMs) / 1000).toFixed(1);
  return deltaMs < 0 ? `${s} s faster than your ghost` : `${s} s behind your ghost`;
}

/** The row's icon: a calendar for the Daily, a door for Advent catch-up (fixed artwork, no input in it). */
const NEXT_ICON: Readonly<Record<NextStep['kind'], string>> = {
  daily: '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><rect x="3" y="4.5" width="14" height="12.5" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3 8.5h14M7 2.8v3.4M13 2.8v3.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="10" cy="12.6" r="1.7" fill="currentColor"/></svg>',
  'catch-up': '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M4 17V7.5L10 3l6 4.5V17z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 17v-5h4v5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="11.2" cy="14.4" r=".8" fill="currentColor"/></svg>',
};

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
    this.setTurns(d.turns ?? null);
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

  /** How the race against your ghost went, under the time; null takes it away. Looked up lazily: older fixtures have no #r-ghost. */
  setGhost(line: string | null): void {
    const g = document.getElementById('r-ghost');
    if (!g) return;
    g.textContent = line ?? '';
    g.hidden = line === null;
  }

  /** "123 turns · 40 extra" under the time, or nothing. Looked up lazily: older fixtures have no #r-turns. */
  setTurns(t: TurnsLine | null): void {
    const line = document.getElementById('r-turns');
    if (!line) return;
    line.textContent = t ? `${t.turns} turns \u00b7 ${t.extra} extra` : '';
    line.hidden = !t;
  }

  /** "Daily Tree · Nov 6" above the time, or nothing. Looked up lazily: older fixtures have no #r-daily. */
  private setDaily(day: string | null): void {
    const line = document.getElementById('r-daily');
    if (!line) return;
    line.textContent = day ? dailyLabel(day) : '';
    line.hidden = !day;
  }

  /**
   * "Unlocked: Bubble lights · Try it", and " · +N more", under the rank strip (renderRibbon puts its line straight after
   * the words under the time, so this one stays below it); null takes it away. Focus on one of its buttons stays there.
   */
  setUnlocks(line: UnlockLine | null, h: { onTry(): void; onMore(): void }): void {
    const old = this.root.querySelector('.unlock');
    const active = document.activeElement;
    const focused = active instanceof HTMLElement && old?.contains(active) ? active.className : null;
    old?.remove();
    if (!line) return;
    const u = document.createElement('div');
    u.className = 'unlock';
    const button = (cls: string, text: string, on: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.textContent = text;
      b.addEventListener('click', on);
      return b;
    };
    const label = document.createElement('b');
    label.textContent = line.best.label;
    u.append('Unlocked: ', label, ' · ', button('unlock-try', 'Try it', h.onTry));
    if (line.more > 0) u.append(' · ', button('unlock-more', `+${line.more} more`, h.onMore));
    const anchor = this.root.querySelector('.rib-line') ?? document.getElementById('r-merry');
    if (anchor) anchor.after(u);
    else this.root.querySelector('.stats')?.before(u);
    if (focused) u.querySelector<HTMLElement>(`.${focused.split(' ')[0]}`)?.focus({ preventScroll: true });
  }

  /**
   * The tag's one next step (spec 2026-11-17), between its buttons and Keep watching; null takes it away. A tap hands back
   * the step and the row (where focus returns from a sheet it opens).
   */
  setNext(step: NextStep | null, onGo: (step: NextStep, from: HTMLElement) => void): void {
    this.root.querySelector('.next-row')?.remove();
    if (!step) return;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'next-row';
    b.innerHTML = `<span class="next-i">${NEXT_ICON[step.kind]}</span><span class="next-w"></span><span class="next-m"></span><span class="next-c">\u203a</span>`;
    b.querySelector('.next-w')!.textContent = step.word;
    b.querySelector('.next-m')!.textContent = step.meta;
    b.addEventListener('click', () => onGo(step, b));
    const keep = document.getElementById('r-keep');
    if (keep?.parentElement === this.root) keep.before(b);
    else this.root.append(b);
  }

  /** The look's tag style: its paper and ribbon (tag-styles.css). The words keep their own inks on every one. */
  setTag(tag: TagStyle): void {
    this.root.dataset.tag = tag;
  }

  /** The tag is up (shown, not put away). */
  get isShown(): boolean {
    return !this.root.hidden;
  }

  hide(): void {
    this.root.classList.remove('show');
    this.root.hidden = true;
  }
}
