/**
 * Bubble lights (season two, C3; ported from the lab's strands-bubble). A coloured glass tube of liquid standing on a
 * cream plastic base (the lamp is inside the base). Unlit: a still, dim, translucent tube. Lit: the liquid glows, the
 * base glows from within, and a stream of small bubbles rises and froths at the meniscus.
 *
 * Still (a calm frame, reduced motion, a stepped-down quality tier): the stream is painted once into the lit sprite at a
 * fixed moment, so a still bubble light costs one drawImage like any other lit bulb, and nothing in it moves.
 */
import { D, L, R, U } from '../../core/dirs';
import type { Scene } from '../scenes';
import { blit, clamp01, css, devScale, haloSprite, lerp3, luma, mul3, rgb, sat, sprite, TAU, WHITE, type RGB } from './kit';

/* Upright frame (tile units): origin at the base's foot, the tube rising along −y. */
const BASE_H = 0.175;
const BASE_W = 0.235;
const TUBE_W = 0.14;
const TUBE_Y0 = -0.175;
const TUBE_Y1 = -0.63;
const MENISCUS = -0.54;
const BOX = [-0.19, -0.68, 0.38, 0.72] as const;

/** Where the base sits (toward the wire) and which way the tube points, for a tile's links. */
export function bubblePose(bits: number): { ax: number; ay: number; rot: number } {
  const tilt = 0.42; // side lights lean up, as a clip holds them on a bough
  if (bits & D) return { ax: 0, ay: 0.2, rot: 0 };
  if (bits & U) return { ax: 0, ay: -0.2, rot: Math.PI };
  if (bits & L) return { ax: -0.2, ay: 0.02, rot: Math.PI / 2 - tilt };
  if (bits & R) return { ax: 0.2, ay: 0.02, rot: -Math.PI / 2 + tilt };
  return { ax: 0, ay: 0.2, rot: 0 };
}

function basePath(c: CanvasRenderingContext2D): void {
  const w = BASE_W / 2;
  const t = w * 0.8;
  c.beginPath();
  c.moveTo(-t, -BASE_H);
  c.lineTo(t, -BASE_H);
  c.bezierCurveTo(w * 1.02, -BASE_H * 0.7, w * 1.08, -BASE_H * 0.3, w * 0.92, -BASE_H * 0.08);
  c.quadraticCurveTo(w * 0.7, 0.012, 0, 0.012);
  c.quadraticCurveTo(-w * 0.7, 0.012, -w * 0.92, -BASE_H * 0.08);
  c.bezierCurveTo(-w * 1.08, -BASE_H * 0.3, -w * 1.02, -BASE_H * 0.7, -t, -BASE_H);
  c.closePath();
}

function tubePath(c: CanvasRenderingContext2D, top = TUBE_Y1): void {
  const w = TUBE_W / 2;
  c.beginPath();
  c.moveTo(-w, TUBE_Y0);
  c.lineTo(-w, top + w);
  c.quadraticCurveTo(-w, top, 0, top - 0.006);
  c.quadraticCurveTo(w, top, w, top + w);
  c.lineTo(w, TUBE_Y0);
  c.closePath();
}

/** Cylinder shading across x: [offset, colour] from the left edge to the right. */
function across(c: CanvasRenderingContext2D, w: number, stops: readonly (readonly [number, string])[]): CanvasGradient {
  const gr = c.createLinearGradient(-w / 2, 0, w / 2, 0);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  return gr;
}

const CREAM: RGB = [238, 226, 198];

