import type { ReplayResponse } from '../api/types';
import { dailyLabel, formatMs } from './format';

export interface ReplayBarHooks {
  /** Pause or Play. */
  onToggle(): void;
  /** 2× on or off. */
  onSpeed(): void;
  /** Watch again, once the replay has ended. */
  onRestart(): void;
  onDone(): void;
}

export interface ReplayBarState {
  playing: boolean;
  speed: 1 | 2;
  ended: boolean;
}

/**
 * The bar's caption (C4 decision 9): `Your run · 1:02.4`, or another player's name in its place, a Daily run's day in
 * front (`Daily Tree · Nov 6 · …`). The route only hands out another player's run when its owner has a name.
 */
export function replayCaption(r: Pick<ReplayResponse, 'name' | 'mine' | 'ms' | 'daily'>): string {
  const who = r.mine ? 'Your run' : (r.name ?? 'A player');
  return `${r.daily ? `${dailyLabel(r.daily)} · ` : ''}${who} · ${formatMs(r.ms)}`;
}

/**
 * The replay's controls, along the bottom of the stage while a run plays back (src/app.ts watch): its caption, Pause
 * and Play (Watch again once it has ended), 2× and Done. The host (#replay-bar) shows only while body.watching.
 */
export class ReplayBar {
  private readonly cap: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly fast: HTMLButtonElement;
  private ended = false;

  constructor(
    private readonly host: HTMLElement,
    hooks: ReplayBarHooks,
  ) {
    host.setAttribute('role', 'group');
    host.setAttribute('aria-label', 'Replay');
    host.innerHTML =
      '<span class="rb-cap"></span><span class="rb-btns"><button type="button" class="rb-toggle"></button>' +
      '<button type="button" class="rb-fast" aria-pressed="false">2×</button><button type="button" class="rb-done">Done</button></span>';
    this.cap = host.querySelector('.rb-cap')!;
    this.toggle = host.querySelector('.rb-toggle')!;
    this.fast = host.querySelector('.rb-fast')!;
    this.toggle.addEventListener('click', () => (this.ended ? hooks.onRestart() : hooks.onToggle()));
    this.fast.addEventListener('click', () => hooks.onSpeed());
    host.querySelector('.rb-done')!.addEventListener('click', () => hooks.onDone());
  }

  /** Up with `caption`, playing at 1×, keyboard focus on Pause (Space and Enter work it). */
  show(caption: string): void {
    this.cap.textContent = caption;
    this.set({ playing: true, speed: 1, ended: false });
    this.host.hidden = false;
    this.toggle.focus({ preventScroll: true });
  }

  set(s: ReplayBarState): void {
    this.ended = s.ended;
    this.toggle.textContent = s.ended ? 'Watch again' : s.playing ? 'Pause' : 'Play';
    this.fast.setAttribute('aria-pressed', String(s.speed === 2));
  }

  hide(): void {
    this.host.hidden = true;
  }
}
