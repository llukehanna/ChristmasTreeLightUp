import type { RunOutcome } from '../api/outcome';
import type { SessionState } from '../api/session';
import { formatMs, plural, UNRANKED_TEXT } from './format';
import { G_LOGO } from './icons';

export type RibbonModel =
  | { kind: 'rank'; rank: number; of: number; best: number | null; newBest: boolean }
  | { kind: 'save'; rank: number | null; of: number }
  | { kind: 'unranked'; why: string }
  | { kind: 'saving' }
  | { kind: 'retry' };

/** What the results tag says about the run (spec §6, pick 3B). */
export function ribbonModel(o: RunOutcome, user: SessionState): RibbonModel {
  switch (o.kind) {
    case 'offline':
      return { kind: 'unranked', why: UNRANKED_TEXT.offline };
    case 'unverified':
      return { kind: 'unranked', why: UNRANKED_TEXT.unverified };
    case 'saving':
      return { kind: 'saving' };
    case 'failed':
      return { kind: 'retry' };
    case 'done': {
      const r = o.result;
      // A run by a player still picking a name is placed but not yet counted in the total.
      if (r.ranked) return { kind: 'rank', rank: r.rank ?? r.total, of: Math.max(r.total, r.rank ?? 0), best: r.best, newBest: r.newBest };
      // A signed-out run: with a named account it is being claimed; otherwise saving it is a sign-in (or a name) away,
      // and the server's total doesn't count it yet, so once saved it adds one.
      if (r.reason === 'anonymous') return user?.name ? { kind: 'saving' } : { kind: 'save', rank: r.rank, of: Math.max(r.total + 1, r.rank ?? 0) };
      return { kind: 'unranked', why: UNRANKED_TEXT[r.reason ?? 'anonymous'] };
    }
  }
}

export interface RibbonHandlers {
  board(): void;
  save(): void;
  retry(): void;
}

/** "340", "1,340"; from 10,000 on "12.3K", so the count still fits the rosette's face (the label has it in full). */
const short = (n: number): string => (n < 10_000 ? n.toLocaleString('en-US') : new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n));

interface Rosette {
  kind: '' | 'best' | 'un';
  big: string;
  small: string;
  banner: string;
  label: string;
  /** null: a disabled rosette (unranked). */
  onClick: (() => void) | null;
}

/** The rosette badge, top right of the tag. Its text goes in as text. */
function rosette(o: Rosette): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `rib rib-ros${o.kind ? ` ${o.kind}` : ''}`;
  b.setAttribute('aria-label', o.label);
  if (o.onClick) b.addEventListener('click', o.onClick);
  else b.disabled = true;
  b.innerHTML = `<i class="tail l"></i><i class="tail r"></i><span class="rib-ros-pleat"></span><span class="rib-ros-ring"></span><span class="rib-ros-face"><b></b><small></small></span>${o.banner ? '<span class="rib-ros-banner"></span>' : ''}`;
  const face = b.querySelector('.rib-ros-face');
  const big = face?.querySelector('b');
  const small = face?.querySelector('small');
  const banner = b.querySelector('.rib-ros-banner');
  if (big) big.textContent = o.big;
  if (small) small.textContent = o.small;
  if (banner) banner.textContent = o.banner;
  // "#1234" and longer: a smaller numeral, so it stays inside the face.
  face?.classList.toggle('long', o.big.length > 4);
  return b;
}

/** The ribbon's controls, by the class a redrawn control keeps. */
const FOCUSABLE = ['rib-ros', 'rib-ribbon', 'rib-retry'];

/**
 * Draws `m` onto the results tag, replacing what was there; null clears it. The tag's own time, score and stats are
 * untouched (only its best pill hides while ranked). Server numbers are coerced and every piece of text goes in as
 * text. A redraw keeps keyboard focus on the same control when it is still there.
 */
export function renderRibbon(root: HTMLElement, m: RibbonModel | null, h: RibbonHandlers): void {
  const active = document.activeElement;
  const focused = active instanceof HTMLElement && root.contains(active) ? FOCUSABLE.find((c) => active.classList.contains(c)) : undefined;
  root.querySelectorAll('.rib').forEach((n) => n.remove());
  // Ranked, the rosette and the line tell the player's best: the device's own "New best" / "Best" pill steps aside.
  root.classList.toggle('rib-ranked', m?.kind === 'rank');
  if (!m) return;
  const line = document.createElement('div');
  line.className = 'rib rib-line';
  const bold = (text: string): HTMLElement => {
    const b = document.createElement('b');
    b.textContent = text;
    return b;
  };
  switch (m.kind) {
    case 'rank': {
      const rank = Number(m.rank);
      const of = Number(m.of);
      const best = m.best === null ? null : Number(m.best);
      line.append(bold(`#${rank}`), ` of ${plural(of, 'run')} · `);
      if (m.newBest || best === null) line.append('New personal best!');
      else line.append('Your best ', bold(formatMs(best)));
      root.prepend(
        rosette({ kind: m.newBest ? 'best' : '', big: `#${rank}`, small: `of ${short(of)}`, banner: m.newBest ? 'New best' : '', label: `Rank ${rank} of ${of}: open the leaderboard`, onClick: h.board }),
      );
      break;
    }
    case 'save': {
      if (m.rank === null) line.textContent = 'Sign in to put this time on the leaderboard';
      else line.append('Would place ', bold(`#${Number(m.rank)}`), ` of ${plural(m.of, 'run')}`);
      const ribbon = document.createElement('button');
      ribbon.type = 'button';
      ribbon.className = 'rib rib-ribbon';
      ribbon.innerHTML = `${G_LOGO}<span>Save to leaderboard</span>`;
      ribbon.addEventListener('click', h.save);
      root.querySelector('.actions')?.before(ribbon);
      break;
    }
    case 'unranked': {
      line.textContent = `Unranked: ${m.why}`;
      root.prepend(rosette({ kind: 'un', big: '–', small: 'Unranked', banner: '', label: 'Unranked', onClick: null }));
      break;
    }
    case 'saving':
      line.textContent = 'Saving your time…';
      break;
    case 'retry': {
      line.textContent = "Couldn't save this run. ";
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'rib-retry';
      retry.textContent = 'Retry';
      retry.addEventListener('click', h.retry);
      line.append(retry);
      break;
    }
  }
  root.querySelector('#r-merry')?.after(line);
  if (focused) root.querySelector<HTMLElement>(`.${focused}:not(:disabled)`)?.focus({ preventScroll: true });
}
