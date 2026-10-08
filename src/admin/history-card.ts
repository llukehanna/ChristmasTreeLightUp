import { HISTORY_FIRST_DAY, type AccountStats } from '../api/types.js';
import { loadStats, localDay } from '../store/stats.js';
import { plural } from '../ui/format.js';
import { ApiError, api } from './api.js';
import { h } from './dom.js';
import { importDefaults, importPreview, importRequest, markDone, pendingMark, readMark, type ImportFields, type ImportMark } from './history.js';

const isAuthLost = (e: unknown): e is ApiError => e instanceof ApiError && (e.status === 401 || e.status === 403);
/** Stands in for the real id while the form is only being previewed: the id is made when the import is sent. */
const PREVIEW_ID = 'preview-preview-preview';

export interface HistoryCardHooks {
  /** A 401 or 403 from the import: the page's sign-in or Not authorized card. */
  authLost(e: ApiError): void;
}

/**
 * "Import this device's history" (spec 2026-10-08 §6.1): this browser's pre-accounts stats become runs on the admin's
 * own account, once per device. Built once and kept across the editor's renders: it holds its own state.
 */
export function historyCard(hooks: HistoryCardHooks): HTMLElement {
  const section = h(
    'section',
    { class: 'history', attrs: { 'aria-labelledby': 'history-title' } },
    h('h2', { id: 'history-title', textContent: "Import this device's history" }),
    h('p', { class: 'note', textContent: "Adds this browser's saved games to your account as runs, so they count on the leaderboard and in your stats. Do it once per device." }),
  );
  const defaults = importDefaults(loadStats());
  if (!defaults) {
    section.append(h('p', { class: 'note', textContent: 'This browser has no saved games to import.' }));
    return section;
  }

  const inputs = {} as Record<keyof ImportFields, HTMLInputElement>;
  const field = (key: keyof ImportFields, label: string, mode: 'numeric' | 'text' = 'text', type: 'text' | 'date' = 'text'): HTMLLabelElement => {
    const input = h('input', { type, name: key, value: defaults.fields[key], attrs: { autocomplete: 'off', inputmode: mode } });
    inputs[key] = input;
    return h('label', {}, h('span', { textContent: label }), input);
  };
  const account = h('p', { class: 'note', textContent: 'Checking your account…' });
  const button = h('button', { class: 'primary', type: 'submit' });
  /** What the import will create, as the form stands; or what is wrong with it. Live, before anything is sent. */
  const preview = h('p', { class: 'preview', id: 'history-preview', attrs: { 'aria-live': 'polite', 'aria-atomic': 'true' } });
  const err = h('p', { class: 'err', id: 'history-err', attrs: { role: 'alert' } });
  const status = h('p', { class: 'done', id: 'history-status', attrs: { role: 'status' } });
  const form = h(
    'form',
    { class: 'history-form' },
    h(
      'div',
      { class: 'grid' },
      field('solved', 'Games solved', 'numeric'),
      field('best', 'Best time (m:ss)'),
      field('average', 'Average time (m:ss.t)'),
      field('streak', 'Current streak (days)', 'numeric'),
      field('longest', 'Longest streak (days)', 'numeric'),
      field('lastDay', 'Last solved day', 'text', 'date'),
    ),
    preview,
    h('div', { class: 'row' }, button),
    err,
    status,
  );
  for (const input of Object.values(inputs)) input.setAttribute('aria-describedby', preview.id);
  inputs.lastDay.min = HISTORY_FIRST_DAY;
  inputs.lastDay.max = localDay(new Date());
  section.append(account, form);

  let mark: ImportMark | null = readMark();
  let sending = false;
  const values = (): ImportFields => ({
    solved: inputs.solved.value,
    best: inputs.best.value,
    average: inputs.average.value,
    streak: inputs.streak.value,
    longest: inputs.longest.value,
    lastDay: inputs.lastDay.value,
  });
  const check = (importId: string) => {
    const now = new Date();
    return importRequest(values(), defaults, importId, now.getTimezoneOffset(), localDay(now));
  };
  const runs = (): number => {
    const n = Number(inputs.solved.value.trim());
    return Number.isInteger(n) && n > 0 ? n : 0;
  };

  function paint(): void {
    const done = mark?.done === true;
    const checked = check(PREVIEW_ID);
    const active = document.activeElement;
    const hadFocus = active instanceof HTMLElement && form.contains(active);
    for (const input of Object.values(inputs)) {
      input.disabled = done || sending;
      if (done) input.removeAttribute('aria-describedby');
    }
    preview.hidden = done;
    preview.classList.toggle('bad', typeof checked === 'string');
    preview.textContent = typeof checked === 'string' ? checked : importPreview(checked);
    // A form that fails can't be sent: send() ignores it, and the preview says why. aria-disabled rather than disabled,
    // so the button keeps keyboard focus when it goes inactive and its reason is read (aria-describedby).
    const off = done || sending || typeof checked === 'string';
    if (off) button.setAttribute('aria-disabled', 'true');
    else button.removeAttribute('aria-disabled');
    button.setAttribute('aria-describedby', done ? status.id : `${preview.id} ${err.id}`);
    // Enter in a field submits, and the field then disables: keep the place on the button.
    if (hadFocus && active instanceof HTMLInputElement && active.disabled) button.focus();
    button.textContent = done ? 'Imported' : sending ? 'Importing…' : `Import ${plural(runs(), 'run')}`;
    if (done && !status.textContent) status.textContent = `This device's history was imported${mark?.added ? ` (${plural(mark.added, 'run')})` : ''}.`;
  }

  async function loadAccount(): Promise<void> {
    try {
      const s: AccountStats = await api.stats(new Date());
      account.textContent = `Your account already has ${plural(s.solved - s.imported, 'played game')}${s.imported ? ` and ${plural(s.imported, 'imported run')}` : ''}. Its streak is ${plural(s.streak, 'day')}, longest ${plural(s.longestStreak, 'day')}. This device's total includes any games you played here since accounts launched: subtract them from Games solved so they aren't counted twice.`;
    } catch {
      // Only the import itself hands a 401 or 403 to the page: this line is a hint, never a reason to leave the editor.
      account.textContent = "Couldn't load your account's games. The import still works.";
    }
  }

  async function send(): Promise<void> {
    if (sending || mark?.done) return;
    err.textContent = '';
    if (typeof check(PREVIEW_ID) === 'string') return;
    // The id is saved before the request goes out: a resend after a lost answer can't add the runs twice.
    // Reuse this page's own mark first: a storage write that failed must not mint a second id on a resend.
    const pending = mark ?? pendingMark();
    const body = check(pending.importId);
    if (typeof body === 'string') return;
    mark = pending;
    sending = true;
    paint();
    try {
      const r = await api.importHistory(body);
      mark = markDone(pending, r.added);
      status.textContent = r.already ? "This device's history was already imported." : `Imported ${plural(r.added, 'run')} from this device.`;
      // On "already", streak, longestStreak and clamped describe this request, not the runs stored: say nothing of them.
      if (r.clamped && !r.already) status.textContent += ` The streaks didn't fit between Sep 29 and the last solved day, so they were placed as ${r.streak} and ${r.longestStreak} days.`;
      void loadAccount();
    } catch (e) {
      if (isAuthLost(e)) hooks.authLost(e);
      else err.textContent = e instanceof Error ? e.message : String(e);
    } finally {
      sending = false;
      paint();
    }
  }

  form.addEventListener('input', paint);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void send();
  });
  paint();
  void loadAccount();
  return section;
}
