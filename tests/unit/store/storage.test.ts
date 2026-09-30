// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { readJSON, writeJSON } from '../../../src/store/storage';
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../../../src/store/settings';

beforeEach(() => localStorage.clear());

const isNum = (v: unknown): v is number => typeof v === 'number';

it('round-trips valid JSON and rejects invalid or corrupt values', () => {
  writeJSON('k', 5);
  expect(readJSON('k', isNum)).toBe(5);
  localStorage.setItem('k', '"text"');
  expect(readJSON('k', isNum)).toBeNull();
  localStorage.setItem('k', '{not json');
  expect(readJSON('k', isNum)).toBeNull();
});

it('falls back to default settings and persists changes', () => {
  expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  saveSettings({ ...DEFAULT_SETTINGS, pathStyle: 'neon', scene: 'frost' });
  expect(loadSettings().pathStyle).toBe('neon');
  localStorage.setItem('aglow.settings', JSON.stringify({ v: 1, scene: 'mars' }));
  expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
});