function paintBase(c: CanvasRenderingContext2D, lit: boolean, col: RGB, sc: Scene): void {
  const dayK = sc.light === 'day' ? 1 : 0;
  basePath(c);
  if (lit) {
    // The lamp inside glows through the plastic: warm, brightest low in the middle.
    const warm: RGB = [255, 214, 150];
    const gr = c.createRadialGradient(0, -BASE_H * 0.45, 0.01, 0, -BASE_H * 0.45, BASE_W * 0.62);
    gr.addColorStop(0, '#fffaf0');
    gr.addColorStop(0.45, css(lerp3(warm, WHITE, 0.45)));
    gr.addColorStop(1, css(lerp3(warm, col, 0.25)));
    c.fillStyle = gr;
    c.fill();
  } else {
    const k = dayK ? 1 : sc.light === 'fire' ? 0.62 : 0.5;
    const b = mul3(sc.light === 'moon' ? lerp3(CREAM, [200, 214, 236], 0.25) : CREAM, k);
    c.fillStyle = across(c, BASE_W, [
      [0, css(mul3(b, 0.42))],
      [0.3, css(lerp3(b, WHITE, 0.12))],
      [0.55, css(b)],
      [1, css(mul3(b, 0.38))],
    ]);
    c.fill();
  }
  // Soft shading top and bottom (a rounded body), then a moulded seam and a specular stripe.
  c.save();
  basePath(c);
  c.clip();
  const v = c.createLinearGradient(0, -BASE_H, 0, 0.012);
  v.addColorStop(0, 'rgba(0,0,0,.18)');
  v.addColorStop(0.25, 'rgba(0,0,0,0)');
  v.addColorStop(0.75, 'rgba(0,0,0,0)');
  v.addColorStop(1, `rgba(0,0,0,${lit ? 0.12 : 0.35})`);
  c.fillStyle = v;
  c.fillRect(-0.2, -0.3, 0.4, 0.4);
  c.strokeStyle = `rgba(0,0,0,${lit ? 0.1 : 0.22})`;
  c.lineWidth = 0.006;
  for (const y of [-BASE_H * 0.62, -BASE_H * 0.36]) {
    c.beginPath();
    c.moveTo(-0.1, y);
    c.lineTo(0.1, y);
    c.stroke();
  }
  c.fillStyle = `rgba(255,255,255,${lit ? 0.5 : dayK ? 0.6 : 0.32})`;
  c.beginPath();
  c.ellipse(-BASE_W * 0.24, -BASE_H * 0.5, 0.011, BASE_H * 0.32, 0.05, 0, TAU);
  c.fill();
  c.restore();
  // The collar the tube seats in.
  const cw = TUBE_W * 1.35;
  c.fillStyle = across(c, cw, lit
    ? [[0, 'rgb(150,110,60)'], [0.35, 'rgb(255,236,190)'], [1, 'rgb(120,86,44)']]
    : [[0, css(mul3(CREAM, dayK ? 0.4 : 0.18))], [0.35, css(mul3(CREAM, dayK ? 0.92 : 0.55))], [1, css(mul3(CREAM, dayK ? 0.32 : 0.14))]]);
  c.beginPath();
  c.roundRect(-cw / 2, -BASE_H - 0.03, cw, 0.034, 0.008);
  c.fill();
}

