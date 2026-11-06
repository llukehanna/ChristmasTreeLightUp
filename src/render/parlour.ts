/**
 * The Parlour (ported from the lab's scenes-parlour): a Victorian parlour on Christmas Eve. Oxblood damask above dark
 * wainscoting; on the left a fireplace whose mantel carries a bracket clock, brass candlesticks and greenery under a
 * gilt overmantel mirror (the game's firelight and embers come from the lower left, so they belong to this hearth); on
 * the right a tall window with snow outside between crimson velvet drapes; a brass wall sconce. Per frame (ParlourRoom):
 * the candle flames, the clock's hands (the real time, read once a second), the coals and the snow behind the glass.
 * Every per-frame light is a sprite baked at paint time and drawn with drawImage + globalAlpha (no gradients, no
 * allocation per frame).
 */
import { mulberry32 } from '../core/rng';
import type { Backdrop } from './backdrop';
import { X, Y, type Layout } from './layout';
import { TAU, clamp01 } from './paint-util';
import { blurInto, disc, grain, layerBox, linear, radial, radialSprite, softSprite } from './scene-util';

interface Flame {
  x: number;
  y: number;
  k: number;
  p: number;
}
/** What the paint leaves for the frames: where the flames, the clock, the coals and the window are, and their sprites. */
export interface Room {
  flames: Flame[];
  clock: { x: number; y: number; r: number };
  coals: { x: number; y: number; w: number };
  win: { x0: number; y0: number; x1: number; y1: number };
  /** Baked once per paint: a flake, the coals' breath, a flame (at its tallest, k = 1), a flame's and the coals' bloom. */
  spr: { flake: HTMLCanvasElement; coals: HTMLCanvasElement; flame: HTMLCanvasElement; flameGlow: HTMLCanvasElement; coalsGlow: HTMLCanvasElement };
  /** The flame sprite's size in CSS px at k = 1. */
  flameW: number;
  flameH: number;
}

