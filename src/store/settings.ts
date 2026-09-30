import type { PathStyle } from '../render/paths';
import type { SceneId } from '../render/scenes';
import { readJSON, writeJSON } from './storage';

export interface Settings {
  v: 1;
  scene: 'auto' | SceneId;
  pathStyle: PathStyle;
  effectsVolume: number;
  haptics: boolean;
}

export const DEFAULT_SETTINGS: Settings = { v: 1, scene: 'auto', pathStyle: 'filament', effectsVolume: 0.8, haptics: true };

const KEY = 'aglow.settings';
const SCENE_VALUES = ['auto', 'midnight', 'fireside', 'frost'];
const STYLE_VALUES = ['filament', 'fairy', 'neon'];

function isSettings(v: unknown): v is Settings {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    o.v === 1 &&
    typeof o.scene === 'string' && SCENE_VALUES.includes(o.scene) &&
    typeof o.pathStyle === 'string' && STYLE_VALUES.includes(o.pathStyle) &&
    typeof o.effectsVolume === 'number' && o.effectsVolume >= 0 && o.effectsVolume <= 1 &&
    typeof o.haptics === 'boolean'
  );
}

export const loadSettings = (): Settings => readJSON(KEY, isSettings) ?? { ...DEFAULT_SETTINGS };
export const saveSettings = (s: Settings): void => writeJSON(KEY, s);
