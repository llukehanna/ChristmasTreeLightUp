/**
 * The C9 strand (season two, C3; ported from the lab's strands-c9): big bulbs in opaque painted ceramic (the dipped-paint
 * outdoor bulbs of the 1950s–60s) on a ribbed green socket. Unlit: a satin painted surface lit by the room (no glass
 * streaks; paint is matte). Lit: the paint glows evenly from within, brightest where it is thinnest at the tip, with a
 * soft satin sheen. Nothing in it moves: every bulb is a cached sprite.
 */
import { D, L, R, U } from '../../core/dirs';
import type { Scene } from '../scenes';
import { blit, clamp01, css, devScale, haloSprite, lerp3, luma, mul3, rgb, sat, sprite, TAU, WHITE, type RGB } from './kit';

/* Upright frame (tile units): origin at the socket's wire end, the bulb pointing along −y. */
const SOCK_H = 0.135;
const SOCK_W = 0.125;
const G0 = -0.115; // where the glass leaves the socket
const Z = 0.45; // glass length
const TIP = G0 - Z * 1.03;
const GC = G0 - Z * 0.46; // glass centre
const BOX = [-0.22, -0.63, 0.44, 0.67] as const;

export function c9Pose(bits: number): { ax: number; ay: number; rot: number } {
  if (bits & D) return { ax: 0, ay: 0.235, rot: 0 };
  if (bits & U) return { ax: 0, ay: -0.235, rot: Math.PI };
  if (bits & L) return { ax: -0.235, ay: 0, rot: Math.PI / 2 };
  if (bits & R) return { ax: 0.235, ay: 0, rot: -Math.PI / 2 };
  return { ax: 0, ay: 0.235, rot: 0 };
}

/** The C9 strawberry (same profile as the garland's glass, pointing up). */
function glassPath(c: CanvasRenderingContext2D): void {
  const z = Z;
  c.beginPath();
  c.moveTo(-0.2 * z, G0);
  c.bezierCurveTo(-0.43 * z, G0 - 0.16 * z, -0.37 * z, G0 - 0.62 * z, -0.09 * z, G0 - 0.95 * z);
  c.quadraticCurveTo(0, G0 - 1.04 * z, 0.09 * z, G0 - 0.95 * z);
  c.bezierCurveTo(0.37 * z, G0 - 0.62 * z, 0.43 * z, G0 - 0.16 * z, 0.2 * z, G0);
  c.closePath();
}

/** The screen's light (upper left) seen in the bulb's own frame. */
function lightDir(rot: number): [number, number] {
  const lx = -0.55;
  const ly = -0.83;
  const cs = Math.cos(-rot);
  const sn = Math.sin(-rot);
  return [lx * cs - ly * sn, lx * sn + ly * cs];
}

function paintSocket(c: CanvasRenderingContext2D, lit: boolean, sc: Scene, rot: number): void {
  const day = sc.light === 'day';
  const base: RGB = day ? [52, 112, 74] : sc.light === 'fire' ? [40, 82, 50] : [36, 80, 60];
  const [lx] = lightDir(rot);
  const w = SOCK_W;
  const gr = c.createLinearGradient(-w / 2, 0, w / 2, 0);
  const hiAt = 0.5 + lx * 0.25;
  gr.addColorStop(0, css(mul3(base, 0.35)));
  gr.addColorStop(clamp01(hiAt - 0.05), css(lerp3(base, WHITE, day ? 0.3 : 0.18)));
  gr.addColorStop(clamp01(hiAt + 0.2), css(base));
  gr.addColorStop(1, css(mul3(base, 0.3)));
  c.fillStyle = gr;
  c.beginPath();
  c.roundRect(-w / 2, -SOCK_H, w, SOCK_H + 0.01, [0.03, 0.03, 0.02, 0.02]);
  c.fill();
  // Ribs.
  c.strokeStyle = 'rgba(0,0,0,.35)';
  c.lineWidth = 0.006;
  for (const y of [-SOCK_H * 0.32, -SOCK_H * 0.58]) {
    c.beginPath();
    c.moveTo(-w / 2, y);
    c.lineTo(w / 2, y);
    c.stroke();
  }
  c.strokeStyle = `rgba(255,255,255,${day ? 0.3 : 0.12})`;
  for (const y of [-SOCK_H * 0.32 - 0.007, -SOCK_H * 0.58 - 0.007]) {
    c.beginPath();
    c.moveTo(-w * 0.45, y);
    c.lineTo(w * 0.45, y);
    c.stroke();
  }
  // The collar where the glass seats: catches the bulb's light.
  c.fillStyle = lit ? 'rgba(255,226,170,.75)' : 'rgba(0,0,0,.35)';
  c.beginPath();
  c.ellipse(0, -SOCK_H + 0.004, w * 0.42, 0.012, 0, 0, TAU);
  c.fill();
}

