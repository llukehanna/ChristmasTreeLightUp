// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { DEFAULT_RADIO, loadRadioSettings, saveRadioSettings } from '../../../src/store/radio-settings';

beforeEach(() => localStorage.clear());

it('defaults to music on, shuffle on, light show on', () => {
  expect(loadRadioSettings()).toEqual(DEFAULT_RADIO);
  expect(DEFAULT_RADIO).toMatchObject({ on: true, shuffle: true, lightShow: true, source: null });
});
it('persists and validates', () => {
  saveRadioSettings({ ...DEFAULT_RADIO, on: false, source: 'fireplace', volume: 0.4 });
  expect(loadRadioSettings()).toMatchObject({ on: false, source: 'fireplace', volume: 0.4 });
  localStorage.setItem('aglow.radio', JSON.stringify({ v: 1, volume: 7 }));
  expect(loadRadioSettings()).toEqual(DEFAULT_RADIO);
});
