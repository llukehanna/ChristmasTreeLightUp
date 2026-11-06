/**
 * The candle strand (season two, C3; ported from the lab's strands-candle): Victorian candles. A small ivory wax candle
 * in a clip-on tin holder at each end tile, always upright (it stays upright while its tile turns; the clip turns with
 * the wire). Lit: a live, gently flickering flame and a soft warm halo; the wax near the flame glows. Unlit: the candle
 * with its blackened wick. Still (a calm frame, reduced motion, a stepped-down quality tier), the flame burns steady.
 */
import { D, L, R, U } from '../../core/dirs';
import type { Scene } from '../scenes';
import { blit, clamp01, css, devAngle, devScale, haloSprite, lerp3, mul3, rgb, sprite, TAU, WHITE, type RGB } from './kit';

const WAX: RGB = [246, 236, 214];
/** How much of the tile's bulb colour the wax takes (hand-dipped candles; 0 = all ivory). */
const WAX_TINT = 0.13;
const TIN: RGB = [176, 180, 184];

const CW = 0.092; // candle width
const C_TOP = -0.2;
const C_BOT = 0.05;
const CUP_Y = 0.045;
const FLAME_Y = C_TOP - 0.035;
const FLAME_H = 0.21;
const BOX = [-0.15, -0.27, 0.3, 0.44] as const;
/** Candle scale and how far it sits below the tile centre (so the flame stays inside the tile). */
const K = 1.35;
const LIFT = 0.09;

function waxColour(col: string): RGB {
  return lerp3(WAX, rgb(col), WAX_TINT);
}