export function paintParlour(c: CanvasRenderingContext2D, L: Layout): ParlourRoom {
  const { w, h, s } = L;
  const r = mulberry32(31);
  const hz = Y(L, 10.05);
  const dado = Y(L, 7.35);
  const flames: Flame[] = [];

  // Wall: oxblood, darker toward the ceiling.
  c.fillStyle = linear(c, 0, 0, 0, dado, [[0, '#120708'], [0.35, '#1d0a0b'], [0.8, '#250d0e'], [1, '#200b0c']]);
  c.fillRect(0, 0, w, dado);
  // Flocked damask: soft medallions, a little lighter and warmer than the paper.
  blurInto(c, L, s * 0.035, (o) => {
    const tw = s * 1.55;
    const th = s * 2.2;
    for (let row = -1; row * th < dado + th; row++) {
      for (let col = -1; col * tw < w + tw; col++) {
        const x = col * tw + (row % 2 ? tw / 2 : 0);
        const y = row * th + s * 0.4;
        damask(o, x, y, s * 0.62);
      }
    }
    // faint stripes between
    o.fillStyle = 'rgba(255,180,140,.018)';
    for (let x = 0; x < w; x += s * 0.775) o.fillRect(x, 0, Math.max(1, s * 0.03), dado);
  });
  // Cornice and picture rail.
  c.fillStyle = linear(c, 0, 0, 0, Y(L, -2.6), [[0, '#0e0506'], [0.8, '#1c0a0b'], [1, '#2a1612']]);
  c.fillRect(0, 0, w, Y(L, -2.6));
  c.fillStyle = 'rgba(255,200,150,.07)';
  c.fillRect(0, Y(L, -2.6), w, 1);
  c.fillStyle = 'rgba(0,0,0,.25)';
  c.fillRect(0, Y(L, -2.6) + 1, w, s * 0.08);
  c.fillStyle = 'rgba(210,160,100,.10)';
  c.fillRect(0, Y(L, 0.15), w, Math.max(1, s * 0.04));

  // Wainscoting: raised walnut panels, a chair rail, the skirting.
  c.fillStyle = linear(c, 0, dado, 0, hz, [[0, '#24130b'], [1, '#170c07']]);
  c.fillRect(0, dado, w, hz - dado);
  const pw = s * 1.9;
  for (let x = -s * 0.4; x < w; x += pw) {
    const y0 = dado + s * 0.32;
    const y1 = hz - s * 0.4;
    c.fillStyle = 'rgba(0,0,0,.25)';
    c.fillRect(x + s * 0.18, y0, pw - s * 0.36, y1 - y0);
    c.fillStyle = linear(c, 0, y0, 0, y1, [[0, 'rgba(120,60,30,.18)'], [1, 'rgba(60,30,15,.10)']]);
    c.fillRect(x + s * 0.24, y0 + s * 0.06, pw - s * 0.48, y1 - y0 - s * 0.12);
    c.fillStyle = 'rgba(255,190,130,.10)';
    c.fillRect(x + s * 0.24, y0 + s * 0.06, pw - s * 0.48, 1);
  }
  c.fillStyle = linear(c, 0, dado - s * 0.12, 0, dado + s * 0.2, [[0, '#2e190e'], [0.4, '#3c2214'], [0.6, '#24130a'], [1, '#1a0d07']]);
  c.fillRect(0, dado - s * 0.12, w, s * 0.32);
  c.fillStyle = 'rgba(255,200,140,.09)';
  c.fillRect(0, dado - s * 0.12, w, 1);
  c.fillStyle = '#140a06';
  c.fillRect(0, hz - s * 0.3, w, s * 0.3);

  // Floor: dark polished boards, a Persian rug under the tree seen at a grazing angle.
  c.fillStyle = linear(c, 0, hz, 0, h, [[0, '#22120a'], [1, '#0d0705']]);
  c.fillRect(0, hz, w, h - hz);
  c.strokeStyle = 'rgba(0,0,0,.3)';
  c.lineWidth = 1;
  for (let y = hz + s * 0.25; y < h; y += s * 0.3 + (y - hz) * 0.1) {
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(w, y);
    c.stroke();
  }
  const ry0 = hz + s * 0.22;
  const rx0 = X(L, -9.2);
  const rx1 = X(L, 9.2);
  c.fillStyle = linear(c, 0, ry0, 0, h, [[0, '#3a1214'], [1, '#200a0b']]);
  c.beginPath();
  c.moveTo(rx0 + s * 0.4, ry0);
  c.lineTo(rx1 - s * 0.4, ry0);
  c.lineTo(rx1 + s * 0.6, h + 2);
  c.lineTo(rx0 - s * 0.6, h + 2);
  c.fill();
  // rug border: a band of small lozenges
  for (let x = rx0 + s * 0.5; x < rx1 - s * 0.5; x += s * 0.28) {
    c.fillStyle = ['rgba(200,150,70,.22)', 'rgba(40,40,90,.35)', 'rgba(150,30,30,.35)'][Math.round(x / (s * 0.28)) % 3];
    c.beginPath();
    c.moveTo(x, ry0 + s * 0.1);
    c.lineTo(x + s * 0.08, ry0 + s * 0.16);
    c.lineTo(x, ry0 + s * 0.22);
    c.lineTo(x - s * 0.08, ry0 + s * 0.16);
    c.fill();
  }
  c.fillStyle = 'rgba(220,190,140,.16)';
  for (let x = rx0 + s * 0.45; x < rx1 - s * 0.45; x += 3) c.fillRect(x, ry0 - s * 0.06, 1, s * 0.06);

  // ---- the hearth (left) ----
  const mx1 = Math.min(X(L, -7.3), w * 0.24);
  const mantelY = Y(L, 5.35);
  // surround: black marble with a faint vein
  c.fillStyle = linear(c, 0, mantelY, 0, hz, [[0, '#1a1312'], [1, '#0e0909']]);
  c.fillRect(-s, mantelY, mx1 - s * 0.25 + s, hz - mantelY);
  const fx0 = s * 0.2;
  const fx1 = mx1 - s * 1.0;
  const fy0 = Y(L, 7.0);
  // firebox: arched opening, glowing coals, the iron grate
  c.save();
  c.beginPath();
  c.moveTo(fx0, hz - s * 0.3);
  c.lineTo(fx0, fy0 + (fx1 - fx0) * 0.3);
  c.quadraticCurveTo((fx0 + fx1) / 2, fy0 - (fx1 - fx0) * 0.12, fx1, fy0 + (fx1 - fx0) * 0.3);
  c.lineTo(fx1, hz - s * 0.3);
  c.closePath();
  c.fillStyle = '#050202';
  c.fill();
  c.clip();
  radial(c, (fx0 + fx1) / 2, hz - s * 0.6, (fx1 - fx0) * 0.75, [[0, 'rgba(255,140,50,.7)'], [0.35, 'rgba(220,70,20,.38)'], [1, 'rgba(80,20,5,0)']]);
  for (let i = 0; i < 40; i++) {
    const x = fx0 + r() * (fx1 - fx0);
    const y = hz - s * (0.35 + r() * 0.5);
    c.fillStyle = `rgba(${200 + ((r() * 55) | 0)},${60 + ((r() * 90) | 0)},20,${0.3 + r() * 0.5})`;
    disc(c, x, y, s * (0.05 + r() * 0.1));
  }
  c.strokeStyle = 'rgba(10,6,6,.95)';
  c.lineWidth = Math.max(1, s * 0.06);
  for (let x = fx0 + s * 0.2; x < fx1; x += s * 0.28) {
    c.beginPath();
    c.moveTo(x, hz - s * 1.1);
    c.lineTo(x, hz - s * 0.3);
    c.stroke();
  }
  c.restore();
  c.strokeStyle = 'rgba(200,150,90,.12)';
  c.lineWidth = Math.max(1, s * 0.05);
  c.beginPath();
  c.moveTo(fx0 - s * 0.1, hz - s * 0.3);
  c.lineTo(fx0 - s * 0.1, fy0 + (fx1 - fx0) * 0.3);
  c.quadraticCurveTo((fx0 + fx1) / 2, fy0 - (fx1 - fx0) * 0.18, fx1 + s * 0.1, fy0 + (fx1 - fx0) * 0.3);
  c.lineTo(fx1 + s * 0.1, hz - s * 0.3);
  c.stroke();
  // the mantel shelf
  c.fillStyle = linear(c, 0, mantelY - s * 0.28, 0, mantelY + s * 0.12, [[0, '#36200f'], [0.25, '#4a2c18'], [0.4, '#2c170c'], [1, '#170b06']]);
  c.fillRect(-s, mantelY - s * 0.28, mx1 + s, s * 0.4);
  c.fillStyle = 'rgba(255,200,140,.12)';
  c.fillRect(-s, mantelY - s * 0.28, mx1 + s, 1);
  // overmantel mirror in a gilt frame
  const mx0 = s * 0.35;
  const mmx1 = mx1 - s * 0.5;
  const my0 = Y(L, 0.7);
  const my1 = mantelY - s * 1.0;
  c.fillStyle = linear(c, mx0, my0, mmx1, my1, [[0, '#060304'], [0.45, '#0e0809'], [0.55, '#150d0d'], [1, '#050303']]);
  c.fillRect(mx0, my0, mmx1 - mx0, my1 - my0);
  blurInto(c, L, s * 0.25, (o) => {
    o.save();
    o.beginPath();
    o.rect(mx0, my0, mmx1 - mx0, my1 - my0);
    o.clip();
    // the room reflected: warm candle and tree lights, out of focus
    // the tree's lights, far across the room behind us, and the candles close by
    for (let i = 0; i < 22; i++) {
      const col = ['255,170,90', '255,90,80', '255,210,140', '110,210,130', '120,170,255'][i % 5];
      o.fillStyle = `rgba(${col},${0.07 + r() * 0.11})`;
      disc(o, mx0 + (mmx1 - mx0) * (0.45 + r() * 0.55), my0 + (my1 - my0) * (0.15 + r() * 0.7), s * (0.08 + r() * 0.16));
    }
    radial(o, mx0 + (mmx1 - mx0) * 0.3, my1, s * 1.4, [[0, 'rgba(255,170,90,.16)'], [1, 'rgba(255,170,90,0)']]);
    o.restore();
  }, 'lighter', layerBox(L, mx0, my0, mmx1, my1, s * 0.25));
  c.fillStyle = 'rgba(255,240,220,.025)';
  c.beginPath();
  c.moveTo(mx0, my0 + (my1 - my0) * 0.2);
  c.lineTo(mx0 + (mmx1 - mx0) * 0.35, my0);
  c.lineTo(mx0 + (mmx1 - mx0) * 0.5, my0);
  c.lineTo(mx0, my0 + (my1 - my0) * 0.45);
  c.fill();
  gilt(c, mx0, my0, mmx1 - mx0, my1 - my0, s * 0.2);

  // mantel things: candlesticks, the clock, greenery
  const clockX = (mx0 + mmx1) / 2;
  const candleXs = [mx0 + (clockX - mx0) * 0.35, mmx1 - (mmx1 - clockX) * 0.35];
  for (const cx of candleXs) {
    const top = mantelY - s * 0.28;
    // brass stick
    c.fillStyle = linear(c, cx - s * 0.18, 0, cx + s * 0.18, 0, [[0, '#30200e'], [0.35, '#6e5a3c'], [0.6, '#4c3a20'], [1, '#26180a']]);
    c.beginPath();
    c.ellipse(cx, top - s * 0.04, s * 0.2, s * 0.06, 0, 0, TAU);
    c.fill();
    c.fillRect(cx - s * 0.05, top - s * 0.75, s * 0.1, s * 0.72);
    c.beginPath();
    c.ellipse(cx, top - s * 0.42, s * 0.09, s * 0.05, 0, 0, TAU);
    c.fill();
    c.beginPath();
    c.ellipse(cx, top - s * 0.76, s * 0.13, s * 0.04, 0, 0, TAU);
    c.fill();
    // the candle
    const ch = s * 0.7;
    c.fillStyle = linear(c, cx - s * 0.06, 0, cx + s * 0.06, 0, [[0, '#5e5246'], [0.4, '#8c8270'], [1, '#4c4238']]);
    c.fillRect(cx - s * 0.06, top - s * 0.78 - ch, s * 0.12, ch);
    c.fillStyle = 'rgba(255,230,180,.3)';
    c.fillRect(cx - s * 0.06, top - s * 0.78 - ch, s * 0.12, Math.max(1, s * 0.03));
    flames.push({ x: cx, y: top - s * 0.78 - ch - s * 0.02, k: 1, p: r() * 10 });
  }
  const clock = bracketClock(c, L, clockX, mantelY - s * 0.28);
  // greenery along the mantel edge, with berries
  blurInto(c, L, s * 0.02, (o) => {
    for (let k = 0; k < 2; k++) {
      const x0 = -s * 0.2;
      const x1 = mx1 + s * 0.1;
      const swags = 2;
      for (let i = 0; i < 260; i++) {
        const t = r();
        const x = x0 + (x1 - x0) * t;
        const sw = (t * swags) % 1;
        const y = mantelY - s * 0.05 + Math.sin(sw * Math.PI) * s * 0.42 + (r() - 0.5) * s * 0.14;
        const a = r() * TAU;
        o.strokeStyle = `rgba(${20 + ((r() * 25) | 0)},${50 + ((r() * 40) | 0)},${25 + ((r() * 20) | 0)},${0.6 + r() * 0.4})`;
        o.lineWidth = Math.max(0.8, s * 0.025);
        o.beginPath();
        o.moveTo(x, y);
        o.lineTo(x + Math.cos(a) * s * 0.14, y + Math.sin(a) * s * 0.1);
        o.stroke();
      }
      for (let i = 0; i < 22; i++) {
        const t = r();
        const sw = (t * swags) % 1;
        o.fillStyle = `rgba(${140 + ((r() * 50) | 0)},24,28,.55)`;
        disc(o, x0 + (x1 - x0) * t, mantelY - s * 0.03 + Math.sin(sw * Math.PI) * s * 0.4, s * 0.04);
      }
    }
  });

  // ---- the window and the drapes (right) ----
  const wx0 = Math.max(X(L, 8.15), w - s * 3.9);
  const wx1 = wx0 + s * 2.9;
  const wy0 = Y(L, -0.4);
  const wy1 = Y(L, 7.0);
  c.fillStyle = linear(c, 0, wy0, 0, wy1, [[0, '#060b1e'], [0.6, '#0f1a3a'], [1, '#26345e']]);
  c.fillRect(wx0, wy0, wx1 - wx0, wy1 - wy0);
  blurInto(c, L, s * 0.15, (o) => {
    o.save();
    o.beginPath();
    o.rect(wx0, wy0, wx1 - wx0, wy1 - wy0);
    o.clip();
    // snowy rooftops and a lit window across the street
    o.fillStyle = 'rgba(150,165,205,.35)';
    o.beginPath();
    o.moveTo(wx0, wy1);
    o.lineTo(wx0, wy1 - s * 1.5);
    o.lineTo(wx0 + s * 1.2, wy1 - s * 2.4);
    o.lineTo(wx0 + s * 2.2, wy1 - s * 1.7);
    o.lineTo(wx1, wy1 - s * 2.0);
    o.lineTo(wx1, wy1);
    o.fill();
    o.fillStyle = 'rgba(255,190,110,.5)';
    o.fillRect(wx0 + s * 0.7, wy1 - s * 1.2, s * 0.22, s * 0.3);
    o.fillRect(wx0 + s * 1.9, wy1 - s * 1.0, s * 0.22, s * 0.3);
    radial(o, wx0 + s * 2.4, wy0 + s * 1.2, s * 1.8, [[0, 'rgba(160,190,255,.14)'], [1, 'rgba(160,190,255,0)']]);
    o.restore();
  }, 'source-over', layerBox(L, wx0, wy0, wx1, wy1, s * 0.15));
  // frost in the corners of the panes
  c.save();
  c.beginPath();
  c.rect(wx0, wy0, wx1 - wx0, wy1 - wy0);
  c.clip();
  for (const [x, y] of [[wx0, wy1], [wx1, wy1], [wx0, wy0], [wx1, wy0]] as const) radial(c, x, y, s * 1.1, [[0, 'rgba(210,225,255,.22)'], [1, 'rgba(210,225,255,0)']]);
  c.restore();
  // sash bars
  c.fillStyle = '#1a0d08';
  const bar = Math.max(2, s * 0.09);
  c.fillRect((wx0 + wx1) / 2 - bar / 2, wy0, bar, wy1 - wy0);
  for (let k = 1; k < 4; k++) c.fillRect(wx0, wy0 + ((wy1 - wy0) * k) / 4 - bar / 2, wx1 - wx0, bar);
  c.strokeStyle = '#140a06';
  c.lineWidth = s * 0.16;
  c.strokeRect(wx0, wy0, wx1 - wx0, wy1 - wy0);
  // the sill, with a little snow outside showing through
  c.fillStyle = linear(c, 0, wy1, 0, wy1 + s * 0.3, [[0, '#3a2214'], [1, '#180c06']]);
  c.fillRect(wx0 - s * 0.3, wy1, wx1 - wx0 + s * 0.6, s * 0.3);
  // drapes: crimson velvet, deep folds, pooled at the floor
  drape(c, L, wx0 - s * 1.35, wx0 + s * 0.45, Y(L, -1.1), hz + s * 0.15, r, -1);
  drape(c, L, wx1 - s * 0.45, Math.max(w + s * 0.2, wx1 + s * 1.3), Y(L, -1.1), hz + s * 0.15, r, 1);
  // valance
  c.fillStyle = linear(c, 0, Y(L, -1.5), 0, Y(L, -0.3), [[0, '#2a0508'], [0.5, '#5a0f16'], [1, '#22040a']]);
  c.beginPath();
  c.moveTo(wx0 - s * 1.5, Y(L, -1.5));
  c.lineTo(w + s, Y(L, -1.5));
  c.lineTo(w + s, Y(L, -0.6));
  const vx0 = wx0 - s * 1.5;
  const vx1 = w + s;
  const n = 3;
  for (let i = n; i > 0; i--) {
    const a = vx0 + ((vx1 - vx0) * i) / n;
    const b = vx0 + ((vx1 - vx0) * (i - 1)) / n;
    c.quadraticCurveTo((a + b) / 2, Y(L, 0.1), b, Y(L, -0.6));
  }
  c.closePath();
  c.fill();
  c.strokeStyle = 'rgba(220,170,90,.2)';
  c.lineWidth = Math.max(1, s * 0.04);
  c.stroke();

  // ---- a brass wall sconce between the tree and the window ----
  const scx = Math.min(X(L, 6.0), wx0 - s * 2.0);
  const scy = Y(L, 2.6);
  c.strokeStyle = '#5e4a2e';
  c.lineWidth = Math.max(1, s * 0.05);
  c.beginPath();
  c.moveTo(scx, scy + s * 0.9);
  c.quadraticCurveTo(scx - s * 0.35, scy + s * 0.6, scx, scy + s * 0.25);
  c.stroke();
  c.fillStyle = linear(c, scx - s * 0.1, 0, scx + s * 0.1, 0, [[0, '#34240e'], [0.5, '#6e5a3c'], [1, '#2c1e0c']]);
  c.fillRect(scx - s * 0.12, scy + s * 0.85, s * 0.24, s * 0.3);
  c.fillStyle = linear(c, scx - s * 0.05, 0, scx + s * 0.05, 0, [[0, '#5e5246'], [0.4, '#8c8270'], [1, '#4c4238']]);
  c.fillRect(scx - s * 0.05, scy - s * 0.2, s * 0.1, s * 0.45);
  flames.push({ x: scx, y: scy - s * 0.22, k: 0.9, p: r() * 10 });

  // ---- light: the fire low left, candle pools, darkness up high and to the right ----
  blurInto(c, L, 0, (o) => {
    radial(o, 0, hz, w * 0.6, [[0, 'rgba(255,120,50,.17)'], [0.5, 'rgba(255,100,40,.04)'], [1, 'rgba(255,100,40,0)']]);
    for (const f of flames) radial(o, f.x, f.y, s * 2.6, [[0, 'rgba(255,170,90,.16)'], [0.4, 'rgba(255,150,70,.05)'], [1, 'rgba(255,150,70,0)']]);
  }, 'lighter');
  c.fillStyle = linear(c, 0, 0, 0, h * 0.35, [[0, 'rgba(0,0,0,.34)'], [1, 'rgba(0,0,0,0)']]);
  c.fillRect(0, 0, w, h * 0.35);
  c.fillStyle = linear(c, w * 0.55, 0, w, 0, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,.15)']]);
  c.fillRect(w * 0.55, 0, w * 0.45, h);
  grain(c, 0.12, 31);

  const room: Room = {
    flames,
    clock,
    coals: { x: (fx0 + fx1) / 2, y: hz - s * 0.6, w: fx1 - fx0 },
    win: { x0: wx0, y0: wy0, x1: wx1, y1: wy1 },
    spr: {
      flake: softSprite('235,240,255', 8, 0.3),
      coals: radialSprite([[0, 'rgba(255,120,40,1)'], [1, 'rgba(255,120,40,0)']]),
      flame: flameSprite(L),
      flameGlow: radialSprite([[0, 'rgba(255,190,110,.5)'], [0.3, 'rgba(255,150,70,.16)'], [1, 'rgba(255,150,70,0)']]),
      coalsGlow: radialSprite([[0, 'rgba(255,110,40,1)'], [1, 'rgba(255,110,40,0)']]),
    },
    flameW: s * FLAME_W * 2.8,
    flameH: s * FLAME_H,
  };
  return new ParlourRoom(room, L);
}

