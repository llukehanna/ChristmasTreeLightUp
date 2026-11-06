import { mulberry32, type Rng } from '../core/rng';
import type { PresentSet } from '../store/look';
import type { Face, Gift, Pass, Paper, Tone } from './presents';

/**
 * The alternative present sets, painted in place of the game's boxes through the same placement, sprites and two-pass
 * lighting (`Tone`: the scene's ambient, then the tree's warm light), so they warm with the tree like the game's own.
 *  - Luxe: matte papers in deep, quiet colours, satin ribbon with a proper bow (folded loops, notched tails), a hair of
 *    gold foil on the lid edge and a foil tag on the largest box.
 *  - Kraft: brown paper with folded ends and fibres, a few printed in white ink, natural or baker's twine tied in a
 *    small bow, and a sprig of fir with berries.
 * Painted at layout time only, into the gift's sprites; nothing here runs per frame.
 */

type Ctx = CanvasRenderingContext2D;
type P = readonly [number, number];

/**
 * The wrappings that are the game's boxes in other papers (season two, Parts C2+C3): six each, standing in for the
 * game's six (PAPERS) one for one, so every gift keeps its place, size and bow.
 */
export type PaperSet = Extract<PresentSet, 'silver' | 'tartan' | 'starry' | 'candystripe' | 'goldfoil'>;
export const SET_PAPERS: Readonly<Record<PaperSet, readonly Paper[]>> = {
  silver: [
    { base: '#b8c2cc', ribbon: '#f2f5f8', pattern: 'plain', ink: '#b8c2cc' }, // brushed silver, white satin
    { base: '#2c3440', ribbon: '#c9d3de', pattern: 'dots', ink: '#c9d3de' }, // gunmetal, silver dots
    { base: '#e8edf2', ribbon: '#8c99a8', pattern: 'stripe', ink: '#9aa7b6' }, // frost white, pewter pinstripe
    { base: '#5d6b7a', ribbon: '#eef2f6', pattern: 'plain', ink: '#5d6b7a' }, // slate, white satin
    { base: '#cfd8e2', ribbon: '#3a4656', pattern: 'plain', ink: '#cfd8e2' }, // platinum, charcoal ribbon
    { base: '#3e4a58', ribbon: '#d8e0e8', pattern: 'stripe', ink: '#b8c4d0' }, // midnight steel, silver stripe
  ],
  tartan: [
    { base: '#9e1b26', ribbon: '#1f4a33', pattern: 'check', ink: '#1f4a33' }, // red tartan, green ribbon
    { base: '#1f4a33', ribbon: '#c9a24a', pattern: 'check', ink: '#9e1b26' }, // green tartan, gold ribbon
    { base: '#e9dcc0', ribbon: '#9e1b26', pattern: 'check', ink: '#9e1b26' }, // dress tartan on cream, red ribbon
    { base: '#1c2c50', ribbon: '#9e1b26', pattern: 'check', ink: '#2f6b45' }, // navy tartan, red ribbon
    { base: '#9e1b26', ribbon: '#e9dcc0', pattern: 'plain', ink: '#9e1b26' }, // plain red, cream ribbon
    { base: '#1f4a33', ribbon: '#9e1b26', pattern: 'plain', ink: '#1f4a33' }, // plain green, red ribbon
  ],
  starry: [
    { base: '#16224a', ribbon: '#e2b25a', pattern: 'stars', ink: '#f0d080' }, // midnight, gold stars
    { base: '#0f1834', ribbon: '#c9d6ee', pattern: 'stars', ink: '#dfe8ff' }, // night sky, silver stars
    { base: '#e2b25a', ribbon: '#16224a', pattern: 'stars', ink: '#16224a' }, // gold, midnight stars
    { base: '#22336a', ribbon: '#e2b25a', pattern: 'plain', ink: '#22336a' }, // twilight blue, gold ribbon
    { base: '#16224a', ribbon: '#c9d6ee', pattern: 'stars', ink: '#f0d080' }, // midnight, gold stars, silver ribbon
    { base: '#2b3f7a', ribbon: '#f0d080', pattern: 'stars', ink: '#f0d080' }, // dusk blue, gold stars
  ],
  candystripe: [
    { base: '#f6efe8', ribbon: '#c8202e', pattern: 'candy', ink: '#c8202e' }, // white, red candy stripe
    { base: '#c8202e', ribbon: '#f6efe8', pattern: 'candy', ink: '#f6efe8' }, // red, white candy stripe
    { base: '#f6efe8', ribbon: '#2a8a4e', pattern: 'candy', ink: '#2a8a4e' }, // white, green candy stripe
    { base: '#c8202e', ribbon: '#f6efe8', pattern: 'plain', ink: '#c8202e' }, // plain red, white ribbon
    { base: '#f6efe8', ribbon: '#c8202e', pattern: 'candy', ink: '#c8202e' }, // white, red candy stripe
    { base: '#2a8a4e', ribbon: '#f6efe8', pattern: 'candy', ink: '#f6efe8' }, // green, white candy stripe
  ],
  goldfoil: [
    { base: '#c9a24a', ribbon: '#7d1420', pattern: 'plain', ink: '#c9a24a' }, // gold foil, crimson ribbon
    { base: '#e2c070', ribbon: '#1f3f66', pattern: 'stripe', ink: '#b88a30' }, // pale gold, blue ribbon
    { base: '#d8b25a', ribbon: '#7d1420', pattern: 'dots', ink: '#fff0c0' }, // gold, champagne dots
    { base: '#b8862e', ribbon: '#f3e6c4', pattern: 'plain', ink: '#b8862e' }, // old gold, ivory ribbon
    { base: '#e9cc80', ribbon: '#7d1420', pattern: 'stripe', ink: '#b88a30' }, // champagne gold, crimson ribbon
    { base: '#a8782a', ribbon: '#f3e6c4', pattern: 'plain', ink: '#a8782a' }, // antique gold, ivory ribbon
  ],
};

