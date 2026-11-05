/**
 * The Sash (ported from the lab's scenes-window-sash): a tall Venetian sash window directly behind the tree, an arched
 * fanlight over the star, narrow sidelights either side, heavy slate drapes. Outside: a deep blue snowy night, a far
 * ridge with a few village lights, one street lamp down the hill. Heavy, slow flakes. The bars are backlit, so they
 * read dark. Painted once; the snow behind the glass is the WindowSpec's (src/render/window-kit.ts).
 */
import { mulberry32 } from '../core/rng';
import { X, Y, type Layout } from './layout';
import { TAU } from './paint-util';
import { blurInto, disc, grain, linear, radial } from './scene-util';
import { boxOf, drape, floor, glassEdge, panes, paneDrift, snowbank, type Rect, type WindowSpec } from './window-kit';

export function paintSash(c: CanvasRenderingContext2D, L: Layout): WindowSpec {
  const { w, h, s } = L;
  const r = mulberry32(41);
  const hz = Y(L, 10.05);

  // ---- the room: slate-blue wall, faint panelling ----
  c.fillStyle = linear(c, 0, 0, 0, hz, [[0, '#0c0f18'], [0.45, '#151a27'], [1, '#171c29']]);
  c.fillRect(0, 0, w, hz);
  const dado = Y(L, 8.15);
  c.fillStyle = 'rgba(0,0,0,.22)';
  c.fillRect(0, dado, w, hz - dado);
  c.fillStyle = 'rgba(150,170,220,.07)';
  c.fillRect(0, dado, w, 1);
  for (let x = -s * 0.6; x < w; x += s * 2.1) {
    c.strokeStyle = 'rgba(150,170,220,.05)';
    c.strokeRect(x + s * 0.25, dado + s * 0.35, s * 1.6, hz - dado - s * 0.8);
  }
  floor(c, L, hz, '#16171f', '#08080c');

  // ---- the window: geometry ----
  const bar = Math.max(2, s * 0.07);
  const rail = Math.max(3, s * 0.14);
  const post = s * 0.46;
  const cx0 = X(L, -5.4);
  const cx1 = X(L, 5.4);
  const spring = Y(L, -0.6);
  const sill = Y(L, 7.6);
  const meet = Y(L, 3.5);
  const ry = s * 2.9;
  const sideW = s * 2.7;
  const lx0 = cx0 - post - sideW;
  const rx0 = cx1 + post;
  const sideTop = Y(L, -0.15);
  // the opening (centre arch + sidelights), painted as the frame colour; the glass is cut out of it
  const frame = '#121620';
  c.fillStyle = frame;
  c.beginPath();
  c.moveTo(cx0, sill);
  c.lineTo(cx0, spring);
  c.ellipse((cx0 + cx1) / 2, spring, (cx1 - cx0) / 2, ry, 0, Math.PI, TAU);
  c.lineTo(cx1, sill);
  c.closePath();
  c.fill();
  c.fillRect(lx0, sideTop, sideW + post, sill - sideTop);
  c.fillRect(cx1, sideTop, sideW + post, sill - sideTop);

  const glass: Rect[] = [
    ...panes({ x: cx0 + rail, y: spring + rail, w: cx1 - cx0 - 2 * rail, h: meet - spring - rail * 1.5 }, 3, 2, bar),
    ...panes({ x: cx0 + rail, y: meet + rail * 0.5, w: cx1 - cx0 - 2 * rail, h: sill - meet - rail * 1.5 }, 3, 2, bar),
    ...panes({ x: lx0 + rail, y: sideTop + rail, w: sideW - 2 * rail, h: sill - sideTop - 2 * rail }, 1, 4, bar),
    ...panes({ x: rx0 + rail, y: sideTop + rail, w: sideW - 2 * rail, h: sill - sideTop - 2 * rail }, 1, 4, bar),
  ];
  const path = new Path2D();
  for (const q of glass) path.rect(q.x, q.y, q.w, q.h);
  // the fanlight: a sunburst of wedges between radial bars, round a small hub
  const fcx = (cx0 + cx1) / 2;
  const fy = spring;
  const rx = (cx1 - cx0) / 2 - rail;
  const ryi = ry - rail;
  const hub = 0.22;
  const spokes = 5;
  const gap = bar / rx;
  const fan = new Path2D();
  for (let i = 0; i < spokes; i++) {
    const a0 = Math.PI + (i / spokes) * Math.PI + gap;
    const a1 = Math.PI + ((i + 1) / spokes) * Math.PI - gap;
    fan.moveTo(fcx + Math.cos(a0) * rx * hub, fy - rail * 0.5 + Math.sin(a0) * ryi * hub);
    fan.ellipse(fcx, fy - rail * 0.5, rx, ryi, 0, a0, a1);
    fan.ellipse(fcx, fy - rail * 0.5, rx * hub, ryi * hub, 0, a1, a0, true);
    fan.closePath();
  }
  path.addPath(fan);

  // ---- outside: a deep blue night, seen through the glass ----
  const top = spring - ry;
  c.save();
  c.clip(path);
  c.fillStyle = linear(c, 0, top, 0, sill, [[0, '#03061a'], [0.35, '#08102a'], [0.62, '#0f1a3c'], [1, '#121d40']]);
  c.fillRect(lx0, top, rx0 + sideW - lx0, sill - top);
  // a moon lost behind the snow cloud
  radial(c, X(L, -2.2), Y(L, -1.6), s * 3.2, [[0, 'rgba(120,145,210,.10)'], [1, 'rgba(120,145,210,0)']]);
  blurInto(c, L, s * 0.06, (o) => {
    o.save();
    o.clip(path);
    // the far ridge, a little lighter than the sky (snow), with a scatter of village lights
    snowbank(o, lx0 - s, rx0 + sideW + s, Y(L, 2.15), s * 0.35, sill, r, linear(o, 0, Y(L, 1.8), 0, sill, [[0, '#1b2648'], [0.5, '#141d3a'], [1, '#0e1530']]));
    // a nearer slope falling away to the right, and the street lamp on it
    snowbank(o, X(L, 2.5), rx0 + sideW + s, Y(L, 3.6), s * 0.2, sill, r, linear(o, 0, Y(L, 3.4), 0, sill, [[0, '#212c50'], [1, '#121a36']]));
    snowbank(o, lx0 - s, X(L, -1.0), Y(L, 4.0), s * 0.25, sill, r, linear(o, 0, Y(L, 3.8), 0, sill, [[0, '#1d2749'], [1, '#111833']]));
    // bare trees on the left slope
    o.strokeStyle = 'rgba(6,8,18,.85)';
    for (let i = 0; i < 4; i++) {
      const tx = lx0 + s * 0.4 + i * s * 0.55 + r() * s * 0.3;
      const tb = Y(L, 3.95);
      tree(o, tx, tb, s * (1.0 + r() * 0.5), r);
    }
  });
  // village lights along the ridge, crisp but tiny
  for (let i = 0; i < 34; i++) {
    const x = lx0 + r() * (rx0 + sideW - lx0);
    const y = Y(L, 2.3) + Math.pow(r(), 1.5) * s * 1.2;
    c.fillStyle = `rgba(255,${(180 + r() * 40) | 0},${(110 + r() * 50) | 0},${0.3 + r() * 0.4})`;
    disc(c, x, y, Math.max(0.7, s * (0.014 + r() * 0.014)));
  }
  const lamp = { x: rx0 + sideW * 0.55, y: Y(L, 2.6) };
  c.fillStyle = '#05070f';
  c.fillRect(lamp.x - Math.max(0.6, s * 0.018), lamp.y, Math.max(1.2, s * 0.036), Y(L, 3.75) - lamp.y);
  radial(c, lamp.x, lamp.y, s * 1.4, [[0, 'rgba(255,190,120,.10)'], [1, 'rgba(255,190,120,0)']]);
  c.fillStyle = 'rgba(255,214,160,.75)';
  disc(c, lamp.x, lamp.y, Math.max(1, s * 0.035));
  // a pool of lamplight on the snow below it
  c.save();
  c.translate(lamp.x, Y(L, 3.78));
  c.scale(1, 0.25);
  radial(c, 0, 0, s * 1.1, [[0, 'rgba(255,190,120,.12)'], [1, 'rgba(255,190,120,0)']]);
  c.restore();
  c.restore();
  // snow drifted on the outer sill against the bottom row of panes
  for (const q of glass) if (q.y + q.h > sill - rail * 2) paneDrift(c, q, s * 0.09, r, 'rgba(120,135,180,.32)');
  glassEdge(c, path, 'rgba(110,135,200,.10)');

  // ---- casing, sill, window seat ----
  const casing = s * 0.26;
  c.strokeStyle = '#10131c';
  c.lineWidth = casing;
  c.beginPath();
  c.moveTo(lx0 - casing / 2, sill);
  c.lineTo(lx0 - casing / 2, sideTop - casing / 2);
  c.lineTo(cx0, sideTop - casing / 2);
  c.lineTo(cx0, spring);
  c.ellipse(fcx, spring, (cx1 - cx0) / 2 + casing / 2, ry + casing / 2, 0, Math.PI, TAU);
  c.lineTo(cx1 + casing / 2, sideTop - casing / 2);
  c.lineTo(rx0 + sideW + casing / 2, sideTop - casing / 2);
  c.lineTo(rx0 + sideW + casing / 2, sill);
  c.stroke();
  c.strokeStyle = 'rgba(140,160,215,.06)';
  c.lineWidth = 1;
  c.stroke();
  c.fillStyle = linear(c, 0, sill, 0, sill + s * 0.28, [[0, '#23273a'], [0.25, '#181b27'], [1, '#0e1016']]);
  c.fillRect(lx0 - s * 0.45, sill, rx0 + sideW - lx0 + s * 0.9, s * 0.28);
  c.fillStyle = 'rgba(150,170,225,.09)';
  c.fillRect(lx0 - s * 0.45, sill, rx0 + sideW - lx0 + s * 0.9, 1);
  // a long seat cushion under the window
  c.fillStyle = linear(c, 0, sill + s * 0.28, 0, dado, [[0, '#151824'], [1, '#0f111a']]);
  c.fillRect(lx0 - s * 0.3, sill + s * 0.28, rx0 + sideW - lx0 + s * 0.6, Math.max(0, dado - sill - s * 0.28));

  // ---- drapes on a pole ----
  const poleY = Y(L, -3.75);
  const dl0 = lx0 - s * 1.9;
  const dr1 = rx0 + sideW + s * 1.9;
  drape(c, s, dl0, lx0 + s * 0.35, poleY, hz + s * 0.1, r, '24,27,42', '150,170,230');
  drape(c, s, rx0 + sideW - s * 0.35, dr1, poleY, hz + s * 0.1, r, '24,27,42', '150,170,230');
  c.fillStyle = '#12141c';
  c.fillRect(dl0 - s * 0.3, poleY - s * 0.06, dr1 - dl0 + s * 0.6, s * 0.12);
  c.fillStyle = 'rgba(160,175,220,.08)';
  c.fillRect(dl0 - s * 0.3, poleY - s * 0.06, dr1 - dl0 + s * 0.6, 1);
  for (const x of [dl0 - s * 0.3, dr1 + s * 0.3]) {
    c.fillStyle = '#0d0f16';
    disc(c, x, poleY, s * 0.12);
  }

  // ---- light: the window's cool spill on the floor, darkness at the top and edges ----
  blurInto(c, L, s * 0.5, (o) => {
    o.fillStyle = 'rgba(110,135,210,.08)';
    o.beginPath();
    o.moveTo(lx0, hz + s * 0.1);
    o.lineTo(rx0 + sideW, hz + s * 0.1);
    o.lineTo(rx0 + sideW + s * 2.5, h);
    o.lineTo(lx0 - s * 2.5, h);
    o.fill();
    radial(o, fcx, Y(L, 3), s * 9, [[0, 'rgba(70,90,160,.07)'], [1, 'rgba(70,90,160,0)']]);
    // the tree's own warmth on the room around it
    radial(o, fcx, Y(L, 8.5), s * 11, [[0, 'rgba(255,170,95,.07)'], [1, 'rgba(255,170,95,0)']]);
  }, 'lighter');
  c.fillStyle = linear(c, 0, 0, 0, h * 0.25, [[0, 'rgba(0,0,0,.32)'], [1, 'rgba(0,0,0,0)']]);
  c.fillRect(0, 0, w, h * 0.25);
  for (const [x0, x1] of [[0, w * 0.18], [w, w * 0.82]] as const) {
    c.fillStyle = linear(c, x0, 0, x1, 0, [[0, 'rgba(0,0,0,.28)'], [1, 'rgba(0,0,0,0)']]);
    c.fillRect(Math.min(x0, x1), 0, Math.abs(x1 - x0), h);
  }
  grain(c, 0.1, 41);

  return {
    glass: path,
    box: boxOf([...glass, { x: cx0, y: top, w: cx1 - cx0, h: ry }]),
    rgb: '226,234,255',
    wind: 0.1,
    sheets: [
      { n: 240, tile: 4.2, size: [0.022, 0.034], fall: 0.22, alpha: 0.36, sway: 0.06, drift: 0.4 },
      { n: 110, tile: 5.3, size: [0.036, 0.052], fall: 0.32, alpha: 0.4, sway: 0.1, drift: 0.6 },
    ],
    layers: [
      { n: 90, size: [0.08, 0.12], fall: [0.42, 0.56], alpha: 0.46, look: 'soft', sway: 0.16, drift: 0.8 },
      { n: 22, size: [0.24, 0.36], fall: [0.66, 0.9], alpha: 0.2, look: 'blur', sway: 0.26, drift: 1 },
    ],
    warm: { x: lamp.x, y: lamp.y, r: s * 1.25, rgb: '255,205,140', gain: 1.3 },
    glows: [{ x: lamp.x, y: lamp.y, r: s * 0.45, a: 0.4, rgb: '255,200,130' }],
  };
}

/** A bare winter tree, a few forking strokes. */
function tree(o: CanvasRenderingContext2D, x: number, base: number, ht: number, r: () => number): void {
  const branch = (x0: number, y0: number, ang: number, len: number, wd: number, depth: number): void => {
    const x1 = x0 + Math.cos(ang) * len;
    const y1 = y0 + Math.sin(ang) * len;
    o.lineWidth = wd;
    o.beginPath();
    o.moveTo(x0, y0);
    o.lineTo(x1, y1);
    o.stroke();
    if (depth <= 0) return;
    const n = 2 + (r() < 0.4 ? 1 : 0);
    for (let i = 0; i < n; i++) branch(x1, y1, ang + (r() - 0.5) * 1.3, len * (0.6 + r() * 0.2), wd * 0.65, depth - 1);
  };
  branch(x, base, -Math.PI / 2 + (r() - 0.5) * 0.2, ht * 0.4, Math.max(0.8, ht * 0.04), 4);
}