/** Flame size in cells at k = 1 and full flicker (the per-frame height scales down from this). */
const FLAME_H = 0.2 * 1.05;
const FLAME_W = 0.055;

/** A candle flame at its tallest, baked at twice device resolution: blue at the wick, white core, amber tip. */
function flameSprite(L: Layout): HTMLCanvasElement {
  const fh = L.s * FLAME_H;
  const fw = L.s * FLAME_W;
  const q = L.dpr * 2;
  const cv = document.createElement('canvas');
  cv.width = Math.max(2, Math.ceil(fw * 2.8 * q));
  cv.height = Math.max(2, Math.ceil(fh * q));
  const c = cv.getContext('2d')!;
  c.setTransform(cv.width / (fw * 2.8), 0, 0, cv.height / fh, cv.width / 2, cv.height);
  c.fillStyle = linear(c, 0, -fh, 0, 0, [[0, 'rgba(255,200,110,0)'], [0.3, 'rgba(255,214,140,.9)'], [0.75, 'rgba(255,248,225,1)'], [1, 'rgba(120,150,255,.55)']]);
  c.beginPath();
  c.moveTo(0, -fh);
  c.quadraticCurveTo(fw * 1.4, -fh * 0.35, 0, 0);
  c.quadraticCurveTo(-fw * 1.4, -fh * 0.35, 0, -fh);
  c.fill();
  return cv;
}

