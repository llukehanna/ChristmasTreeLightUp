import type { RunOutcome } from '../api/outcome';
import type { SessionState } from '../api/session';
import { formatMs, plural, UNRANKED_TEXT } from './format';
import { G_LOGO } from './icons';

export type RibbonModel =
  | { kind: 'rank'; rank: number; of: number; best: number | null; newBest: boolean }
  /** `signedIn`: an account without a name yet, so saving is the name card, not Google. */
  | { kind: 'save'; rank: number | null; of: number; signedIn: boolean }
  /** `saved`: the server kept the run, unranked (a finish that arrived too late). */
  | { kind: 'unranked'; why: string; saved?: boolean }
  | { kind: 'saving' }
  /** The finish didn't reach the server, or the claim after naming didn't. */
  | { kind: 'retry'; what: 'finish' | 'claim' }
  /** Claimed already (another tab) or gone: a retry can't help, and the run is in Your games if it is anyone's. */
  | { kind: 'kept' };

/** What the App knows beyond the outcome and the session. */
export interface RibbonContext {
  /** The claim of this run, after naming: failed ('stuck') or not taken by the server ('gone'). */
  claim?: 'stuck' | 'gone' | null;
  /** The finish was (re)sent more than the judge's clock tolerance after the win. */
  late?: boolean;
  /** Back from Google for this run: until /api/me answers, a claim is likely on its way. */
  returning?: boolean;
}

/** "Unranked: …" for a finish the server kept but couldn't time (controller ruling, fix round 1). */
export const LATE_TEXT = 'reached the server too late';

