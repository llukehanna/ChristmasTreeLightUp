/**
 * The Town square (ported from the lab's scenes-square): the square at blue hour. Far side of the square: a row of
 * snow-roofed townhouses with lit shopfronts and a clock tower, slightly out of focus; gas lamps; carolers and
 * passers-by in silhouette against the shop light; the near side is a skating rink that mirrors the shop light (and, via
 * `reflect`, the tree). Painted once; per frame only its lights bloom, each a sprite baked at paint (SquareLights).
 */
import { mulberry32, type Rng } from '../core/rng';
import type { Backdrop } from './backdrop';
import { X, Y, type Layout } from './layout';
import { TAU, clamp01 } from './paint-util';
import { blurInto, disc, grain, linear, radial, radialSprite } from './scene-util';

/** A light source that blooms: a lamp, the lantern, the clock face or one of the brightest shop windows. */
export interface Glow {
  x: number;
  y: number;
  r: number;
  a: number;
  flicker: number;
  /** A shop window's faint bloom (the first light to go when frames are slow). */
  shop: boolean;
  /** Its bloom, baked once (SquareLights only draws it, faded by globalAlpha). */
  spr: HTMLCanvasElement;
}
function addGlow(glows: Glow[], x: number, y: number, r: number, a: number, col: string, flicker: number, shop = false): void {
  glows.push({ x, y, r, a, flicker, shop, spr: radialSprite([[0, `rgba(${col},1)`], [1, `rgba(${col},0)`]]) });
}

interface Win {
  x: number;
  y: number;
  w: number;
  h: number;
  lit: number;
  shop: boolean;
}