function paintTube(c: CanvasRenderingContext2D, lit: boolean, base: RGB, sc: Scene): void {
  const dayK = sc.light === 'day';
  const pale = luma(base) > 0.82;
  const col = lit && !pale ? sat(base, 1.45) : base;
  // Liquid (below the meniscus) and the clear glass air space above it.
  c.save();
  tubePath(c);
  c.clip();
  if (lit) {
    const edge = pale ? lerp3(col, [255, 196, 120], 0.35) : lerp3(col, WHITE, 0.08);
    c.fillStyle = across(c, TUBE_W, [
      [0, css(mul3(edge, 0.72))],
      [0.28, css(lerp3(col, WHITE, pale ? 0.4 : 0.16))],
      [0.5, css(lerp3(col, WHITE, pale ? 0.62 : 0.34))],
      [0.75, css(lerp3(col, WHITE, 0.12))],
      [1, css(mul3(edge, 0.7))],
    ]);
    c.fillRect(-0.1, MENISCUS, 0.2, TUBE_Y0 - MENISCUS + 0.01);
    // Brighter low down, where the lamp is.
    const v = c.createLinearGradient(0, TUBE_Y0, 0, MENISCUS);
    v.addColorStop(0, 'rgba(255,250,235,.55)');
    v.addColorStop(0.4, 'rgba(255,250,235,.08)');
    v.addColorStop(1, 'rgba(255,250,235,0)');
    c.fillStyle = v;
    c.fillRect(-0.1, MENISCUS, 0.2, TUBE_Y0 - MENISCUS + 0.01);
    // Air space: the glass tinted by the light below.
    c.fillStyle = across(c, TUBE_W, [
      [0, css(col, 0.55)],
      [0.45, css(lerp3(col, WHITE, 0.6), 0.5)],
      [1, css(col, 0.5)],
    ]);
    c.fillRect(-0.1, TUBE_Y1 - 0.02, 0.2, MENISCUS - TUBE_Y1 + 0.02);
  } else if (dayK) {
    // Daylight: the liquid is a clear, muted colour against the dark fir; pale glass rim.
    const body = lerp3(mul3(col, 0.72), [168, 180, 188], 0.32);
    c.fillStyle = across(c, TUBE_W, [
      [0, css(mul3(body, 0.55))],
      [0.35, css(lerp3(body, WHITE, 0.38))],
      [0.62, css(body)],
      [1, css(mul3(body, 0.5))],
    ]);
    c.fillRect(-0.1, MENISCUS, 0.2, TUBE_Y0 - MENISCUS + 0.01);
    c.fillStyle = 'rgba(226,236,242,.62)';
    c.fillRect(-0.1, TUBE_Y1 - 0.02, 0.2, MENISCUS - TUBE_Y1 + 0.02);
  } else {
    const body = mul3(col, pale ? 0.42 : 0.5);
    c.fillStyle = across(c, TUBE_W, [
      [0, css(mul3(body, 0.45), 0.92)],
      [0.35, css(lerp3(body, WHITE, 0.14), 0.92)],
      [0.65, css(body, 0.85)],
      [1, css(mul3(body, 0.5), 0.92)],
    ]);
    c.fillRect(-0.1, MENISCUS, 0.2, TUBE_Y0 - MENISCUS + 0.01);
    c.fillStyle = 'rgba(210,220,235,.14)';
    c.fillRect(-0.1, TUBE_Y1 - 0.02, 0.2, MENISCUS - TUBE_Y1 + 0.02);
  }
  // The meniscus: a thin bright curve.
  c.strokeStyle = lit ? 'rgba(255,255,255,.85)' : `rgba(255,255,255,${dayK ? 0.7 : 0.32})`;
  c.lineWidth = 0.007;
  c.beginPath();
  c.moveTo(-TUBE_W / 2, MENISCUS - 0.008);
  c.quadraticCurveTo(0, MENISCUS + 0.008, TUBE_W / 2, MENISCUS - 0.008);
  c.stroke();
  c.restore();
  // Glass: a long specular on the left, a rim light on the right, and the sealed tip.
  c.strokeStyle = `rgba(255,255,255,${lit ? 0.75 : dayK ? 0.85 : 0.42})`;
  c.lineWidth = 0.011;
  c.beginPath();
  c.moveTo(-TUBE_W * 0.24, TUBE_Y0 - 0.03);
  c.lineTo(-TUBE_W * 0.24, TUBE_Y1 + 0.05);
  c.stroke();
  c.strokeStyle = `rgba(255,255,255,${lit ? 0.35 : dayK ? 0.55 : 0.18})`;
  c.lineWidth = 0.006;
  c.beginPath();
  c.moveTo(TUBE_W * 0.4, TUBE_Y0 - 0.02);
  c.lineTo(TUBE_W * 0.4, TUBE_Y1 + 0.06);
  c.stroke();
  if (dayK && !lit) {
    c.strokeStyle = 'rgba(255,255,255,.5)';
    c.lineWidth = 0.008;
    tubePath(c);
    c.stroke();
  }
  c.fillStyle = `rgba(255,255,255,${lit ? 0.7 : 0.4})`;
  c.beginPath();
  c.arc(0, TUBE_Y1 - 0.004, 0.009, 0, TAU);
  c.fill();
}

/**
 * The light, painted once per colour, scene light and resolution. A still lit one has its stream in it, frozen at one of
 * STILL_VARIANTS moments (by `seed`), rising (`up`) or, hanging, falling.
 */
function lightSprite(col: string, lit: boolean, s: number, ppu: number, sc: Scene, still: { seed: number; up: boolean } | null = null) {
  const key = still ? `|still${still.seed}${still.up ? 'u' : 'd'}` : '';
  return sprite(`bubble|${col}|${lit ? 1 : 0}|${sc.light}${key}`, s, ppu, BOX, (c) => {
    const v = rgb(col);
    paintTube(c, lit, v, sc);
    paintBase(c, lit, v, sc);
    if (still) paintBubbles(c, STILL_AT + still.seed * 997, still.seed, still.up, 1);
  });
}

/** How many different frozen streams the still lights take (by tile), and the moment they are frozen at. */
const STILL_VARIANTS = 4;
const STILL_AT = 1300;

/** Cheap per-bubble hash (0..1). */
const h = (n: number): number => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

const BUBBLES = 8;