function damask(o: CanvasRenderingContext2D, x: number, y: number, k: number): void {
  o.save();
  o.translate(x, y);
  o.scale(k, k);
  const ogee = (sc: number) => {
    o.beginPath();
    o.moveTo(0, -1.3 * sc);
    o.bezierCurveTo(0.35 * sc, -0.95 * sc, 0.85 * sc, -0.5 * sc, 0.62 * sc, 0.05 * sc);
    o.bezierCurveTo(0.45 * sc, 0.5 * sc, 0.15 * sc, 0.8 * sc, 0, 1.3 * sc);
    o.bezierCurveTo(-0.15 * sc, 0.8 * sc, -0.45 * sc, 0.5 * sc, -0.62 * sc, 0.05 * sc);
    o.bezierCurveTo(-0.85 * sc, -0.5 * sc, -0.35 * sc, -0.95 * sc, 0, -1.3 * sc);
  };
  ogee(1);
  o.fillStyle = 'rgba(150,40,40,.10)';
  o.fill();
  o.lineWidth = 0.05;
  o.strokeStyle = 'rgba(255,170,120,.07)';
  o.stroke();
  ogee(0.55);
  o.fillStyle = 'rgba(255,150,110,.05)';
  o.fill();
  // leaf curls either side
  for (const sx of [-1, 1]) {
    o.beginPath();
    o.moveTo(0.1 * sx, 0.2);
    o.bezierCurveTo(0.7 * sx, 0.1, 1.0 * sx, 0.55, 0.62 * sx, 0.8);
    o.bezierCurveTo(0.75 * sx, 0.45, 0.45 * sx, 0.35, 0.1 * sx, 0.45);
    o.fillStyle = 'rgba(150,40,40,.09)';
    o.fill();
  }
  for (const [dx, dy] of [[0, -1.55], [-0.18, -1.45], [0.18, -1.45]] as const) {
    o.fillStyle = 'rgba(255,170,120,.06)';
    disc(o, dx, dy, 0.09);
  }
  o.restore();
}

