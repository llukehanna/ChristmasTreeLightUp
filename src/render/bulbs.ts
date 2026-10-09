import { D, L, U } from '../core/dirs';
import { hexRgb, mix, rgba, shade } from './color';
import { FACE_ORNAMENT_H } from './faces';
import { GLINT_NEAR, GLINT_WIDE, type PathStyle } from './paths';
import type { Scene } from './scenes';

const TAU = Math.PI * 2;

/** Angle from the bulb toward its wire (the socket side). */
export const bulbAngle = (b: number): number => (b & U ? -Math.PI / 2 : b & D ? Math.PI / 2 : b & L ? Math.PI : 0);

/** Glass bulb with a socket facing the wire. `amt` 0 = unlit; ≥1 lit (values >1 swell during the pop). */
export function drawBulb(c: CanvasRenderingContext2D, b: number, color: string, amt: number, s: number, sc: Scene, style: PathStyle): void {
  const r = s * (style === 'fairy' ? 0.18 : 0.2) * (amt > 1 ? 1 + (amt - 1) * 0.35 : 1);
  const a = bulbAngle(b);
  if (amt <= 0) drawBulbUnder(c, r, a, sc, style, s);
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

/** An unlit bulb on a glint-treated style gets the same soft snow-glint halo as its wire. */
function drawBulbUnder(c: CanvasRenderingContext2D, r: number, a: number, sc: Scene, style: PathStyle, s: number): void {
  if (sc.unlit[style].look !== 'glint') return;
  const gx = -Math.cos(a) * r * 0.12;
  const gy = -Math.sin(a) * r * 0.12;
  c.fillStyle = GLINT_WIDE;
  c.beginPath();
  c.arc(gx, gy, r + s * 0.1, 0, TAU);
  c.fill();
  c.fillStyle = GLINT_NEAR;
  c.beginPath();
  c.arc(gx, gy, r + s * 0.05, 0, TAU);
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

/**
 * Secret mode's face ornament (spec 2026-10-08 secret mode §3.2): the socket still faces the wire, and Luke's head,
 * upright, takes the glass's place: `sprite` is dimmed when unlit, lit (at the glass's opacity) when lit.
 */
export function drawFaceBulb(c: CanvasRenderingContext2D, b: number, amt: number, s: number, sc: Scene, sprite: HTMLCanvasElement): void {
  const swell = amt > 1 ? 1 + (amt - 1) * 0.35 : 1;
  const r = s * 0.2 * swell;
  const a = bulbAngle(b);
  c.save();
  c.rotate(a);
  c.fillStyle = sc.socket;
  c.beginPath();
  c.roundRect(r * 0.55, -r * 0.38, r * 0.75, r * 0.76, r * 0.12);
  c.fill();
  c.restore();
  const h = s * FACE_ORNAMENT_H * swell;
  const w = (h * sprite.width) / sprite.height;
  const gx = -Math.cos(a) * r * 0.12;
  const gy = -Math.sin(a) * r * 0.12;
  const a0 = c.globalAlpha;
  if (amt > 0) c.globalAlpha = a0 * Math.min(1, 0.35 + amt);
  c.drawImage(sprite, gx - w / 2, gy - h * 0.55, w, h);
  c.globalAlpha = a0;
}
