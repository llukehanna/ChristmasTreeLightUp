// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closesAt, doorItem } from '../../../src/core/advent';
import type { ItemId } from '../../../src/core/catalogue';
import { AdventSheet, type AdventHooks } from '../../../src/ui/advent';
import { NEW_TREE_CONFIRM_MS } from '../../../src/ui/menu';
import { Sheet } from '../../../src/ui/sheet';

let sheet: Sheet;
beforeEach(() => {
  vi.useFakeTimers();
  // Noon on Dec 9, 2026 here: doors 1–7 are closed days, 8 is still open somewhere, 9 is today's.
  vi.setSystemTime(new Date(2026, 11, 9, 12));
  sheet = new Sheet({ onOpen: () => {}, onAct: () => {} });
});
afterEach(() => {
  sheet.close();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

function make(over: Partial<AdventHooks> = {}) {
  const hooks: AdventHooks = {
    sheet,
    owns: () => false,
    guest: () => false,
    needsConfirm: () => false,
    playingDaily: () => false,
    onToday: vi.fn(),
    onDay: vi.fn(),
    ...over,
  };
  const advent = new AdventSheet(hooks);
  advent.open();
  return { advent, hooks };
}
const door = (d: number) => document.getElementById(`adv-door-${d}`) as HTMLElement;
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!;

it('opens in the account sheet as "Advent calendar": 24 doors in order, six to a row', () => {
  make();
  expect(dialog().getAttribute('aria-label')).toBe('Advent calendar');
  const doors = [...dialog().querySelectorAll<HTMLElement>('.adv-door')];
  expect(doors.map((d) => d.id)).toEqual(Array.from({ length: 24 }, (_, i) => `adv-door-${i + 1}`));
  expect(dialog().querySelector('.adv-grid')).not.toBeNull();
  expect(dialog().querySelector('.acct-sub')?.textContent).toBe('December 2026 · 0/24 open');
});

it('the sheet: a catch-up door starts that day; a waiting door is disabled with its date', () => {
  const { advent, hooks } = make();
  expect(door(6).dataset.state).toBe('catch-up');
  expect(door(6).textContent).toContain('6');
  expect(door(6).textContent).toContain('Catch up');
  // Door 8 closes at Dec 10 00:00 UTC: it opens on that instant's local date (tonight, when that is still Dec 9).
  const opens = new Date(Date.UTC(2026, 11, 10));
  const when = opens.getDate() === 9 ? 'tonight' : `Dec ${opens.getDate()}`;
  expect(door(8).dataset.state).toBe('waiting');
  expect((door(8) as HTMLButtonElement).disabled).toBe(true);
  expect(door(8).textContent).toContain(`Opens ${when.replace(' ', '\u00a0')}`);
  expect(door(8).getAttribute('aria-label')).toBe(`Dec 8 · Opens ${when}`);
  expect(door(10).dataset.state).toBe('future');
  expect((door(10) as HTMLButtonElement).disabled).toBe(true);
  door(6).click();
  expect(hooks.onDay).toHaveBeenCalledWith('2026-12-06');
  expect(hooks.onToday).not.toHaveBeenCalled();
  expect(advent.isOpen).toBe(false);
});

it("today's door starts the live Daily; mid-run it arms first, as the menu's Daily row does", () => {
  const { advent, hooks } = make({ needsConfirm: () => true });
  expect(door(9).dataset.state).toBe('today');
  door(9).click();
  expect(hooks.onToday).not.toHaveBeenCalled();
  expect(door(9).classList.contains('armed')).toBe(true);
  expect(door(9).textContent).toContain('Tap again');
  // A press of another door never confirms this one: it arms for itself.
  door(6).click();
  expect(hooks.onDay).not.toHaveBeenCalled();
  expect(door(9).classList.contains('armed')).toBe(false);
  door(9).click();
  vi.advanceTimersByTime(1000);
  door(9).click();
  expect(hooks.onToday).toHaveBeenCalledTimes(1);
  expect(advent.isOpen).toBe(false);

  // The window is the menu's: after it, a press arms afresh.
  advent.open();
  door(6).click();
  vi.advanceTimersByTime(NEW_TREE_CONFIRM_MS + 100);
  expect(door(6).classList.contains('armed')).toBe(false);
  door(6).click();
  expect(hooks.onDay).not.toHaveBeenCalled();
});

it("on today's live Daily, its door just closes the sheet", () => {
  const { advent, hooks } = make({ needsConfirm: () => true, playingDaily: () => true });
  door(9).click();
  expect(advent.isOpen).toBe(false);
  expect(hooks.onToday).not.toHaveBeenCalled();
});

it("an open door shows its item's swatch and label, whatever the day", () => {
  const owned = new Set<ItemId>([doorItem(6).id, doorItem(9).id, doorItem(20).id]);
  make({ owns: (id) => owned.has(id) });
  for (const d of [6, 9, 20]) {
    expect(door(d).dataset.state).toBe('open');
    expect(door(d).textContent).toContain(doorItem(d).label);
    expect(door(d).querySelector('.adv-art svg, .adv-art .deco-pal')).not.toBeNull();
  }
  expect(door(6).textContent).toContain('Gingerbread tag');
  expect(dialog().querySelector('.acct-sub')?.textContent).toBe('December 2026 · 3/24 open');
  // Door 19's Pastel bulbs paint in their own colours; door 20's Rose gold garland too.
  owned.add(doorItem(19).id);
  make({ owns: (id) => owned.has(id) });
  expect(door(19).querySelectorAll<HTMLElement>('.deco-pal b')[0].style.getPropertyValue('--c')).not.toBe('');
  expect(door(20).querySelectorAll<SVGElement>('.deco-garl-g')[0].style.getPropertyValue('--c')).not.toBe('');
});

it('refresh() repaints an open sheet when a door opens', () => {
  const owned = new Set<ItemId>();
  const { advent } = make({ owns: (id) => owned.has(id) });
  expect(door(6).dataset.state).toBe('catch-up');
  owned.add(doorItem(6).id);
  advent.refresh();
  expect(door(6).dataset.state).toBe('open');
});

it('a guest is asked to sign in; in November the doors wait for December 1', () => {
  make({ guest: () => true });
  expect(dialog().textContent).toContain('Sign in to open doors · your trees still count once you do');
  expect(dialog().textContent).not.toContain('Doors open December 1');
  sheet.close();

  vi.setSystemTime(new Date(2026, 10, 6, 12));
  make();
  expect(dialog().textContent).toContain('Doors open December 1');
  expect(dialog().textContent).not.toContain('Sign in to open doors');
  expect([...dialog().querySelectorAll<HTMLElement>('.adv-door')].every((d) => d.dataset.state === 'future')).toBe(true);
});

/** Runs `fn` with the process in time zone `tz` (Date reads TZ afresh each time it is set). */
function inZone(tz: string, fn: () => void): void {
  const was = process.env.TZ;
  process.env.TZ = tz;
  try {
    fn();
  } finally {
    if (was === undefined) delete process.env.TZ;
    else process.env.TZ = was;
  }
}

it('a waiting door that opens this evening (west of UTC) reads "Opens tonight"; otherwise its date', () => {
  inZone('America/Los_Angeles', () => {
    // Noon on Dec 9 in Los Angeles: door 8 closed at Dec 10 00:00 UTC, which is 4 pm on Dec 9 there.
    vi.setSystemTime(new Date(2026, 11, 9, 12));
    make();
    expect(door(8).dataset.state).toBe('waiting');
    expect(door(8).textContent).toContain('Opens tonight');
    expect(door(8).getAttribute('aria-label')).toBe('Dec 8 · Opens tonight');
    sheet.close();
  });
  inZone('Asia/Tokyo', () => {
    // Noon on Dec 9 in Tokyo: door 8 closes at 9 am on Dec 10 there, tomorrow.
    vi.setSystemTime(new Date(2026, 11, 9, 12));
    make();
    expect(door(8).textContent).toContain('Opens Dec\u00a010');
    expect(door(8).getAttribute('aria-label')).toBe('Dec 8 · Opens Dec 10');
    sheet.close();
  });
});

describe('an open sheet keeps up with the clock', () => {
  const hidden = (value: boolean) => Object.defineProperty(document, 'hidden', { configurable: true, get: () => value });
  afterEach(() => hidden(false));

  it('a waiting door opens when its day closes, with no reopening', () => {
    make();
    expect(door(8).dataset.state).toBe('waiting');
    vi.advanceTimersByTime(closesAt('2026-12-08') - Date.now() + 100);
    expect(door(8).dataset.state).toBe('catch-up');
    expect((door(8) as HTMLButtonElement).disabled).toBe(false);
  });

  it('"Today" moves on at local midnight, with no reopening', () => {
    make();
    expect(door(9).dataset.state).toBe('today');
    vi.advanceTimersByTime(new Date(2026, 11, 10, 0, 30).getTime() - Date.now());
    expect(door(9).dataset.state).not.toBe('today');
    expect(door(10).dataset.state).toBe('today');
  });

  it('each render sets one timer; closing clears it; a sheet closed from outside is left alone', () => {
    // The sheet's first open leaves a timer of its own: out of the way, so that only the page's are counted.
    sheet.open({ label: 'Plain', card: false, render: (inner) => void (inner.textContent = 'x') });
    sheet.close();
    vi.clearAllTimers();

    const { advent } = make();
    expect(vi.getTimerCount()).toBe(1);
    advent.refresh();
    expect(vi.getTimerCount()).toBe(1);
    advent.close();
    expect(vi.getTimerCount()).toBe(0);
    // Closed by the sheet itself (Escape, the scrim): the timer that runs out finds it closed and sets no more.
    advent.open();
    sheet.close();
    vi.advanceTimersByTime(3 * 86_400_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never runs while the tab is hidden: the sheet repaints when the tab is back', () => {
    make();
    hidden(true);
    vi.advanceTimersByTime(closesAt('2026-12-08') - Date.now() + 100);
    expect(door(8).dataset.state).toBe('waiting');
    hidden(false);
    document.dispatchEvent(new Event('visibilitychange'));
    expect(door(8).dataset.state).toBe('catch-up');
  });
});
