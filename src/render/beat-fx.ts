/** What the beat moves in secret mode (spec 2026-10-08 secret mode §5.3). Pure, so a frame allocates nothing. */

const TAU = Math.PI * 2;
const smooth = (x: number) => x * x * (3 - 2 * x);

export const NOD_MS = 260;
/** How far the head dips at the nod's deepest (tiles), and how much it squashes. */
export const NOD_DIP = 0.09;
export const NOD_SQUASH = 0.03;

/** 0 → 1 → 0 over NOD_MS after a beat: a quick dip (30 %) and a slower return. */
export function nodPulse(t: number): number {
  const k = t / NOD_MS;
  if (!(k >= 0 && k < 1)) return 0;
  return k < 0.3 ? smooth(k / 0.3) : 1 - smooth((k - 0.3) / 0.7);
}

/** Extra brightness for every lit tree bulb `t` ms after a beat; gentler under reduced motion. */
export function beatPulse(t: number, strength: number, reduced: boolean): number {
  if (!(t >= 0)) return 0;
  return reduced ? 0.25 * strength * Math.exp(-t / 250) : 0.6 * strength * Math.exp(-t / 180);
}

/** The garland face's bob, in bulb sizes (down): a slow idle sway plus a dip on each beat. Still under reduced motion. */
export function garlandBob(now: number, at: number, strength: number, reduced: boolean): number {
  if (reduced) return 0;
  return 0.05 * Math.sin((TAU * now) / 2400) + 0.16 * strength * nodPulse(now - at);
}
