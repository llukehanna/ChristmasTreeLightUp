// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { DEFAULT_RADIO, loadRadioSettings, saveRadioSettings } from '../../../src/store/radio-settings';

beforeEach(() => localStorage.clear());

it('defaults to music on, light show on', () => {
  expect(loadRadioSettings()).toEqual(DEFAULT_RADIO);
  expect(DEFAULT_RADIO).toMatchObject({ on: true, lightShow: true, source: null });
});
it('persists and validates', () => {
  saveRadioSettings({ ...DEFAULT_RADIO, on: false, source: 'fireplace', volume: 0.4 });
  expect(loadRadioSettings()).toMatchObject({ on: false, source: 'fireplace', volume: 0.4 });
  localStorage.setItem('aglow.radio', JSON.stringify({ v: 1, volume: 7 }));
  expect(loadRadioSettings()).toEqual(DEFAULT_RADIO);
});
it('still loads an older save that carries the retired shuffle flag, keeping its other fields and dropping the flag', () => {
  localStorage.setItem('aglow.radio', JSON.stringify({ v: 1, on: false, source: 'fireplace', embedUrl: null, volume: 0.3, shuffle: false, lightShow: false }));
  const s = loadRadioSettings();
  expect(s).toEqual({ v: 1, on: false, source: 'fireplace', embedUrl: null, volume: 0.3, lightShow: false });
  expect('shuffle' in s).toBe(false);
});
