import { signInHref } from '../api/client';
import { NAME_RULE } from '../api/names';
import type { User } from '../api/types';
import { esc, formatMs } from './format';
import { G_LOGO, I } from './icons';
import type { SheetView } from './sheet';

export interface SignInOptions {
  /** A finished signed-out run waiting to be saved: its ranked time. */
  pendingMs?: number | null;
  /** Runs just before the browser leaves for Google (Save to leaderboard marks its run here). */
  beforeLeave?: () => void;
  /** Where to land after signing in (default: this page). */
  returnPath?: string;
}

/** Sign-in (spec §6): Google's own button, one line about names and email, and the privacy link. */
export function signInView(o: SignInOptions, peek: boolean): SheetView {
  return {
    label: 'Sign in',
    card: true,
    focus: '.acct-google',
    render(inner) {
      const pending = o.pendingMs != null;
      inner.innerHTML = `<div class="acct-emb">${I.trophy}</div>
        <h2 class="acct-title">${pending ? 'Save this time' : 'Join the leaderboard'}</h2>
        ${pending ? `<p class="acct-pending">Your <b>${formatMs(o.pendingMs ?? 0)}</b> is waiting on this device.</p>` : '<p class="acct-lede">Put your fastest trees on the all-time leaderboard.</p>'}
        <a class="acct-google" href="${esc(signInHref(o.returnPath ?? location.pathname + location.search))}">${G_LOGO}<span>Continue with Google</span></a>
        <p class="acct-fine">Your name on the leaderboard is the one you pick. We never show your email. <a href="/privacy">Privacy</a></p>
        ${peek ? '<button class="acct-text" type="button" data-act="peek">Just looking? See the leaderboard</button>' : ''}`;
      inner.querySelector('.acct-google')?.addEventListener('click', () => o.beforeLeave?.());
    },
  };
}

export type NameStatus = 'empty' | 'checking' | 'available' | 'taken' | 'reserved' | 'invalid' | 'error' | 'saving' | 'failed';
export interface NameState {
  status: NameStatus;
  value: string;
}

/** The line under the name field, as HTML. */
export function nameMessage(s: NameState): string {
  const n = `“${esc(s.value.trim())}”`;
  switch (s.status) {
    case 'empty':
      return `<span class="acct-ci">${I.pen}</span><span>Pick something festive, or just your name.</span>`;
    case 'checking':
      return `<span class="acct-spin" aria-hidden="true"></span><span>Checking ${n}…</span>`;
    case 'saving':
      return `<span class="acct-spin" aria-hidden="true"></span><span>Saving ${n}…</span>`;
    case 'available':
      return `<span class="acct-ci">${I.check}</span><span>${n} is available</span>`;
    case 'taken':
      return `<span class="acct-ci">${I.cross}</span><span>${n} is taken. Try another.</span>`;
    case 'reserved':
      return `<span class="acct-ci">${I.cross}</span><span>That name is reserved</span>`;
    case 'invalid':
      return `<span class="acct-ci">${I.warn}</span><span>${s.value.trim().length < 3 ? 'At least 3 characters' : 'Letters, numbers, spaces, - and _ only'}</span>`;
    case 'error':
      return `<span class="acct-ci">${I.warn}</span><span>Couldn't check that name. You can still try to save it.</span>`;
    case 'failed':
      return `<span class="acct-ci">${I.warn}</span><span>Couldn't save your name. Try again.</span>`;
  }
}

export const canSaveName = (s: NameStatus): boolean => s === 'available' || s === 'error' || s === 'failed';

export interface NameCardHooks {
  input(value: string): void;
  save(): void;
}

/** Shown once after the first sign-in (spec §6). A name is chosen once. */
export function nameView(h: NameCardHooks): SheetView {
  return {
    label: 'Pick a display name',
    card: true,
    focus: '.acct-input',
    render(inner) {
      inner.innerHTML = `<div class="acct-emb">${I.pen}</div>
        <h2 class="acct-title">Pick a display name</h2>
        <p class="acct-lede">This is how you'll appear on the leaderboard. It can't be changed later.</p>
        <div class="acct-field"><input class="acct-input" type="text" maxlength="20" autocomplete="nickname" autocapitalize="words" spellcheck="false" aria-label="Display name" aria-describedby="acct-check"><span class="acct-count" aria-hidden="true">0/20</span></div>
        <p class="acct-check" id="acct-check" aria-live="polite"></p>
        <button class="acct-primary" type="button" data-act="save-name" disabled>Save name</button>
        <p class="acct-fine">${NAME_RULE}. Keep it kind.</p>`;
      const field = inner.querySelector<HTMLInputElement>('.acct-input');
      field?.addEventListener('input', () => h.input(field.value));
      field?.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        h.save();
      });
    },
  };
}

/** Paints a name state into the open name card without re-rendering it, so the field keeps focus. */
export function paintName(inner: HTMLElement, s: NameState): void {
  const line = inner.querySelector<HTMLElement>('.acct-check');
  const field = inner.querySelector<HTMLElement>('.acct-field');
  const save = inner.querySelector<HTMLButtonElement>('[data-act="save-name"]');
  const count = inner.querySelector<HTMLElement>('.acct-count');
  if (!line || !field || !save) return;
  line.dataset.state = s.status;
  field.dataset.state = s.status;
  line.innerHTML = nameMessage(s);
  save.disabled = !canSaveName(s.status);
  if (count) count.textContent = `${s.value.trim().length}/20`;
}

/** The delete card's confirmation: the name in any case, or (before a name is picked) the Google email. */
export function confirmMatches(user: User, typed: string): boolean {
  const t = typed.trim().toLowerCase();
  return user.name ? t === user.name.toLowerCase() : /^[^\s@]+@[^\s@]+$/.test(t);
}

/** Delete account (spec §6): type your name to confirm. The user, sessions and games go. */
export function deleteView(user: User): SheetView {
  return {
    label: 'Delete account',
    card: true,
    focus: '#acct-confirm',
    render(inner) {
      const what = user.name ? `your name, <b>${esc(user.name)}</b>,` : 'the email of your Google account';
      inner.innerHTML = `<div class="acct-emb danger">${I.warn}</div>
        <h2 class="acct-title">Delete your account?</h2>
        <p class="acct-lede">Your name and every game you saved leave the leaderboard for good. This can't be undone.</p>
        <label class="acct-confirm-l" for="acct-confirm">Type ${what} to confirm</label>
        <div class="acct-field"><input class="acct-input" id="acct-confirm" type="text" autocomplete="off" spellcheck="false"></div>
        <p class="acct-check" aria-live="polite"></p>
        <div class="acct-btnrow"><button class="acct-secondary" type="button" data-act="cancel">Keep account</button><button class="acct-danger" type="button" data-act="confirm-delete" disabled>Delete account</button></div>
        <p class="acct-fine">Games on this device stay here, unranked.</p>`;
      const input = inner.querySelector<HTMLInputElement>('#acct-confirm');
      const go = inner.querySelector<HTMLButtonElement>('[data-act="confirm-delete"]');
      input?.addEventListener('input', () => {
        if (go) go.disabled = !confirmMatches(user, input.value);
      });
    },
  };
}