function paintCandle(c: CanvasRenderingContext2D, col: string, lit: boolean, sc: Scene): void {
  const day = sc.light === 'day';
  const k = lit ? 1 : day ? 1 : sc.light === 'fire' ? 0.7 : 0.64;
  const coolK = sc.light === 'moon' && !lit ? 0.12 : 0;
  const wax = lerp3(mul3(waxColour(col), k), mul3([196, 210, 236], k), coolK);
  const tin = lit ? lerp3(TIN, [255, 206, 140], 0.35) : mul3(lerp3(TIN, [196, 210, 236], coolK), day ? 1 : sc.light === 'fire' ? 0.62 : 0.52);

  // Drip dish: a crimped tin plate under the cup.
  const dw = 0.22;
  const dish = c.createLinearGradient(-dw / 2, 0, dw / 2, 0);
  dish.addColorStop(0, css(mul3(tin, 0.45)));
  dish.addColorStop(0.3, css(lerp3(tin, WHITE, 0.3)));
  dish.addColorStop(0.6, css(tin));
  dish.addColorStop(1, css(mul3(tin, 0.4)));
  c.fillStyle = dish;
  c.beginPath();
  c.ellipse(0, CUP_Y + 0.012, dw / 2, 0.026, 0, 0, TAU);
  c.fill();
  c.strokeStyle = css(mul3(tin, 0.35), 0.7);
  c.lineWidth = 0.005;
  for (let i = -4; i <= 4; i++) {
    const x = (i / 4.6) * (dw / 2);
    c.beginPath();
    c.moveTo(x, CUP_Y + 0.012 + 0.024 * Math.sqrt(1 - (x / (dw / 2)) ** 2) - 0.004);
    c.lineTo(x * 1.03, CUP_Y + 0.012 + 0.026 * Math.sqrt(1 - (x / (dw / 2)) ** 2));
    c.stroke();
  }

  // The candle: cylinder shading, translucent wax glowing near the flame when lit.
  c.save();
  c.beginPath();
  c.roundRect(-CW / 2, C_TOP, CW, C_BOT - C_TOP, [0.012, 0.012, 0, 0]);
  c.clip();
  const body = c.createLinearGradient(-CW / 2, 0, CW / 2, 0);
  body.addColorStop(0, css(mul3(wax, lit ? 0.68 : 0.52)));
  body.addColorStop(0.32, css(lerp3(wax, WHITE, lit ? 0.25 : 0.1)));
  body.addColorStop(0.62, css(wax));
  body.addColorStop(1, css(mul3(wax, lit ? 0.62 : 0.45)));
  c.fillStyle = body;
  c.fillRect(-CW, C_TOP, 2 * CW, C_BOT - C_TOP);
  if (lit) {
    const glow = c.createLinearGradient(0, C_TOP, 0, C_TOP + 0.13);
    glow.addColorStop(0, 'rgba(255,214,150,.85)');
    glow.addColorStop(0.35, 'rgba(255,190,120,.32)');
    glow.addColorStop(1, 'rgba(255,190,120,0)');
    c.fillStyle = glow;
    c.fillRect(-CW, C_TOP, 2 * CW, 0.14);
  } else {
    const shadow = c.createLinearGradient(0, C_TOP, 0, C_BOT);
    shadow.addColorStop(0, 'rgba(0,0,0,0)');
    shadow.addColorStop(1, 'rgba(0,0,0,.22)');
    c.fillStyle = shadow;
    c.fillRect(-CW, C_TOP, 2 * CW, C_BOT - C_TOP);
  }
  c.restore();
  // A drip down the right side and the soft melted rim.
  c.fillStyle = css(lerp3(wax, WHITE, lit ? 0.35 : 0.08));
  c.beginPath();
  c.moveTo(CW * 0.18, C_TOP + 0.004);
  c.quadraticCurveTo(CW * 0.42, C_TOP + 0.01, CW * 0.36, C_TOP + 0.05);
  c.quadraticCurveTo(CW * 0.34, C_TOP + 0.075, CW * 0.27, C_TOP + 0.07);
  c.quadraticCurveTo(CW * 0.22, C_TOP + 0.04, CW * 0.18, C_TOP + 0.004);
  c.fill();
  c.fillStyle = css(lerp3(wax, WHITE, lit ? 0.55 : 0.15));
  c.beginPath();
  c.ellipse(0, C_TOP + 0.004, CW * 0.47, 0.011, 0, 0, TAU);
  c.fill();
  c.fillStyle = css(mul3(wax, lit ? 0.85 : 0.7));
  c.beginPath();
  c.ellipse(0, C_TOP + 0.006, CW * 0.32, 0.006, 0, 0, TAU);
  c.fill();
  // Specular down the left.
  c.fillStyle = `rgba(255,255,255,${lit ? 0.4 : day ? 0.55 : 0.22})`;
  c.beginPath();
  c.roundRect(-CW * 0.3, C_TOP + 0.03, CW * 0.12, C_BOT - C_TOP - 0.06, 0.006);
  c.fill();

  // The wick.
  c.strokeStyle = lit ? '#3a2416' : '#1b120c';
  c.lineWidth = 0.009;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(0, C_TOP + 0.004);
  c.quadraticCurveTo(0.002, C_TOP - 0.018, 0.008, C_TOP - 0.03);
  c.stroke();

  // The cup: a tin collar round the candle's foot.
  const cw = CW * 1.55;
  const cup = c.createLinearGradient(-cw / 2, 0, cw / 2, 0);
  cup.addColorStop(0, css(mul3(tin, 0.42)));
  cup.addColorStop(0.28, css(lerp3(tin, WHITE, 0.45)));
  cup.addColorStop(0.55, css(tin));
  cup.addColorStop(1, css(mul3(tin, 0.36)));
  c.fillStyle = cup;
  c.beginPath();
  c.moveTo(-cw / 2, CUP_Y - 0.045);
  c.lineTo(cw / 2, CUP_Y - 0.045);
  c.lineTo(cw * 0.38, CUP_Y + 0.012);
  c.lineTo(-cw * 0.38, CUP_Y + 0.012);
  c.closePath();
  c.fill();
  c.fillStyle = css(lerp3(tin, WHITE, 0.55));
  c.beginPath();
  c.ellipse(0, CUP_Y - 0.045, cw / 2, 0.008, 0, 0, TAU);
  c.fill();
}

/* ---------- the flame ---------- */

let flameCv: HTMLCanvasElement | null = null;
const FW = 64;
const FH = 128;

