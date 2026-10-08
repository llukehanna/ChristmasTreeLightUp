import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { asPlayer, game, onlineTree, pickName, ready, resumeIfPaused, signInFromChip, solveByTapping } from './helpers';

test.describe.configure({ timeout: 120_000 });

test('the HUD chip signs in with (fake) Google, asks for a name once, then shows it', async ({ page }) => {
  const player = await asPlayer(page);
  await ready(page);
  const chip = page.locator('#account-chip');
  await expect(chip).toHaveAccessibleName('Sign in');
  await chip.click();
  const card = page.getByRole('dialog', { name: 'Sign in' });
  await expect(card).toContainText('Your name on the leaderboard is the one you pick. We never show your email.');
  await expect(card.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy');
  await card.getByRole('link', { name: 'Continue with Google' }).click();
  await page.waitForURL(/\/\?test$/);
  await pickName(page, player.name);
  await expect(chip).toHaveAccessibleName(`Account: ${player.name}`);
});

test('the account menu opens the leaderboard and Your games; Escape closes the sheet', async ({ page }) => {
  const player = await asPlayer(page);
  await ready(page);
  await signInFromChip(page);
  await pickName(page, player.name);
  await resumeIfPaused(page);
  await page.locator('#account-chip').click();
  await page.getByRole('dialog', { name: 'Account' }).getByRole('button', { name: 'Leaderboard' }).click();
  const board = page.getByRole('dialog', { name: 'Leaderboard' });
  await expect(board).toBeVisible();
  await board.getByRole('tab', { name: 'Your games' }).click();
  const games = page.getByRole('dialog', { name: 'Your games' });
  await expect(games).toContainText('No games yet. Light a tree to see it here.');
  // The tabs answer the arrow keys, and focus stays on the selected tab across the re-render.
  await expect(games.getByRole('tab', { name: 'Your games' })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(board.getByRole('tab', { name: 'Leaderboard', selected: true })).toBeFocused();
  await expect(board.getByRole('tabpanel')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(games.getByRole('tab', { name: 'Your games', selected: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(games).toBeHidden();
});

test('the name card checks as you type: too short, reserved, taken by a look-alike, then available', async ({ page }) => {
  const first = await asPlayer(page);
  await ready(page);
  await signInFromChip(page);
  await pickName(page, first.name);
  await resumeIfPaused(page);
  // Sign out from the menu, then come back as another Google account.
  await page.locator('#account-chip').click();
  await page.getByRole('dialog', { name: 'Account' }).getByRole('button', { name: 'Sign out' }).click();
  await expect(page.locator('#account-chip')).toHaveAccessibleName('Sign in');
  await expect(page.locator('#toast')).toHaveText('Signed out');
  const second = await asPlayer(page);
  await page.evaluate(() => sessionStorage.clear());
  await signInFromChip(page);
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
  await expect(page.locator('#account-chip')).toHaveAccessibleName(`Account: ${second.name}`);
});

test('a sheet pauses the game in progress, keeps Tab inside, and Escape hands focus to the pause overlay', async ({ page }) => {
  await ready(page);
  await expect(page.locator('#pause-btn')).toBeVisible();
  await page.locator('#account-chip').click();
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

test('delete account: typing the name enables Delete; the account goes, the chip signs out, and a toast says so', async ({ page }) => {
  const player = await asPlayer(page);
  await ready(page);
  await signInFromChip(page);
  await pickName(page, player.name);
  await resumeIfPaused(page);
  await page.locator('#account-chip').click();
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
  await expect(page.locator('#account-chip')).toHaveAccessibleName('Sign in');
  // The session went with the account.
  expect(await page.evaluate(() => fetch('/api/me').then((r) => r.json()))).toEqual({ user: null });
});

test('delete account before a name: a wrong email is refused inline, the right one deletes', async ({ page }) => {
  const player = await asPlayer(page);
  await ready(page);
  await signInFromChip(page);
  await page.getByRole('dialog', { name: 'Pick a display name' }).waitFor();
  await page.keyboard.press('Escape');
  await resumeIfPaused(page);
  const chip = page.locator('#account-chip');
  await expect(chip).toHaveAccessibleName('Account');
  await chip.click();
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
  await expect(chip).toHaveAccessibleName('Sign in');
});

test('the admin sees Radio admin in the account menu; a player does not', async ({ page }) => {
  await page.context().addCookies([{ name: 'aglow_fake_as', value: 'admin@example.com', url: 'http://localhost:4173' }]);
  await ready(page);
  await signInFromChip(page);
  // The admin may have picked a name in another test; without one ("Account" alone), the name card opens with the chip.
  const chip = page.locator('#account-chip');
  await expect(chip).toHaveAccessibleName(/^Account/);
  const nameCard = page.getByRole('dialog', { name: 'Pick a display name' });
  if ((await chip.getAttribute('aria-label')) === 'Account') {
    await nameCard.waitFor();
    await page.keyboard.press('Escape');
  }
  await expect(nameCard).toBeHidden();
  await resumeIfPaused(page);
  await page.locator('#account-chip').click();
  const menu = page.getByRole('dialog', { name: 'Account' });
  await expect(menu.getByRole('link', { name: 'Radio admin' })).toHaveAttribute('href', '/admin');
  await page.keyboard.press('Escape');

  // Another Google account, signed in afresh.
  await page.context().clearCookies();
  await asPlayer(page);
  await page.reload();
  await expect(page.locator('#account-chip')).toHaveAccessibleName('Sign in');
  await page.evaluate(() => sessionStorage.clear());
  await signInFromChip(page);
  await page.getByRole('dialog', { name: 'Pick a display name' }).waitFor();
  await page.keyboard.press('Escape');
  await resumeIfPaused(page);
  await page.locator('#account-chip').click();
  await expect(menu.getByRole('button', { name: 'Your games' })).toBeVisible();
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
  await expect(results.locator('#r-score')).toHaveText(/^Score [\d,]+$/);
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
  await results.getByRole('button', { name: /^Rank \d+ of \d+: open the leaderboard$/ }).click();
  await expect(page.getByRole('dialog', { name: 'Leaderboard' }).locator('.acct-row.acct-me')).toContainText(player.name);
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

test('a claim another tab already took out of storage ends as "Saved to Your games", not "Saving…"', async ({ page }) => {
  const player = await asPlayer(page);
  await ready(page);
  await onlineTree(page);
  await solveByTapping(page);
  const results = page.locator('#results');
  await expect(results.locator('.rib-line')).toHaveText(/^Would place #/, { timeout: 15_000 });
  await page.evaluate(() => localStorage.removeItem('aglow.claims'));
  await saveFromTag(page, player.name);
  await expect(results.locator('.rib-line')).toHaveText('Saved to Your games', { timeout: 15_000 });
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

test('two runs by the same player both appear in Your games', async ({ page }) => {
  const player = await asPlayer(page);
  await ready(page);
  await signInFromChip(page);
  await pickName(page, player.name);
  await resumeIfPaused(page);
  for (let run = 0; run < 2; run++) {
    if (run) await page.locator('#r-new').click();
    await onlineTree(page);
    await solveByTapping(page);
    await expect(page.locator('#results .rib-line')).toHaveText(/^#\d+ of [\d,]+ runs? · /, { timeout: 15_000 });
  }
  await page.locator('#account-chip').click();
  await page.getByRole('dialog', { name: 'Account' }).getByRole('button', { name: 'Leaderboard' }).click();
  // Your games, not the shared top 50: other tests' players can push these two runs off the board.
  await page.getByRole('dialog', { name: 'Leaderboard' }).getByRole('tab', { name: 'Your games' }).click();
  await expect(page.getByRole('dialog', { name: 'Your games' }).locator('.acct-game')).toHaveCount(2);
  const mine = await page.request.get('/api/me/games');
  expect(((await mine.json()) as { games: unknown[] }).games).toHaveLength(2);
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

test("signed in with a history on this device, the tag and Your games add it to the account's numbers", async ({ page }) => {
  const player = await asPlayer(page);
  await seedDeviceHistory(page);
  await ready(page);
  await signInFromChip(page);
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

  await page.locator('#account-chip').click();
  await page.getByRole('dialog', { name: 'Account' }).getByRole('button', { name: 'Leaderboard' }).click();
  await page.getByRole('dialog', { name: 'Leaderboard' }).getByRole('tab', { name: 'Your games' }).click();
  const games = page.getByRole('dialog', { name: 'Your games' });
  await expect(games.locator('.acct-totals span')).toHaveText(['Solved', 'Average', 'Day streak', 'Longest']);
  // The same additive numbers; the recent-games list below is still the account's own (one game).
  await expect(games.locator('.acct-totals b')).toHaveText(['9', /^\d+:\d{2}\.\d$/, '11', '11']);
  await expect(games.locator('.acct-game')).toHaveCount(1);
  // The four columns fit the sheet at this width (375 px on the phone project).
  const fits = await games.locator('.acct-body').evaluate((n) => n.scrollWidth <= n.clientWidth);
  expect(fits).toBe(true);
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
  await signInFromChip(page);
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
  await signInFromChip(page);
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

test("signed in but the stats can't be read: the tag keeps this device's numbers, and Your games says so", async ({ page }) => {
  const player = await asPlayer(page);
  await seedDeviceHistory(page);
  await page.route(
    (url) => url.pathname === '/api/me/stats',
    (route) => route.abort(),
  );
  await ready(page);
  await signInFromChip(page);
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

  await page.locator('#account-chip').click();
  await page.getByRole('dialog', { name: 'Account' }).getByRole('button', { name: 'Leaderboard' }).click();
  await page.getByRole('dialog', { name: 'Leaderboard' }).getByRole('tab', { name: 'Your games' }).click();
  const games = page.getByRole('dialog', { name: 'Your games' });
  await expect(games.locator('.acct-totals-err')).toHaveText("Couldn't load your totals.");
  await expect(games.locator('.acct-totals b')).toHaveText(['–', '–', '–', '–']);
  await expect(games.locator('.acct-game')).toHaveCount(1);
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
