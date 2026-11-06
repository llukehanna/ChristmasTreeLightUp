import { STARTER, type ItemId, type Slot } from '../core/catalogue';
import type { PathStyle } from '../render/paths';
import type { SceneId } from '../render/scenes';
import { hasPlayed, readJSON, writeJSON } from './storage';

export type PaletteId =
  | 'scene' | 'gilded' | 'classic' | 'ice' | 'goldsilver' | 'pastel'
  | 'golden' | 'candy' | 'emerald' | 'disco' | 'peppermint' | 'snow' | 'rosegold' | 'copper' | 'sapphire';
export type TopperKind = 'snowflake' | 'star' | 'angel' | 'bow' | 'silverstar' | 'goldstar';
export type PresentSet = 'none' | 'game' | 'luxe' | 'kraft' | 'silver' | 'tartan' | 'starry' | 'candystripe' | 'goldfoil';
/** The garland's bulb colours across the top: 'game' wears the tree's own (src/render/garland-sets.ts). */
export type GarlandSet = 'game' | 'candlelight' | 'gold' | 'mercury' | 'champagne' | 'silver' | 'ice' | 'pastel' | 'classic' | 'peppermint' | 'rosegold';
/** The results tag's paper and ribbon (src/ui/tag-styles.css). */
export type TagStyle =
  | 'plain' | 'silver' | 'goldfoil' | 'velvet' | 'tartan' | 'holly' | 'plaid' | 'ember' | 'frost' | 'gingerbread' | 'snowflake' | 'kraft'
  | 'candystripe' | 'starry';
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
  garland: GarlandSet;
  tag: TagStyle;
}

/**
 * What the renderer dresses the tree with: everything in the look but the scene, the light path and the results tag, and
 * how many of the placed presents to show (the pile: Decision 9).
 */
export type Dress = Pick<Look, 'palette' | 'topper' | 'decor' | 'presents' | 'garland'> & { pile: number };

export const NO_DECOR: Decor = { tinsel: false, beads: false, canes: false, skirt: false };

export const STARTER_LOOK: Look = {
  v: 1, scene: 'fireside', path: 'filament', palette: 'scene', topper: 'snowflake', decor: NO_DECOR, presents: 'none', garland: 'game', tag: 'plain',
};

const KEY = 'aglow.look';
const SETTINGS_KEY = 'aglow.settings';
const SCENES: readonly string[] = ['midnight', 'fireside', 'frost', 'sash', 'square', 'parlour'];
const PATHS: readonly string[] = ['filament', 'fairy', 'neon', 'neonbright'];
const PALETTES: readonly string[] = [
  'scene', 'gilded', 'classic', 'ice', 'goldsilver', 'pastel', 'golden', 'candy', 'emerald', 'disco', 'peppermint', 'snow', 'rosegold', 'copper', 'sapphire',
];
const TOPPERS: readonly string[] = ['snowflake', 'star', 'angel', 'bow', 'silverstar', 'goldstar'];
const PRESENTS: readonly string[] = ['none', 'game', 'luxe', 'kraft', 'silver', 'tartan', 'starry', 'candystripe', 'goldfoil'];
const GARLANDS: readonly string[] = ['game', 'candlelight', 'gold', 'mercury', 'champagne', 'silver', 'ice', 'pastel', 'classic', 'peppermint', 'rosegold'];
const TAGS: readonly string[] = [
  'plain', 'silver', 'goldfoil', 'velvet', 'tartan', 'holly', 'plaid', 'ember', 'frost', 'gingerbread', 'snowflake', 'kraft', 'candystripe', 'starry',
];

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
    garland: pick(GARLANDS, o.garland, STARTER_LOOK.garland),
    tag: pick(TAGS, o.tag, STARTER_LOOK.tag),
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/**
 * The look the first load of this device gets. A device that has played here before (any play data: most players never
 * changed a setting, so had no settings record) keeps today's tree, the star and the game's presents (shown once
 * earned: effectiveLook), and a v1 settings record's scene and path; Auto, which is gone, becomes Fireside. A new device
 * gets the starter look.
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
 * The look the stage shows in an egg world. Secret mode and Home Alone keep their own sky and tree, garland and tag: only
 * the light path (and the scene id, which steers the radio) carry in. The topper is kept in secret mode: the star-head
 * egg flips from it.
 */
export function worldLook(l: Look, world: 'secret' | 'home-alone' | null): Look {
  if (world === null) return l;
  const w: Look = { ...l, palette: 'scene', decor: NO_DECOR, presents: 'game', garland: 'game', tag: 'plain' };
  return world === 'home-alone' ? { ...w, topper: 'star' } : w;
}

/**
 * The look as the player may show it: each slot they don't own takes the starter's value, and each decoration they don't
 * own is off. The saved look is left as it is, so an item earned later comes back.
 */
export function effectiveLook(l: Look, owns: (id: ItemId) => boolean): Look {
  const has = (slot: Slot, value: string): boolean => value === STARTER[slot] || owns(`${slot}:${value}` as ItemId);
  const keep = <K extends 'scene' | 'path' | 'palette' | 'topper' | 'presents' | 'garland' | 'tag'>(slot: K): Look[K] =>
    has(slot, l[slot]) ? l[slot] : (STARTER[slot] as Look[K]);
  const decor = (k: keyof Decor): boolean => l.decor[k] && has('decor', k);
  return {
    ...l,
    scene: keep('scene'),
    path: keep('path'),
    palette: keep('palette'),
    topper: keep('topper'),
    presents: keep('presents'),
    garland: keep('garland'),
    tag: keep('tag'),
    decor: { tinsel: decor('tinsel'), beads: decor('beads'), canes: decor('canes'), skirt: decor('skirt') },
  };
}