function flamePath(c: CanvasRenderingContext2D, w: number): void {
  c.beginPath();
  c.moveTo(0, -1);
  c.bezierCurveTo(0.5 * w, -0.68, 1.15 * w, -0.4, w, -0.16);
  c.bezierCurveTo(0.9 * w, 0.02, 0.4 * w, 0.07, 0, 0.07);
  c.bezierCurveTo(-0.4 * w, 0.07, -0.9 * w, 0.02, -w, -0.16);
  c.bezierCurveTo(-1.15 * w, -0.4, -0.5 * w, -0.68, 0, -1);
}

/** One flame, painted once (unit height, base at the origin), drawn each frame with its flicker as a transform. */
function flameSprite(): HTMLCanvasElement {
  if (flameCv) return flameCv;
  const cv = document.createElement('canvas');
  cv.width = FW;
  cv.height = FH;
  const c = cv.getContext('2d')!;
  // Unit space: x −0.5..0.5, y −1.1..0.15 mapped onto the canvas.
  c.setTransform(FW, 0, 0, FH / 1.25, FW / 2, (FH / 1.25) * 1.1);
  c.globalCompositeOperation = 'lighter';
  // Outer envelope: orange, fading at the edge.
  let gr = c.createRadialGradient(0, -0.25, 0.02, 0, -0.38, 0.62);
  gr.addColorStop(0, 'rgba(255,236,170,1)');
  gr.addColorStop(0.45, 'rgba(255,170,60,.85)');
  gr.addColorStop(0.8, 'rgba(230,90,20,.35)');
  gr.addColorStop(1, 'rgba(200,60,10,0)');
  c.fillStyle = gr;
  flamePath(c, 0.21);
  c.fill();
  // Bright core.
  gr = c.createRadialGradient(0, -0.2, 0.01, 0, -0.26, 0.34);
  gr.addColorStop(0, 'rgba(255,255,245,1)');
  gr.addColorStop(0.55, 'rgba(255,240,200,.85)');
  gr.addColorStop(1, 'rgba(255,220,150,0)');
  c.fillStyle = gr;
  c.save();
  c.translate(0, 0.02);
  c.scale(0.62, 0.62);
  flamePath(c, 0.21);
  c.fill();
  c.restore();
  // The blue root.
  c.globalCompositeOperation = 'source-over';
  gr = c.createRadialGradient(0, 0.0, 0.0, 0, 0.0, 0.11);
  gr.addColorStop(0, 'rgba(90,120,255,.0)');
  gr.addColorStop(0.55, 'rgba(90,130,255,.55)');
  gr.addColorStop(1, 'rgba(70,100,255,0)');
  c.fillStyle = gr;
  c.beginPath();
  c.ellipse(0, -0.02, 0.13, 0.08, 0, 0, TAU);
  c.fill();
  flameCv = cv;
  return cv;
}

interface Flame {
  h: number;
  lean: number;
  bright: number;
}

/** A still flame: upright, full height, steady. */
const STEADY: Flame = { h: 1, lean: 0, bright: 1 };

/** Height and lean of the flame at `now`: slow breathing, a quicker shiver, and an occasional draught. */
function flicker(now: number, seed: number): Flame {
  const t = now * 0.001;
  const p = seed * 1.618;
  const gust = Math.max(0, Math.sin(t * 0.37 + p * 2.1)) ** 12;
  const h = 1 + 0.06 * Math.sin(t * 7.3 + p) + 0.035 * Math.sin(t * 17.9 + p * 3.1) + 0.02 * Math.sin(t * 31 + p * 5) - 0.08 * gust;
  const lean = 0.07 * Math.sin(t * 1.9 + p) + 0.035 * Math.sin(t * 5.1 + p * 2.7) + 0.16 * gust * Math.sin(t * 9 + p);
  const bright = 0.92 + 0.08 * Math.sin(t * 9.7 + p * 1.3) - 0.12 * gust;
  return { h, lean, bright };
}

/* ---------- the clip ---------- */

const wireDir = (bits: number): [number, number] => (bits & U ? [0, -1] : bits & D ? [0, 1] : bits & L ? [-1, 0] : bits & R ? [1, 0] : [0, 1]);

