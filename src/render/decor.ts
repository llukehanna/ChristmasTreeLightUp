import { mulberry32, type Rng } from '../core/rng';
import type { Decor } from '../store/look';
import { blurredLayer } from './blur';
import { hexRgb } from './color';
import { envelope, X, Y, type Layout } from './layout';
import { canvas, clamp01, css, mixRgb, smooth, TAU } from './paint-util';
import type { Rgb, Scene } from './scenes';

/**
 * The static decorations on the tree layer (ported from the visual lab, 2026-11): fine antique-gold tinsel and
 * mercury-glass beads draped in catenary swags that wrap round behind the boughs at the tree's edges, three glossy candy
 * canes hooked outside the tiles, and a quilted velvet skirt with a faux-fur trim. All painted once per repaint, in the
 * scene's key light plus a share of the tree's own warm light; the renderer draws the tree layer before every wire,
 * glass and bulb, so none of this can cover one. Ornaments (the lab's advent baubles) are not ported.
 */

type Ctx = CanvasRenderingContext2D;

/** How the decorations are lit: the scene's key light direction (unit-ish), ambient level and tint, and a specular. */
interface Lit {
  amb: number;
  tint: Rgb;
  kx: number;
  ky: number;
  spec: number;
  specCol: Rgb;
}

/** The scene's own light on small objects: dark at night, true colour by day. */
function ambientLit(sc: Scene): Lit {
  switch (sc.light) {
    case 'day':
      return { amb: 0.86, tint: [0.97, 1, 1.04], kx: -0.55, ky: -0.65, spec: 0.85, specCol: [255, 255, 255] };
    case 'fire':
      return { amb: 0.3, tint: [1.2, 0.86, 0.62], kx: -0.85, ky: -0.35, spec: 0.55, specCol: [255, 170, 100] };
    case 'aurora':
      return { amb: 0.28, tint: [0.7, 0.95, 1.1], kx: 0.2, ky: -0.9, spec: 0.5, specCol: [150, 255, 220] };
    default:
      return { amb: 0.26, tint: [0.78, 0.88, 1.12], kx: 0.6, ky: -0.6, spec: 0.5, specCol: [190, 210, 255] };
  }
}

/** The scene's key light plus a share of the tree's warm glow as fill, since they hang among the bulbs. Daylight is left as it is. */
function decorLit(sc: Scene): Lit {
  const a = ambientLit(sc);
  if (sc.light === 'day') return a;
  const warm: Rgb = [1.12, 0.95, 0.76];
  return { ...a, amb: a.amb * 1.65, tint: mixRgb(a.tint, warm, 0.5), specCol: mixRgb(a.specCol, [255, 236, 200], 0.45) };
}

/** An albedo under a light. */
const lit = (L: Lit, c: Rgb, k = 1): Rgb => [c[0] * L.amb * L.tint[0] * k, c[1] * L.amb * L.tint[1] * k, c[2] * L.amb * L.tint[2] * k];

/* ---------- drape geometry ---------- */

interface Pt {
  x: number;
  y: number;
  /** Unit tangent and the normal below it (screen px). */
  tx: number;
  ty: number;
  nx: number;
  ny: number;
  /** 1 in front of the boughs, fading to 0 where the swag wraps round behind the tree's edge. */
  vis: number;
}

/** A catenary's sag profile: 0 at both ends, 1 in the middle, with a flatter bottom than a parabola. */
const CAT_K = 1.5;
const catenary = (t: number): number => (Math.cosh(CAT_K) - Math.cosh(CAT_K * (2 * t - 1))) / (Math.cosh(CAT_K) - 1);

/**
 * Points every `step` px along a garland hung from `anchors` (tile units): one catenary swag between each pair, sagging
 * `sag` × the span. Visibility fades near the tree's silhouette, where the garland goes round the back.
 */
