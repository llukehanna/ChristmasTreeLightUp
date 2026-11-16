/**
 * The career page (spec: Your career), loaded on first use like the replay (src/replay/index.ts): its code and styles
 * stay out of the entry chunk, and nothing here imports the app. The app opens it with openCareer and closes it with
 * page.close(); the page only asks (onClose) when the player presses ‹ Tree or Esc.
 */
import './career.css';
import type { CareerResponse } from '../api/types';
import { eyebrowText, renderBody, shell } from './page';

export interface CareerOptions {
  user: { name: string | null };
  /** api.career */
  load(): Promise<CareerResponse>;
  /** The page asked to close (‹ Tree, Esc). */
  onClose(): void;
  /** The Leaderboard switch. */
  onLeaderboard(): void;
  /** A row's Watch. */
  onWatch(id: string): void;
  now?: () => Date;
}

export interface CareerPage {
  readonly el: HTMLElement;
  close(): void;
}

const STOPS = 'button, a[href], [tabindex]:not([tabindex="-1"])';

/** Opens the page over the stage, appended to the body, with the title focused. */
export function openCareer(opts: CareerOptions): CareerPage {
  const { el, title, eyebrow, body } = shell(opts.user);
  let closed = false;
  let attempt = 0;

  function load(): void {
    const mine = ++attempt;
    body.innerHTML = '<div class="msg" role="status">Loading your career…</div>';
    let pending: Promise<CareerResponse>;
    try {
      pending = opts.load();
    } catch (e) {
      pending = Promise.reject(e);
    }
    const fail = (): void => {
      body.innerHTML = '<div class="msg" role="alert"><p>Couldn’t load your career.</p><button type="button" class="retry">Retry</button></div>';
      body.querySelector('.retry')!.addEventListener('click', load);
    };
    pending.then((res) => {
      if (closed || mine !== attempt) return;
      try {
        const { runs } = renderBody(body, res, (opts.now ?? (() => new Date()))(), opts.onWatch);
        eyebrow.textContent = eyebrowText(opts.user.name, runs[0]);
      } catch {
        // A response this page can't read is an error like a failed request: the same Retry.
        fail();
      }
    }, () => {
      if (closed || mine !== attempt) return;
      fail();
    });
  }

  /** Escape asks to close; Tab stays inside; P never reaches the game's pause key. Capture phase, so nothing else sees them. */
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      opts.onClose();
    } else if (e.key === 'Tab') {
      const stops = [...el.querySelectorAll<HTMLElement>(STOPS)].filter((n) => !(n instanceof HTMLButtonElement && n.disabled) && n.getClientRects().length > 0);
      if (!stops.length) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      const at = document.activeElement;
      // The title is out of the Tab order but holds focus on open: Tab from it goes to the first stop.
      if (!el.contains(at) || at === title || (e.shiftKey && at === first) || (!e.shiftKey && at === last)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus({ preventScroll: true });
      }
    } else if (e.key === 'p' || e.key === 'P') {
      e.stopPropagation();
    }
  }

  el.querySelector('.back')!.addEventListener('click', () => opts.onClose());
  el.querySelector('[data-tab="board"]')!.addEventListener('click', () => opts.onLeaderboard());
  document.addEventListener('keydown', onKey, true);
  document.body.append(el);
  title.focus({ preventScroll: true });
  load();

  return {
    el,
    close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      el.remove();
    },
  };
}