function gilt(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, t: number): void {
  const g = linear(c, x, y, x + w, y + h, [[0, '#34241a'], [0.2, '#5a4630'], [0.35, '#3c2c1c'], [0.6, '#4e3e28'], [0.8, '#2e2014'], [1, '#463624']]);
  c.strokeStyle = g;
  c.lineWidth = t;
  c.strokeRect(x - t / 2, y - t / 2, w + t, h + t);
  c.strokeStyle = 'rgba(0,0,0,.32)';
  c.lineWidth = 1;
  c.strokeRect(x, y, w, h);
  c.strokeRect(x - t, y - t, w + 2 * t, h + 2 * t);
  c.strokeStyle = 'rgba(255,230,170,.13)';
  c.strokeRect(x - t * 0.6, y - t * 0.6, w + t * 1.2, h + t * 1.2);
  // a carved crest
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(x + w / 2 - t * 2.2, y - t);
  c.quadraticCurveTo(x + w / 2, y - t * 3.4, x + w / 2 + t * 2.2, y - t);
  c.fill();
}

function bracketClock(c: CanvasRenderingContext2D, L: Layout, cx: number, base: number): { x: number; y: number; r: number } {
  const s = L.s;
  const cw = s * 1.2;
  const ch = s * 1.45;
  const top = base - ch;
  // case: mahogany, a bell top, brass finials and feet
  c.fillStyle = linear(c, cx - cw / 2, 0, cx + cw / 2, 0, [[0, '#1e0c08'], [0.3, '#3e200f'], [0.45, '#4c2814'], [0.7, '#2e1409'], [1, '#180806']]);
  c.beginPath();
  c.moveTo(cx - cw / 2, base);
  c.lineTo(cx - cw / 2, top + s * 0.3);
  c.bezierCurveTo(cx - cw / 2, top - s * 0.05, cx - cw * 0.25, top - s * 0.05, cx - cw * 0.2, top - s * 0.25);
  c.quadraticCurveTo(cx, top - s * 0.55, cx + cw * 0.2, top - s * 0.25);
  c.bezierCurveTo(cx + cw * 0.25, top - s * 0.05, cx + cw / 2, top - s * 0.05, cx + cw / 2, top + s * 0.3);
  c.lineTo(cx + cw / 2, base);
  c.closePath();
  c.fill();
  c.strokeStyle = 'rgba(255,190,120,.09)';
  c.lineWidth = 1;
  c.stroke();
  c.fillStyle = '#5e4a2e';
  disc(c, cx, top - s * 0.52, s * 0.06);
  for (const k of [-1, 1]) {
    disc(c, cx + (k * cw) / 2, top + s * 0.22, s * 0.05);
    c.fillRect(cx + (k * cw) / 2 - s * 0.08 - (k > 0 ? s * 0.04 : 0), base - s * 0.06, s * 0.16, s * 0.08);
  }
  // dial
  const dy = top + ch * 0.45;
  const dr = cw * 0.34;
  radial(c, cx, dy, dr * 1.25, [[0, '#64543a'], [0.8, '#4e4028'], [1, '#30241a']]);
  radial(c, cx, dy, dr, [[0, '#857a68'], [0.85, '#787060'], [1, '#5a4e3e']]);
  c.strokeStyle = 'rgba(40,24,10,.5)';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    c.lineWidth = i % 3 ? 0.8 : 1.4;
    c.beginPath();
    c.moveTo(cx + Math.cos(a) * dr * 0.72, dy + Math.sin(a) * dr * 0.72);
    c.lineTo(cx + Math.cos(a) * dr * 0.9, dy + Math.sin(a) * dr * 0.9);
    c.stroke();
  }
  // a brass grille below the dial
  c.strokeStyle = 'rgba(200,160,80,.2)';
  c.lineWidth = 1;
  for (let i = -2; i <= 2; i++) {
    c.beginPath();
    c.arc(cx + i * s * 0.1, base - s * 0.22, s * 0.05, 0, TAU);
    c.stroke();
  }
  return { x: cx, y: dy, r: dr };
}

