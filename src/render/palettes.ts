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
  // The lab's Golden (Luke: "more yellow, less gray"): saturated yellow-golds, no near-whites.
  golden: ['#ffc83a', '#ffd95e', '#ffb526', '#ffe27a', '#ffa91c', '#ffcf48'],
  // Candy: bubblegum, lime, grape, tangerine, lemon, aqua.
  candy: ['#ff4f9a', '#9cf03c', '#a45bff', '#ff8a2a', '#ffe23c', '#3fe0e0'],
  // Emerald: six greens, deep to pale.
  emerald: ['#22d97f', '#0fae62', '#6cf2ab', '#17c070', '#a8f7cc', '#3be892'],
  // Disco: hot pink, cyan, yellow, violet, green, orange at full saturation.
  disco: ['#ff2fd0', '#2ff0ff', '#ffe52f', '#7a3dff', '#3dff6e', '#ff6a2f'],
  // Peppermint: candy red and white, with a blush between.
  peppermint: ['#ff2d3d', '#fff4f0', '#e8202e', '#ffe0e4', '#ff5a66', '#fffaf6'],
  // Snow: whites with a cold blue cast.
  snow: ['#fafcff', '#e6f2ff', '#f2f8ff', '#d6e8ff', '#ffffff', '#e0eeff'],
  // Rose gold: pinked golds and coppers.
  rosegold: ['#f6b3a2', '#e89a86', '#ffd3c4', '#d98a75', '#ffc2ae', '#f9e0d4'],
  // Copper: burnished orange-browns.
  copper: ['#e8894a', '#d4703a', '#f5a46a', '#c45f2c', '#ffb980', '#e07a40'],
  // Sapphire: six blues, deep to pale.
  sapphire: ['#2f5bff', '#1e3fd8', '#5a82ff', '#2a4ae8', '#8aa6ff', '#3d6cff'],
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
