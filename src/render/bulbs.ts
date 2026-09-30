import { D, L, U } from '../core/dirs';
import { mix, rgba, shade } from './color';
import type { PathStyle } from './paths';
import type { Scene } from './scenes';

const TAU = Math.PI * 2;

/** Angle from the bulb toward its wire (the socket side). */
export const bulbAngle = (b: number): number => (b & U ? -Math.PI / 2 : b & D ? Math.PI / 2 : b & L ? Math.PI : 0);

/** Glass bulb with a socket facing the wire. `amt` 0 = unlit; ≥1 lit (values >1 swell during the pop). */
export function drawBulb(c: CanvasRenderingContext2D, b: number, color: string, amt: number, s: number, sc: Scene, style: PathStyle): void {
  const r = s * (style === 'fairy' ? 0.18 : 0.2) * (amt > 1 ? 1 + (amt - 1) * 0.35 : 1);
  const a = bulbAngle(b);
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
}

export function drawBulbHalo(c: CanvasRenderingContext2D, color: string, amt: number, s: number): void {
  if (amt <= 0) return;
  const rad = s * 1.1 * amt;
  const gr = c.createRadialGradient(0, 0, 0, 0, 0, rad);
  gr.addColorStop(0, rgba(color, 0.95));
  gr.addColorStop(0.28, rgba(color, 0.38));
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