function drape(c: CanvasRenderingContext2D, L: Layout, x0: number, x1: number, y0: number, y1: number, r: () => number, side: number): void {
  const s = L.s;
  const wd = x1 - x0;
  // gathered toward the window at the tie-back
  const tie = y0 + (y1 - y0) * 0.58;
  c.save();
  c.beginPath();
  c.moveTo(x0, y0);
  c.lineTo(x1, y0);
  if (side < 0) {
    c.lineTo(x1, y0 + s * 0.3);
    c.quadraticCurveTo(x1 - wd * 0.15, tie - s, x1 - wd * 0.42, tie);
    c.quadraticCurveTo(x1 - wd * 0.15, tie + s * 1.2, x1 + s * 0.2, y1);
    c.lineTo(x0 - s * 0.3, y1);
  } else {
    c.lineTo(x1, y1);
    c.lineTo(x0 - s * 0.2, y1);
    c.quadraticCurveTo(x0 + wd * 0.15, tie + s * 1.2, x0 + wd * 0.42, tie);
    c.quadraticCurveTo(x0 + wd * 0.15, tie - s, x0, y0 + s * 0.3);
  }
  c.closePath();
  c.fillStyle = '#3a060c';
  c.fill();
  c.clip();
  // folds: velvet catches light on the crests and goes near-black in the troughs
  const folds = Math.max(4, Math.round(wd / (s * 0.32)));
  for (let i = 0; i < folds; i++) {
    const fx = x0 - s * 0.3 + ((wd + s * 0.6) * (i + r() * 0.3)) / folds;
    const fw = (wd / folds) * (1.1 + r() * 0.5);
    const g = c.createLinearGradient(fx, 0, fx + fw, 0);
    const hi = (0.25 + r() * 0.25) * 0.75;
    g.addColorStop(0, 'rgba(0,0,0,.55)');
    g.addColorStop(0.45, `rgba(170,30,45,${hi})`);
    g.addColorStop(0.55, `rgba(230,90,90,${hi * 0.45})`);
    g.addColorStop(1, 'rgba(0,0,0,.45)');
    c.fillStyle = g;
    c.fillRect(fx, y0, fw, y1 - y0);
  }
  // lit low by the fire and candles, dark up high
  c.fillStyle = linear(c, 0, y0, 0, y1, [[0, 'rgba(0,0,0,.6)'], [0.5, 'rgba(0,0,0,.1)'], [1, 'rgba(255,120,60,.08)']]);
  c.fillRect(x0 - s, y0, wd + 2 * s, y1 - y0);
  c.restore();
  // tie-back cord with a tassel
  const tx = side < 0 ? x1 - wd * 0.42 : x0 + wd * 0.42;
  c.strokeStyle = '#8a6c3c';
  c.lineWidth = Math.max(1.5, s * 0.06);
  c.beginPath();
  c.moveTo(tx - s * 0.1, tie - s * 0.05);
  c.quadraticCurveTo(tx + side * wd * 0.2, tie + s * 0.12, tx + side * wd * 0.55, tie - s * 0.02);
  c.stroke();
  c.fillStyle = linear(c, 0, tie, 0, tie + s * 0.55, [[0, '#9a7c48'], [1, '#4a3416']]);
  c.beginPath();
  c.moveTo(tx, tie);
  c.lineTo(tx + s * 0.1, tie + s * 0.5);
  c.lineTo(tx - s * 0.1, tie + s * 0.5);
  c.fill();
}

