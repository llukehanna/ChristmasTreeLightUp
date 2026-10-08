// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { Sheet, type SheetView } from '../../../src/ui/sheet';

let sheets: Sheet[] = [];
afterEach(() => {
  for (const s of sheets) s.close();
  sheets = [];
  document.body.innerHTML = '';
});
const make = (onOpen = vi.fn(), onAct = vi.fn()) => {
  const s = new Sheet({ onOpen, onAct });
  sheets.push(s);
  return s;
};
const view = (label: string): SheetView => ({
  label,
  card: true,
  render: (inner) => {
    inner.innerHTML = '<button type="button" data-act="go">Go</button>';
  },
});
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

it('opens as a labelled modal dialog over a scrim, telling the app once', () => {
  const onOpen = vi.fn();
  const sheet = make(onOpen);
  sheet.open(view('Sign in'));
  expect(dialog()?.hidden).toBe(false);
  expect(dialog()?.getAttribute('aria-label')).toBe('Sign in');
  expect(dialog()?.getAttribute('aria-modal')).toBe('true');
  expect(document.querySelector<HTMLElement>('.acct-scrim')?.hidden).toBe(false);
  sheet.open(view('Pick a display name'));
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(dialog()?.getAttribute('aria-label')).toBe('Pick a display name');
});

it('routes [data-act] clicks, and closes on its close button, Escape or the scrim', () => {
  const onAct = vi.fn();
  const sheet = make(vi.fn(), onAct);
  sheet.open(view('A'));
  document.querySelector<HTMLElement>('[data-act="go"]')?.click();
  expect(onAct).toHaveBeenCalledWith('go', expect.any(HTMLElement));
  document.querySelector<HTMLElement>('.acct-x')?.click();
  expect(sheet.isOpen).toBe(false);
  sheet.open(view('A'));
  dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(sheet.isOpen).toBe(false);
  sheet.open(view('A'));
  document.querySelector<HTMLElement>('.acct-scrim')?.click();
  expect(sheet.isOpen).toBe(false);
});

it('keeps P (pause) from reaching the game while open', () => {
  const sheet = make();
  sheet.open(view('A'));
  const seen = vi.fn();
  document.addEventListener('keydown', seen);
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true }));
  expect(seen).not.toHaveBeenCalled();
  document.removeEventListener('keydown', seen);
});