function drape(L: Layout, anchors: readonly (readonly [number, number])[], sag: number, step: number): Pt[] {
  const fine: [number, number, number][] = [];
  for (let i = 0; i < anchors.length - 1; i++) {
    const [u0, v0] = anchors[i];
    const [u1, v1] = anchors[i + 1];
    const span = Math.abs(u1 - u0);
    const n = Math.max(8, Math.ceil(span * 40));
    for (let k = i ? 1 : 0; k <= n; k++) {
      const t = k / n;
      const u = u0 + (u1 - u0) * t;
      const v = v0 + (v1 - v0) * t + sag * span * catenary(t);
      fine.push([X(L, u), Y(L, v), Math.abs(u) / envelope(v)]);
    }
  }
  // Round the gathers at the hooks: a short moving average (about a tenth of a tile).
  const win = Math.max(1, Math.round(L.s * 0.14 / Math.max(1e-3, Math.hypot(fine[1][0] - fine[0][0], fine[1][1] - fine[0][1]))));
  const soft = fine.map((p, i) => {
    let x = 0;
    let y = 0;
    let w = 0;
    for (let j = Math.max(0, i - win); j <= Math.min(fine.length - 1, i + win); j++) {
      const k = 1 - Math.abs(j - i) / (win + 1);
      x += fine[j][0] * k;
      y += fine[j][1] * k;
      w += k;
    }
    return [x / w, y / w, p[2]] as [number, number, number];
  });
  fine.splice(0, fine.length, ...soft);
  // Resample by arc length.
  const out: Pt[] = [];
  let carry = 0;
  for (let i = 1; i < fine.length; i++) {
    const [x0, y0, e0] = fine[i - 1];
    const [x1, y1, e1] = fine[i];
    const d = Math.hypot(x1 - x0, y1 - y0);
    if (d < 1e-6) continue;
    const tx = (x1 - x0) / d;
    const ty = (y1 - y0) / d;
    let a = carry;
    while (a < d) {
      const f = a / d;
      const e = e0 + (e1 - e0) * f;
      // The normal that points down the screen.
      const flip = tx < 0 ? -1 : 1;
      out.push({ x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, tx, ty, nx: -ty * flip, ny: tx * flip, vis: 1 - smooth(clamp01((e - 0.74) / 0.2)) });
      a += step;
    }
    carry = a - d;
  }
  return out;
}

/** One tier of scallops round the tree at height `v`: `n` swags between hooks; the front sits lower than the sides. */
function tier(v: number, n: number, reach: number, offset = 0): [number, number][] {
  const e = envelope(v) * reach;
  const pts: [number, number][] = [];
  for (let k = 0; k <= n; k++) {
    const u = -e + (2 * e * k) / n + offset;
    const q = u / e;
    pts.push([u, v - 0.32 * q * q]);
  }
  return pts;
}

/** Shadow of a garland on the needles: the path, thick and blurred, pushed away from the key light. */
function garlandShadow(c: Ctx, L: Layout, pts: readonly Pt[], width: number, lt: Lit, dist: number, alpha: number): void {
  blurredLayer(c, L.dpr, width * 0.6, (o) => {
    o.lineCap = 'round';
    o.lineJoin = 'round';
    o.lineWidth = width;
    const dx = -lt.kx * dist;
    const dy = Math.abs(lt.ky) * dist + dist * 0.6;
    // Split into runs by visibility so the shadow fades with the garland.
    for (const band of [0.3, 0.65, 1]) {
      o.strokeStyle = `rgba(4,8,6,${(alpha * band).toFixed(3)})`;
      o.beginPath();
      let on = false;
      for (const p of pts) {
        const keep = p.vis > band - 0.35 && p.vis <= band + 0.001;
        if (keep && !on) o.moveTo(p.x + dx, p.y + dy);
        else if (keep) o.lineTo(p.x + dx, p.y + dy);
        on = keep;
      }
      o.stroke();
    }
  });
}

/* ---------- tinsel garland: fine antique-gold metallic strands ---------- */

const TINSEL_TIERS: readonly (readonly [number, number, number])[] = [
  [2.7, 2, 0.17],
  [5.15, 3, 0.16],
  [7.65, 4, 0.15],
];

