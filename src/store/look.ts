import type { PathStyle } from '../render/paths';
import type { SceneId } from '../render/scenes';
import { hasPlayed, readJSON, writeJSON } from './storage';

export type PaletteId = 'scene' | 'gilded' | 'classic' | 'ice' | 'goldsilver' | 'pastel';
export type TopperKind = 'snowflake' | 'star' | 'angel' | 'bow';
export type PresentSet = 'none' | 'game' | 'luxe' | 'kraft';
export interface Decor { tinsel: boolean; beads: boolean; canes: boolean; skirt: boolean }

/** Every cosmetic choice in one record (spec: Part B). Saved on its own, apart from the settings. */
export interface Look {
  v: 1;
  scene: SceneId;
  path: PathStyle;
  palette: PaletteId;
  topper: TopperKind;
  decor: Decor;
  presents: PresentSet;
}

/** What the renderer dresses the tree with: everything in the look but the scene and the light path. */
export type Dress = Pick<Look, 'palette' | 'topper' | 'decor' | 'presents'>;

export const NO_DECOR: Decor = { tinsel: false, beads: false, canes: false, skirt: false };

export const STARTER_LOOK: Look = {
  v: 1, scene: 'fireside', path: 'filament', palette: 'scene', topper: 'snowflake', decor: NO_DECOR, presents: 'none',
};

const KEY = 'aglow.look';
const SETTINGS_KEY = 'aglow.settings';
const SCENES: readonly string[] = ['midnight', 'fireside', 'frost', 'sash', 'square', 'parlour'];
const PATHS: readonly string[] = ['filament', 'fairy', 'neon'];
const PALETTES: readonly string[] = ['scene', 'gilded', 'classic', 'ice', 'goldsilver', 'pastel'];
const TOPPERS: readonly string[] = ['snowflake', 'star', 'angel', 'bow'];
const PRESENTS: readonly string[] = ['none', 'game', 'luxe', 'kraft'];

const pick = <T extends string>(allowed: readonly string[], v: unknown, fallback: T): T =>
  typeof v === 'string' && allowed.includes(v) ? (v as T) : fallback;

function parseDecor(raw: unknown): Decor {
  if (typeof raw !== 'object' || raw === null) return NO_DECOR;
  const o = raw as Record<string, unknown>;
  const flag = (k: keyof Decor): boolean => (typeof o[k] === 'boolean' ? (o[k] as boolean) : NO_DECOR[k]);
  return { tinsel: flag('tinsel'), beads: flag('beads'), canes: flag('canes'), skirt: flag('skirt') };
}

/** Field by field: a missing or unknown value takes the starter look's. */
export function parseLook(raw: unknown): Look {
  if (typeof raw !== 'object' || raw === null) return STARTER_LOOK;
  const o = raw as Record<string, unknown>;
  return {
    v: 1,
    scene: pick(SCENES, o.scene, STARTER_LOOK.scene),
    path: pick(PATHS, o.path, STARTER_LOOK.path),
    palette: pick(PALETTES, o.palette, STARTER_LOOK.palette),
    topper: pick(TOPPERS, o.topper, STARTER_LOOK.topper),
    decor: parseDecor(o.decor),
    presents: pick(PRESENTS, o.presents, STARTER_LOOK.presents),
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/**
 * The look the first load of this device gets. A device that has played here before (any play data: most players never
 * changed a setting, so had no settings record) keeps today's tree, the star and the game's presents (until the
 * recompute in C2), and a v1 settings record's scene and path; Auto, which is gone, becomes Fireside. A new device gets
 * the starter look.
 */
function migrate(): Look {
  if (!hasPlayed()) return STARTER_LOOK;
  const v1 = readJSON(SETTINGS_KEY, (v): v is Record<string, unknown> => isRecord(v) && v.v === 1);
  return {
    ...STARTER_LOOK,
    scene: v1?.scene === 'auto' ? 'fireside' : pick(SCENES, v1?.scene, STARTER_LOOK.scene),
    path: pick(PATHS, v1?.pathStyle, STARTER_LOOK.path),
    topper: 'star',
    presents: 'game',
  };
}

/** The saved look; on a device without one, the migrated (or starter) look, saved. Read before settings are re-saved. */
export function loadLook(): Look {
  const saved = readJSON(KEY, isRecord);
  if (saved) return parseLook(saved);
  const l = migrate();
  saveLook(l);
  return l;
}

export const saveLook = (l: Look): void => writeJSON(KEY, l);

/**
 * The look the stage shows in an egg world. Secret mode and Home Alone keep their own sky and tree: only the light path
 * (and the scene id, which steers the radio) carry in. The topper is kept in secret mode: the star-head egg flips from it.
 */
export function worldLook(l: Look, world: 'secret' | 'home-alone' | null): Look {
  if (world === null) return l;
  const w: Look = { ...l, palette: 'scene', decor: NO_DECOR, presents: 'game' };
  return world === 'home-alone' ? { ...w, topper: 'star' } : w;
}