/** Paints gift `index` (of the layout, in order) in `set`: six specs each, used `index % 6`. */
export function paintSetGift(c: Ctx, g: Gift, t: Tone, pass: Pass, index: number, set: 'luxe' | 'kraft'): void {
  const r = mulberry32(4099 + index * 97);
  if (set === 'luxe') luxe(c, g, t, pass, index, r);
  else kraft(c, g, t, pass, index, r);
}

/* ---------- shared geometry ---------- */

interface Geo {
  x0: number;
  x1: number;
  yT: number;
  base: number;
  sx: number;
  rise: number;
  /** The visible side face's x (toward the centre of view) and whether it is on the right. */
  sideX: number;
  right: boolean;
  bump: (p: P) => P;
}

function geo(g: Gift): Geo {
  const x0 = g.cx - g.w / 2;
  const x1 = g.cx + g.w / 2;
  const right = g.sx >= 0;
  return { x0, x1, yT: g.base - g.h, base: g.base, sx: g.sx, rise: g.rise, sideX: right ? x1 : x0, right, bump: (p) => [p[0] + g.sx, p[1] - g.rise] };
}

function poly(c: Ctx, pts: readonly P[]): void {
  c.beginPath();
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.closePath();
}

function lin(c: Ctx, a: P, b: P, stops: readonly (readonly [number, string])[]): CanvasGradient {
  const gr = c.createLinearGradient(a[0], a[1], b[0], b[1]);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  return gr;
}

/** Light falls off away from the tree across a front face; matte, so no sheen band. */
function falloff(c: Ctx, geo: Geo, y0: number, y1: number, pass: Pass): void {
  const near = geo.right ? geo.x1 : geo.x0;
  const far = geo.right ? geo.x0 : geo.x1;
  c.fillStyle = lin(c, [near, 0], [far, 0], [[0, 'rgba(0,0,0,0)'], [1, `rgba(0,0,0,${pass === 'base' ? 0.16 : 0.45})`]]);
  c.fillRect(geo.x0, y0, geo.x1 - geo.x0, y1 - y0);
}

/** Paper tooth: faint specks and fibres in the current clip. */
function grain(c: Ctx, box: readonly [number, number, number, number], r: Rng, density: number, fibre: number, dark: string, light: string): void {
  const [x0, y0, x1, y1] = box;
  const n = Math.round(((x1 - x0) * (y1 - y0) * density) / 10);
  c.lineWidth = 0.4;
  for (let k = 0; k < n; k++) {
    const x = x0 + r() * (x1 - x0);
    const y = y0 + r() * (y1 - y0);
    c.strokeStyle = r() < 0.5 ? dark : light;
    const a = r() * Math.PI;
    const l = fibre * (0.3 + r());
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    c.stroke();
  }
}

/* ---------- Luxe ---------- */

interface LuxeSpec {
  paper: string;
  ribbon: string;
  /** 'cross': ribbon both ways and a full bow; 'band': one off-centre band and a flat bow. */
  style: 'cross' | 'band';
}

const LUXE: readonly LuxeSpec[] = [
  { paper: '#4f1520', ribbon: '#c6ab72', style: 'cross' }, // oxblood, champagne satin
  { paper: '#1b3a2d', ribbon: '#d6c9ab', style: 'band' }, // spruce, ivory satin
  { paper: '#8d8273', ribbon: '#651823', style: 'cross' }, // greige, oxblood satin
  { paper: '#1a2340', ribbon: '#c6ab72', style: 'cross' }, // ink navy, champagne
  { paper: '#cbbd9f', ribbon: '#234536', style: 'band' }, // stone, spruce satin
  { paper: '#3a1b2e', ribbon: '#b0925a', style: 'cross' }, // aubergine, antique gold
];
const FOIL = '#c9a660';

function satin(c: Ctx, t: Tone, hex: string, face: Face, a: P, b: P): CanvasGradient {
  return lin(c, a, b, [
    [0, t.of(hex, face, 0.5)],
    [0.12, t.of(hex, face, 0.85)],
    [0.45, t.of(hex, face, 1.25)],
    [0.55, t.of(hex, face, 1.4)],
    [0.88, t.of(hex, face, 0.85)],
    [1, t.of(hex, face, 0.55)],
  ]);
}