function paintTinsel(c: Ctx, L: Layout, sc: Scene, r: Rng): void {
  const s = L.s;
  const lt = decorLit(sc);
  const gold: Rgb = [214, 182, 122]; // champagne gold
  const R = 0.08 * s; // strand reach from the cord: the swag is ~0.12 tiles across
  const lw = Math.max(0.38, s * 0.0072);
  // Key light direction in screen space (unit).
  const kl = Math.hypot(lt.kx, lt.ky) || 1;
  const kx = lt.kx / kl;
  const ky = lt.ky / kl;
  const BR = 7; // brightness buckets
  const FADE = 3; // visibility buckets
  const paths = Array.from({ length: BR * FADE }, () => new Path2D());
  const back = Array.from({ length: FADE }, () => new Path2D());
  const glints: [number, number, number][] = [];
  const all: Pt[][] = [];
  for (const [v, n, sag] of TINSEL_TIERS) {
    const pts = drape(L, tier(v, n, 0.9), sag, 0.3);
    all.push(pts);
    for (const p of pts) {
      if (p.vis <= 0.02) continue;
      const fb = Math.min(FADE - 1, Math.floor(p.vis * FADE));
      for (let q = 0; q < 3; q++) {
        const th = r() * TAU; // angle round the cord: cos → across the screen, sin → toward the viewer
        const across = Math.cos(th);
        const toward = Math.sin(th);
        const len = R * (0.55 + 0.45 * r());
        const tilt = (r() - 0.5) * 0.9;
        const ox = p.x + p.nx * (r() - 0.5) * R * 0.2;
        const oy = p.y + p.ny * (r() - 0.5) * R * 0.2;
        const dx = p.nx * across + p.tx * tilt;
        const dy = p.ny * across + p.ty * tilt;
        const ex = ox + dx * len;
        const ey = oy + dy * len + len * 0.28; // a little droop
        if (toward < -0.35) {
          back[fb].moveTo(ox, oy);
          back[fb].lineTo(ex, ey);
          continue;
        }
        // A metal facet: bright when it faces the key light (strands pointing up toward it) or the viewer.
        const facing = Math.max(0, -(dx * kx + dy * ky) * 0.5 + 0.5) * 0.55 + Math.max(0, toward) * 0.45;
        const b = clamp01(facing * (0.2 + 1.1 * Math.pow(r(), 1.4)));
        let bi = Math.min(BR - 2, Math.floor(b * (BR - 1)));
        if (r() < 0.06 * p.vis && facing > 0.4) {
          bi = BR - 1;
          if (r() < 0.12) glints.push([ex * 0.4 + ox * 0.6, ey * 0.4 + oy * 0.6, 0.5 + 0.5 * r()]);
        }
        const path = paths[bi * FADE + fb];
        path.moveTo(ox, oy);
        path.quadraticCurveTo(ox + dx * len * 0.55, oy + dy * len * 0.55, ex, ey);
      }
    }
  }
  c.save();
  for (const pts of all) garlandShadow(c, L, pts, R * 1.2, lt, R * 0.55, 0.42);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.lineWidth = lw;
  const dark = lit(lt, gold, 0.12);
  const mid = lit(lt, gold, 1.25);
  const hi = mixRgb(lit(lt, gold, 2.5), lt.specCol, 0.4);
  for (let f = 0; f < FADE; f++) {
    c.strokeStyle = css(dark, 0.75 * ((f + 1) / FADE));
    c.stroke(back[f]);
  }
  // The dense heart of the swag: a dark, slightly warm core the strands come out of.
  for (const pts of all) {
    c.lineWidth = R * 0.42;
    for (let i = 1; i < pts.length; i += 1) {
      const p = pts[i - 1];
      const q = pts[i];
      if (p.vis < 0.02) continue;
      c.strokeStyle = css(lit(lt, gold, 0.2), 0.35 * p.vis);
      c.beginPath();
      c.moveTo(p.x, p.y);
      c.lineTo(q.x, q.y);
      c.stroke();
    }
  }
  c.lineWidth = lw;
  for (let b = 0; b < BR; b++) {
    const k = b / (BR - 1);
    const col = k < 0.6 ? mixRgb(dark, mid, k / 0.6) : mixRgb(mid, hi, (k - 0.6) / 0.4);
    for (let f = 0; f < FADE; f++) {
      c.strokeStyle = css(col, (0.55 + 0.4 * k) * ((f + 1) / FADE));
      c.stroke(paths[b * FADE + f]);
    }
  }
  // Glints: a pin-point and a hair-thin four-point flare, in the key light's colour.
  for (const [x, y, k] of glints) {
    const g = c.createRadialGradient(x, y, 0, x, y, R * 0.7);
    g.addColorStop(0, css(lt.specCol, 0.75 * lt.spec * k));
    g.addColorStop(0.25, css(lt.specCol, 0.18 * lt.spec * k));
    g.addColorStop(1, css(lt.specCol, 0));
    c.fillStyle = g;
    c.fillRect(x - R, y - R, 2 * R, 2 * R);
    c.strokeStyle = css(lt.specCol, 0.45 * lt.spec * k);
    c.lineWidth = Math.max(0.35, lw * 0.7);
    const f = R * (0.7 + 0.5 * k);
    c.beginPath();
    c.moveTo(x - f, y);
    c.lineTo(x + f, y);
    c.moveTo(x, y - f * 0.75);
    c.lineTo(x, y + f * 0.75);
    c.stroke();
  }
  c.restore();
}

/* ---------- bead garland: mercury glass ---------- */

/** Antique-gold and champagne mercury glass, with a garnet accent. */
const BEAD_GOLD: Rgb = [186, 146, 84];
const BEAD_CHAMP: Rgb = [170, 160, 140];
const BEAD_GARNET: Rgb = [112, 20, 34];

const BEAD_TIERS: readonly (readonly [number, number, number, number])[] = [
  [3.85, 2, 0.2, 0],
  [6.35, 3, 0.18, 0],
];