/* ---------------- per frame ---------------- */

/**
 * A flame's flicker: FLICKER_MEAN plus three sines (weights 0.5, 0.3, 0.2) scaled by 0.18, so it swings over
 * 0.64..1 and averages FLICKER_MEAN.
 */
export const FLICKER_MEAN = 0.82;
function flicker(now: number, p: number): number {
  return FLICKER_MEAN + 0.18 * (0.5 * Math.sin(now * 0.013 + p) + 0.3 * Math.sin(now * 0.031 + p * 2.1) + 0.2 * Math.sin(now * 0.071 + p * 3.3));
}

/** The room's per-frame part: the snow beyond the glass, the coals, the candle flames and the clock; their glow. */
export class ParlourRoom implements Backdrop {
  /** The snow outside, in the window's 0..1 coordinates. */
  private readonly flakes = Array.from({ length: 34 }, (_, i) => {
    const r = mulberry32(500 + i);
    return { x: r(), y: r(), z: r(), p: r() * TAU };
  });
  private last = 0;
  private readonly s: number;
  /** The clock's hands, as angles; read from the real time at most once a second (into one Date), not every frame. */
  private handH = 0;
  private handM = 0;
  private clockRead = -Infinity;
  private readonly time = new Date();

  constructor(readonly room: Room, L: Layout) {
    this.s = L.s;
  }