function luxe(c: Ctx, g: Gift, t: Tone, pass: Pass, index: number, r: Rng): void {
  const sp = LUXE[index % LUXE.length];
  const G = geo(g);
  const { x0, x1, yT, base, sx, rise, bump } = G;
  const { w, h, lid, over, cx } = g;
  const lx0 = x0 - over;
  const lx1 = x1 + over;
  const lyT = yT - 0.02 * h;
  const lyB = yT + lid;
  const rw = Math.max(1.5, w * 0.1);
  const rx = sp.style === 'cross' ? cx : x0 + w * 0.3; // the vertical ribbon's centre on the front
  const paper = sp.paper;
  const rib = sp.ribbon;
  const grainDark = 'rgba(0,0,0,.06)';
  const grainLight = 'rgba(255,255,255,.012)';

  // Body side, front.
  if (Math.abs(sx) > 0.5) {
    const side: P[] = [[G.sideX, lyB], [G.sideX, base], bump([G.sideX, base]), bump([G.sideX, lyB])];
    poly(c, side);
    c.fillStyle = lin(c, [G.sideX, lyB], [G.sideX, base], [[0, t.of(paper, 'side', 0.95)], [1, t.of(paper, 'side', 0.55)]]);
    c.fill();
    if (sp.style === 'cross') {
      // The ribbon down the middle of the side, foreshortened like the face: its width runs along the depth.
      const f = (rw / 2) / (0.75 * w);
      const a: P = [G.sideX + sx * (0.5 - f), lyB - rise * (0.5 - f)];
      const b2: P = [G.sideX + sx * (0.5 + f), lyB - rise * (0.5 + f)];
      poly(c, [a, b2, [b2[0], b2[1] + (base - lyB)], [a[0], a[1] + (base - lyB)]]);
      c.fillStyle = satin(c, t, rib, 'side', a, b2);
      c.fill();
    }
  }
  const front: P[] = [[x0, lyB], [x1, lyB], [x1, base], [x0, base]];
  poly(c, front);
  c.fillStyle = lin(c, [0, lyB], [0, base], pass === 'base'
    ? [[0, t.of(paper, 'front', 1.0)], [0.75, t.of(paper, 'front', 0.84)], [1, t.of(paper, 'front', 0.62)]]
    : [[0, t.of(paper, 'front', 1.1)], [1, t.of(paper, 'front', 0.38)]]);
  c.fill();
  c.save();
  poly(c, front);
  c.clip();
  grain(c, [x0, lyB, x1, base], r, 1.2, 1.2, grainDark, grainLight);
  c.restore();
  falloff(c, G, lyB, base, pass);
  // Shadow under the lid's overhang.
  c.fillStyle = lin(c, [0, lyB], [0, lyB + h * 0.1], [[0, 'rgba(0,0,0,.45)'], [1, 'rgba(0,0,0,0)']]);
  c.fillRect(x0, lyB, w, h * 0.1);
  // Vertical satin ribbon down the body, with a crisp shadow line where it lifts off the paper.
  c.fillStyle = 'rgba(0,0,0,.25)';
  c.fillRect(rx + rw / 2, lyB, Math.max(0.5, w * 0.008), base - lyB);
  c.fillStyle = satin(c, t, rib, 'front', [rx - rw / 2, 0], [rx + rw / 2, 0]);
  c.fillRect(rx - rw / 2, lyB, rw, base - lyB);

  // Lid: side, front, top.
  const lSideX = G.right ? lx1 : lx0;
  if (Math.abs(sx) > 0.5) {
    poly(c, [[lSideX, lyT], [lSideX, lyB], bump([lSideX, lyB]), bump([lSideX, lyT])]);
    c.fillStyle = t.of(paper, 'side', 0.88);
    c.fill();
  }
  const lidFront: P[] = [[lx0, lyT], [lx1, lyT], [lx1, lyB], [lx0, lyB]];
  poly(c, lidFront);
  c.fillStyle = lin(c, [0, lyT], [0, lyB], [[0, t.of(paper, 'front', 1.12)], [1, t.of(paper, 'front', 0.9)]]);
  c.fill();
  c.fillStyle = satin(c, t, rib, 'front', [rx - rw / 2, 0], [rx + rw / 2, 0]);
  c.fillRect(rx - rw / 2, lyT, rw, lid);
  // A hair of gold foil along the lid's lower edge.
  c.lineWidth = Math.max(0.5, w * 0.011);
  c.strokeStyle = lin(c, [lx0, 0], [lx1, 0], [[0, t.of(FOIL, 'front', 0.7)], [G.right ? 0.8 : 0.2, t.of(FOIL, 'top', 1.25)], [1, t.of(FOIL, 'front', 0.7)]]);
  c.beginPath();
  c.moveTo(lx0, lyB - c.lineWidth * 0.8);
  c.lineTo(lx1, lyB - c.lineWidth * 0.8);
  c.stroke();
  const top: P[] = [[lx0, lyT], [lx1, lyT], bump([lx1, lyT]), bump([lx0, lyT])];
  poly(c, top);
  c.fillStyle = lin(c, [0, lyT], [0, lyT - rise], pass === 'base'
    ? [[0, t.of(paper, 'top', 1)], [1, t.of(paper, 'top', 0.86)]]
    : [[0, t.of(paper, 'top', 0.8)], [1, t.of(paper, 'top', 1.15)]]);
  c.fill();
  c.save();
  poly(c, top);
  c.clip();
  grain(c, [Math.min(lx0, lx0 + sx), lyT - rise, Math.max(lx1, lx1 + sx), lyT], r, 1.2, 1.2, grainDark, grainLight);
  c.restore();
  // Ribbons across the top.
  poly(c, [[rx - rw / 2, lyT], [rx + rw / 2, lyT], bump([rx + rw / 2, lyT]), bump([rx - rw / 2, lyT])]);
  c.fillStyle = satin(c, t, rib, 'top', [rx - rw / 2, 0], [rx + rw / 2, 0]);
  c.fill();
  const my = lyT - rise / 2;
  if (sp.style === 'cross') {
    const mx = sx / 2;
    const hw = rw * 0.32;
    poly(c, [[lx0 + mx, my - hw], [lx1 + mx, my - hw], [lx1 + mx, my + hw], [lx0 + mx, my + hw]]);
    c.fillStyle = satin(c, t, rib, 'top', [0, my - hw], [0, my + hw]);
    c.fill();
  }
  // Crisp lid edges: the top edge catches the light, a dark line under the lid.
  c.lineWidth = Math.max(0.5, w * 0.01);
  c.strokeStyle = pass === 'base' ? 'rgba(255,255,255,.12)' : t.of('#ffffff', 'top', 0.35);
  c.beginPath();
  c.moveTo(lx0, lyT);
  c.lineTo(lx1, lyT);
  c.stroke();
  c.strokeStyle = 'rgba(0,0,0,.35)';
  c.beginPath();
  c.moveTo(lx0, lyB);
  c.lineTo(lx1, lyB);
  c.stroke();

  const bx = rx + sx / 2;
  const by = lyT - rise / 2;
  const b = g.bow * (sp.style === 'cross' ? 1 : 0.78);
  satinBow(c, t, rib, bx, by, b, sp.style === 'band');
  if (index === 0) foilTag(c, t, bx, by, b, x1, lyB, h);
}