function bead(c: Ctx, x: number, y: number, rad: number, col: Rgb, glass: boolean, lt: Lit, vis: number, warmBulb: Rgb | null): void {
  const kl = Math.hypot(lt.kx, lt.ky) || 1;
  const kx = lt.kx / kl;
  const ky = lt.ky / kl;
  c.globalAlpha = vis;
  // Contact shadow on the needles below, away from the key light.
  const sx = x - kx * rad * 0.55;
  const sy = y + rad * 0.75;
  const sh = c.createRadialGradient(sx, sy, 0, sx, sy, rad * 1.5);
  sh.addColorStop(0, 'rgba(0,4,2,.5)');
  sh.addColorStop(1, 'rgba(0,4,2,0)');
  c.fillStyle = sh;
  c.fillRect(sx - rad * 1.5, sy - rad * 1.5, rad * 3, rad * 3);
  // Body: mirror-like, so it shows its surroundings: the dark night above, its own colour, the tree's warmth below.
  const g = c.createLinearGradient(x, y - rad, x, y + rad);
  if (glass) {
    g.addColorStop(0, css(lit(lt, col, 0.55)));
    g.addColorStop(0.5, css(lit(lt, col, 0.8)));
    g.addColorStop(0.85, css(lit(lt, col, 1.35)));
    g.addColorStop(1, css(lit(lt, col, 0.9)));
  } else {
    g.addColorStop(0, css(lit(lt, col, 0.95)));
    g.addColorStop(0.38, css(lit(lt, col, 0.42)));
    g.addColorStop(0.62, css(lit(lt, col, 0.62)));
    g.addColorStop(0.9, css(lit(lt, col, 1.45)));
    g.addColorStop(1, css(lit(lt, col, 0.8)));
  }
  c.fillStyle = g;
  c.beginPath();
  c.arc(x, y, rad, 0, TAU);
  c.fill();
  // Darkened rim (silvering seen edge-on), heavier on the side away from the light.
  const rim = c.createRadialGradient(x + kx * rad * 0.25, y + ky * rad * 0.25, rad * 0.45, x, y, rad);
  rim.addColorStop(0, 'rgba(0,0,0,0)');
  rim.addColorStop(1, `rgba(6,4,2,${glass ? 0.45 : 0.6})`);
  c.fillStyle = rim;
  c.fill();
  // A coloured bulb caught in the lower curve.
  if (warmBulb) {
    c.fillStyle = css(warmBulb, 0.28);
    c.beginPath();
    c.ellipse(x - kx * rad * 0.4, y + rad * 0.5, rad * 0.32, rad * 0.16, 0, 0, TAU);
    c.fill();
  }
  // Key specular: a crisp window highlight and its soft bloom.
  const hx = x + kx * rad * 0.42;
  const hy = y + ky * rad * 0.42;
  const hl = c.createRadialGradient(hx, hy, 0, hx, hy, rad * 0.6);
  hl.addColorStop(0, css(lt.specCol, 0.5 * lt.spec));
  hl.addColorStop(1, css(lt.specCol, 0));
  c.fillStyle = hl;
  c.fillRect(hx - rad, hy - rad, rad * 2, rad * 2);
  c.fillStyle = css(mixRgb(lt.specCol, [255, 255, 255], 0.4), Math.min(1, 1.25 * lt.spec));
  c.beginPath();
  c.ellipse(hx, hy, rad * 0.24, rad * 0.15, Math.atan2(ky, kx) + Math.PI / 2, 0, TAU);
  c.fill();
  c.globalAlpha = 1;
}

/** Rhythm: a large gold bead, two small champagne; a garnet takes the large bead's place every fourth repeat. [size, kind] */
const BEAD_RHYTHM: readonly (readonly [number, number])[] = [[1, 0], [0.62, 1], [0.62, 1], [1, 0], [0.62, 1], [0.62, 1], [1, 0], [0.62, 1], [0.62, 1], [1.05, 2]];

function paintBeads(c: Ctx, L: Layout, sc: Scene): void {
  const s = L.s;
  const lt = decorLit(sc);
  const big = 0.054 * s;
  const bulbs = sc.bulbs.map((h) => mixRgb(hexRgb(h), [0, 0, 0], 0.25));
  const r = mulberry32(31);
  c.save();
  for (const [v, n, sag, off] of BEAD_TIERS) {
    const pts = drape(L, tier(v, n, 0.88, off), sag, 0.25);
    garlandShadow(c, L, pts, big * 0.8, lt, big * 0.5, 0.25);
    // The thread.
    c.lineWidth = Math.max(0.4, s * 0.006);
    c.strokeStyle = css(lit(lt, [150, 128, 90], 0.6), 0.6);
    c.beginPath();
    let on = false;
    for (const p of pts) {
      if (p.vis > 0.05 && !on) c.moveTo(p.x, p.y);
      else if (p.vis > 0.05) c.lineTo(p.x, p.y);
      on = p.vis > 0.05;
    }
    c.stroke();
    // Beads by arc length: each sits radius + gap + next radius along.
    let i = 0;
    let need = 0;
    let acc = 0;
    let prevR = 0;
    for (let k = 1; k < pts.length; k++) {
      acc += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
      if (acc < need) continue;
      const [kr, kind] = BEAD_RHYTHM[i % BEAD_RHYTHM.length];
      const rad = big * kr;
      if (prevR && acc < prevR + rad + big * 0.22) continue;
      const p = pts[k];
      i++;
      acc = 0;
      need = rad + big * 0.22;
      prevR = rad;
      if (p.vis < 0.05) continue;
      const col = kind === 2 ? BEAD_GARNET : kind === 1 ? BEAD_CHAMP : BEAD_GOLD;
      const reflect = kind !== 2 && r() < 0.35 ? bulbs[Math.floor(r() * bulbs.length)] : null;
      bead(c, p.x, p.y, rad, col, kind === 2, lt, p.vis, reflect);
    }
  }
  c.restore();
}