function paintGlass(c: CanvasRenderingContext2D, base: RGB, lit: boolean, sc: Scene, rot: number): void {
  const day = sc.light === 'day';
  const [lx, ly] = lightDir(rot);
  const pale = luma(base) > 0.8;
  const col = pale ? base : sat(base, lit ? 1.3 : 1.1);
  glassPath(c);
  if (lit) {
    // Even inner glow through the paint; the thin-painted tip burns brighter.
    const gr = c.createRadialGradient(0, GC + Z * 0.06, 0.01, 0, GC, Z * 0.6);
    gr.addColorStop(0, css(lerp3(col, WHITE, pale ? 0.75 : 0.62)));
    gr.addColorStop(0.32, css(lerp3(col, WHITE, pale ? 0.42 : 0.24)));
    gr.addColorStop(0.7, css(pale ? lerp3(col, [255, 190, 110], 0.2) : col));
    gr.addColorStop(1, css(mul3(pale ? lerp3(col, [255, 170, 90], 0.45) : col, 0.6)));
    c.fillStyle = gr;
    c.fill();
    c.save();
    glassPath(c);
    c.clip();
    const tip = c.createRadialGradient(0, TIP + 0.02, 0, 0, TIP + 0.02, Z * 0.32);
    tip.addColorStop(0, 'rgba(255,252,240,.7)');
    tip.addColorStop(1, 'rgba(255,252,240,0)');
    c.fillStyle = tip;
    c.fillRect(-0.2, TIP - 0.02, 0.4, 0.2);
    // Satin sheen toward the light.
    const sh = c.createRadialGradient(lx * Z * 0.17, GC + ly * Z * 0.24, 0, lx * Z * 0.17, GC + ly * Z * 0.24, Z * 0.2);
    sh.addColorStop(0, 'rgba(255,255,255,.55)');
    sh.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = sh;
    c.fillRect(-0.2, TIP - 0.02, 0.4, 0.5);
    c.restore();
    return;
  }
  // Unlit painted ceramic: diffuse shading from the room's light, a satin sheen, no glassy streak.
  const k = day ? 0.95 : sc.light === 'fire' ? 0.58 : 0.5;
  const body = mul3(sc.light === 'moon' ? lerp3(col, [170, 186, 220], 0.06) : col, k);
  const cx = lx * Z * 0.16;
  const cy = GC + ly * Z * 0.2;
  const gr = c.createRadialGradient(cx, cy, 0.005, 0, GC, Z * 0.62);
  gr.addColorStop(0, css(lerp3(body, WHITE, day ? 0.32 : 0.16)));
  gr.addColorStop(0.35, css(body));
  gr.addColorStop(0.8, css(mul3(body, 0.6)));
  gr.addColorStop(1, css(mul3(body, 0.38)));
  c.fillStyle = gr;
  c.fill();
  c.save();
  glassPath(c);
  c.clip();
  // Paint pools thicker near the socket (dipped): a touch darker there.
  const dip = c.createLinearGradient(0, G0, 0, G0 - Z * 0.35);
  dip.addColorStop(0, 'rgba(0,0,0,.28)');
  dip.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = dip;
  c.fillRect(-0.2, G0 - Z * 0.35, 0.4, Z * 0.36);
  const sh = c.createRadialGradient(cx * 1.1, cy - 0.01, 0, cx * 1.1, cy - 0.01, Z * 0.17);
  sh.addColorStop(0, `rgba(255,255,255,${day ? 0.6 : 0.34})`);
  sh.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = sh;
  c.fillRect(-0.2, TIP - 0.02, 0.4, 0.5);
  // A faint rim from the opposite side (bounce light), so the silhouette reads on the dark fir.
  c.strokeStyle = `rgba(255,255,255,${day ? 0.28 : 0.1})`;
  c.lineWidth = 0.014;
  c.translate(-lx * 0.006, -ly * 0.006);
  glassPath(c);
  c.stroke();
  c.restore();
}

function c9Sprite(col: string, lit: boolean, s: number, ppu: number, sc: Scene, rot: number) {
  return sprite(`c9|${col}|${lit ? 1 : 0}|${sc.light}|${rot.toFixed(2)}`, s, ppu, BOX, (c) => {
    paintGlass(c, rgb(col), lit, sc, rot);
    paintSocket(c, lit, sc, rot);
  });
}

export function c9Bulb(c: CanvasRenderingContext2D, bits: number, color: string, amt: number, s: number, sc: Scene): void {
  const pose = c9Pose(bits);
  const swell = amt > 1 ? 1 + (amt - 1) * 0.15 : 1;
  const ppu = devScale(c) * swell;
  c.save();
  c.translate(pose.ax * s, pose.ay * s);
  c.rotate(pose.rot);
  if (swell !== 1) c.scale(swell, swell);
  if (amt <= 0) blit(c, c9Sprite(color, false, s, ppu, sc, pose.rot));
  else {
    c.globalAlpha = Math.min(1, amt);
    blit(c, c9Sprite(color, true, s, ppu, sc, pose.rot));
    if (amt > 1) {
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = clamp01((amt - 1) * 0.6);
      blit(c, c9Sprite(color, true, s, ppu, sc, pose.rot));
    }
  }
  c.restore();
}

export function c9Halo(g: CanvasRenderingContext2D, bits: number, color: string, amt: number, s: number): void {
  if (amt <= 0) return;
  const pose = c9Pose(bits);
  const a = Math.min(1.4, amt);
  g.save();
  g.translate(pose.ax * s, pose.ay * s);
  g.rotate(pose.rot);
  const sp = haloSprite(rgb(color), [[0, 0.95], [0.2, 0.5], [0.5, 0.15], [1, 0]]);
  const rw = s * 0.78 * a;
  const rh = s * 0.92 * a;
  g.globalAlpha = Math.min(1, a);
  g.drawImage(sp, -rw, GC * s - rh, 2 * rw, 2 * rh);
  g.restore();
}
