import { expect, test } from './fixtures';
import { asPlayer, pickName, ready, resumeIfPaused, signInFromChip } from './helpers';

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
  // The admin may have picked a name in another test; without one, the name card opens first.
  await expect(page.locator('#account-chip')).toHaveAccessibleName(/^Account/);
  if (await page.getByRole('dialog', { name: 'Pick a display name' }).isVisible()) await page.keyboard.press('Escape');
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