export function paintSquare(c: CanvasRenderingContext2D, L: Layout): SquareLights {
  const { w, h, s } = L;
  const r = mulberry32(23);
  const hz = Y(L, 10.05);
  const yb = Y(L, 8.25);
  const glows: Glow[] = [];

  // Sky: blue hour, a last rose glow low in the west.
  c.fillStyle = linear(c, 0, 0, 0, yb, [[0, '#04071a'], [0.4, '#0c1335'], [0.78, '#22285a'], [1, '#3a3264']]);
  c.fillRect(0, 0, w, yb + 2);
  radial(c, w * 0.22, yb, w * 0.6, [[0, 'rgba(255,130,120,.16)'], [0.5, 'rgba(200,110,150,.06)'], [1, 'rgba(200,110,150,0)']]);
  for (let i = 0; i < 70; i++) {
    const z = r();
    c.fillStyle = `rgba(220,230,255,${0.05 + z * z * 0.35})`;
    disc(c, r() * w, r() * yb * 0.5, 0.3 + z * 0.6);
  }

  // The far side of the square, painted sharp, then set a little out of focus.
  const wins: Win[] = [];
  const lamps: [number, number][] = [];
  blurInto(c, L, s * 0.045, (o) => {
    let x = -s * 0.6;
    let k = 0;
    while (x < w + s) {
      const bw = s * (2.3 + r() * 1.9);
      const center = Math.abs(x + bw / 2 - L.ox) < s * 6;
      const top = Y(L, center ? 3.2 + r() * 1.8 : 1.6 + r() * 3.4);
      house(o, L, r, x, bw, top, yb, k++, wins);
      x += bw + s * (r() < 0.25 ? 0.25 : 0);
    }
    tower(o, L, X(L, -9.6), yb, wins, glows);
    // string lights across the square between the houses
    for (const [x0, x1, y0, sag] of [
      [0, X(L, -4.5), Y(L, 3.6), s * 0.9],
      [X(L, 4.2), w, Y(L, 3.9), s * 0.8],
      [-s, w + s, Y(L, 2.4), s * 2.2],
    ] as const) {
      o.strokeStyle = 'rgba(10,10,20,.6)';
      o.lineWidth = 1;
      o.beginPath();
      for (let t = 0; t <= 1.0001; t += 0.02) {
        const xx = x0 + (x1 - x0) * t;
        const yy = y0 + sag * 4 * t * (1 - t);
        if (t === 0) o.moveTo(xx, yy);
        else o.lineTo(xx, yy);
      }
      o.stroke();
      const n = Math.round((x1 - x0) / (s * 0.45));
      for (let i = 1; i < n; i++) {
        const t = i / n;
        const xx = x0 + (x1 - x0) * t;
        const yy = y0 + sag * 4 * t * (1 - t) + 1.5;
        o.fillStyle = `rgba(255,${(205 + r() * 40) | 0},${(140 + r() * 60) | 0},.95)`;
        disc(o, xx, yy, Math.max(0.8, s * 0.028));
      }
    }
    // gas lamps on the far pavement
    for (const lx of [X(L, -12.6), X(L, -7.2), X(L, 7.4), X(L, 12.4)]) {
      if (lx < -s || lx > w + s) continue;
      const top = yb + s * 0.3 - s * 2.6;
      o.fillStyle = '#0a0b14';
      o.fillRect(lx - s * 0.035, top, s * 0.07, s * 2.6);
      o.fillRect(lx - s * 0.1, yb + s * 0.2, s * 0.2, s * 0.12);
      o.beginPath();
      o.moveTo(lx - s * 0.16, top);
      o.lineTo(lx + s * 0.16, top);
      o.lineTo(lx + s * 0.11, top - s * 0.36);
      o.lineTo(lx - s * 0.11, top - s * 0.36);
      o.closePath();
      o.fillStyle = '#ffd89a';
      o.fill();
      o.fillStyle = '#0a0b14';
      o.beginPath();
      o.moveTo(lx - s * 0.2, top - s * 0.36);
      o.lineTo(lx + s * 0.2, top - s * 0.36);
      o.lineTo(lx, top - s * 0.56);
      o.fill();
      lamps.push([lx, top - s * 0.18]);
    }
  });

  // Halation: the lit windows and lamps bleed light into the dusk.
  blurInto(c, L, s * 0.32, (o) => {
    for (const wn of wins) {
      if (wn.lit <= 0) continue;
      o.fillStyle = `rgba(255,170,90,${(wn.shop ? 0.5 : 0.28) * wn.lit})`;
      o.fillRect(wn.x - s * 0.1, wn.y - s * 0.1, wn.w + s * 0.2, wn.h + s * 0.2);
    }
    for (const [lx, ly] of lamps) {
      o.fillStyle = 'rgba(255,200,120,.35)';
      disc(o, lx, ly, s * 0.5);
    }
  }, 'lighter');

  // Blue-hour haze between us and the far side, thicker up high where the houses meet the sky.
  c.fillStyle = linear(c, 0, Y(L, -2), 0, yb, [[0, 'rgba(34,38,86,0)'], [0.35, 'rgba(34,38,86,.16)'], [0.75, 'rgba(34,38,86,.08)'], [1, 'rgba(34,38,86,.02)']]);
  c.fillRect(0, Y(L, -2), w, yb - Y(L, -2));
  // The far plaza: trodden snow on cobbles, warm pools of shop light.
  c.fillStyle = linear(c, 0, yb, 0, hz, [[0, '#2a2c4a'], [0.4, '#3a3d62'], [1, '#4c5078']]);
  c.fillRect(0, yb, w, hz - yb);
  blurInto(c, L, s * 0.25, (o) => {
    for (const wn of wins) {
      if (!wn.shop || wn.lit <= 0) continue;
      o.save();
      o.translate(wn.x + wn.w / 2, yb + s * 0.55);
      o.scale(1, 0.28);
      radial(o, 0, 0, wn.w * 1.1, [[0, `rgba(255,180,110,${0.32 * wn.lit})`], [1, 'rgba(255,180,110,0)']]);
      o.restore();
    }
    for (const [lx] of lamps) {
      o.save();
      o.translate(lx, yb + s * 0.4);
      o.scale(1, 0.3);
      radial(o, 0, 0, s * 1.8, [[0, 'rgba(255,200,130,.3)'], [1, 'rgba(255,200,130,0)']]);
      o.restore();
    }
  }, 'lighter');
  for (let i = 0; i < 220; i++) {
    c.fillStyle = `rgba(230,236,255,${r() * 0.18})`;
    c.fillRect(r() * w, yb + r() * (hz - yb), 1, 1);
  }

  // People: carolers round a lantern on the left, a couple and a child on the right. Each stands on the plaza: a
  // contact shadow and a long shadow cast away from the nearest light, a lit side toward it, nearer figures darker
  // and overlapping the ones behind (the far ones take a little of the dusk haze).
  blurInto(c, L, s * 0.03, (o) => {
    const by = (d: number) => yb + s * d;
    const lx = X(L, -11.65);
    const lantern: Light = { x: lx, ground: by(0.58), k: 1.15 };
    const people: Fig[] = [
      // carolers: two behind, three in front, round the lantern
      { x: X(L, -11.0), d: 0.3, ht: 1.28, hat: 'bonnet', book: true, scarf: 0 },
      { x: X(L, -10.45), d: 0.33, ht: 1.34, hat: 'top', book: true, scarf: 2 },
      { x: X(L, -11.3), d: 0.58, ht: 1.44, hat: 'top', book: true, scarf: 1 },
      { x: X(L, -10.72), d: 0.62, ht: 1.34, hat: 'beanie', book: true, scarf: 0 },
      { x: X(L, -10.15), d: 0.54, ht: 1.3, hat: 'bonnet', book: true, scarf: 2 },
      // a couple, the child in front of them, and a walker further off
      { x: X(L, 9.92), d: 0.3, ht: 1.3, hat: 'bonnet', book: false, scarf: 1 },
      { x: X(L, 9.52), d: 0.46, ht: 1.42, hat: 'top', book: false, scarf: 0 },
      { x: X(L, 10.22), d: 0.56, ht: 0.85, hat: 'beanie', book: false, scarf: 2 },
      { x: X(L, 11.6), d: 0.2, ht: 1.22, hat: 'beanie', book: false, scarf: 1 },
    ];
    const lightOf = (f: Fig): Light => {
      if (f.x < L.ox) return lantern;
      let best: Light = { x: lamps[0]?.[0] ?? f.x - s, ground: yb + s * 0.3, k: 1 };
      for (const [x] of lamps) if (Math.abs(x - f.x) < Math.abs(best.x - f.x)) best = { x, ground: yb + s * 0.3, k: 1 };
      return best;
    };
    // shadows first, so no one's shadow lies over a neighbour; then back to front
    for (const f of people) castShadow(o, f.x, by(f.d), f.ht * s, lightOf(f));
    people.sort((p, q) => p.d - q.d);
    for (const f of people) person(o, f, by(f.d), f.ht * s, lightOf(f), clamp01((f.d - 0.15) / 0.45));
    // the carolers' lantern on a pole
    o.strokeStyle = '#090a12';
    o.lineWidth = Math.max(1, s * 0.035);
    o.beginPath();
    o.moveTo(lx, by(0.58));
    o.lineTo(lx + s * 0.15, by(0.58) - s * 1.9);
    o.stroke();
    o.fillStyle = '#ffd08a';
    o.fillRect(lx + s * 0.08, by(0.58) - s * 1.9, s * 0.16, s * 0.22);
    addGlow(glows, lx + s * 0.16, by(0.58) - s * 1.8, s * 0.7, 0.7, '255,200,120', 1);
  });

  // The rink: dark glossy ice, the shop light streaked down in it, a snowy lip at its edge.
  c.fillStyle = linear(c, 0, hz, 0, h, [[0, '#1d2340'], [0.35, '#11152a'], [1, '#080a14']]);
  c.fillRect(0, hz, w, h - hz);
  blurInto(c, L, s * 0.22, (o) => {
    for (const wn of wins) {
      if (!wn.shop || wn.lit <= 0) continue;
      const x = wn.x + wn.w * 0.15;
      o.fillStyle = linear(o, 0, hz, 0, hz + s * 1.6, [[0, `rgba(255,180,100,${0.28 * wn.lit})`], [1, 'rgba(255,180,100,0)']]);
      o.fillRect(x, hz, wn.w * 0.7, s * 1.6);
    }
    for (const [lx] of lamps) {
      o.fillStyle = linear(o, 0, hz, 0, hz + s * 1.4, [[0, 'rgba(255,210,140,.3)'], [1, 'rgba(255,210,140,0)']]);
      o.fillRect(lx - s * 0.12, hz, s * 0.24, s * 1.4);
    }
  }, 'lighter');
  c.fillStyle = linear(c, 0, hz, 0, hz + s * 0.5, [[0, 'rgba(200,215,255,.08)'], [1, 'rgba(200,215,255,0)']]);
  c.fillRect(0, hz, w, s * 0.5);
  // skate scratches
  c.lineWidth = 0.7;
  for (let i = 0; i < 26; i++) {
    const x = r() * w;
    const y = hz + s * (0.15 + r() * 1.2);
    c.strokeStyle = `rgba(210,220,255,${0.04 + r() * 0.07})`;
    c.beginPath();
    c.ellipse(x, y, s * (1 + r() * 3), s * (0.1 + r() * 0.25), (r() - 0.5) * 0.2, r() * TAU, r() * TAU + 1.2 + r());
    c.stroke();
  }
  c.fillStyle = linear(c, 0, hz - s * 0.12, 0, hz + s * 0.08, [[0, 'rgba(220,228,250,0)'], [0.6, 'rgba(220,228,250,.22)'], [1, 'rgba(220,228,250,0)']]);
  c.fillRect(0, hz - s * 0.12, w, s * 0.2);

  for (const [lx, ly] of lamps) addGlow(glows, lx, ly, s * 0.9, 0.85, '255,205,130', 0.5);
  // the brightest shop windows bloom a little
  for (const wn of wins) if (wn.shop && wn.lit > 0.8) addGlow(glows, wn.x + wn.w / 2, wn.y + wn.h * 0.55, wn.w * 0.6, 0.22, '255,180,100', 0, true);
  grain(c, 0.1, 23);
  return new SquareLights(glows);
}