/* ---------- candy canes: glossy, with a true helical stripe ---------- */

/**
 * A cane hooked over a branch at (x, y), the crook curling toward the tree (`side`: the tree is to the left, -1, or
 * right, +1). Shaded per facet as a lit cylinder with a helical red stripe and a red pinstripe.
 */
function cane(c: Ctx, L: Layout, x: number, y: number, side: number, lt: Lit): void {
  const s = L.s;
  const W = 0.07 * s; // diameter
  const Rk = 0.095 * s; // crook radius
  const len = 0.46 * s;
  const pitch = W * 2.1;
  // Centreline from the shank's foot up and over the crook: [x, y, arc length].
  const line: [number, number][] = [];
  for (let k = 0; k <= 40; k++) line.push([x, y + len * (1 - k / 40)]);
  const cx = x + side * Rk;
  for (let k = 1; k <= 48; k++) {
    // From the shank's top, over the crook's crown, and a little way down the far side.
    const a = side > 0 ? Math.PI + (k / 48) * Math.PI * 1.12 : -(k / 48) * Math.PI * 1.12;
    line.push([cx + Math.cos(a) * Rk, y + Math.sin(a) * Rk]);
  }
  // Key light in 3D (screen x right, y down, z toward the viewer).
  const L3 = [lt.kx, lt.ky, 0.75];
  const ll = Math.hypot(L3[0], L3[1], L3[2]);
  const lx = L3[0] / ll;
  const ly = L3[1] / ll;
  const lz = L3[2] / ll;
  const ivory: Rgb = [222, 212, 196];
  const red: Rgb = [150, 18, 30];
  const STRIPS = 9;
  // Contact shadow on the needles: the silhouette, blurred and pushed away from the light.
  blurredLayer(c, L.dpr, W * 0.55, (o) => {
    o.strokeStyle = 'rgba(0,6,3,.55)';
    o.lineWidth = W * 1.05;
    o.lineCap = 'round';
    o.lineJoin = 'round';
    o.beginPath();
    line.forEach(([px, py], i) => (i ? o.lineTo(px - lt.kx * W * 0.7, py + W * 0.75) : o.moveTo(px - lt.kx * W * 0.7, py + W * 0.75)));
    o.stroke();
  });
  c.save();
  c.lineJoin = 'round';
  c.lineWidth = 0.35;
  let arc = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const [x0, y0] = line[i];
    const [x1, y1] = line[i + 1];
    const d = Math.hypot(x1 - x0, y1 - y0);
    const tx = (x1 - x0) / d;
    const ty = (y1 - y0) / d;
    const nx = -ty;
    const ny = tx;
    // Normals at both ends (smooth joins): average with the neighbouring segments.
    const n0 = segNormal(line, i);
    const n1 = segNormal(line, i + 1);
    for (let j = 0; j < STRIPS; j++) {
      const a0 = (j / STRIPS) * 2 - 1;
      const a1 = ((j + 1) / STRIPS) * 2 - 1;
      const am = (a0 + a1) / 2;
      const phi = Math.asin(am); // angle round the cylinder, 0 facing the viewer
      // Surface normal: across-screen component along the stroke normal, the rest toward the viewer.
      const sxn = nx * Math.sin(phi);
      const syn = ny * Math.sin(phi);
      const szn = Math.cos(phi);
      const diff = Math.max(0, sxn * lx + syn * ly + szn * lz);
      // Blinn half-vector with the view (0,0,1).
      const hx = lx;
      const hy = ly;
      const hz = lz + 1;
      const hl = Math.hypot(hx, hy, hz);
      const spec = Math.pow(Math.max(0, (sxn * hx + syn * hy + szn * hz) / hl), 40);
      // Helical stripe: the boundary advances along the cane as it goes round.
      const ph = (arc + d / 2 + phi * (W / 2) * 1.7) / pitch;
      const f = ph - Math.floor(ph);
      const aa = 0.7 / pitch;
      const wide = clamp01((0.19 - Math.abs(f - 0.25)) / aa + 0.5);
      const pin = clamp01((0.035 - Math.abs(f - 0.71)) / aa + 0.5);
      const k = Math.max(wide, pin * 0.9);
      const albedo = mixRgb(ivory, red, clamp01(k));
      const shade = 0.26 + 1.1 * diff;
      const base = lit(lt, albedo, shade);
      const col = mixRgb(base, lt.specCol, clamp01(spec * lt.spec * 2));
      c.fillStyle = css(col);
      c.strokeStyle = c.fillStyle;
      c.beginPath();
      c.moveTo(x0 + n0[0] * a0 * W * 0.5, y0 + n0[1] * a0 * W * 0.5);
      c.lineTo(x0 + n0[0] * a1 * W * 0.5, y0 + n0[1] * a1 * W * 0.5);
      c.lineTo(x1 + n1[0] * a1 * W * 0.5, y1 + n1[1] * a1 * W * 0.5);
      c.lineTo(x1 + n1[0] * a0 * W * 0.5, y1 + n1[1] * a0 * W * 0.5);
      c.closePath();
      c.fill();
      c.stroke();
    }
    arc += d;
  }
  c.restore();
}

