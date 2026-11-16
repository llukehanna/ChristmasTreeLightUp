import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { asPlayer, fromMenu, game, onlineTree, openAccount, pickName, ready, resumeIfPaused, signInFromMenu, solveByTapping } from './helpers';

test.describe.configure({ timeout: 120_000 });

test("the menu's account row signs in with (fake) Google, asks for a name once, then shows it", async ({ page }) => {
  const player = await asPlayer(page);
  await ready(page);
  const chip = page.locator('#account-row');
  await expect(chip).toHaveAttribute('aria-label', 'Sign in');
  await openAccount(page);
  const card = page.getByRole('dialog', { name: 'Sign in' });
  await expect(card).toContainText('Your name on the leaderboard is the one you pick. We never show your email.');
  await expect(card.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
  await card.getByRole('link', { name: 'Continue with Google' }).click();
  await page.waitForURL(/\/\?test$/);
  await pickName(page, player.name);
  await expect(chip).toHaveAttribute('aria-label', `Account: ${player.name}`);
});

test('the menu opens the leaderboard, with Career beside it in its switch; Escape closes the sheet', async ({ page }) => {
  const player = await asPlayer(page);
  await ready(page);
  await signInFromMenu(page);
  await pickName(page, player.name);
  await resumeIfPaused(page);
  await fromMenu(page, 'board-row');
  const board = page.getByRole('dialog', { name: 'Leaderboard' });
  await expect(board).toBeVisible();
  await expect(board.getByRole('button', { name: 'Leaderboard' })).toHaveAttribute('aria-current', 'page');
  await expect(board.getByRole('button', { name: 'Career' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(board).toBeHidden();
});

test('the name card checks as you type: too short, reserved, taken by a look-alike, then available', async ({ page }) => {
  const first = await asPlayer(page);
  await ready(page);
  await signInFromMenu(page);
  await pickName(page, first.name);
  await resumeIfPaused(page);
  // Sign out from the menu, then come back as another Google account.
  await openAccount(page);
  await page.getByRole('dialog', { name: 'Account' }).getByRole('button', { name: 'Sign out' }).click();
  await expect(page.locator('#account-row')).toHaveAttribute('aria-label', 'Sign in');
  await expect(page.locator('#toast')).toHaveText('Signed out');
  const second = await asPlayer(page);
  await page.evaluate(() => sessionStorage.clear());
  await signInFromMenu(page);
  const card = page.getByRole('dialog', { name: 'Pick a display name' });
  const field = card.getByLabel('Display name');
  const line = card.locator('.acct-check');
  const save = card.getByRole('button', { name: 'Save name' });
  await field.fill('ab');
  await expect(line).toHaveText('At least 3 characters');
  await expect(save).toBeDisabled();
  await field.fill('Santa');
  await expect(line).toHaveText('That name is reserved');
  await expect(save).toBeDisabled();
  await field.fill(` ${first.name.toUpperCase()} `);
  await expect(line).toHaveText(`“${first.name.toUpperCase()}” is taken. Try another.`);
  await expect(save).toBeDisabled();
  await field.fill(second.name);
  await expect(line).toHaveText(`“${second.name}” is available`);
  await field.press('Enter');
  await expect(card).toBeHidden();
  await expect(page.locator('#toast')).toHaveText(`Welcome, ${second.name}`);
  await expect(page.locator('#account-row')).toHaveAttribute('aria-label', `Account: ${second.name}`);
});

test('the account page goes back to the menu on Escape, and a second Escape closes the menu without pausing', async ({ page }) => {
  const player = await asPlayer(page);
  await ready(page);
  await signInFromMenu(page);
  await pickName(page, player.name);
  await resumeIfPaused(page);
  await openAccount(page);
  const account = page.getByRole('dialog', { name: 'Account' });
  await expect(account).toBeVisible();
  await expect(page.locator('#menu')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(account).toBeHidden();
  await expect(page.locator('#menu')).toBeVisible();
  await expect(page.locator('#account-row')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#menu')).toBeHidden();
  await expect(page.locator('body')).not.toHaveClass(/\bpaused\b/);
});

test('a sheet pauses the game in progress, keeps Tab inside, and Escape hands focus to the pause overlay', async ({ page }) => {
  await ready(page);
  await expect(page.locator('#pause-btn')).toBeVisible();
  await openAccount(page);
  const card = page.getByRole('dialog', { name: 'Sign in' });
  await expect(card).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/paused/);
  await expect(card.getByRole('link', { name: 'Continue with Google' })).toBeFocused();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('#account-sheet'))).toBe(true);
  }
  // P belongs to the sheet while it is open: the game stays paused.
  await page.keyboard.press('p');
  await expect(page.locator('body')).toHaveClass(/paused/);
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await expect(page.locator('#pause')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#pause')).toBeHidden();
});

test('?auth=failed: a toast says sign-in did not finish, and the address drops the parameter', async ({ page }) => {
  await page.goto('/?test&auth=failed');
  await expect(page.locator('#toast')).toHaveText("Sign-in didn't finish. Try again.");
  expect(new URL(page.url()).search).toBe('?test');
});

test('delete account: typing the name enables Delete; the account goes, the row reads Sign in, and a toast says so', async ({ page }) => {
  const player = await asPlayer(page);
  await ready(page);
  await signInFromMenu(page);
  await pickName(page, player.name);
  await resumeIfPaused(page);
  await openAccount(page);
  await page.getByRole('dialog', { name: 'Account' }).getByRole('button', { name: 'Delete account' }).click();
  const card = page.getByRole('dialog', { name: 'Delete account' });
  const field = card.getByLabel(`Type your name, ${player.name}, to confirm`);
  await expect(field).toBeFocused();
  const go = card.getByRole('button', { name: 'Delete account' });
  await field.fill('not my name');
  await expect(go).toBeDisabled();
  await field.fill(player.name.toUpperCase());
  await go.click();
  await expect(card).toBeHidden();
  await expect(page.locator('#toast')).toHaveText('Account deleted');
  await expect(page.locator('#account-row')).toHaveAttribute('aria-label', 'Sign in');
  // The session went with the account.
  expect(await page.evaluate(() => fetch('/api/me').then((r) => r.json()))).toEqual({ user: null });
});

test('delete account before a name: a wrong email is refused inline, the right one deletes', async ({ page }) => {
  const player = await asPlayer(page);
  await ready(page);
  await signInFromMenu(page);
  await page.getByRole('dialog', { name: 'Pick a display name' }).waitFor();
  await page.keyboard.press('Escape');
  await resumeIfPaused(page);
  const chip = page.locator('#account-row');
  await expect(chip).toHaveAttribute('aria-label', 'Account');
  await openAccount(page);
  await page.getByRole('dialog', { name: 'Account' }).getByRole('button', { name: 'Delete account' }).click();
  const card = page.getByRole('dialog', { name: 'Delete account' });
  const field = card.getByLabel('Type the email of your Google account to confirm');
  await field.fill('someone.else@example.com');
  await card.getByRole('button', { name: 'Delete account' }).click();
  await expect(card.locator('.acct-check')).toHaveText("That doesn't match. Type it exactly as shown.");
  await expect(card).toBeVisible();
  await field.fill(player.email);
  await card.getByRole('button', { name: 'Delete account' }).click();
  await expect(card).toBeHidden();
  await expect(page.locator('#toast')).toHaveText('Account deleted');
  await expect(chip).toHaveAttribute('aria-label', 'Sign in');
});

test('the admin sees Radio admin in the account menu; a player does not', async ({ page }) => {
  await page.context().addCookies([{ name: 'aglow_fake_as', value: 'admin@example.com', url: 'http://localhost:4173' }]);
  await ready(page);
  await signInFromMenu(page);
  // The admin may have picked a name in another test; without one ("Account" alone), the name card opens with the chip.
  const chip = page.locator('#account-row');
  await expect(chip).toHaveAttribute('aria-label', /^Account/);
  const nameCard = page.getByRole('dialog', { name: 'Pick a display name' });
  if ((await chip.getAttribute('aria-label')) === 'Account') {
    await nameCard.waitFor();
    await page.keyboard.press('Escape');
  }
  await expect(nameCard).toBeHidden();
  await resumeIfPaused(page);
  await openAccount(page);
  const menu = page.getByRole('dialog', { name: 'Account' });
  await expect(menu.getByRole('link', { name: 'Radio admin' })).toHaveAttribute('href', '/admin');
  await page.keyboard.press('Escape');

  // Another Google account, signed in afresh.
  await page.context().clearCookies();
  await asPlayer(page);
  await page.reload();
  await expect(page.locator('#account-row')).toHaveAttribute('aria-label', 'Sign in');
  await page.evaluate(() => sessionStorage.clear());
  await signInFromMenu(page);
  await page.getByRole('dialog', { name: 'Pick a display name' }).waitFor();
  await page.keyboard.press('Escape');
  await resumeIfPaused(page);
  await openAccount(page);
  await expect(menu.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Radio admin' })).toHaveCount(0);
});

test('play signed out, Save to leaderboard: sign in, pick a name, and the run is on the board', async ({ page }) => {
  const player = await asPlayer(page);
  await ready(page);
  await onlineTree(page);
  await solveByTapping(page);
  const results = page.locator('#results');
  await expect(results).toBeVisible({ timeout: 15_000 });
  await expect(results.locator('.rib-line')).toHaveText(/^Would place #\d+ of [\d,]+ runs?$/);
  // The tag itself reads as before.
  await expect(results.locator('#r-time')).toHaveText(/^Lit in \d+:\d\d$/);
  await expect(results.locator('#r-score')).toHaveCount(0);
  await results.getByRole('button', { name: 'Save to leaderboard' }).click();
  const card = page.getByRole('dialog', { name: 'Sign in' });
  await expect(card).toContainText(/Your \d+:\d\d\.\d is waiting on this device\./);
  // Back from Google, /api/me answers slowly: the tag says "Saving…", never a flash of "Save to leaderboard".
  let releaseMe = (): void => {};
  const meHeld = new Promise<void>((r) => (releaseMe = r));
  await page.route(
    (url) => url.pathname === '/api/me',
    async (route) => {
      await meHeld;
      await route.fallback();
    },
  );
  await card.getByRole('link', { name: 'Continue with Google' }).click();
  // Back from (fake) Google on the same results tag, asked for a name; naming claims the run.
  await page.waitForURL(/\/\?test$/);
  await expect(results).toBeVisible({ timeout: 15_000 });
  await expect(results.locator('.rib-line')).toHaveText('Saving your time…');
  await expect(results.locator('.rib-ribbon')).toHaveCount(0);
  releaseMe();
  await pickName(page, player.name);
  await expect(results).toBeVisible({ timeout: 15_000 });
  await expect(results.locator('.rib-line')).toHaveText(/^#\d+ of [\d,]+ runs? · New personal best!$/, { timeout: 15_000 });
  await expect(results.locator('.rib-ribbon')).toHaveCount(0);
  const rosette = results.getByRole('button', { name: /^Rank \d+ of \d+: open the leaderboard$/ });
  const [, rank, total] = /^Rank (\d+) of (\d+)/.exec((await rosette.getAttribute('aria-label')) ?? '') ?? [];
  await rosette.click();
  const board = page.getByRole('dialog', { name: 'Leaderboard' });
  await expect(board.locator('.acct-row.acct-me')).toContainText(player.name);
  // The rosette's numbers are all-time ones, so it opens All time, at the same place, without making it the remembered window.
  await expect(board.getByRole('group', { name: 'Time window' }).getByRole('button', { name: 'All time', pressed: true })).toBeVisible();
  // Another project's run can land between the rosette and the board: the board's total is at least the rosette's, and
  // this run's rank moves down by at most the runs that landed in between.
  const sub = board.locator('.acct-sub');
  await expect(sub).toHaveText(/^All-time · [\d,]+ ranked runs?$/);
  const boardTotal = Number((/([\d,]+) ranked/.exec((await sub.textContent()) ?? '')?.[1] ?? '').replaceAll(',', ''));
  expect(boardTotal).toBeGreaterThanOrEqual(Number(total));
  const boardRank = Number(await board.locator('.acct-me .acct-rank').first().textContent());
  expect(boardRank).toBeGreaterThanOrEqual(Number(rank));
  expect(boardRank).toBeLessThanOrEqual(Number(rank) + boardTotal - Number(total));
  expect(await page.evaluate(() => localStorage.getItem('aglow.boardWindow'))).toBeNull();
});

test('paused more than 20 times: the tag says "Unranked: paused too long" under a grey rosette', async ({ page }) => {
  await ready(page);
  const id = await onlineTree(page);
  await expect(page.locator('#pause-btn')).toBeVisible();
  for (let i = 0; i < 21; i++) {
    await page.keyboard.press('p');
    await expect(page.locator('#pause')).toBeVisible();
    await page.keyboard.press('p');
    await expect(page.locator('#pause')).toBeHidden();
  }
  await solveByTapping(page);
  await expect.poll(() => game(page), { timeout: 15_000 }).toMatchObject({ id, outcome: 'done', reason: 'paused', ranked: false });
  const results = page.locator('#results');
  await expect(results).toBeVisible({ timeout: 15_000 });
  await expect(results.locator('.rib-line')).toHaveText('Unranked: paused too long');
  await expect(results.getByRole('img', { name: 'Unranked' })).toBeVisible();
  await expect(results.getByRole('button', { name: 'Unranked' })).toHaveCount(0);
  // The device's best pill would contradict the grey rosette: it steps aside.
  await expect(results.locator('#r-badge')).toBeHidden();
  await expect(results.locator('.rib-ribbon')).toHaveCount(0);
});

test("a finish that never reaches the server: Couldn't save this run, and a late Retry saves it, unranked (clock)", async ({ page }) => {
  let down = true;
  await page.route('**/api/games/*/finish', (route) => (down ? route.abort() : route.fallback()));
  await ready(page);
  await onlineTree(page);
  await solveByTapping(page);
  const results = page.locator('#results');
  await expect(results).toBeVisible({ timeout: 15_000 });
  await expect(results.locator('.rib-line')).toHaveText("Couldn't save this run. Retry", { timeout: 15_000 });
  down = false;
  // A finish arriving over 3 s after the win is kept but unranked, by design (the judge's clock tolerance): wait past
  // it, so the verdict is always the same.
  await page.waitForTimeout(3500);
  await results.getByRole('button', { name: 'Retry' }).click();
  await expect(results.locator('.rib-line')).toHaveText('Saved, unranked: reached the server too late');
  await expect.poll(() => game(page)).toMatchObject({ outcome: 'done', reason: 'clock', ranked: false });
  await expect(results.getByRole('img', { name: 'Unranked' })).toBeVisible();
});

test('a claim that fails after naming offers Retry, and Retry ranks the run', async ({ page }) => {
  const player = await asPlayer(page);
  let fails = 1;
  await page.route('**/api/games/claim', (route) => (fails-- > 0 ? route.abort() : route.fallback()));
  await ready(page);
  await onlineTree(page);
  await solveByTapping(page);
  const results = page.locator('#results');
  await expect(results.locator('.rib-line')).toHaveText(/^Would place #/, { timeout: 15_000 });
  await results.getByRole('button', { name: 'Save to leaderboard' }).click();
  await page.getByRole('dialog', { name: 'Sign in' }).getByRole('link', { name: 'Continue with Google' }).click();
  await page.waitForURL(/\/\?test$/);
  await pickName(page, player.name);
  await expect(results.locator('.rib-line')).toHaveText("Couldn't save this run. Retry", { timeout: 15_000 });
  await results.getByRole('button', { name: 'Retry' }).click();
  await expect(results.locator('.rib-line')).toHaveText(/^#\d+ of [\d,]+ runs? · New personal best!$/, { timeout: 15_000 });
  await expect(results.getByRole('button', { name: /^Rank \d+ of \d+: open the leaderboard$/ })).toBeVisible();
});

/** The sign-in round trip for a run finished signed out: Save to leaderboard, Google, a name. */
async function saveFromTag(page: Page, name: string): Promise<void> {
  const results = page.locator('#results');
  await expect(results.locator('.rib-line')).toHaveText(/^Would place #/, { timeout: 15_000 });
  await results.getByRole('button', { name: 'Save to leaderboard' }).click();
  await page.getByRole('dialog', { name: 'Sign in' }).getByRole('link', { name: 'Continue with Google' }).click();
  await page.waitForURL(/\/\?test$/);
  await pickName(page, name);
}

test('a claim that failed on an earlier batch offers Retry (never "Saving…" for ever), and Retry ranks the run', async ({ page }) => {
  const player = await asPlayer(page);
  let fails = 1;
  await page.route('**/api/games/claim', (route) => (fails-- > 0 ? route.abort() : route.fallback()));
  await ready(page);
  await onlineTree(page);
  await solveByTapping(page);
  const results = page.locator('#results');
  await expect(results.locator('.rib-line')).toHaveText(/^Would place #/, { timeout: 15_000 });
  // Nine older claims on this browser ahead of this run's: the first batch of eight is the one that fails.
  await page.evaluate(() => {
    const older = Array.from({ length: 9 }, (_, i) => ({ id: `older-game-${String(i).padStart(2, '0')}-padding`, claim: 'x', at: Date.now() - 1000 - i }));
    const mine = JSON.parse(localStorage.getItem('aglow.claims') ?? '[]') as unknown[];
    localStorage.setItem('aglow.claims', JSON.stringify([...older, ...mine]));
  });
  await saveFromTag(page, player.name);
  await expect(results.locator('.rib-line')).toHaveText("Couldn't save this run. Retry", { timeout: 15_000 });
  await results.getByRole('button', { name: 'Retry' }).click();
  await expect(results.locator('.rib-line')).toHaveText(/^#\d+ of [\d,]+ runs? · New personal best!$/, { timeout: 15_000 });
});

test('a claim another tab already took out of storage ends as "Saved to your career", not "Saving…"', async ({ page }) => {
  const player = await asPlayer(page);
  await ready(page);
  await onlineTree(page);
  await solveByTapping(page);
  const results = page.locator('#results');
  await expect(results.locator('.rib-line')).toHaveText(/^Would place #/, { timeout: 15_000 });
  await page.evaluate(() => localStorage.removeItem('aglow.claims'));
  await saveFromTag(page, player.name);
  await expect(results.locator('.rib-line')).toHaveText('Saved to your career', { timeout: 15_000 });
});

test('a finish whose automatic retry lands past the clock tolerance says "reached the server too late"', async ({ page }) => {
  let first = true;
  await page.route('**/api/games/*/finish', async (route) => {
    if (!first) return route.fallback();
    first = false;
    // The first attempt fails after 4 s, so the retry (0.8 s later) lands well over the 3 s tolerance.
    await new Promise((r) => setTimeout(r, 4000));
    await route.abort();
  });
  await ready(page);
  await onlineTree(page);
  await solveByTapping(page);
  await expect(page.locator('#results .rib-line')).toHaveText('Saved, unranked: reached the server too late', { timeout: 20_000 });
});

test('two runs by the same player both appear in the career', async ({ page }) => {
  const player = await asPlayer(page);
  await ready(page);
  await signInFromMenu(page);
  await pickName(page, player.name);
  await resumeIfPaused(page);
  for (let run = 0; run < 2; run++) {
    if (run) await page.locator('#r-new').click();
    await onlineTree(page);
    await solveByTapping(page);
    await expect(page.locator('#results .rib-line')).toHaveText(/^#\d+ of [\d,]+ runs? · /, { timeout: 15_000 });
  }
  // The career, not the shared top 50: other tests' players can push these two runs off the board.
  await fromMenu(page, 'career-row');
  await expect(page.getByRole('dialog', { name: 'Your career' }).locator('#career-log tbody tr')).toHaveCount(2);
  const mine = await page.request.get('/api/me/career');
  expect(((await mine.json()) as { runs: unknown[] }).runs).toHaveLength(2);
});

/**
 * A browser in American Samoa (UTC-11, no daylight saving, getTimezoneOffset 660): its local date is always the
 * server's UTC date or the day before, so its next local midnight is a "today" the Worker still accepts (within a day
 * of its own), and that day starts after every run on the board.
 */
const SAMOA_MS = 11 * 3_600_000;
const samoaDay = (at: number): number => Math.floor((at - SAMOA_MS) / 86_400_000);
test.describe('board windows', () => {
  test.use({ timezoneId: 'Pacific/Pago_Pago' });

  test('the leaderboard opens on Today; This week and All time show their own runs, and the choice is remembered', async ({ page }) => {
    const player = await asPlayer(page);
    await ready(page);
    await signInFromMenu(page);
    await pickName(page, player.name);
    await resumeIfPaused(page);
    await onlineTree(page);
    await solveByTapping(page);
    await expect(page.locator('#results .rib-line')).toHaveText(/^#\d+ of [\d,]+ runs? · /, { timeout: 15_000 });
    const openBoard = async () => {
      await resumeIfPaused(page);
      await fromMenu(page, 'board-row');
      return page.getByRole('dialog', { name: 'Leaderboard' });
    };
    let board = await openBoard();
    const windows = board.getByRole('group', { name: 'Time window' });
    await expect(windows.getByRole('button', { name: 'Today', pressed: true })).toBeVisible();
    await expect(board.locator('.acct-sub')).toHaveText(/^Today · [\d,]+ ranked runs?$/);
    // Just finished: in today's list (or pinned below it, if others' runs today push it past the top 50).
    await expect(board.locator('.acct-me .acct-nm').first()).toHaveText(player.name);
    await page.keyboard.press('Escape');
    // A minute into the next local day: the run (and every other on the board) finished before today began here, so
    // Today is empty. This week has the run unless the new day is a Monday; All time always has it.
    const [[, finishedAt]] = ((await (await page.request.get('/api/me/career')).json()) as { runs: [string, number][] }).runs;
    const view = (samoaDay(Date.now()) + 1) * 86_400_000 + SAMOA_MS + 60_000;
    await page.clock.setFixedTime(view);
    const viewDay = samoaDay(view);
    const inWeek = samoaDay(finishedAt) >= viewDay - ((viewDay + 3) % 7); // on or after this week's Monday
    board = await openBoard();
    await expect(board.locator('.acct-sub')).toHaveText('Today · 0 ranked runs');
    await expect(board.locator('.acct-body')).toHaveText('No runs yet today — be the first.');
    await expect(board.locator('.acct-pin .acct-me')).toHaveCount(0);
    await windows.getByRole('button', { name: 'This week' }).click();
    await expect(windows.getByRole('button', { name: 'This week', pressed: true })).toBeFocused();
    if (inWeek) {
      await expect(board.locator('.acct-sub')).toHaveText(/^This week · [\d,]+ ranked runs?$/);
      await expect(board.locator('.acct-me .acct-nm').first()).toHaveText(player.name);
    } else {
      await expect(board.locator('.acct-sub')).toHaveText('This week · 0 ranked runs');
      await expect(board.locator('.acct-body')).toHaveText('No runs yet this week.');
    }
    await windows.getByRole('button', { name: 'All time' }).click();
    await expect(board.locator('.acct-sub')).toHaveText(/^All-time · [\d,]+ ranked runs?$/);
    await expect(board.locator('.acct-me .acct-nm').first()).toHaveText(player.name);
    await page.keyboard.press('Escape');
    board = await openBoard();
    await expect(windows.getByRole('button', { name: 'All time', pressed: true })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('aglow.boardWindow'))).toBe('all');
  });
});

/** This device has a history of its own from before accounts: 7 solved and a 10-day streak up to yesterday. */
async function seedDeviceHistory(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('aglow.stats')) return;
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const yesterday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    localStorage.setItem('aglow.stats', JSON.stringify({ v: 1, solved: 7, totalSeconds: 700, bestSeconds: 60, bestScore: 44000, streak: 10, longestStreak: 10, lastSolvedDay: yesterday }));
  });
}

test("signed in with a history on this device, the tag adds it to the account's numbers", async ({ page }) => {
  const player = await asPlayer(page);
  await seedDeviceHistory(page);
  await ready(page);
  await signInFromMenu(page);
  await pickName(page, player.name);
  await resumeIfPaused(page);
  await onlineTree(page);
  await solveByTapping(page);
  const results = page.locator('#results');
  await expect(results.locator('.rib-line')).toHaveText(/^#\d+ of [\d,]+ runs? · /, { timeout: 15_000 });
  // The device had 8 at its first signed-in view (its 7 and this win); the account holds this one game. Nothing drops
  // on sign-in: Solved is 8 + 1 (this win is in both, which is accepted) and the device's live 11-day streak shows.
  await expect(results.locator('#r-solved')).toHaveText('9');
  await expect(results.locator('#r-streak')).toHaveText('11');
  const baseline = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('aglow.statsBaseline') ?? '{}') as Record<string, { solved: number }>).map((b) => b.solved));
  expect(baseline).toEqual([8]);
  // The device still records its own.
  expect(await page.evaluate(() => (JSON.parse(localStorage.getItem('aglow.stats') ?? '{}') as { solved?: number }).solved)).toBe(8);
});

test("an account that imported its history shows its own numbers, with no device baseline", async ({ page }) => {
  const player = await asPlayer(page);
  await seedDeviceHistory(page);
  // The account holds 312 games, 300 of them imported (the admin's case): the device's history is in them already.
  await page.route(
    (url) => url.pathname === '/api/me/stats',
    (route) =>
      route.fulfill({
        json: { userId: 4242, solved: 312, totalMs: 312 * 78_456, averageMs: 78_456, bestMs: 41_000, streak: 4, longestStreak: 7, lastSolvedDay: '2026-10-08', imported: 300 },
        headers: { 'Cache-Control': 'no-store' },
      }),
  );
  await ready(page);
  await signInFromMenu(page);
  await pickName(page, player.name);
  await resumeIfPaused(page);
  await onlineTree(page);
  await solveByTapping(page);
  const results = page.locator('#results');
  await expect(results.locator('.rib-line')).toHaveText(/^#\d+ of [\d,]+ runs? · /, { timeout: 15_000 });
  await expect(results.locator('#r-solved')).toHaveText('312');
  await expect(results.locator('#r-avg')).toHaveText('1:18');
  await expect(results.locator('#r-streak')).toHaveText('4');
  expect(await page.evaluate(() => localStorage.getItem('aglow.statsBaseline'))).toBeNull();
});

test("a baseline is kept per account and never overwritten, so another account's stays put", async ({ page }) => {
  const player = await asPlayer(page);
  await seedDeviceHistory(page);
  await page.addInitScript(() => {
    if (!localStorage.getItem('aglow.statsBaseline')) localStorage.setItem('aglow.statsBaseline', JSON.stringify({ '1': { solved: 999, totalSeconds: 5, at: 1 } }));
  });
  // 312 played games on the account, none imported, from another device.
  await page.route(
    (url) => url.pathname === '/api/me/stats',
    (route) =>
      route.fulfill({
        json: { userId: 4242, solved: 312, totalMs: 312 * 100_000, averageMs: 100_000, bestMs: 41_000, streak: 4, longestStreak: 7, lastSolvedDay: '2026-10-08', imported: 0 },
        headers: { 'Cache-Control': 'no-store' },
      }),
  );
  await ready(page);
  await signInFromMenu(page);
  await pickName(page, player.name);
  await resumeIfPaused(page);
  await onlineTree(page);
  await solveByTapping(page);
  const results = page.locator('#results');
  await expect(results.locator('.rib-line')).toHaveText(/^#\d+ of [\d,]+ runs? · /, { timeout: 15_000 });
  await expect(results.locator('#r-solved')).toHaveText('320'); // 312 + the device's 8
  await expect(results.locator('#r-streak')).toHaveText('11'); // the device's live streak beats the account's 4
  const kept = await page.evaluate(() => Object.fromEntries(Object.entries(JSON.parse(localStorage.getItem('aglow.statsBaseline') ?? '{}') as Record<string, { solved: number }>).map(([k, v]) => [k, v.solved])));
  expect(kept).toEqual({ '1': 999, '4242': 8 });
});

test("signed in but the stats can't be read: the tag keeps this device's numbers", async ({ page }) => {
  const player = await asPlayer(page);
  await seedDeviceHistory(page);
  await page.route(
    (url) => url.pathname === '/api/me/stats',
    (route) => route.abort(),
  );
  await ready(page);
  await signInFromMenu(page);
  await pickName(page, player.name);
  await resumeIfPaused(page);
  await onlineTree(page);
  // The stats call is made after the win; the tag's fallback only means something once it has actually failed.
  const failed = page.waitForEvent('requestfailed', (r) => new URL(r.url()).pathname === '/api/me/stats');
  await solveByTapping(page);
  const results = page.locator('#results');
  await expect(results.locator('.rib-line')).toHaveText(/^#\d+ of [\d,]+ runs? · /, { timeout: 15_000 });
  await failed;
  await expect(results.locator('#r-solved')).toHaveText('8');
  await expect(results.locator('#r-streak')).toHaveText('11');
});

test('the settings menu links to the privacy page', async ({ page }) => {
  await ready(page);
  await page.locator('#menu-btn').click();
  await expect(page.getByRole('dialog', { name: 'Settings' }).getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
});

test('the privacy page says what is stored, why, for how long, and how to delete it', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: 'Privacy', level: 1 })).toBeVisible();
  for (const text of ['Google account ID and email address', 'display name', 'log of your taps and pauses', 'keyed hash of your IP address', '90 days', '365 days', 'up to 7 days', 'up to 30 days', 'Spotify or Apple', 'Delete account']) {
    await expect(page.locator('main')).toContainText(text);
  }
  // Phone width included: no sideways scroll.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('a tree the server never started: "Unranked: offline" on the tag', async ({ page }) => {
  await page.route('**/api/games', (route) => route.abort());
  await ready(page);
  await solveByTapping(page);
  const results = page.locator('#results');
  await expect(results).toBeVisible({ timeout: 15_000 });
  await expect(results.locator('.rib-line')).toHaveText('Unranked: offline');
  await expect(results.locator('.rib-ribbon')).toHaveCount(0);
});