type Hat = 'top' | 'bonnet' | 'beanie';
interface Fig {
  x: number;
  /** Feet below the far pavement, in cells (bigger is nearer). */
  d: number;
  /** Height in cells. */
  ht: number;
  hat: Hat;
  book: boolean;
  scarf: number;
}
/** A light standing on the plaza: its x, the screen y of its foot, how long the shadows it throws are. */
interface Light {
  x: number;
  ground: number;
  k: number;
}
/** The plaza seen at a grazing angle: a step of 1 into the scene is this much up the screen. */
const FORESHORTEN = 0.3;
const SCARVES = ['rgba(120,34,36,.55)', 'rgba(36,70,46,.5)', 'rgba(150,130,100,.32)'];

/** A contact shadow at the feet and a long, fading shadow laid on the snow away from the light. */
function castShadow(o: CanvasRenderingContext2D, x: number, feet: number, ht: number, lt: Light): void {
  const sh = ht * 0.17;
  // ground space: x across, z into the scene (screen y = feet - z·FORESHORTEN)
  const gx = x - lt.x;
  const gz = (lt.ground - feet) / FORESHORTEN;
  const n = Math.hypot(gx, gz) || 1;
  const dx = gx / n;
  const dz = gz / n;
  const len = ht * lt.k * (0.9 + 0.4 * Math.min(1, n / (ht * 2.5)));
  const at = (u: number, v: number): [number, number] => [x + dx * u - dz * v, feet - (dz * u + dx * v) * FORESHORTEN];
  const [x0, y0] = at(0, sh * 0.95);
  const [x1, y1] = at(len, sh * 1.6);
  const [x2, y2] = at(len, -sh * 1.6);
  const [x3, y3] = at(0, -sh * 0.95);
  const [ex, ey] = at(len, 0);
  o.fillStyle = linear(o, x, feet, ex, ey, [[0, 'rgba(8,10,28,.6)'], [0.5, 'rgba(8,10,28,.28)'], [1, 'rgba(8,10,28,0)']]);
  o.beginPath();
  o.moveTo(x0, y0);
  o.lineTo(x1, y1);
  o.lineTo(x2, y2);
  o.lineTo(x3, y3);
  o.closePath();
  o.fill();
  o.fillStyle = 'rgba(6,8,20,.5)';
  o.beginPath();
  o.ellipse(x, feet - ht * 0.005, sh * 1.25, Math.max(1, ht * 0.03), 0, 0, TAU);
  o.fill();
}