function segNormal(line: readonly (readonly [number, number])[], i: number): [number, number] {
  const a = line[Math.max(0, i - 1)];
  const b = line[Math.min(line.length - 1, i + 1)];
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [-(b[1] - a[1]) / d, (b[0] - a[0]) / d];
}

function paintCanes(c: Ctx, L: Layout, sc: Scene): void {
  const lt = decorLit(sc);
  // In the outer, lower corner of a row's outermost tile (row r spans |u| ≤ r + 1.5): wires only run from a tile's
  // centre to its edge midpoints, and the bulb sits at the centre, so that corner is always clear. The shank hangs
  // into the stair step below, also clear of the next row's wires and bulbs. Under the wires in any case.
  for (const [row, side] of [[3, -1], [5, 1], [7, -1]] as const) {
    const u = side * (row + 1.45);
    const v = row + 0.78;
    // The crook curls back toward the tree.
    cane(c, L, X(L, u), Y(L, v), -side, lt);
  }
}

/* ---------- tree skirt: quilted velvet, faux-fur trim ---------- */

function paintSkirt(c: Ctx, L: Layout, sc: Scene, r: Rng): void {
  const s = L.s;
  const lt = decorLit(sc);
  const cx = X(L, 0);
  const cy = Y(L, 10.22);
  const rx = 4.2 * s;
  const ry = 0.58 * s;
  const sq = ry / rx;
  const velvet: Rgb = [118, 14, 44]; // wine, cool enough to stay red under the tree's warm glow
  const day = sc.light === 'day';
  // A soft, irregular drape: the velvet falls in a few broad folds.
  const ph = [r() * TAU, r() * TAU, r() * TAU];
  const wob = (a: number) => 1 + 0.014 * Math.sin(a * 6 + ph[0]) + 0.009 * Math.sin(a * 11 + ph[1]) + 0.004 * Math.sin(a * 19 + ph[2]);
  const edge = (a: number, k = 1): [number, number] => [cx + Math.cos(a) * rx * wob(a) * k, cy + Math.sin(a) * ry * wob(a) * k];
  const outline = (k: number) => {
    c.beginPath();
    for (let i = 0; i <= 160; i++) {
      const [x, y] = edge((i / 160) * TAU, k);
      if (i) c.lineTo(x, y);
      else c.moveTo(x, y);
    }
    c.closePath();
  };
  c.save();
  // Contact shadow on the floor, wider at the front.
  c.save();
  c.translate(cx, cy + ry * 0.22);
  c.scale(1, sq);
  const sh = c.createRadialGradient(0, 0, rx * 0.8, 0, 0, rx * 1.13);
  sh.addColorStop(0, 'rgba(0,0,0,.5)');
  sh.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = sh;
  c.fillRect(-rx * 1.2, -rx * 1.2, rx * 2.4, rx * 2.4);
  c.restore();
  // Velvet base: deep at the back under the boughs, lifting toward the front.
  outline(0.97);
  const g = c.createLinearGradient(0, cy - ry, 0, cy + ry);
  g.addColorStop(0, css(lit(lt, velvet, 0.22)));
  g.addColorStop(0.5, css(lit(lt, velvet, 0.55)));
  g.addColorStop(1, css(lit(lt, velvet, 0.85)));
  c.fillStyle = g;
  c.fill();
  c.save();
  c.clip();
  // Channel quilting: radial velvet panels, each pillowed between stitched seams. Velvet's nap turns each panel to
  // the light a little differently, so neighbouring panels differ in sheen.
  const PANELS = 18;
  const a0 = r() * TAU;
  c.save();
  c.translate(cx, cy);
  c.scale(1, sq);
  for (let k = 0; k < PANELS; k++) {
    const p0 = a0 + (k / PANELS) * TAU;
    const p1 = a0 + ((k + 1) / PANELS) * TAU;
    const R = rx * 1.12;
    const nap = 0.55 + 0.9 * r();
    c.beginPath();
    c.moveTo(0, 0);
    c.arc(0, 0, R, p0, p1);
    c.closePath();
    const mR = rx * 0.75;
    const gp = c.createLinearGradient(Math.cos(p0) * mR, Math.sin(p0) * mR, Math.cos(p1) * mR, Math.sin(p1) * mR);
    gp.addColorStop(0, 'rgba(6,0,4,.5)');
    gp.addColorStop(0.22, 'rgba(6,0,4,0)');
    gp.addColorStop(0.5, css(lit(lt, [214, 90, 120], nap), 0.2));
    gp.addColorStop(0.78, 'rgba(6,0,4,0)');
    gp.addColorStop(1, 'rgba(6,0,4,.5)');
    c.fillStyle = gp;
    c.fill();
  }
  // Velvet's pile catches the light at grazing angles: a sheen just inside the front edge.
  const sheen = c.createRadialGradient(0, -rx * 0.1, rx * 0.62, 0, 0, rx);
  sheen.addColorStop(0, 'rgba(0,0,0,0)');
  sheen.addColorStop(0.8, css(lit(lt, [220, 110, 140]), 0.2));
  sheen.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = sheen;
  c.fillRect(-rx, -rx, 2 * rx, 2 * rx);
  c.restore();
  // Seams in screen space (so the stitches keep their size): a pressed groove and a fine running stitch.
  for (let k = 0; k < PANELS; k++) {
    const a = a0 + (k / PANELS) * TAU;
    const [ex, ey] = edge(a, 0.97);
    c.strokeStyle = 'rgba(8,0,4,.55)';
    c.lineWidth = Math.max(0.5, s * 0.012);
    c.beginPath();
    c.moveTo(cx, cy);
    c.lineTo(ex, ey);
    c.stroke();
    c.setLineDash([s * 0.035, s * 0.03]);
    c.strokeStyle = css(lit(lt, [220, 120, 140], 0.9), 0.35);
    c.lineWidth = Math.max(0.35, s * 0.006);
    c.beginPath();
    c.moveTo(cx + Math.sin(a) * 1.2, cy - Math.cos(a) * 0.4);
    c.lineTo(ex + Math.sin(a) * 1.2, ey - Math.cos(a) * 0.4);
    c.stroke();
    c.setLineDash([]);
  }
  // The boughs' shadow over the back half and round the trunk (blurred; the skirt's clip still holds it in).
  blurredLayer(c, L.dpr, 0.09 * s, (o) => {
    const hole = o.createRadialGradient(cx, cy - ry * 0.3, 0, cx, cy - ry * 0.3, 2.8 * s);
    hole.addColorStop(0, 'rgba(0,0,0,.75)');
    hole.addColorStop(0.3, 'rgba(0,0,0,.35)');
    hole.addColorStop(1, 'rgba(0,0,0,0)');
    o.fillStyle = hole;
    o.fillRect(cx - 3 * s, cy - 2 * s, 6 * s, 3 * s);
  });
  // Embroidered border: a gold running stitch just inside the fur.
  outline(0.875);
  c.setLineDash([s * 0.05, s * 0.035]);
  c.strokeStyle = css(lit(lt, [196, 156, 86], 1.05), 0.75);
  c.lineWidth = Math.max(0.6, s * 0.014);
  c.stroke();
  c.setLineDash([]);
  outline(0.86);
  c.strokeStyle = css(lit(lt, [196, 156, 86], 0.8), 0.35);
  c.lineWidth = Math.max(0.4, s * 0.007);
  c.stroke();
  c.restore();
  paintFur(c, L, cy, ry, edge, lt, day, r);
  c.restore();
}