/** A tied satin bow: soft shadow on the lid, notched tails, two folded loops, a pinched knot. */
function satinBow(c: Ctx, t: Tone, rib: string, bx: number, by: number, b: number, flat: boolean): void {
  const lift = flat ? 0.62 : 1; // a flat bow sits lower
  // Shadow on the lid.
  const sg = c.createRadialGradient(bx, by + 0.12 * b, 0, bx, by + 0.12 * b, 1.05 * b);
  sg.addColorStop(0, 'rgba(0,0,0,.4)');
  sg.addColorStop(1, 'rgba(0,0,0,0)');
  c.save();
  c.translate(bx, by + 0.12 * b);
  c.scale(1, 0.4);
  c.translate(-bx, -(by + 0.12 * b));
  c.fillStyle = sg;
  c.fillRect(bx - 1.1 * b, by - 1.1 * b, 2.2 * b, 2.4 * b);
  c.restore();
  // Tails, falling forward over the lid with a swallowtail notch; the far half turned (darker) by a twist.
  for (const d of [-1, 1]) {
    const k = d < 0 ? 1 : 0.9;
    const a: P = [bx + d * 0.04 * b, by];
    const a2: P = [bx + d * 0.26 * b, by + 0.02 * b];
    const e1: P = [bx + d * 0.66 * b * k, by + 0.98 * b * k];
    const e2: P = [bx + d * 0.42 * b * k, by + 1.04 * b * k];
    const notch: P = [bx + d * 0.5 * b * k, by + 0.86 * b * k];
    poly(c, [a, a2, e1, notch, e2]);
    c.fillStyle = lin(c, [bx, by], [bx + d * 0.55 * b, by + b], [[0, t.of(rib, 'front', 1.15)], [0.55, t.of(rib, 'front', 0.95)], [1, t.of(rib, 'front', 0.55)]]);
    c.fill();
    // The twist: the inner half, turned away, in shade.
    poly(c, [a, [bx + d * 0.15 * b, by + 0.01 * b], [bx + d * 0.5 * b * k, by + 0.95 * b * k], notch, e2]);
    c.fillStyle = 'rgba(0,0,0,.22)';
    c.fill();
    // A thin sheen along the outer edge.
    c.lineWidth = Math.max(0.4, b * 0.035);
    c.strokeStyle = t.of('#ffffff', 'top', 0.28);
    c.beginPath();
    c.moveTo(a2[0], a2[1] + 0.06 * b);
    c.lineTo(e1[0] - d * 0.04 * b, e1[1] - 0.1 * b);
    c.stroke();
  }
  // Loops: an outer ribbon surface, the shaded inside showing through the opening, folds at the knot.
  for (const d of [-1, 1]) {
    const tipX = bx + d * 1.06 * b;
    const tipY = by - 0.34 * b * lift;
    c.beginPath();
    c.moveTo(bx, by - 0.04 * b);
    c.bezierCurveTo(bx + d * 0.22 * b, by - 0.9 * b * lift, tipX + d * 0.12 * b, tipY - 0.55 * b * lift, tipX, tipY + 0.08 * b);
    c.bezierCurveTo(tipX - d * 0.04 * b, by + 0.18 * b, bx + d * 0.4 * b, by + 0.2 * b, bx, by + 0.06 * b);
    c.closePath();
    c.fillStyle = lin(c, [bx, by - 0.85 * b * lift], [bx, by + 0.2 * b], [[0, t.of(rib, 'top', 1.35)], [0.5, t.of(rib, 'top', 1.0)], [1, t.of(rib, 'front', 0.6)]]);
    c.fill();
    // The opening: the loop's inner surface, in shade, lighter toward its lower lip.
    c.beginPath();
    c.moveTo(bx + d * 0.3 * b, by - 0.12 * b * lift);
    c.bezierCurveTo(bx + d * 0.44 * b, by - 0.5 * b * lift, tipX - d * 0.1 * b, tipY - 0.24 * b * lift, tipX - d * 0.2 * b, tipY + 0.04 * b);
    c.bezierCurveTo(tipX - d * 0.3 * b, by + 0.0 * b, bx + d * 0.5 * b, by + 0.02 * b, bx + d * 0.3 * b, by - 0.12 * b * lift);
    c.fillStyle = lin(c, [bx, by - 0.6 * b * lift], [bx, by + 0.05 * b], [[0, t.of(rib, 'side', 0.3)], [1, t.of(rib, 'side', 0.62)]]);
    c.fill();
    // Two folds pinched into the knot.
    c.lineWidth = Math.max(0.4, b * 0.03);
    c.strokeStyle = 'rgba(0,0,0,.28)';
    c.beginPath();
    c.moveTo(bx + d * 0.08 * b, by - 0.06 * b);
    c.quadraticCurveTo(bx + d * 0.3 * b, by - 0.28 * b * lift, bx + d * 0.5 * b, by - 0.3 * b * lift);
    c.moveTo(bx + d * 0.1 * b, by + 0.04 * b);
    c.quadraticCurveTo(bx + d * 0.3 * b, by + 0.1 * b, bx + d * 0.52 * b, by + 0.1 * b);
    c.stroke();
    // Satin sheen along the crown of the loop.
    c.beginPath();
    c.moveTo(bx + d * 0.16 * b, by - 0.3 * b * lift);
    c.bezierCurveTo(bx + d * 0.32 * b, by - 0.72 * b * lift, tipX - d * 0.1 * b, tipY - 0.42 * b * lift, tipX - d * 0.04 * b, tipY - 0.1 * b);
    c.lineWidth = Math.max(0.5, b * 0.07);
    c.lineCap = 'round';
    c.strokeStyle = t.of(rib, 'top', 1.75);
    c.globalAlpha = 0.55;
    c.stroke();
    c.globalAlpha = 1;
  }
  // Knot: a short wrapped band, pinched at top and bottom.
  const kw = 0.22 * b;
  const kh = 0.3 * b;
  c.beginPath();
  c.moveTo(bx - kw / 2, by - kh / 2);
  c.quadraticCurveTo(bx, by - kh * 0.38, bx + kw / 2, by - kh / 2);
  c.quadraticCurveTo(bx + kw * 0.62, by, bx + kw / 2, by + kh / 2);
  c.quadraticCurveTo(bx, by + kh * 0.38, bx - kw / 2, by + kh / 2);
  c.quadraticCurveTo(bx - kw * 0.62, by, bx - kw / 2, by - kh / 2);
  c.fillStyle = lin(c, [bx - kw / 2, 0], [bx + kw / 2, 0], [[0, t.of(rib, 'front', 0.7)], [0.45, t.of(rib, 'top', 1.3)], [1, t.of(rib, 'front', 0.65)]]);
  c.fill();
}

