// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountMenu, type AccountMenuHooks } from '../../../src/ui/account-menu';

const makeHooks = () => ({
  open: vi.fn<AccountMenuHooks['open']>(),
  act: vi.fn<AccountMenuHooks['act']>(),
  signIn: vi.fn<AccountMenuHooks['signIn']>(),
  fit: vi.fn<AccountMenuHooks['fit']>(),
});
let hooks: ReturnType<typeof makeHooks>;
let menu: AccountMenu;
beforeEach(() => {
  document.body.innerHTML = '<div class="hud"><button id="menu-btn">···</button></div>';
  hooks = makeHooks();
  menu = new AccountMenu(hooks);
});
afterEach(() => {
  menu.close(false);
  document.body.innerHTML = '';
});
const drop = () => document.getElementById('account-menu') as HTMLElement;
const items = () => [...drop().querySelectorAll('.acct-item')].map((n) => n.textContent?.trim());

it('sits left of the ··· button, hidden until /api/me answers', () => {
  expect(menu.chip.nextElementSibling?.id).toBe('menu-btn');
  expect(menu.chip.hidden).toBe(true);
  menu.render(null);
  expect(menu.chip.hidden).toBe(false);
  expect(hooks.fit).toHaveBeenCalled();
});

it('signed out, the chip reads Sign in and opens the sign-in card, not the menu', () => {
  menu.render(null);
  expect(menu.chip.getAttribute('aria-label')).toBe('Sign in');
  expect(menu.chip.textContent).toBe('Sign in');
  menu.chip.click();
  expect(hooks.signIn).toHaveBeenCalledWith(menu.chip);
  expect(menu.isOpen).toBe(false);
});

it('signed in: the name (escaped) and initial, and a menu with the leaderboard, your games, sign out, delete and privacy', () => {
  menu.render({ name: '<Comet>', isAdmin: false });
  expect(menu.chip.getAttribute('aria-label')).toBe('Account: <Comet>');
  expect(menu.chip.querySelector('.acct-chip-l')?.textContent).toBe('<Comet>');
  expect(menu.chip.querySelector('.acct-av')?.textContent).toBe('<');
  expect(drop().querySelector('b')?.innerHTML).toBe('&lt;Comet&gt;');
  expect(items()).toEqual(['Leaderboard', 'Your games']);
  expect([...drop().querySelectorAll('.acct-drop-foot > *')].map((n) => n.textContent)).toEqual(['Sign out', 'Delete account', 'Privacy']);
});

it('no name yet: offers to pick one; an admin also gets Radio admin', () => {
  menu.render({ name: null, isAdmin: true });
  expect(menu.chip.getAttribute('aria-label')).toBe('Account: Account');
  expect(items()).toEqual(['Pick a display name', 'Leaderboard', 'Your games', 'Radio admin']);
  expect(drop().querySelector<HTMLAnchorElement>('a.acct-item')?.getAttribute('href')).toBe('/admin');
});

it('the head line: rank and best once loaded, or no ranked runs yet', () => {
  menu.render({ name: 'Comet', isAdmin: false }, { rank: 12, best: 81_049 });
  expect(drop().querySelector('small')?.textContent).toBe('#12 all-time · best 1:21.0');
  expect(drop().querySelector('.acct-r')?.textContent).toBe('#12');
  menu.render({ name: 'Comet', isAdmin: false }, { rank: null, best: null });
  expect(drop().querySelector('small')?.textContent).toBe('No ranked runs yet');
});

it('opens from the chip (telling the app), routes items, and closes on Escape back to the chip', () => {
  menu.render({ name: 'Comet', isAdmin: false });
  menu.chip.click();
  expect(hooks.open).toHaveBeenCalledTimes(1);
  expect(menu.isOpen).toBe(true);
  expect(menu.chip.getAttribute('aria-expanded')).toBe('true');
  expect(menu.hasFocus).toBe(true);
  drop().querySelector<HTMLElement>('[data-act="games"]')?.click();
  expect(hooks.act).toHaveBeenCalledWith('games', menu.chip);
  expect(menu.isOpen).toBe(false);
  menu.chip.click();
  dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(menu.isOpen).toBe(false);
  expect(document.activeElement).toBe(menu.chip);
});

it('signing out closes an open menu', () => {
  menu.render({ name: 'Comet', isAdmin: false });
  menu.open();
  menu.render(null);
  expect(menu.isOpen).toBe(false);
});