/** The faux-fur trim: a soft tube along the skirt's edge, lit on top, with fine hairs breaking its outline. */
function paintFur(c: Ctx, L: Layout, cy: number, ry: number, edge: (a: number, k?: number) => [number, number], lt: Lit, day: boolean, r: Rng): void {
  const s = L.s;
  const fur: Rgb = day ? [240, 236, 228] : [236, 224, 200];
  const T = 0.15 * s; // tube thickness
  const tube = (o: Ctx, k: number) => {
    o.beginPath();
    for (let i = 0; i <= 160; i++) {
      const [x, y] = edge((i / 160) * TAU, k);
      if (i) o.lineTo(x, y);
      else o.moveTo(x, y);
    }
    o.closePath();
  };
  // Shadow the trim casts on the floor in front.
  blurredLayer(c, L.dpr, T * 0.5, (o) => {
    o.translate(0, T * 0.45);
    tube(o, 0.985);
    o.lineWidth = T * 1.1;
    o.strokeStyle = 'rgba(0,0,0,.45)';
    o.stroke();
  });
  // The tube: soft-edged, darker toward the back where the boughs shade it.
  blurredLayer(c, L.dpr, T * 0.18, (o) => {
    tube(o, 0.985);
    o.lineWidth = T;
    const fg = o.createLinearGradient(0, cy - ry, 0, cy + ry);
    fg.addColorStop(0, css(lit(lt, fur, 0.3)));
    fg.addColorStop(0.55, css(lit(lt, fur, 0.75)));
    fg.addColorStop(1, css(lit(lt, fur, 0.95)));
    o.strokeStyle = fg;
    o.stroke();
  });
  // The tube's rounded top catches the light; its underside falls into shadow.
  blurredLayer(c, L.dpr, T * 0.22, (o) => {
    o.translate(0, -T * 0.2);
    tube(o, 0.985);
    o.lineWidth = T * 0.38;
    const hg = o.createLinearGradient(0, cy - ry, 0, cy + ry);
    hg.addColorStop(0, css(lit(lt, fur, 0.5), 0));
    hg.addColorStop(0.6, css(lit(lt, fur, 1.0), 0.35));
    hg.addColorStop(1, css(lit(lt, fur, 1.15), 0.6));
    o.strokeStyle = hg;
    o.stroke();
  });
  // Hairs: short, curved, mostly outward; brighter on the tube's lit upper side and toward the front.
  c.save();
  c.lineCap = 'round';
  const BUCKETS = 6;
  const paths = Array.from({ length: BUCKETS }, () => new Path2D());
  const count = Math.round(5000 * (s / 60));
  for (let k = 0; k < count; k++) {
    const a = r() * TAU;
    const front = 0.5 + 0.5 * Math.sin(a);
    const across = (r() - 0.5) * 2; // -1 top of tube … +1 bottom
    const [ex, ey] = edge(a, 0.985);
    const nx = Math.cos(a);
    const ny = Math.sin(a) * 0.35;
    const nl = Math.hypot(nx, ny) || 1;
    const x = ex + (nx / nl) * across * T * 0.35;
    const y = ey + across * T * 0.45;
    const l = (0.016 + r() * 0.028) * s;
    const ang = Math.atan2(ny, nx) + (r() - 0.5) * 2.2 - 0.6 * (across < 0 ? 1 : 0) * Math.sign(nx);
    const lift = clamp01(0.55 - 0.45 * across) * (0.45 + 0.55 * front) * (0.7 + 0.5 * r());
    const b = Math.min(BUCKETS - 1, Math.floor(lift * BUCKETS));
    const mx = x + Math.cos(ang) * l * 0.5;
    const my = y + Math.sin(ang) * l * 0.5;
    paths[b].moveTo(x, y);
    paths[b].quadraticCurveTo(mx, my - l * 0.12, x + Math.cos(ang + 0.3) * l, y + Math.sin(ang + 0.3) * l);
  }
  c.lineWidth = Math.max(0.35, s * 0.0055);
  for (let b = 0; b < BUCKETS; b++) {
    const k = (b + 0.5) / BUCKETS;
    c.strokeStyle = css(lit(lt, fur, 0.3 + 0.95 * k), 0.42);
    c.stroke(paths[b]);
  }
  c.restore();
}

/**
 * Paints the decorations that are on onto the tree layer, in CSS px (the transform is scale `dpr`), right after
 * paintTree. Does nothing when every flag is off. Once per repaint: nothing here runs per frame.
 */
export function paintDecor(c: CanvasRenderingContext2D, L: Layout, sc: Scene, d: Decor): void {
  if (!d.tinsel && !d.beads && !d.canes && !d.skirt) return;
  const r = mulberry32(77);
  if (d.skirt) {
    // Painted behind what is already on the layer, so the lowest boughs and the trunk sit over its back half.
    const [cv, o] = canvas(c.canvas.width, c.canvas.height);
    o.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    paintSkirt(o, L, sc, r);
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'destination-over';
    c.drawImage(cv, 0, 0);
    c.restore();
    cv.width = 0;
  }
  if (d.beads) paintBeads(c, L, sc);
  if (d.tinsel) paintTinsel(c, L, sc, r);
  if (d.canes) paintCanes(c, L, sc);
}