/** What the results tag says about the run (spec §6, pick 3B). */
export function ribbonModel(o: RunOutcome, user: SessionState, ctx: RibbonContext = {}): RibbonModel {
  switch (o.kind) {
    case 'offline':
      return { kind: 'unranked', why: UNRANKED_TEXT.offline };
    case 'unverified':
      return { kind: 'unranked', why: UNRANKED_TEXT.unverified };
    case 'saving':
      return { kind: 'saving' };
    case 'failed':
      return { kind: 'retry', what: 'finish' };
    case 'done': {
      const r = o.result;
      // A run by a player still picking a name is placed but not yet counted in the total.
      if (r.ranked) return { kind: 'rank', rank: r.rank ?? r.total, of: Math.max(r.total, r.rank ?? 0), best: r.best, newBest: r.newBest };
      if (r.reason === 'anonymous') {
        // A signed-out run: with a named account it is being claimed (or the claim failed, or was taken elsewhere).
        if (user?.name) return ctx.claim === 'stuck' ? { kind: 'retry', what: 'claim' } : ctx.claim === 'gone' ? { kind: 'kept' } : { kind: 'saving' };
        // Back from Google, the session still loading: no flash of "Save to leaderboard".
        if (user === undefined && ctx.returning) return { kind: 'saving' };
        // Otherwise saving is a sign-in (or a name) away; the server's total doesn't count it yet, so once saved it adds one.
        return { kind: 'save', rank: r.rank, of: Math.max(r.total + 1, r.rank ?? 0), signedIn: !!user };
      }
      if (r.reason === 'clock' && ctx.late) return { kind: 'unranked', why: LATE_TEXT, saved: true };
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
const num = (n: number): string => n.toLocaleString('en-US');

interface Rosette {
  kind: '' | 'best' | 'un';
  big: string;
  small: string;
  banner: string;
  label: string;
  /** null: a picture (unranked), not a control. */
  onClick: (() => void) | null;
}

/** The rosette badge, top right of the tag: a button to the leaderboard, or (unranked) an image. Text goes in as text. */
function rosette(o: Rosette): HTMLElement {
  let b: HTMLElement;
  if (o.onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.addEventListener('click', o.onClick);
    b = btn;
  } else {
    b = document.createElement('span');
    b.setAttribute('role', 'img');
  }
  b.className = `rib rib-ros${o.kind ? ` ${o.kind}` : ''}`;
  b.setAttribute('aria-label', o.label);
  b.innerHTML = `<i class="tail l"></i><i class="tail r"></i><span class="rib-ros-pleat"></span><span class="rib-ros-ring"></span><span class="rib-ros-face"><b></b><small></small></span>${o.banner ? '<span class="rib-ros-banner"></span>' : ''}`;
  const face = b.querySelector('.rib-ros-face');
  const big = face?.querySelector('b');
  const small = face?.querySelector('small');
  const banner = b.querySelector('.rib-ros-banner');
  if (big) big.textContent = o.big;
  if (small) small.textContent = o.small;
  if (banner) banner.textContent = o.banner;
  // "#1234" and longer, then "#12345" and longer: smaller numerals, so they stay inside the face.
  face?.classList.toggle('long', o.big.length > 4);
  face?.classList.toggle('longer', o.big.length > 5);
  return b;
}

/** The ribbon's controls, by the class a redrawn control keeps; then where focus goes when that control is gone. */
const CONTROLS = ['rib-ros', 'rib-ribbon', 'rib-retry'];
const FALLBACK = 'button.rib-ros, .rib-retry, .rib-ribbon';

/**
 * Draws `m` onto the results tag, replacing what was there; null clears it. The tag's own time, score and stats are
 * untouched (only its best pill hides beside a rosette). Server numbers are coerced and every piece of text goes in as
 * text. Keyboard focus on the ribbon stays on the ribbon across redraws: on the same control when it is still there,
 * else on the control that replaced it, else on the line (and on to the next control when one comes back).
 */
export function renderRibbon(root: HTMLElement, m: RibbonModel | null, h: RibbonHandlers): void {
  const active = document.activeElement;
  const ours = active instanceof HTMLElement && root.contains(active) && (active.classList.contains('rib-line') || CONTROLS.some((c) => active.classList.contains(c)));
  const same = ours ? CONTROLS.find((c) => active.classList.contains(c)) : undefined;
  root.querySelectorAll('.rib').forEach((n) => n.remove());
  // Beside a rosette (ranked or not), the device's own "New best" / "Best" pill steps aside: the rosette tells the run.
  root.classList.toggle('rib-ros-on', m?.kind === 'rank' || m?.kind === 'unranked');
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
      line.append(bold(`#${num(rank)}`), ` of ${plural(of, 'run')} · `);
      if (m.newBest || best === null) line.append('New personal best!');
      else line.append('Your best ', bold(formatMs(best)));
      root.prepend(
        rosette({ kind: m.newBest ? 'best' : '', big: `#${rank}`, small: `of ${short(of)}`, banner: m.newBest ? 'New best' : '', label: `Rank ${rank} of ${of}: open the leaderboard`, onClick: h.board }),
      );
      break;
    }
    case 'save': {
      if (m.rank === null) line.textContent = 'Sign in to put this time on the leaderboard';
      else line.append('Would place ', bold(`#${num(Number(m.rank))}`), ` of ${plural(m.of, 'run')}`);
      const ribbon = document.createElement('button');
      ribbon.type = 'button';
      ribbon.className = 'rib rib-ribbon';
      // Google's mark only where the ribbon leads to Google.
      ribbon.innerHTML = `${m.signedIn ? '' : G_LOGO}<span>Save to leaderboard</span>`;
      ribbon.addEventListener('click', h.save);
      root.querySelector('.actions')?.before(ribbon);
      break;
    }
    case 'unranked':
      line.textContent = `${m.saved ? 'Saved, unranked' : 'Unranked'}: ${m.why}`;
      root.prepend(rosette({ kind: 'un', big: '—', small: 'Unranked', banner: '', label: 'Unranked', onClick: null }));
      break;
    case 'saving':
      line.textContent = 'Saving your time…';
      break;
    case 'kept':
      line.textContent = 'Saved to Your games';
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
  if (!ours) return;
  const next = (same && root.querySelector<HTMLElement>(`button.${same}`)) || root.querySelector<HTMLElement>(FALLBACK);
  if (next) next.focus({ preventScroll: true });
  else {
    // Nothing to press now (saving, kept): the line holds focus rather than dropping it to the page.
    line.tabIndex = -1;
    line.focus({ preventScroll: true });
  }
}