function person(o: CanvasRenderingContext2D, f: Fig, feet: number, ht: number, lt: Light, near: number): void {
  const { x, hat, book } = f;
  const head = ht * 0.1;
  const sh = ht * 0.17;
  const neck = feet - ht + head * 2.1;
  const side = lt.x < x ? -1 : 1;
  // the silhouette, every part wound the same way so it fills (and clips) as one shape
  const p = new Path2D();
  p.moveTo(x + sh * 0.62, neck + head * 0.2);
  p.quadraticCurveTo(x + sh * 0.95, neck + head * 0.3, x + sh * 0.9, neck + ht * 0.25);
  p.lineTo(x + sh * 1.05, feet - ht * 0.08);
  p.lineTo(x - sh * 1.05, feet - ht * 0.08);
  p.lineTo(x - sh * 0.9, neck + ht * 0.25);
  p.quadraticCurveTo(x - sh * 0.95, neck + head * 0.3, x - sh * 0.62, neck + head * 0.2);
  p.closePath();
  p.rect(x - sh * 0.5, feet - ht * 0.1, sh * 0.35, ht * 0.1);
  p.rect(x + sh * 0.15, feet - ht * 0.1, sh * 0.35, ht * 0.1);
  p.moveTo(x + head, neck - head * 0.75);
  p.arc(x, neck - head * 0.75, head, 0, TAU);
  if (hat === 'top') {
    p.rect(x - head * 1.25, neck - head * 1.55, head * 2.5, head * 0.28);
    p.rect(x - head * 0.8, neck - head * 2.9, head * 1.6, head * 1.4);
  } else if (hat === 'bonnet') {
    p.moveTo(x + Math.cos(Math.PI * 0.9) * head * 1.35, neck - head * 0.9 + Math.sin(Math.PI * 0.9) * head * 1.25);
    p.ellipse(x, neck - head * 0.9, head * 1.35, head * 1.25, 0, Math.PI * 0.9, Math.PI * 2.1);
    p.closePath();
  } else {
    p.moveTo(x - head * 1.05, neck - head * 1.15);
    p.ellipse(x, neck - head * 1.15, head * 1.05, head * 0.85, 0, Math.PI, TAU);
    p.closePath();
    p.moveTo(x + head * 0.35, neck - head * 2.05);
    p.arc(x, neck - head * 2.05, head * 0.35, 0, TAU);
  }
  // nearer figures are darker; the far ones take on a little of the dusk between
  const haze = (1 - near) * 0.6;
  o.fillStyle = `rgb(${Math.round(8 + 22 * haze)},${Math.round(9 + 22 * haze)},${Math.round(17 + 38 * haze)})`;
  o.fill(p);
  o.save();
  o.clip(p);
  // the lit side toward the light, the far side falling into shadow; the shoulders catch a little more
  o.fillStyle = linear(o, x - side * sh * 1.1, 0, x + side * sh * 1.1, 0, [[0, 'rgba(0,0,0,.38)'], [0.45, 'rgba(0,0,0,0)'], [0.65, 'rgba(255,186,118,.06)'], [1, 'rgba(255,186,118,.36)']]);
  o.fillRect(x - sh * 1.2, feet - ht * 1.1, sh * 2.4, ht * 1.1);
  o.fillStyle = linear(o, 0, neck - head * 3, 0, feet, [[0, 'rgba(255,200,140,.07)'], [0.45, 'rgba(255,200,140,0)'], [1, 'rgba(0,0,0,.18)']]);
  o.fillRect(x - sh * 1.2, feet - ht * 1.1, sh * 2.4, ht * 1.1);
  // a scarf, barely there
  o.fillStyle = SCARVES[f.scarf % SCARVES.length];
  o.fillRect(x - sh * 0.62, neck - head * 0.05, sh * 1.24, head * 0.5);
  o.restore();
  // rim light on the lit side
  o.strokeStyle = 'rgba(255,190,120,.3)';
  o.lineWidth = Math.max(0.8, ht * 0.012);
  o.beginPath();
  if (side < 0) o.arc(x, neck - head * 0.75, head, -Math.PI * 0.95, -Math.PI * 0.4);
  else o.arc(x, neck - head * 0.75, head, -Math.PI * 0.6, -Math.PI * 0.05);
  o.stroke();
  o.beginPath();
  o.moveTo(x + side * sh * 0.62, neck + head * 0.2);
  o.quadraticCurveTo(x + side * sh * 0.95, neck + head * 0.3, x + side * sh * 0.9, neck + ht * 0.25);
  o.lineTo(x + side * sh * 0.98, neck + ht * 0.5);
  o.stroke();
  if (book) {
    o.fillStyle = 'rgba(255,214,160,.3)';
    o.save();
    o.translate(x, neck + ht * 0.2);
    o.rotate(-0.15);
    o.fillRect(-sh * 0.45, 0, sh * 0.9, ht * 0.07);
    o.restore();
  }
}

