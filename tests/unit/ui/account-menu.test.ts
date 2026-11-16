// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountMenu, type AccountMenuHooks } from '../../../src/ui/account-menu';

const makeHooks = () => ({
  open: vi.fn<AccountMenuHooks['open']>(),
  act: vi.fn<AccountMenuHooks['act']>(),
  signIn: vi.fn<AccountMenuHooks['signIn']>(),
  back: vi.fn<AccountMenuHooks['back']>(),
});
let hooks: ReturnType<typeof makeHooks>;
let menu: AccountMenu;
beforeEach(() => {
  document.body.innerHTML = '<button id="menu-btn">···</button><div id="menu"><span id="board-rank"></span><button id="account-row" hidden></button></div>';
  hooks = makeHooks();
  menu = new AccountMenu(hooks);
});
afterEach(() => {
  menu.close();
  document.body.innerHTML = '';
});
const drop = () => document.getElementById('account-menu') as HTMLElement;
const items = () => [...drop().querySelectorAll('.acct-item')].map((n) => n.textContent?.trim());
const menuBtn = () => document.getElementById('menu-btn');

it('the account row sits in the menu, hidden until /api/me answers, and hidden again offline', () => {
  expect(menu.row.id).toBe('account-row');
  expect(menu.row.hidden).toBe(true);
  menu.render(null);
  expect(menu.row.hidden).toBe(false);
  menu.render(undefined);
  expect(menu.row.hidden).toBe(true);
});

it('signed out it reads Sign in and opens the sign-in card from the menu button', () => {
  menu.render(null);
  expect(menu.row.getAttribute('aria-label')).toBe('Sign in');
  expect(menu.row.textContent).toContain('Sign in');
  expect(menu.row.textContent).toContain('Save your times and rank');
  menu.row.click();
  expect(hooks.signIn).toHaveBeenCalledWith(menuBtn());
  expect(menu.isOpen).toBe(false);
});

it('signed in it shows the name (escaped) and summary, and the rank beside Leaderboard', () => {
  menu.render({ name: '<Comet>', isAdmin: false, starHead: false }, { rank: 12, best: 81_049 });
  expect(menu.row.getAttribute('aria-label')).toBe('Account: <Comet>');
  expect(menu.row.querySelector('.acct-av')?.textContent).toBe('<');
  expect(menu.row.textContent).toContain('<Comet>');
  expect(menu.row.textContent).toContain('#12 all-time · best 1:21.0');
  expect(document.getElementById('board-rank')?.textContent).toBe('#12');
  menu.render({ name: 'Comet', isAdmin: false, starHead: false }, { rank: null, best: null });
  expect(document.getElementById('board-rank')?.textContent).toBe('');
});

it('no name yet: the person icon and "Account"; the page offers a name, and an admin also gets Radio admin', () => {
  menu.render({ name: null, isAdmin: true, starHead: false });
  expect(menu.row.getAttribute('aria-label')).toBe('Account');
  expect(menu.row.querySelector('.acct-av svg')).not.toBeNull();
  expect(items()).toEqual(['‹ Menu', 'Pick a display name', 'Radio admin']);
});

it('the account page leads with a way back and holds no Leaderboard or Career', () => {
  menu.render({ name: 'Comet', isAdmin: false, starHead: false });
  menu.row.click();
  expect(hooks.open).toHaveBeenCalledTimes(1);
  expect(menu.isOpen).toBe(true);
  expect(drop().querySelector('.acct-item')?.getAttribute('data-act')).toBe('back');
  expect(drop().querySelector('[data-act="board"], [data-act="career"]')).toBeNull();
  expect(drop().querySelector('.bow, .acct-band')).toBeNull();
  expect([...drop().querySelectorAll('.acct-drop-foot > *')].map((n) => n.textContent)).toEqual(['Sign out', 'Delete account', 'Privacy']);
});

it('‹ Menu closes the page and goes back', () => {
  menu.render({ name: 'Comet', isAdmin: false, starHead: false });
  menu.open();
  drop().querySelector<HTMLElement>('[data-act="back"]')?.click();
  expect(menu.isOpen).toBe(false);
  expect(hooks.back).toHaveBeenCalledTimes(1);
  expect(hooks.act).not.toHaveBeenCalled();
});

it('Escape closes the page and goes back, and goes no further (no pause, no second close)', () => {
  menu.render({ name: 'Comet', isAdmin: false, starHead: false });
  menu.open();
  const below = vi.fn();
  document.addEventListener('keydown', below);
  const e = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  document.activeElement?.dispatchEvent(e);
  document.removeEventListener('keydown', below);
  expect(menu.isOpen).toBe(false);
  expect(hooks.back).toHaveBeenCalledTimes(1);
  expect(e.defaultPrevented).toBe(true);
  expect(below).not.toHaveBeenCalled();
});

it('other items close the page and hand over the menu button', () => {
  menu.render({ name: 'Comet', isAdmin: false, starHead: false });
  menu.open();
  drop().querySelector<HTMLElement>('[data-act="signout"]')?.click();
  expect(menu.isOpen).toBe(false);
  expect(hooks.act).toHaveBeenCalledWith('signout', menuBtn());
  expect(hooks.back).not.toHaveBeenCalled();
});

it('a summary arriving while the page is open keeps focus where it was', () => {
  menu.render({ name: 'Comet', isAdmin: false, starHead: false });
  menu.open();
  const back = drop().querySelector<HTMLElement>('[data-act="back"]');
  expect(document.activeElement).toBe(back);
  menu.render({ name: 'Comet', isAdmin: false, starHead: false }, { rank: 3, best: 50_000 });
  expect(document.activeElement).toBe(drop().querySelector('[data-act="back"]'));
  drop().querySelector<HTMLElement>('a[href="/privacy"]')?.focus();
  menu.render({ name: 'Comet', isAdmin: false, starHead: false }, { rank: 2, best: 49_000 });
  expect(document.activeElement).toBe(drop().querySelector('a[href="/privacy"]'));
});

it('signing out closes an open page', () => {
  menu.render({ name: 'Comet', isAdmin: false, starHead: false });
  menu.open();
  menu.render(null);
  expect(menu.isOpen).toBe(false);
});
