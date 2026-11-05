import type { PaletteId } from '../store/look';
import type { Scene } from './scenes';

/** The bulb colours a look can dress the tree in; 'scene' keeps each scene's own. */
export const PALETTES: Readonly<Record<Exclude<PaletteId, 'scene'>, readonly string[]>> = {
  // The traditional multicolour string: cherry red, emerald, cobalt, amber, orange, warm white.
  classic: ['#ff1a24', '#22c25a', '#2f6bff', '#ffbf1f', '#ff8a1a', '#fff1d4'],
  // Golden bulbs, and the lit wire turns yellow-gold to match (see GILDED).
  gilded: ['#ffcc3e', '#ffdc62', '#ffb92a', '#ffe47e', '#ffad20', '#ffd24c'],
  // Ice: glacier, sky, frost white, sapphire, pale aqua, moonlight.
  ice: ['#9fd6ff', '#5fb0ff', '#eef8ff', '#3f86ff', '#a8eef2', '#d6e6ff'],
  // Gold and silver: bright gold, cool silver, deep gold, pewter blue-silver, champagne, platinum.
  goldsilver: ['#ffc94f', '#e4ebf2', '#ffab2e', '#c3d0de', '#ffe3a1', '#f6f8fb'],
  // 1950s aluminium-tree pastels: pink, mint, powder blue, lilac, butter, peach.
  pastel: ['#ff9cc4', '#8ff0c4', '#94cbff', '#c7a4ff', '#fff08f', '#ffbf96'],
};

/** Gilded's lit wire: a yellower core, glow and neon than the scenes' orange-amber. */
export const GILDED: Partial<Scene> = { core: '#fff6d0', glow: '#ffcc48', copperOn: 'rgba(250,210,110,.95)', neon: '#ffc23a', neonMid: '#ffdb7a' };

const memo = new WeakMap<Scene, Map<PaletteId, Scene>>();

/**
 * The scene with its six bulb colours replaced by the palette's ('scene' keeps them). The egg worlds keep their own.
 * Memoised per scene and palette, so the same pair is the same object (App.setScene tells a change by identity).
 */
export function withPalette(sc: Scene, p: PaletteId): Scene {
  if (p === 'scene' || sc.id === 'aurora' || sc.id === 'home-alone') return sc;
  let m = memo.get(sc);
  if (!m) memo.set(sc, (m = new Map()));
  let out = m.get(p);
  if (!out) m.set(p, (out = { ...sc, bulbs: PALETTES[p], ...(p === 'gilded' ? GILDED : {}) }));
  return out;
}