const WALLS = ['#141428', '#1a1424', '#111426', '#17152b', '#1c1422', '#121527'];
const AWNINGS = [['#5a1418', '#d8c8a8'], ['#163a26', '#d8c8a8'], ['#4a1a3a', '#e0d0b0'], ['#1c2c50', '#d8c8a8']];

function house(o: CanvasRenderingContext2D, L: Layout, r: Rng, x: number, bw: number, top: number, base: number, k: number, wins: Win[]): void {
  const s = L.s;
  const roof = r();
  const kind = roof < 0.4 ? 'gable' : roof < 0.7 ? 'step' : 'flat';
  const wall = WALLS[k % WALLS.length];
  o.fillStyle = wall;
  o.beginPath();
  o.moveTo(x, base);
  o.lineTo(x, top);
  if (kind === 'gable') o.lineTo(x + bw / 2, top - bw * 0.42);
  else if (kind === 'step') {
    const st = 4;
    for (let i = 0; i < st; i++) {
      const xx = x + (bw / 2) * (i / st);
      const yy = top - (bw * 0.45 * i) / st;
      o.lineTo(xx, yy);
      o.lineTo(xx, yy - (bw * 0.45) / st);
    }
    o.lineTo(x + bw / 2 + bw * 0.06, top - bw * 0.45);
    for (let i = st - 1; i >= 0; i--) {
      const xx = x + bw - (bw / 2) * (i / st);
      const yy = top - (bw * 0.45 * i) / st;
      o.lineTo(xx, yy - (bw * 0.45) / st);
      o.lineTo(xx, yy);
    }
  }
  o.lineTo(x + bw, top);
  o.lineTo(x + bw, base);
  o.closePath();
  o.fill();
  // light: warm from the street below, the sky's cool on the upper wall
  o.save();
  o.clip();
  o.fillStyle = linear(o, 0, top - bw * 0.5, 0, base, [[0, 'rgba(120,130,200,.08)'], [0.6, 'rgba(0,0,0,0)'], [1, 'rgba(255,150,80,.16)']]);
  o.fillRect(x, top - bw, bw, base - top + bw);
  o.fillStyle = 'rgba(0,0,0,.25)';
  o.fillRect(x, top - bw, s * 0.08, base - top + bw);
  o.restore();
  // snow on the roofline
  o.strokeStyle = 'rgba(214,224,246,.55)';
  o.lineWidth = Math.max(1, s * 0.07);
  o.lineJoin = 'round';
  o.beginPath();
  if (kind === 'gable') {
    o.moveTo(x - s * 0.05, top + 1);
    o.lineTo(x + bw / 2, top - bw * 0.42 + 1);
    o.lineTo(x + bw + s * 0.05, top + 1);
  } else if (kind === 'flat') {
    o.moveTo(x - s * 0.06, top);
    o.lineTo(x + bw + s * 0.06, top);
  }
  o.stroke();
  if (kind === 'flat') {
    o.fillStyle = 'rgba(0,0,0,.35)';
    o.fillRect(x - s * 0.06, top + s * 0.04, bw + s * 0.12, s * 0.1);
  }
  // upper windows
  const floors = Math.max(1, Math.floor((base - s * 1.55 - top) / (s * 1.05)));
  const cols = Math.max(2, Math.floor(bw / (s * 0.8)));
  const ww = s * 0.36;
  const wh = s * 0.58;
  for (let f = 0; f < floors; f++) {
    const yy = top + s * 0.35 + f * s * 1.05;
    for (let i = 0; i < cols; i++) {
      const xx = x + (bw / cols) * (i + 0.5) - ww / 2;
      const lit = r() < 0.42 ? 0.55 + r() * 0.45 : 0;
      win(o, xx, yy, ww, wh, lit, false);
      wins.push({ x: xx, y: yy, w: ww, h: wh, lit, shop: false });
      o.fillStyle = 'rgba(214,224,246,.35)';
      o.fillRect(xx - s * 0.04, yy + wh, ww + s * 0.08, Math.max(1, s * 0.04));
    }
  }
  // the shopfront
  const sy = base - s * 1.25;
  const sw = bw * (0.55 + r() * 0.15);
  const sx = x + (bw - sw) * (r() < 0.5 ? 0.22 : 0.78);
  const lit = r() < 0.85 ? 0.8 + r() * 0.2 : 0.3;
  win(o, sx, sy, sw, s * 0.95, lit, true);
  wins.push({ x: sx, y: sy, w: sw, h: s * 0.95, lit, shop: true });
  // door
  const dx = sx < x + bw / 2 ? sx + sw + s * 0.2 : sx - s * 0.62;
  if (dx > x && dx + s * 0.45 < x + bw) {
    o.fillStyle = '#0b0b14';
    o.fillRect(dx, base - s * 1.05, s * 0.42, s * 1.05);
    o.fillStyle = 'rgba(255,190,110,.5)';
    o.fillRect(dx + s * 0.08, base - s * 0.95, s * 0.26, s * 0.22);
    // wreath
    o.strokeStyle = '#1d3a22';
    o.lineWidth = Math.max(1, s * 0.06);
    o.beginPath();
    o.arc(dx + s * 0.21, base - s * 0.55, s * 0.11, 0, TAU);
    o.stroke();
    o.fillStyle = '#9a1c22';
    disc(o, dx + s * 0.21, base - s * 0.43, s * 0.035);
  }
  // awning over the shop window, in shadow on top, warm lit underneath
  const [a0, a1] = AWNINGS[k % AWNINGS.length];
  const ay = sy - s * 0.32;
  const ad = s * 0.36;
  const stripes = Math.max(4, Math.round(sw / (s * 0.22)));
  for (let i = 0; i < stripes; i++) {
    o.fillStyle = i % 2 ? a1 : a0;
    const x0 = sx - s * 0.08 + ((sw + s * 0.16) * i) / stripes;
    const x1 = sx - s * 0.08 + ((sw + s * 0.16) * (i + 1)) / stripes;
    o.fillRect(x0, ay, x1 - x0 + 0.5, ad);
  }
  o.fillStyle = linear(o, 0, ay, 0, ay + ad, [[0, 'rgba(10,10,25,.75)'], [0.7, 'rgba(10,10,25,.45)'], [1, 'rgba(255,170,90,.25)']]);
  o.fillRect(sx - s * 0.08, ay, sw + s * 0.16, ad);
  o.fillStyle = 'rgba(214,224,246,.5)';
  o.fillRect(sx - s * 0.1, ay - Math.max(1, s * 0.04), sw + s * 0.2, Math.max(1, s * 0.05));
  // a sign board above
  o.fillStyle = 'rgba(0,0,0,.35)';
  o.fillRect(sx, ay - s * 0.36, sw, s * 0.24);
  o.fillStyle = 'rgba(220,180,110,.28)';
  o.fillRect(sx + sw * 0.2, ay - s * 0.26, sw * 0.6, Math.max(1, s * 0.035));
}

