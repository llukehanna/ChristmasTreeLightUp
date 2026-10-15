import type { SessionState } from '../api/session';
import type { User } from '../api/types';
import { isEditable } from './dom';
import { LatestPut } from './latest-put';

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

  /** The taps so far toward the next toggle (0–4), as of the last tap. */
  get count(): number {
    return this.n;
  }

  /** Counts a tap on the star: 1–4 build up, 5 toggles (and the count starts over). */
  tap(now: number): number {
    if (now - this.last > STAR_TAP_GAP_MS) this.n = 0;
    this.last = now;
    const n = ++this.n;
    if (n >= STAR_TAPS) this.n = 0;
    return n;
  }
}

export type KeyLike = Pick<KeyboardEvent, 'key' | 'target' | 'ctrlKey' | 'metaKey' | 'altKey' | 'repeat'>;

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
  /**
   * Secret mode follows the head (spec 2026-10-08 secret mode §1): 'start' when constructed, 'loud' for the player's
   * own toggle, 'quiet' for a sign-in or a stored head whose sticker failed.
   */
  mode?(on: boolean, how: 'start' | 'loud' | 'quiet'): void;
  /** Called synchronously inside the gesture that completes a toggle (the 5th tap, the last letter), before anything async: `on` is where it is heading. */
  gesture?(on: boolean): void;
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
  /** A turn to the head is waiting for the sticker: another toggle meanwhile is ignored. */
  private turning = false;
  /** The account's copy, latest-wins. */
  private readonly account: LatestPut;
  /** Bumped by off(): a turn to the head still waiting for the sticker is dropped. */
  private seq = 0;

  constructor(
    private readonly session: SessionLike,
    private readonly h: EggHooks,
    local: boolean,
  ) {
    this.account = new LatestPut((on) => h.put(on));
    this.on = starHeadFor(local, session.current);
    h.topper.set(this.on);
    h.mode?.(this.on, 'start');
    if (this.on) {
      // A stored head whose sticker can't load: the star, quietly, for this visit (the preference itself stays).
      void h.topper.load().then((ok) => {
        if (ok || !this.on || this.turning) return;
        this.on = false;
        h.topper.set(false);
        h.mode?.(false, 'quiet');
      });
    }
    session.subscribe((s) => this.onSession(s));
  }

  get isOn(): boolean {
    return this.on;
  }

  /** The star taps so far toward the next toggle (the e2e probe). */
  get tapCount(): number {
    return this.taps.count;
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
    if (!this.turning) this.h.gesture?.(!this.on);
    this.toggle(now);
  }

  /** A keydown the game would otherwise see: true when it completed "hohoho" (and toggled). */
  key(e: KeyLike, now: number): boolean {
    if (!this.word.feed(e, now)) return false;
    if (!this.turning) this.h.gesture?.(!this.on);
    this.toggle(now);
    return true;
  }

  /**
   * Home Alone took over (spec 2026-10-14 §1): back to the star, quietly (no jingle, no toast), and kept so in this
   * browser and on the account. A turn to the head still waiting for the sticker is dropped, and so is the account's
   * head still loading on a load or sign-in: the account is told it is off, or it would come back on the next load.
   */
  off(): void {
    this.seq++;
    this.turning = false;
    if (this.on) this.apply(false, this.time(), 'kept');
    else if (this.session.current?.starHead) {
      this.h.save(false);
      this.send(false);
    }
  }

  private time(): number {
    return this.h.now?.() ?? performance.now();
  }

  /**
   * The player's toggle. Back to the star at once; to the head only once the sticker can be drawn (a local file: a
   * moment at most). If it can't be had, nothing happens at all: no flip, no jingle, no toast, the star stays.
   */
  private toggle(now: number): void {
    if (this.turning) return;
    if (this.on) {
      this.apply(false, now, 'loud');
      return;
    }
    this.turning = true;
    const seq = this.seq;
    void this.h.topper.load().then((ok) => {
      if (seq !== this.seq) return;
      this.turning = false;
      if (ok && !this.on) this.apply(true, this.time(), 'loud');
    });
  }

  /** Puts `on` in place: the view and this browser; 'kept' and 'loud' also the account; 'loud' (the player did it) the jingle and the toast. */
  private apply(on: boolean, now: number, how: 'loud' | 'quiet' | 'kept'): void {
    this.on = on;
    this.h.save(on);
    this.h.topper.flip(on, now);
    this.h.flipped?.();
    this.h.mode?.(on, how === 'loud' ? 'loud' : 'quiet');
    if (how === 'quiet') return;
    this.send(on);
    if (how === 'kept') return;
    this.h.sfx.jingle(on);
    this.h.toast(on ? 'Ho ho ho.' : 'Back to the star.');
    this.h.vibrate([10, 50, 18]);
  }

  /**
   * Signed in: the account's copy, in the background. One PUT at a time, and only the latest value goes next, so a
   * slow answer can never leave the account on an older toggle. A failed PUT keeps the local state, quietly: the next
   * toggle or sign-in resyncs.
   */
  private send(on: boolean): void {
    const user = this.session.current;
    if (!user) return;
    // The session's copy follows, so setting the same user again later can't undo it.
    (user as User).starHead = on;
    this.account.send(on);
  }

  /**
   * Load or sign-in: the account's value wins, and becomes this browser's too, with a quiet flip. Signing out keeps the
   * browser's. While one of our PUTs is out, the answer may predate it: ours is the newer word, and the session's copy
   * is brought in line instead.
   */
  private onSession(s: SessionState): void {
    if (!s) return;
    if (this.account.pending) {
      (s as User).starHead = this.on;
      return;
    }
    if (s.starHead === this.on) return;
    if (!s.starHead) {
      this.apply(false, this.time(), 'quiet');
      return;
    }
    const seq = this.seq;
    void this.h.topper.load().then((ok) => {
      // Still what the account says, and the player hasn't turned it meanwhile. A toggle of the player's own waiting for
      // the same sticker lands it instead, loud (its PUT agrees with the account).
      if (seq === this.seq && ok && !this.on && !this.turning && this.session.current?.starHead === true) this.apply(true, this.time(), 'quiet');
    });
  }
}
