import type { SessionState } from '../api/session';
import type { User } from '../api/types';
import { isEditable } from './dom';

/**
 * The star-head egg (2026-10-08): five quick taps on the star, or typing "hohoho", swap the star for Luke's head in a
 * Santa hat, and the same again brings the star back. The choice lives in this browser and, signed in, on the account,
 * which wins on load and sign-in. Star taps never reach the board: no move, no log entry, no clock.
 */

export const STAR_TAPS = 5;
/** Each tap within this long of the previous one keeps the count; a longer gap starts over. */
export const STAR_TAP_GAP_MS = 1600;

export class StarTaps {
  private n = 0;
  private last = Number.NEGATIVE_INFINITY;

  /** Counts a tap on the star: 1–4 build up, 5 toggles (and the count starts over). */
  tap(now: number): number {
    if (now - this.last > STAR_TAP_GAP_MS) this.n = 0;
    this.last = now;
    const n = ++this.n;
    if (n >= STAR_TAPS) this.n = 0;
    return n;
  }
}

type KeyLike = Pick<KeyboardEvent, 'key' | 'target' | 'ctrlKey' | 'metaKey' | 'altKey' | 'repeat'>;

/** A word typed anywhere but a field (any case, letters only: other keys are ignored, a 2 s pause starts over). */
export class TypedWord {
  private typed = '';
  private last = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly word: string,
    private readonly gapMs = 2000,
  ) {}

  /** Feeds a keydown; true on the letter that completes the word. */
  feed(e: KeyLike, now: number): boolean {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target) || !/^[a-z]$/i.test(e.key)) return false;
    if (now - this.last > this.gapMs) this.typed = '';
    this.last = now;
    this.typed = (this.typed + e.key.toLowerCase()).slice(-this.word.length);
    if (this.typed !== this.word) return false;
    this.typed = '';
    return true;
  }
}

/** Which face tops the tree: signed in, the account's; signed out (or before /api/me answers), this browser's. */
export const starHeadFor = (local: boolean, user: SessionState): boolean => (user ? user.starHead : local);

export interface EggHooks {
  topper: { load(): Promise<boolean>; set(head: boolean): void; flip(head: boolean, now: number): void; tap(now: number, n: number): void };
  sfx: { starTap(k: number): void; jingle(on: boolean): void };
  toast(text: string): void;
  /** The app's haptics (it checks the setting). */
  vibrate(pattern: number | number[]): void;
  /** This browser's copy. */
  save(on: boolean): void;
  /** The account's copy (PUT /api/me/star-head). */
  put(on: boolean): Promise<unknown>;
  /** A flip has started (the app re-renders the share image once it has landed). */
  flipped?(): void;
  now?(): number;
}

interface SessionLike {
  readonly current: SessionState;
  subscribe(fn: (s: SessionState) => void): unknown;
}

export class StarEgg {
  private on: boolean;
  private readonly taps = new StarTaps();
  private readonly word = new TypedWord('hohoho');

  constructor(
    private readonly session: SessionLike,
    private readonly h: EggHooks,
    local: boolean,
  ) {
    this.on = starHeadFor(local, session.current);
    h.topper.set(this.on);
    if (this.on) void h.topper.load();
    session.subscribe((s) => this.onSession(s));
  }

  get isOn(): boolean {
    return this.on;
  }

  /** A tap on the star (the app has already checked it is one). */
  tap(now: number): void {
    const n = this.taps.tap(now);
    void this.h.topper.load(); // from the first tap, so the sticker is ready by the fifth
    if (n < STAR_TAPS) {
      this.h.topper.tap(now, n);
      this.h.sfx.starTap(n - 1);
      this.h.vibrate(6);
      return;
    }
    this.toggle(now);
  }

  /** A keydown the game would otherwise see: true when it completed "hohoho" (and toggled). */
  key(e: KeyLike, now: number): boolean {
    if (!this.word.feed(e, now)) return false;
    this.toggle(now);
    return true;
  }

  private toggle(now: number): void {
    const on = !this.on;
    this.on = on;
    this.h.save(on);
    const user = this.session.current;
    if (user) {
      // The session's copy follows, so setting the same user again later can't undo it. A failed PUT keeps the local
      // state, quietly: the next toggle or sign-in resyncs.
      (user as User).starHead = on;
      this.h.put(on).catch(() => undefined);
    }
    this.show(on, now, true);
    this.h.toast(on ? 'Ho ho ho.' : 'Back to the star.');
    this.h.vibrate([10, 50, 18]);
  }

  /** Load or sign-in: the account's value wins, and becomes this browser's too. Signing out keeps the browser's. */
  private onSession(s: SessionState): void {
    if (!s || s.starHead === this.on) return;
    this.on = s.starHead;
    this.h.save(this.on);
    this.show(this.on, this.h.now?.() ?? performance.now(), false);
  }

  /** Flips to `on`: to the head once the sticker can be drawn (a local file: a moment at most). `loud`: the player did it. */
  private show(on: boolean, now: number, loud: boolean): void {
    const go = (at: number) => {
      if (this.on !== on) return; // toggled back meanwhile
      this.h.topper.flip(on, at);
      if (loud) this.h.sfx.jingle(on);
      this.h.flipped?.();
    };
    if (!on) go(now);
    else void this.h.topper.load().then(() => go(this.h.now?.() ?? performance.now()));
  }
}