/** The rising stream: drawn live in the upright frame (tile units, c scaled by s). */
function paintBubbles(c: CanvasRenderingContext2D, now: number, seed: number, up: boolean, a: number): void {
  const span = MENISCUS - (TUBE_Y0 - 0.02); // negative
  c.fillStyle = '#fff';
  for (let j = 0; j < BUBBLES; j++) {
    const r0 = h(seed * 13 + j);
    const period = 520 + 420 * h(seed * 7 + j * 3);
    const ph = (now / period + r0 + j / BUBBLES) % 1;
    const p = up ? ph : 1 - ph;
    const y = TUBE_Y0 - 0.02 + span * p;
    const x = (h(j * 5 + seed) - 0.5) * TUBE_W * 0.4 + Math.sin(now * 0.011 + j * 2.3 + seed) * TUBE_W * 0.09 * ph;
    const r = (0.008 + 0.011 * h(seed + j * 11)) * (0.7 + 0.5 * ph);
    // Born small at the bottom, gone at the meniscus.
    const k = Math.min(1, ph * 6) * Math.min(1, (1 - ph) * 8);
    c.globalAlpha = a * 0.9 * k;
    c.beginPath();
    c.arc(x, y, r, 0, TAU);
    c.fill();
  }
  // A little froth sitting under the meniscus.
  const fy = up ? MENISCUS + 0.012 : TUBE_Y0 - 0.02;
  for (let j = 0; j < 3; j++) {
    c.globalAlpha = a * (0.45 + 0.35 * Math.sin(now * 0.017 + j * 2.1 + seed));
    c.beginPath();
    c.arc((j - 1) * TUBE_W * 0.26, fy, 0.006, 0, TAU);
    c.fill();
  }
  c.globalAlpha = 1;
}

/**
 * An end tile's bubble light: `amt` 0 is unlit, 1 lit, above 1 the pop. `bits`: the tile's links (the base faces the
 * wire). `now` moves the stream unless `still`.
 */
export function bubbleBulb(c: CanvasRenderingContext2D, bits: number, color: string, amt: number, s: number, sc: Scene, now: number, seed: number, still: boolean): void {
  const pose = bubblePose(bits);
  // Bubbles rise in the screen's up: along the tube toward the tip unless it hangs.
  const up = Math.cos(pose.rot) > -0.5;
  const frozen = still ? { seed: seed % STILL_VARIANTS, up } : null;
  const swell = amt > 1 ? 1 + (amt - 1) * 0.12 : 1;
  const ppu = devScale(c) * swell;
  c.save();
  c.translate(pose.ax * s, pose.ay * s);
  c.rotate(pose.rot);
  if (swell !== 1) c.scale(swell, swell);
  if (amt <= 0) {
    blit(c, lightSprite(color, false, s, ppu, sc));
  } else {
    const a = Math.min(1, amt);
    c.globalAlpha = a;
    blit(c, lightSprite(color, true, s, ppu, sc, frozen));
    if (amt > 1) {
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = clamp01((amt - 1) * 0.7);
      blit(c, lightSprite(color, true, s, ppu, sc, frozen));
      c.globalCompositeOperation = 'source-over';
    }
    if (!still) {
      c.scale(s, s);
      paintBubbles(c, now, seed, up, a);
    }
  }
  c.restore();
}

/** The light's halo on the glow layer (bloomed): it never moves, still or not. */
export function bubbleHalo(g: CanvasRenderingContext2D, bits: number, color: string, amt: number, s: number): void {
  if (amt <= 0) return;
  const pose = bubblePose(bits);
  const col = rgb(color);
  const a = Math.min(1.4, amt);
  g.save();
  g.translate(pose.ax * s, pose.ay * s);
  g.rotate(pose.rot);
  // The tube's light, drawn out along it, and the lamp's warm pool at the base.
  const tube = haloSprite(col, [[0, 1], [0.25, 0.62], [0.6, 0.18], [1, 0]]);
  g.globalAlpha = Math.min(1, a);
  const rw = s * 0.5 * a;
  const rh = s * 0.82 * a;
  g.drawImage(tube, -rw, -0.38 * s - rh, 2 * rw, 2 * rh);
  const warm = haloSprite(lerp3([255, 196, 120], col, 0.3), [[0, 0.8], [0.35, 0.3], [1, 0]]);
  const rb = s * 0.34 * a;
  g.drawImage(warm, -rb, -0.09 * s - rb, 2 * rb, 2 * rb);
  g.restore();
}
