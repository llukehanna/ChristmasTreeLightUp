// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ItemId } from '../../../src/core/catalogue';
import type { Radio, RadioView } from '../../../src/radio/radio';
import { DEFAULT_RADIO } from '../../../src/store/radio-settings';
import { RadioPanel } from '../../../src/ui/radio-panel';

/** A radio that only answers view() and records select(). */
function fakeRadio(view: Partial<RadioView> = {}) {
  const v: RadioView = {
    kind: null, playing: false, station: null, track: null, position: 0, duration: 0, stations: [], unavailable: () => false,
    embed: null, remoteOk: true, settings: { ...DEFAULT_RADIO }, secretMode: false, secretStation: null, ...view,
  };
  return { onChange: null as (() => void) | null, view: () => v, select: vi.fn() };
}

const row = (id: string) => document.querySelector<HTMLButtonElement>(`#radio-panel .stations .st[data-id="${id}"]`)!;
const desc = (id: string) => row(id).querySelector('.d')!.textContent;

beforeEach(() => {
  document.body.innerHTML = '<div id="radio-slot"></div>';
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
});
let opened: RadioPanel[] = [];
afterEach(() => {
  for (const p of opened) p.close();
  opened = [];
  vi.unstubAllGlobals();
});

it('Rain and Storm are locked rows until owned', () => {
  const owned = new Set<ItemId>();
  const radio = fakeRadio();
  const lockText = (id: ItemId) => (id === 'sound:rain' ? 'Light 10 trees · 3/10' : 'Light 40 tiles with your last turn · Sign in to track');
  const p = new RadioPanel(radio as unknown as Radio, { get: () => 1, set: () => undefined }, { owns: (id) => owned.has(id), lockText });
  p.open();
  opened.push(p);
  expect(row('rain').disabled).toBe(true);
  expect(row('storm').disabled).toBe(true);
  expect(desc('rain')).toBe('Light 10 trees · 3/10');
  expect(desc('storm')).toBe('Light 40 tiles with your last turn · Sign in to track');
  // The Fireplace is free.
  expect(row('fireplace').disabled).toBe(false);
  expect(desc('fireplace')).toBe('Crackling logs, no music');
  row('rain').click();
  expect(radio.select).not.toHaveBeenCalled();

  owned.add('sound:rain');
  radio.onChange?.();
  expect(row('rain').disabled).toBe(false);
  expect(desc('rain')).toBe('Rain on the window, no music');
  expect(row('storm').disabled).toBe(true);
  row('rain').click();
  expect(radio.select).toHaveBeenCalledWith('rain');
});

it('without the hooks, nothing is locked', () => {
  const p = new RadioPanel(fakeRadio() as unknown as Radio, { get: () => 1, set: () => undefined });
  p.open();
  opened.push(p);
  expect(row('rain').disabled).toBe(false);
  expect(row('storm').disabled).toBe(false);
});
