import { D, L, U } from '../core/dirs';
import { hexRgb, mix, rgba, shade } from './color';
import { shadowOffset, type PathStyle } from './paths';
import type { Scene } from './scenes';

const TAU = Math.PI * 2;

/** Angle from the bulb toward its wire (the socket side). */
export const bulbAngle = (b: number): number => (b & U ? -Math.PI / 2 : b & D ? Math.PI / 2 : b & L ? Math.PI : 0);

/** Glass bulb with a socket facing the wire. `amt` 0 = unlit; ≥1 lit (values >1 swell during the pop). */
export function drawBulb(c: CanvasRenderingContext2D, b: number, color: string, amt: number, s: number, sc: Scene, style: PathStyle, angle = 0): void {
  const r = s * (style === 'fairy' ? 0.18 : 0.2) * (amt > 1 ? 1 + (amt - 1) * 0.35 : 1);
  const a = bulbAngle(b);
  if (amt <= 0) drawBulbUnder(c, r, a, sc, s, angle);
  c.save();
  c.rotate(a);
  c.fillStyle = sc.socket;
  c.beginPath();
  c.roundRect(r * 0.55, -r * 0.38, r * 0.75, r * 0.76, r * 0.12);
  c.fill();
  c.restore();
  const gx = -Math.cos(a) * r * 0.12;
  const gy = -Math.sin(a) * r * 0.12;
  const gr = c.createRadialGradient(gx - r * 0.3, gy - r * 0.35, r * 0.05, gx, gy, r);
  if (amt > 0) {
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(0.45, mix(color, '#ffffff', 0.55));
    gr.addColorStop(1, mix(color, '#ffffff', 0.1));
    c.globalAlpha = Math.min(1, 0.35 + amt);
  } else if (sc.bulbFrost > 0) {
    // Daylight: frosted glass, paler and matte with a bright rim, so it reads on the dark fir without glowing.
    const f = sc.bulbFrost;
    gr.addColorStop(0, `rgba(255,255,255,${0.55 + 0.25 * f})`);
    gr.addColorStop(0.25, tone(color, 0.7 + 0.05 * f, FROST, 0.45 * f));
    gr.addColorStop(1, tone(color, 0.36 + 0.06 * f, FROST_SHADOW, 0.3 * f));
  } else {
    gr.addColorStop(0, 'rgba(255,255,255,.55)');
    gr.addColorStop(0.25, shade(color, 0.7));
    gr.addColorStop(1, shade(color, 0.36));
  }
  c.fillStyle = gr;
  c.beginPath();
  c.arc(gx, gy, r, 0, TAU);
  c.fill();
  c.globalAlpha = 1;
  if (amt <= 0 && sc.bulbFrost > 0) {
    c.strokeStyle = `rgba(255,255,255,${0.5 * sc.bulbFrost})`;
    c.lineWidth = Math.max(0.8, r * 0.12);
    c.beginPath();
    c.arc(gx, gy, r - c.lineWidth / 2, 0, TAU);
    c.stroke();
  }
}

/** The daylight treatment under an unlit bulb (scene.unlitLook): a soft glint halo or a resting shadow. */
function drawBulbUnder(c: CanvasRenderingContext2D, r: number, a: number, sc: Scene, s: number, angle: number): void {
  const look = sc.unlitLook;
  if (look !== 'glint' && look !== 'shadow') return;
  const gx = -Math.cos(a) * r * 0.12;
  const gy = -Math.sin(a) * r * 0.12;
  if (look === 'glint') {
    c.fillStyle = 'rgba(236,246,252,.08)';
    c.beginPath();
    c.arc(gx, gy, r + s * 0.1, 0, TAU);
    c.fill();
    c.fillStyle = 'rgba(236,246,252,.14)';
    c.beginPath();
    c.arc(gx, gy, r + s * 0.05, 0, TAU);
    c.fill();
    return;
  }
  const [dx, dy] = shadowOffset(s, angle);
  c.fillStyle = 'rgba(0,14,10,.16)';
  c.beginPath();
  c.arc(gx + dx, gy + dy, r + s * 0.065, 0, TAU);
  c.fill();
  c.fillStyle = 'rgba(0,14,10,.26)';
  c.beginPath();
  c.arc(gx + dx, gy + dy, r + s * 0.025, 0, TAU);
  c.fill();
}

/** Frosted glass in daylight: a muted blue-grey body (never as bright or saturated as a lit bulb) and its shaded edge. */
const FROST: readonly [number, number, number] = [168, 180, 188];
const FROST_SHADOW: readonly [number, number, number] = [44, 54, 60];

/** `hex` scaled by `value`, then mixed toward `to` by `k`. */
function tone(hex: string, value: number, to: readonly [number, number, number], k: number): string {
  return `rgb(${hexRgb(hex).map((v, i) => Math.round(v * value + (to[i] - v * value) * k)).join(',')})`;
}

export function drawBulbHalo(c: CanvasRenderingContext2D, color: string, amt: number, s: number): void {
  if (amt <= 0) return;
  const rad = s * 0.8 * amt;
  const gr = c.createRadialGradient(0, 0, 0, 0, 0, rad);
  gr.addColorStop(0, rgba(color, 0.95));
  gr.addColorStop(0.25, rgba(color, 0.42));
  gr.addColorStop(1, rgba(color, 0));
  c.fillStyle = gr;
  c.fillRect(-rad, -rad, 2 * rad, 2 * rad);
}

/** Cross-shaped glint when a bulb lights (spec §4.5 item 5). */
export function drawBulbGlint(c: CanvasRenderingContext2D, sinceLitMs: number, s: number): void {
  if (sinceLitMs < 0 || sinceLitMs > 520) return;
  const k = 1 - sinceLitMs / 520;
  const len = s * (0.35 + 0.75 * (1 - k * k));
  c.globalAlpha = k;
  c.strokeStyle = '#fff';
  c.lineWidth = Math.max(1, s * 0.02);
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(-len, 0);
  c.lineTo(len, 0);
  c.moveTo(0, -len * 0.7);
  c.lineTo(0, len * 0.7);
  c.stroke();
  c.globalAlpha = 1;
}