function win(o: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, lit: number, shop: boolean): void {
  if (lit > 0) {
    o.fillStyle = linear(o, 0, y, 0, y + h, shop
      ? [[0, `rgba(255,214,150,${lit})`], [0.6, `rgba(255,178,96,${lit})`], [1, `rgba(220,120,60,${lit})`]]
      : [[0, `rgba(255,190,110,${lit * 0.85})`], [1, `rgba(220,130,70,${lit * 0.85})`]]);
  } else o.fillStyle = 'rgba(14,16,32,.95)';
  o.fillRect(x, y, w, h);
  if (shop && lit > 0) {
    // the window display: shelves and a small tree, in silhouette against the light
    o.fillStyle = 'rgba(60,24,12,.55)';
    o.fillRect(x, y + h * 0.72, w, h * 0.04);
    o.fillRect(x, y + h * 0.42, w, h * 0.03);
    for (let i = 0; i < 6; i++) {
      const bx = x + w * (0.08 + i * 0.15);
      o.fillRect(bx, y + h * (i % 2 ? 0.56 : 0.6), w * 0.07, h * (i % 2 ? 0.16 : 0.12));
    }
    o.fillStyle = 'rgba(30,50,30,.6)';
    o.beginPath();
    o.moveTo(x + w * 0.5, y + h * 0.1);
    o.lineTo(x + w * 0.6, y + h * 0.4);
    o.lineTo(x + w * 0.4, y + h * 0.4);
    o.fill();
  }
  if (!shop && lit > 0 && (x * 7 + y * 3) % 5 < 2) {
    // a curtain half drawn
    o.fillStyle = 'rgba(70,20,20,.55)';
    o.fillRect(x, y, w * 0.38, h);
  }
  // glazing bars
  o.fillStyle = 'rgba(8,8,16,.85)';
  const bar = Math.max(1, w * (shop ? 0.012 : 0.07));
  o.fillRect(x + w / 2 - bar / 2, y, bar, h);
  o.fillRect(x, y + h * (shop ? 0.28 : 0.45), w, bar);
  if (shop) {
    o.fillRect(x + w * 0.25 - bar / 2, y, bar, h);
    o.fillRect(x + w * 0.75 - bar / 2, y, bar, h);
  }
  o.strokeStyle = 'rgba(0,0,0,.6)';
  o.lineWidth = 1;
  o.strokeRect(x, y, w, h);
}