  /** Every flake falls; from tier 2 only half are drawn, and tier 3 lets the coals rest. The flames and clock always. */
  back(c: CanvasRenderingContext2D, now: number, reduced: boolean, tier: number): void {
    const { room, s } = this;
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    const spr = room.spr;
    // snow beyond the glass
    const { x0, y0, x1, y1 } = room.win;
    const flakes = this.flakes;
    const drawn = tier >= 2 ? Math.ceil(flakes.length / 2) : flakes.length;
    c.save();
    c.beginPath();
    c.rect(x0, y0, x1 - x0, y1 - y0);
    c.clip();
    for (let i = 0; i < flakes.length; i++) {
      const f = flakes[i];
      if (!reduced) {
        f.y += dt * (0.05 + f.z * 0.08);
        f.x += Math.sin(now * 0.0006 + f.p) * dt * 0.02;
        if (f.y > 1) {
          f.y = 0;
          f.x = Math.random();
        }
      }
      if (i >= drawn) continue;
      const sz = 0.8 + f.z * 1.6;
      c.globalAlpha = 0.4 + f.z * 0.4;
      c.drawImage(spr.flake, x0 + f.x * (x1 - x0) - sz, y0 + f.y * (y1 - y0) - sz, sz * 2, sz * 2);
    }
    c.restore();
    // the coals breathe
    if (tier < 3) {
      const fl = reduced ? 1 : flicker(now * 0.6, 3);
      const cr = room.coals.w * 0.55;
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = Math.max(0, 0.28 * fl - 0.12);
      c.drawImage(spr.coals, room.coals.x - cr, room.coals.y - cr, cr * 2, cr * 2);
      c.globalCompositeOperation = 'source-over';
    }
    // candle flames: the baked flame, scaled to this frame's height and sheared so the tip sways
    c.globalAlpha = 0.9;
    for (let i = 0; i < room.flames.length; i++) {
      const f = room.flames[i];
      const k = reduced ? 1 : flicker(now, f.p);
      const sway = reduced ? 0 : Math.sin(now * 0.004 + f.p) * s * 0.012;
      const fh = s * 0.2 * f.k * (0.9 + 0.15 * k);
      const fw = room.flameW * f.k;
      c.save();
      c.translate(f.x, f.y);
      c.transform(1, 0, (-sway * 3) / fh, 1, 0, 0);
      c.drawImage(spr.flame, -fw / 2, -fh, fw, fh);
      c.restore();
    }
    c.globalAlpha = 1;
    // the clock keeps real time
    if (now - this.clockRead >= 1000 || now < this.clockRead) {
      this.clockRead = now;
      const t = this.time;
      t.setTime(Date.now());
      this.handH = (((t.getHours() % 12) + t.getMinutes() / 60) / 12) * TAU;
      this.handM = ((t.getMinutes() + t.getSeconds() / 60) / 60) * TAU;
    }
    const { handH, handM } = this;
    const { x, y, r } = room.clock;
    c.strokeStyle = 'rgba(30,18,8,.6)';
    c.lineCap = 'round';
    c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + Math.sin(handH) * r * 0.45, y - Math.cos(handH) * r * 0.45);
    c.stroke();
    c.lineWidth = 1.1;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + Math.sin(handM) * r * 0.7, y - Math.cos(handM) * r * 0.7);
    c.stroke();
    c.lineCap = 'butt';
    c.fillStyle = '#3a2410';
    disc(c, x, y, 1.2);
  }

  /**
   * On the glow layer: the cached blooms of the candles and the coals, faded by globalAlpha. While motion is reduced they
   * hold at the flicker's mean, the brightness they average (not its peak).
   */
  glow(g: CanvasRenderingContext2D, now: number, reduced: boolean): void {
    const { room, s } = this;
    const spr = room.spr;
    for (let i = 0; i < room.flames.length; i++) {
      const f = room.flames[i];
      const r = s * 0.55 * f.k;
      g.globalAlpha = reduced ? FLICKER_MEAN : flicker(now, f.p);
      g.drawImage(spr.flameGlow, f.x - r, f.y - s * 0.08 - r, r * 2, r * 2);
    }
    const cr = room.coals.w * 0.5;
    g.globalAlpha = 0.35 * (reduced ? FLICKER_MEAN : clamp01(flicker(now * 0.6, 3)));
    g.drawImage(spr.coalsGlow, room.coals.x - cr, room.coals.y - cr, cr * 2, cr * 2);
    g.globalAlpha = 1;
  }
}
