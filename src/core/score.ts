/** Original Game.Fi: ah - bh * seconds = 50000 - 100 × whole seconds (can go negative, like the original). */
export const scoreFor = (seconds: number): number => 50000 - 100 * seconds;
export const wholeSeconds = (ms: number): number => Math.floor(ms / 1000);
export const formatTime = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