/** The spring clip from the holder out along the wire (tile frame, so it turns with the tile). */
function paintClip(c: CanvasRenderingContext2D, bits: number, s: number, lit: boolean, sc: Scene): void {
  const [dx, dy] = wireDir(bits);
  const ang = Math.atan2(dy, dx);
  const day = sc.light === 'day';
  const tin = lit ? lerp3(TIN, [255, 206, 140], 0.35) : mul3(TIN, day ? 0.95 : sc.light === 'fire' ? 0.55 : 0.48);
  c.save();
  c.scale(s, s);
  c.rotate(ang);
  // Two tapered jaws, slightly apart, gripping the wire's run.
  for (const side of [-1, 1]) {
    c.fillStyle = css(side < 0 ? lerp3(tin, WHITE, 0.25) : mul3(tin, 0.55));
    c.beginPath();
    c.moveTo(0.02, side * 0.03);
    c.lineTo(0.27, side * 0.012);
    c.quadraticCurveTo(0.29, 0, 0.27, side * 0.002);
    c.lineTo(0.02, side * 0.005);
    c.closePath();
    c.fill();
  }
  // The coil spring.
  c.strokeStyle = css(lerp3(tin, WHITE, 0.15));
  c.lineWidth = 0.008;
  c.beginPath();
  c.ellipse(0.1, 0, 0.012, 0.034, 0, 0, TAU);
  c.stroke();
  c.restore();
}

/* ---------- entry points ---------- */

/** An end tile's candle: `amt` 0 is unlit, 1 lit, above 1 the pop. `bits`: the tile's links (the clip grips the wire). */
export function candleBulb(c: CanvasRenderingContext2D, bits: number, color: string, amt: number, s: number, sc: Scene, now: number, seed: number, still: boolean): void {
  const lit = amt > 0;
  paintClip(c, bits, s, lit, sc);
  c.save();
  c.rotate(-devAngle(c)); // upright, whatever the tile's turn
  c.translate(0, LIFT * s);
  c.scale(K, K);
  const ppu = devScale(c);
  if (!lit) {
    blit(c, sprite(`candle|${color}|0|${sc.light}`, s, ppu, BOX, (cc) => paintCandle(cc, color, false, sc)));
    c.restore();
    return;
  }
  const a = Math.min(1, amt);
  c.globalAlpha = a;
  blit(c, sprite(`candle|${color}|1|${sc.light}`, s, ppu, BOX, (cc) => paintCandle(cc, color, true, sc)));
  const f = still ? STEADY : flicker(now, seed);
  const pop = amt > 1 ? 1 + (amt - 1) * 0.5 : 1;
  const fh = FLAME_H * s * f.h * pop;
  const fw = fh * 0.92;
  c.translate(0.004 * s, FLAME_Y * s);
  c.transform(1, 0, -f.lean, 1, 0, 0);
  c.globalAlpha = a * f.bright;
  c.drawImage(flameSprite(), -fw / 2, -fh * 1.1, fw, fh * 1.25);
  c.restore();
}

/** The flame's warm halo on the glow layer (bloomed), breathing with the flame unless `still`. */
export function candleHalo(g: CanvasRenderingContext2D, color: string, amt: number, s: number, now: number, seed: number, still: boolean): void {
  if (amt <= 0) return;
  const f = still ? STEADY : flicker(now, seed);
  const a = Math.min(1.4, amt) * f.bright;
  const warm: RGB = lerp3([255, 168, 76], rgb(color), 0.18);
  g.save();
  g.rotate(-devAngle(g));
  g.translate(0, LIFT * s);
  g.scale(K, K);
  const big = haloSprite(warm, [[0, 0.9], [0.22, 0.45], [0.6, 0.1], [1, 0]]);
  const r = s * 0.8 * Math.min(1.3, a);
  g.globalAlpha = clamp01(a);
  g.drawImage(big, -r, (FLAME_Y - FLAME_H * 0.3) * s - r, 2 * r, 2 * r);
  const hot = haloSprite([255, 236, 190], [[0, 1], [0.4, 0.45], [1, 0]]);
  const rh = s * 0.17 * Math.min(1.3, a);
  g.drawImage(hot, -rh, (FLAME_Y - FLAME_H * 0.4) * s - rh * 1.3, 2 * rh, 2.6 * rh);
  g.restore();
}