/** A small gold-foil tag on a thread from the bow, resting against the box's front. */
function foilTag(c: Ctx, t: Tone, bx: number, by: number, b: number, x1: number, lyB: number, h: number): void {
  const tx = Math.min(x1 - 0.32 * b, bx + 0.55 * b);
  const ty = lyB + h * 0.2;
  const tw = 0.42 * b;
  const th = 0.62 * b;
  c.lineWidth = Math.max(0.35, b * 0.02);
  c.strokeStyle = t.of('#d8ccb0', 'front', 0.8);
  c.beginPath();
  c.moveTo(bx + 0.1 * b, by + 0.05 * b);
  c.quadraticCurveTo(tx + 0.1 * b, ty - 0.3 * b, tx, ty - th / 2 + 0.08 * b);
  c.stroke();
  c.save();
  c.translate(tx, ty);
  c.rotate(-0.12);
  // Shadow on the box.
  c.fillStyle = 'rgba(0,0,0,.35)';
  tagPath(c, tw, th, 0.06 * b, 0.05 * b);
  c.fill();
  c.fillStyle = lin(c, [-tw / 2, -th / 2], [tw / 2, th / 2], [[0, t.of(FOIL, 'top', 1.5)], [0.35, t.of(FOIL, 'front', 0.95)], [0.65, t.of(FOIL, 'top', 1.4)], [1, t.of(FOIL, 'front', 0.75)]]);
  tagPath(c, tw, th, 0, 0);
  c.fill();
  // Debossed border and the eyelet.
  c.strokeStyle = 'rgba(0,0,0,.25)';
  c.lineWidth = Math.max(0.3, b * 0.015);
  c.strokeRect(-tw * 0.34, -th * 0.18, tw * 0.68, th * 0.6);
  c.fillStyle = 'rgba(0,0,0,.5)';
  c.beginPath();
  c.arc(0, -th / 2 + 0.09 * b, 0.035 * b, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

function tagPath(c: Ctx, w: number, h: number, dx: number, dy: number): void {
  const k = w * 0.32;
  c.beginPath();
  c.moveTo(-w / 2 + dx, -h / 2 + k + dy);
  c.lineTo(-w / 2 + k + dx, -h / 2 + dy);
  c.lineTo(w / 2 - k + dx, -h / 2 + dy);
  c.lineTo(w / 2 + dx, -h / 2 + k + dy);
  c.lineTo(w / 2 + dx, h / 2 + dy);
  c.lineTo(-w / 2 + dx, h / 2 + dy);
  c.closePath();
}

/* ---------- Kraft ---------- */

interface KraftSpec {
  paper: string;
  twine: 'natural' | 'baker' | 'dark';
  print: 'plain' | 'stripe' | 'stars';
  sprig: boolean;
}

const KRAFT: readonly KraftSpec[] = [
  { paper: '#8a6741', twine: 'natural', print: 'plain', sprig: true },
  { paper: '#7a5a39', twine: 'baker', print: 'stars', sprig: false },
  { paper: '#9b7a50', twine: 'dark', print: 'stripe', sprig: true },
  { paper: '#6f5236', twine: 'natural', print: 'plain', sprig: true },
  { paper: '#93714a', twine: 'baker', print: 'plain', sprig: false },
  { paper: '#2e2a26', twine: 'natural', print: 'stars', sprig: true }, // black kraft
];

function kraft(c: Ctx, g: Gift, t: Tone, pass: Pass, index: number, r: Rng): void {
  const sp = KRAFT[index % KRAFT.length];
  const G = geo(g);
  const { x0, x1, yT, base, sx, rise, bump } = G;
  const { w, h, cx } = g;
  const paper = sp.paper;
  const dark = 'rgba(40,24,10,.09)';
  const light = 'rgba(255,236,200,.035)';
  const fib = Math.max(0.8, w * 0.014);

  // Side face: the folded end, two flaps meeting across the middle.
  if (Math.abs(sx) > 0.5) {
    const sX = G.sideX;
    const side: P[] = [[sX, yT], [sX, base], bump([sX, base]), bump([sX, yT])];
    poly(c, side);
    c.fillStyle = lin(c, [sX, yT], [sX, base], [[0, t.of(paper, 'side', 0.95)], [1, t.of(paper, 'side', 0.6)]]);
    c.fill();
    c.save();
    poly(c, side);
    c.clip();
    grain(c, [Math.min(sX, sX + sx), yT - rise, Math.max(sX, sX + sx), base], r, 2.2, fib, dark, light);
    printInk(c, sp, t, 'side', [Math.min(sX, sX + sx), yT - rise, Math.max(sX, sX + sx), base], w);
    // The folded end: a top flap down to just past half height over the bottom one, inset from both edges.
    const at = (f: number, d: number): P => [sX + sx * d, yT + h * f - rise * d];
    c.lineWidth = Math.max(0.45, w * 0.008);
    c.strokeStyle = 'rgba(30,16,6,.4)';
    c.beginPath();
    c.moveTo(...at(0, 0));
    c.lineTo(...at(0.56, 0.3));
    c.lineTo(...at(0.56, 0.7));
    c.lineTo(...at(0, 1));
    c.stroke();
    c.strokeStyle = 'rgba(30,16,6,.22)';
    c.beginPath();
    c.moveTo(...at(1, 0));
    c.lineTo(...at(0.62, 0.32));
    c.moveTo(...at(1, 1));
    c.lineTo(...at(0.62, 0.68));
    c.stroke();
    // The flap's lower edge casts a hairline shadow.
    c.strokeStyle = 'rgba(20,10,4,.25)';
    c.lineWidth = Math.max(0.6, w * 0.014);
    c.beginPath();
    c.moveTo(at(0.56, 0.3)[0], at(0.56, 0.3)[1] + 1);
    c.lineTo(at(0.56, 0.7)[0], at(0.56, 0.7)[1] + 1);
    c.stroke();
    c.restore();
  }
  const front: P[] = [[x0, yT], [x1, yT], [x1, base], [x0, base]];
  poly(c, front);
  c.fillStyle = lin(c, [0, yT], [0, base], pass === 'base'
    ? [[0, t.of(paper, 'front', 1.02)], [0.75, t.of(paper, 'front', 0.86)], [1, t.of(paper, 'front', 0.62)]]
    : [[0, t.of(paper, 'front', 1.1)], [1, t.of(paper, 'front', 0.38)]]);
  c.fill();
  c.save();
  poly(c, front);
  c.clip();
  grain(c, [x0, yT, x1, base], r, 2.2, fib, dark, light);
  printInk(c, sp, t, 'front', [x0, yT, x1, base], w);
  c.restore();
  falloff(c, G, yT, base, pass);
  const top: P[] = [[x0, yT], [x1, yT], bump([x1, yT]), bump([x0, yT])];
  poly(c, top);
  c.fillStyle = lin(c, [0, yT], [0, yT - rise], pass === 'base'
    ? [[0, t.of(paper, 'top', 1)], [1, t.of(paper, 'top', 0.86)]]
    : [[0, t.of(paper, 'top', 0.8)], [1, t.of(paper, 'top', 1.15)]]);
  c.fill();
  c.save();
  poly(c, top);
  c.clip();
  const topBox: [number, number, number, number] = [Math.min(x0, x0 + sx), yT - rise, Math.max(x1, x1 + sx), yT];
  grain(c, topBox, r, 2.2, fib, dark, light);
  printInk(c, sp, t, 'top', topBox, w);
  // The wrap's overlap seam across the top, with its little shadow.
  const sf = 0.62;
  c.strokeStyle = 'rgba(30,16,6,.35)';
  c.lineWidth = Math.max(0.5, w * 0.012);
  c.beginPath();
  c.moveTo(x0 + sx * sf, yT - rise * sf);
  c.lineTo(x1 + sx * sf, yT - rise * sf);
  c.stroke();
  c.strokeStyle = 'rgba(255,240,210,.1)';
  c.beginPath();
  c.moveTo(x0 + sx * sf, yT - rise * sf - 0.8);
  c.lineTo(x1 + sx * sf, yT - rise * sf - 0.8);
  c.stroke();
  c.restore();
  // The box's top edge catches the light.
  c.lineWidth = Math.max(0.5, w * 0.01);
  c.strokeStyle = pass === 'base' ? 'rgba(255,255,255,.1)' : t.of('#ffffff', 'top', 0.25);
  c.beginPath();
  c.moveTo(x0, yT);
  c.lineTo(x1, yT);
  c.stroke();

  // Twine: twice round each way.
  const tw = Math.max(0.7, w * 0.014);
  const strings: P[][] = [];
  for (const o of [0]) {
    strings.push([[cx + o, base], [cx + o, yT]]);
    strings.push([[cx + o, yT], bump([cx + o, yT])]);
    const my = yT - rise / 2 + o * 0.6;
    strings.push([[x0 + sx / 2, my], [x1 + sx / 2, my]]);
    if (Math.abs(sx) > 0.5) {
      const sX = G.sideX;
      strings.push([[sX + sx / 2, yT - rise / 2 + o * 0.6], [sX + sx / 2, base - rise / 2]]);
    }
  }
  for (const s of strings) twine(c, t, sp.twine, s[0], s[1], tw);
  const bx = cx + sx / 2;
  const by = yT - rise / 2;
  if (sp.sprig) sprig(c, t, bx, by, g.bow, index % 2 ? 1 : -1, r);
  twineBow(c, t, sp.twine, bx, by, g.bow * 0.62, tw);
}

const TWINE = { natural: '#c8b48c', baker: '#e6dccb', dark: '#3a3028' } as const;

function twine(c: Ctx, t: Tone, kind: KraftSpec['twine'], a: P, b: P, w: number): void {
  c.lineCap = 'round';
  // A shadow on the paper, the strand, then its twist.
  c.strokeStyle = 'rgba(20,10,4,.35)';
  c.lineWidth = w * 1.4;
  c.beginPath();
  c.moveTo(a[0] + w * 0.5, a[1] + w * 0.6);
  c.lineTo(b[0] + w * 0.5, b[1] + w * 0.6);
  c.stroke();
  c.strokeStyle = t.of(TWINE[kind], 'front', 1.05);
  c.lineWidth = w;
  c.beginPath();
  c.moveTo(a[0], a[1]);
  c.lineTo(b[0], b[1]);
  c.stroke();
  c.setLineDash(kind === 'baker' ? [w * 1.3, w * 1.1] : [w * 0.5, w * 1.2]);
  c.strokeStyle = kind === 'baker' ? t.of('#8e1a26', 'front', 1.05) : kind === 'dark' ? t.of('#6a5a48', 'front', 1) : t.of('#8a7550', 'front', 0.95);
  c.globalAlpha = kind === 'baker' ? 0.9 : 0.5;
  c.lineWidth = w * (kind === 'baker' ? 1 : 0.55);
  c.beginPath();
  c.moveTo(a[0], a[1]);
  c.lineTo(b[0], b[1]);
  c.stroke();
  c.setLineDash([]);
  c.globalAlpha = 1;
}

/** A small twine bow: two loops, the knot, two loose ends. */
function twineBow(c: Ctx, t: Tone, kind: KraftSpec['twine'], bx: number, by: number, b: number, w: number): void {
  const col = t.of(TWINE[kind], 'top', 1.1);
  const accent = kind === 'baker' ? t.of('#8e1a26', 'top', 1.1) : null;
  c.lineCap = 'round';
  for (const pass of [0, 1, 2]) {
    c.strokeStyle = pass === 0 ? 'rgba(20,10,4,.4)' : pass === 1 ? col : (accent ?? 'rgba(0,0,0,0)');
    c.lineWidth = pass === 0 ? w * 1.5 : w;
    if (pass === 2) c.setLineDash([w * 1.3, w * 1.1]);
    const o = pass === 0 ? w * 0.6 : 0;
    c.beginPath();
    for (const d of [-1, 1]) {
      // Loop.
      c.moveTo(bx + o, by + o);
      c.bezierCurveTo(bx + d * 0.3 * b + o, by - 0.9 * b + o, bx + d * 1.1 * b + o, by - 0.6 * b + o, bx + d * 0.2 * b + o, by + o);
      // Loose end with a curl.
      c.moveTo(bx + o, by + o);
      c.bezierCurveTo(bx + d * 0.35 * b + o, by + 0.4 * b + o, bx + d * 0.7 * b + o, by + 0.5 * b + o, bx + d * 0.9 * b + o, by + 0.95 * b + o);
    }
    c.stroke();
    c.setLineDash([]);
  }
  c.fillStyle = col;
  c.beginPath();
  c.arc(bx, by, w * 1.3, 0, Math.PI * 2);
  c.fill();
}

/** A fir sprig with two or three berries, tucked under the twine and leaning to `side`. */
function sprig(c: Ctx, t: Tone, bx: number, by: number, b: number, side: number, r: Rng): void {
  const len = 1.25 * b;
  const ang = -Math.PI / 2 + side * 1.15;
  const ex = bx + Math.cos(ang) * len;
  const ey = by + Math.sin(ang) * len * 0.75;
  // Shadow on the paper.
  c.strokeStyle = 'rgba(10,6,2,.35)';
  c.lineWidth = b * 0.22;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(bx + 1, by + 2);
  c.lineTo(ex + 1, ey + 2);
  c.stroke();
  // Stem.
  c.strokeStyle = t.of('#4a3a24', 'top', 1);
  c.lineWidth = Math.max(0.5, b * 0.035);
  c.beginPath();
  c.moveTo(bx, by);
  c.quadraticCurveTo((bx + ex) / 2 + side * b * 0.08, (by + ey) / 2 - b * 0.06, ex, ey);
  c.stroke();
  // Needles: short, paired, darker toward the stem.
  const needles = 22;
  c.lineWidth = Math.max(0.45, b * 0.028);
  for (let k = 1; k <= needles; k++) {
    const f = k / needles;
    const px = bx + (ex - bx) * f;
    const py = by + (ey - by) * f;
    const nl = b * (0.24 - 0.1 * f) * (0.8 + 0.4 * r());
    for (const s of [-1, 1]) {
      const a = ang + s * (0.95 + 0.3 * r());
      c.strokeStyle = t.of(r() < 0.5 ? '#2c4a30' : '#3c6040', 'top', 0.8 + 0.5 * r());
      c.beginPath();
      c.moveTo(px, py);
      c.lineTo(px + Math.cos(a) * nl, py + Math.sin(a) * nl * 0.8);
      c.stroke();
    }
  }
  // Berries at the base of the sprig.
  for (const [dx, dy, k] of [[0.3, -0.12, 1], [0.46, -0.02, 0.9], [0.34, 0.1, 0.8]] as const) {
    const x = bx + side * dx * b;
    const y = by + dy * b;
    const rr = b * 0.1 * k;
    const gr = c.createRadialGradient(x - rr * 0.35, y - rr * 0.4, rr * 0.1, x, y, rr);
    gr.addColorStop(0, t.of('#c8303a', 'top', 1.2));
    gr.addColorStop(0.6, t.of('#8a1620', 'front', 1));
    gr.addColorStop(1, t.of('#4a0a10', 'front', 0.8));
    c.fillStyle = gr;
    c.beginPath();
    c.arc(x, y, rr, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = t.of('#ffffff', 'top', 0.6);
    c.beginPath();
    c.arc(x - rr * 0.35, y - rr * 0.4, rr * 0.22, 0, Math.PI * 2);
    c.fill();
  }
}

/** White-ink print on kraft: thin stripes or small stars, in the current clip. */
function printInk(c: Ctx, sp: KraftSpec, t: Tone, face: Face, box: readonly [number, number, number, number], w: number): void {
  if (sp.print === 'plain') return;
  const [x0, y0, x1, y1] = box;
  c.save();
  c.globalAlpha = 0.5;
  c.strokeStyle = t.of('#efe6d4', face, 0.9);
  c.fillStyle = c.strokeStyle;
  if (sp.print === 'stripe') {
    const step = Math.max(3, w * 0.09);
    c.lineWidth = Math.max(0.4, w * 0.008);
    c.beginPath();
    for (let x = x0 + step / 2; x < x1; x += step) {
      c.moveTo(x, y0);
      c.lineTo(x, y1);
    }
    c.stroke();
  } else {
    const step = Math.max(6, w * 0.17);
    const rr = Math.max(0.8, w * 0.022);
    let row = 0;
    for (let y = y0 + step * 0.35; y < y1; y += step * 0.75, row++) {
      for (let x = x0 + (row % 2 ? step / 2 : 0); x < x1 + step; x += step) star(c, x, y, rr);
    }
  }
  c.restore();
}

function star(c: Ctx, x: number, y: number, r: number): void {
  c.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / 5;
    const rr = k % 2 ? r * 0.42 : r;
    if (k) c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    else c.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
  c.fill();
}
