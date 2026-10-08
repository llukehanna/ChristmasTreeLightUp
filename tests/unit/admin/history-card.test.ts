// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountStats, ImportRequest, ImportResponse } from '../../../src/api/types';
import { ApiError } from '../../../src/admin/api';
import type { Stats } from '../../../src/store/stats';

const calls = vi.hoisted(() => ({
  stats: vi.fn<() => Promise<AccountStats>>(),
  importHistory: vi.fn<(b: ImportRequest) => Promise<ImportResponse>>(),
}));
vi.mock('../../../src/admin/api', async (orig) => ({ ...(await orig<typeof import('../../../src/admin/api')>()), api: { stats: calls.stats, importHistory: calls.importHistory } }));

import { historyCard } from '../../../src/admin/history-card';

const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const device = (): Stats => ({ v: 1, solved: 3, totalSeconds: 9300, bestSeconds: 3000, bestScore: -250000, streak: 1, longestStreak: 2, lastSolvedDay: today() });
const account: AccountStats = { solved: 5, totalMs: 0, averageMs: null, bestMs: null, streak: 0, longestStreak: 0, lastSolvedDay: null, imported: 0 };
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
const input = (card: HTMLElement, name: string): HTMLInputElement => card.querySelector(`input[name="${name}"]`) as HTMLInputElement;
const type = (el: HTMLInputElement, value: string): void => {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const button = (card: HTMLElement): HTMLButtonElement => card.querySelector('button') as HTMLButtonElement;
const preview = (card: HTMLElement): HTMLElement => card.querySelector('.preview') as HTMLElement;

async function build(stats: Stats | null = device()): Promise<{ card: HTMLElement; authLost: ReturnType<typeof vi.fn> }> {
  if (stats) localStorage.setItem('aglow.stats', JSON.stringify(stats));
  const authLost = vi.fn();
  const card = historyCard({ authLost });
  document.body.replaceChildren(card);
  await flush();
  return { card, authLost };
}

beforeEach(() => {
  localStorage.clear();
  calls.stats.mockReset().mockResolvedValue(account);
  calls.importHistory.mockReset();
});

describe('the import card', () => {
  it('has nothing to import without saved games, and calls nothing', async () => {
    const { card } = await build(null);
    expect(card.textContent).toContain('This browser has no saved games to import.');
    expect(card.querySelector('form')).toBeNull();
    expect(calls.stats).not.toHaveBeenCalled();
  });

  it('fills the form from the device and previews what will be created, before anything is sent', async () => {
    const { card } = await build();
    expect(input(card, 'solved').value).toBe('3');
    expect(input(card, 'best').value).toBe('50:00');
    expect(input(card, 'average').value).toBe('51:40.0');
    expect(preview(card).textContent).toBe(`Will add 3 runs: best 50:00.0, average 51:40.0, streak 1 day, longest streak 2 days, last played ${today()}.`);
    expect(button(card).textContent).toBe('Import 3 runs');
    expect(card.textContent).toContain('Your account already has 5 played games.');
    expect(calls.importHistory).not.toHaveBeenCalled();
  });

  it('follows edits: the preview and the button change with the numbers', async () => {
    const { card } = await build();
    type(input(card, 'solved'), '2');
    type(input(card, 'best'), '45:00');
    type(input(card, 'longest'), '4');
    expect(preview(card).textContent).toContain('Will add 2 runs: best 45:00.0, average 51:40.0, streak 1 day, longest streak 4 days');
    expect(button(card).textContent).toBe('Import 2 runs');
  });

  it('says what is wrong instead of previewing, and does not send', async () => {
    const { card } = await build();
    type(input(card, 'average'), '40:00.0');
    expect(preview(card).textContent).toBe("Average time can't be faster than the best time.");
    expect(preview(card).classList.contains('bad')).toBe(true);
    expect(button(card).disabled).toBe(true);
    card.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(calls.importHistory).not.toHaveBeenCalled();
    type(input(card, 'average'), '51:40.0');
    expect(button(card).disabled).toBe(false);
    expect(preview(card).classList.contains('bad')).toBe(false);
  });

  it('imports once: sends the typed numbers under a saved id, then stays done', async () => {
    calls.importHistory.mockResolvedValue({ added: 3, already: false, streak: 1, longestStreak: 2, clamped: false });
    const { card } = await build();
    button(card).click();
    await flush();
    const body = calls.importHistory.mock.calls[0][0];
    expect(body).toMatchObject({ solved: 3, bestSeconds: 3000, averageMs: 3_100_000, streak: 1, longestStreak: 2, lastSolvedDay: today() });
    expect(JSON.parse(localStorage.getItem('aglow.historyImport') as string)).toEqual({ v: 1, importId: body.importId, done: true, added: 3 });
    expect(card.querySelector('[role=status]')?.textContent).toBe('Imported 3 runs from this device.');
    expect(button(card).textContent).toBe('Imported');
    expect(button(card).disabled).toBe(true);
    expect(input(card, 'solved').disabled).toBe(true);
    expect(preview(card).hidden).toBe(true);
  });

  it('reports clamped streaks and an already-imported device', async () => {
    calls.importHistory.mockResolvedValueOnce({ added: 3, already: false, streak: 1, longestStreak: 1, clamped: true });
    const first = await build();
    button(first.card).click();
    await flush();
    expect(first.card.querySelector('[role=status]')?.textContent).toBe("Imported 3 runs from this device. The streaks didn't fit between Sep 29 and the last solved day, so they were placed as 1 and 1 days.");

    localStorage.clear();
    calls.importHistory.mockResolvedValueOnce({ added: 0, already: true, streak: 1, longestStreak: 2, clamped: false });
    const second = await build();
    button(second.card).click();
    await flush();
    expect(second.card.querySelector('[role=status]')?.textContent).toBe("This device's history was already imported.");
  });

  it('stays imported on a later visit', async () => {
    localStorage.setItem('aglow.historyImport', JSON.stringify({ v: 1, importId: 'AbCdEfGhIjKlMnOpQrStUv', done: true, added: 3 }));
    const { card } = await build();
    expect(card.querySelector('[role=status]')?.textContent).toBe("This device's history was imported (3 runs).");
    expect(button(card).disabled).toBe(true);
    expect(button(card).textContent).toBe('Imported');
  });

  it('keeps the id after a failure, so the resend reuses it, and shows the error', async () => {
    calls.importHistory.mockRejectedValueOnce(new ApiError(0, "Couldn't reach the server. Check the connection and try again."));
    const { card } = await build();
    button(card).click();
    await flush();
    expect(card.querySelector('.err')?.textContent).toBe("Couldn't reach the server. Check the connection and try again.");
    expect(button(card).disabled).toBe(false);
    const id = calls.importHistory.mock.calls[0][0].importId;
    calls.importHistory.mockResolvedValueOnce({ added: 3, already: false, streak: 1, longestStreak: 2, clamped: false });
    button(card).click();
    await flush();
    expect(calls.importHistory.mock.calls[1][0].importId).toBe(id);
  });

  it('hands a 401 or 403 to the page', async () => {
    const e = new ApiError(403, 'This account is not the radio admin.');
    calls.importHistory.mockRejectedValueOnce(e);
    const { card, authLost } = await build();
    button(card).click();
    await flush();
    expect(authLost).toHaveBeenCalledWith(e);
    expect(card.querySelector('.err')?.textContent).toBe('');
  });

  it('a failed account line is only a hint, never the page', async () => {
    calls.stats.mockRejectedValue(new ApiError(401, 'Sign in first.'));
    const { card, authLost } = await build();
    expect(card.textContent).toContain("Couldn't load your account's games. The import still works.");
    expect(authLost).not.toHaveBeenCalled();
  });

  it('counts imported runs separately in the account line', async () => {
    calls.stats.mockResolvedValue({ ...account, solved: 45, imported: 40 });
    const { card } = await build();
    expect(card.textContent).toContain('Your account already has 5 played games and 40 imported runs.');
  });
});
