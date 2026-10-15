import type { SessionState } from '../api/session';
import type { User } from '../api/types';
import { LatestPut } from './latest-put';
import { TypedWord, type KeyLike } from './star-egg';

/**
 * Home Alone mode (spec 2026-10-14 §1): typing "kevin" (anywhere but a field, any case, a 2 s gap starts over) switches
 * it. Kept in this browser and, signed in, on the account, which wins on load and sign-in. Never with the head: the
 * head wins any clash, and the player's own switch-on turns the head off (the app calls StarEgg.off()).
 */
export const HOME_ALONE_WORD = 'kevin';

/** Whether the page should be in the house: never with the head on; signed in, the account's value; else this browser's. */
export const homeAloneFor = (local: boolean, user: SessionState, head: boolean): boolean =>
  !head && (user ? user.homeAlone === true && !user.starHead : local);

export interface HomeAloneHooks {
  /** This browser's copy. */
  save(on: boolean): void;
  /** The account's copy (PUT /api/me/home-alone). */
  put(on: boolean): Promise<unknown>;
  /** 'start' when constructed, 'loud' for the player's own typing, 'quiet' for a load, a sign-in or the head taking over. */
  mode(on: boolean, how: 'start' | 'loud' | 'quiet'): void;
  /** The head is on, or the account says it is. */
  head(): boolean;
  /** Called synchronously inside the keydown that completes the word, before mode (audio unlocks here). */
  gesture?(on: boolean): void;
}

interface SessionLike {
  readonly current: SessionState;
  subscribe(fn: (s: SessionState) => void): unknown;
}

export class HomeAloneSwitch {
  private on: boolean;
  private readonly word = new TypedWord(HOME_ALONE_WORD);
  private readonly account: LatestPut;

  constructor(
    private readonly session: SessionLike,
    private readonly h: HomeAloneHooks,
    local: boolean,
  ) {
    this.account = new LatestPut((on) => h.put(on));
    this.on = homeAloneFor(local, session.current, h.head());
    // Found on alongside the head (two devices): the head stays, and this browser forgets the house.
    if (local && !this.on && h.head()) h.save(false);
    h.mode(this.on, 'start');
    session.subscribe((s) => this.onSession(s));
  }

  get isOn(): boolean {
    return this.on;
  }

  /** A keydown the game would otherwise see: true when it completed "kevin" (and switched). */
  key(e: KeyLike, now: number): boolean {
    if (!this.word.feed(e, now)) return false;
    this.h.gesture?.(!this.on);
    this.apply(!this.on, 'loud');
    return true;
  }

  /** The head took over: off, quietly, and kept off in this browser and on the account. */
  off(): void {
    if (this.on) this.apply(false, 'kept');
  }

  private apply(on: boolean, how: 'loud' | 'quiet' | 'kept'): void {
    this.on = on;
    this.h.save(on);
    if (how !== 'quiet') this.send(on);
    this.h.mode(on, how === 'loud' ? 'loud' : 'quiet');
  }

  private send(on: boolean): void {
    const user = this.session.current;
    if (!user) return;
    (user as User).homeAlone = on; // the session's copy follows, so setting the same user again can't undo it
    this.account.send(on);
  }

  /** Load or sign-in: the account wins (quietly); both on there, the head wins and the account is told. */
  private onSession(s: SessionState): void {
    if (!s) return;
    if (this.account.pending) {
      (s as User).homeAlone = this.on;
      return;
    }
    const clash = s.starHead && s.homeAlone === true;
    const want = s.homeAlone === true && !s.starHead;
    if (want !== this.on) this.apply(want, clash ? 'kept' : 'quiet');
    else if (clash) this.send(false);
  }
}