function tower(o: CanvasRenderingContext2D, L: Layout, cx: number, base: number, wins: Win[], glows: Glow[]): void {
  const s = L.s;
  const tw = s * 1.5;
  const top = Y(L, 1.1);
  o.fillStyle = '#15162a';
  o.fillRect(cx - tw / 2, top, tw, base - top);
  o.fillStyle = linear(o, cx - tw / 2, 0, cx + tw / 2, 0, [[0, 'rgba(0,0,0,.3)'], [0.4, 'rgba(255,255,255,0)'], [1, 'rgba(120,130,200,.08)']]);
  o.fillRect(cx - tw / 2, top, tw, base - top);
  // belfry and spire
  o.fillStyle = '#121326';
  o.fillRect(cx - tw * 0.58, top - s * 0.15, tw * 1.16, s * 0.18);
  o.beginPath();
  o.moveTo(cx - tw * 0.5, top - s * 0.12);
  o.lineTo(cx, top - s * 2.1);
  o.lineTo(cx + tw * 0.5, top - s * 0.12);
  o.fill();
  o.strokeStyle = 'rgba(214,224,246,.45)';
  o.lineWidth = Math.max(1, s * 0.05);
  o.beginPath();
  o.moveTo(cx - tw * 0.5, top - s * 0.1);
  o.lineTo(cx, top - s * 2.05);
  o.stroke();
  o.fillStyle = '#c9a25a';
  o.fillRect(cx - 0.6, top - s * 2.45, 1.2, s * 0.4);
  // clock face, lit from within
  const fy = top + s * 0.95;
  const fr = tw * 0.33;
  radial(o, cx, fy, fr * 1.05, [[0, '#fff1d0'], [0.8, '#ffd99a'], [1, '#b98a4a']]);
  o.strokeStyle = 'rgba(40,24,10,.9)';
  o.lineWidth = Math.max(1, s * 0.03);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    o.beginPath();
    o.moveTo(cx + Math.cos(a) * fr * 0.78, fy + Math.sin(a) * fr * 0.78);
    o.lineTo(cx + Math.cos(a) * fr * 0.92, fy + Math.sin(a) * fr * 0.92);
    o.stroke();
  }
  // ten to five
  o.lineWidth = Math.max(1, s * 0.035);
  o.beginPath();
  o.moveTo(cx, fy);
  o.lineTo(cx + Math.cos(-Math.PI / 2 + (4.83 / 12) * TAU) * fr * 0.5, fy + Math.sin(-Math.PI / 2 + (4.83 / 12) * TAU) * fr * 0.5);
  o.moveTo(cx, fy);
  o.lineTo(cx + Math.cos(-Math.PI / 2 + (50 / 60) * TAU) * fr * 0.75, fy + Math.sin(-Math.PI / 2 + (50 / 60) * TAU) * fr * 0.75);
  o.stroke();
  addGlow(glows, cx, fy, fr * 2.2, 0.45, '255,214,150', 0);
  // two arched windows below
  for (const k of [-1, 1]) {
    const x = cx + k * tw * 0.2 - s * 0.12;
    const y = fy + s * 1.0;
    o.fillStyle = 'rgba(255,190,110,.75)';
    o.beginPath();
    o.moveTo(x, y + s * 0.7);
    o.lineTo(x, y + s * 0.12);
    o.arc(x + s * 0.12, y + s * 0.12, s * 0.12, Math.PI, 0);
    o.lineTo(x + s * 0.24, y + s * 0.7);
    o.fill();
    wins.push({ x, y, w: s * 0.24, h: s * 0.7, lit: 0.6, shop: false });
  }
}

/** The square's per-frame part: nothing behind the tree, only its lights' blooms on the glow layer. */
export class SquareLights implements Backdrop {
  constructor(readonly glows: readonly Glow[]) {}

  back(): void {}

  /**
   * Each light's cached bloom sprite, faded by globalAlpha (no gradients, no allocation). The lamps flicker a little,
   * held steady while motion is reduced; tier 3 leaves out the shop windows' faint blooms.
   */
  glow(g: CanvasRenderingContext2D, now: number, reduced: boolean, tier: number): void {
    const glows = this.glows;
    for (let i = 0; i < glows.length; i++) {
      const gl = glows[i];
      if (gl.shop && tier >= 3) continue;
      const f = gl.flicker && !reduced ? 1 - gl.flicker * 0.08 * (0.5 + 0.5 * Math.sin(now * 0.011 + gl.x)) * (0.5 + 0.5 * Math.sin(now * 0.0047 + gl.y)) : 1;
      g.globalAlpha = gl.a * f;
      g.drawImage(gl.spr, gl.x - gl.r, gl.y - gl.r, gl.r * 2, gl.r * 2);
    }
    g.globalAlpha = 1;
  }
}
