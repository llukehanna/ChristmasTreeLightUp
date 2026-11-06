import type { GarlandSet } from '../store/look';

/** The garland cycles six colours along its bulbs, as the tree's bulbs do. */
export const GARLAND_COLOURS = 6;

/**
 * The garland's bulb colours (season two, Parts C2+C3). The game's set ('game') has none of its own: it wears the tree's
 * bulbs, the scene's or the look's palette, as it always has.
 */
export const GARLAND_SETS: Readonly<Record<Exclude<GarlandSet, 'game'>, readonly string[]>> = {
  // Candlelight: warm flame tones, honey to ivory.
  candlelight: ['#ffc46a', '#ffb24a', '#ffd590', '#ffa83a', '#ffcb7a', '#ffe0a8'],
  // Gold: bright, deep and pale golds.
  gold: ['#ffc23a', '#ffd766', '#e9a722', '#ffe08a', '#d99a1e', '#ffcc4d'],
  // Mercury glass: silvered glass with a faint warm or cool cast.
  mercury: ['#dfe6ee', '#c9d6e4', '#f2f5f8', '#b8c6d6', '#e8dfd6', '#d4dde8'],
  // Champagne: pale straw golds.
  champagne: ['#f5d58c', '#ecc272', '#f8e0a8', '#e3b562', '#f0cf8e', '#fbe6bc'],
  // Silver: cool silvers and platinum.
  silver: ['#e6ecf2', '#c8d3de', '#f6f8fb', '#b3c1cf', '#dde5ee', '#eef2f6'],
  // Ice: glacier blues and frost.
  ice: ['#8fd0ff', '#c9ecff', '#5aa8f0', '#b8f0f4', '#e6f6ff', '#7cc4f0'],
  // Pastel: pink, mint, powder blue, lilac, butter, peach.
  pastel: ['#ffb3d1', '#a6f0d0', '#a8d4ff', '#d4b8ff', '#fff3a6', '#ffcaa8'],
  // Classic: the old C9 string, red, green, blue, amber, orange, warm white.
  classic: ['#e8232c', '#22a352', '#2d63e0', '#ffbe2e', '#ff7a24', '#fff0d2'],
  // Peppermint: candy red, white and a mint.
  peppermint: ['#ff2d3d', '#fff4f0', '#e01828', '#ffd6dc', '#3fcf8e', '#fff9f6'],
  // Rose gold: pinked golds.
  rosegold: ['#f4b6a6', '#e8a090', '#ffd2c4', '#d98c7a', '#f7c4b0', '#ffe2d6'],
};
