/**
 * The 1960s aluminium tinsel tree, Evergleam-style (season two, C3; ported from the lab's trees-tinsel). Painted once
 * into the tree layer: a silver pole, tiers of tinsel "bottlebrush" branches at every azimuth (the back ones softer and
 * darker), each ending in a crinkled foil pom, static glints, and the scene's light on the side. The lab's rotating
 * colour wheel (a per-frame wash and twinkles) is not ported: the tree costs nothing per frame.
 */
import { mulberry32, type Rng } from '../../core/rng';
import { blurredLayer } from '../blur';
import { envelope, X, Y, type Layout } from '../layout';
import { clamp01, css, mixRgb, TAU } from '../paint-util';
import type { Rgb, Scene } from '../scenes';

interface Foil {
  dark: Rgb;
  mid: Rgb;
  hi: Rgb;
  body: string;
  bodyA: number;
  pole: Rgb;
}

function foilFor(sc: Scene): Foil {
  switch (sc.light) {
    case 'day':
      return { dark: [70, 78, 90], mid: [150, 158, 170], hi: [252, 253, 255], body: 'rgb(54,62,74)', bodyA: 0.72, pole: [175, 180, 188] };
    case 'fire':
      return { dark: [30, 22, 17], mid: [118, 96, 78], hi: [255, 228, 190], body: 'rgb(14,9,6)', bodyA: 0.7, pole: [150, 128, 108] };
    case 'aurora':
      return { dark: [20, 30, 44], mid: [92, 118, 140], hi: [220, 245, 255], body: 'rgb(6,10,22)', bodyA: 0.7, pole: [130, 150, 170] };
    default:
      return { dark: [22, 27, 40], mid: [96, 110, 138], hi: [222, 232, 255], body: 'rgb(4,6,14)', bodyA: 0.7, pole: [130, 140, 162] };
  }
}

/** Brightness buckets: strands are batched by bucket, one stroke each. */
const BUCKETS = 12;
const bucketColor = (f: Foil, k: number): Rgb => {
  const t = k / (BUCKETS - 1);
  return t < 0.7 ? mixRgb(f.dark, f.mid, t / 0.7) : mixRgb(f.mid, f.hi, (t - 0.7) / 0.3);
};

interface Branch {
  v: number;
  x1: number;
  y1: number;
  z: number;
  len: number;
}

function branches(r: Rng): Branch[] {
  const out: Branch[] = [];
  let phase = 0;
  for (let v = -0.7; v < 9.3; v += 0.6) {
    const len0 = Math.min(8.9, envelope(v + 0.35) * 0.98);
    const n = Math.max(3, Math.round(2.4 + len0 * 1.3));
    phase += 2.39996; // golden angle: no two tiers line up
    for (let j = 0; j < n; j++) {
      const phi = phase + (j * TAU) / n + (r() - 0.5) * 0.5;
      const len = Math.max(0.35, len0 * (0.86 + r() * 0.2));
      const sx = Math.sin(phi);
      const z = Math.cos(phi);
      // Branches angle up a little; ones pointing at the viewer sit lower (seen from slightly above).
      out.push({ v, x1: len * sx, y1: v - len * 0.1 + z * len * 0.12, z, len });
    }
  }
  return out.sort((a, b) => a.z - b.z);
}

/** Paints the branches; the tips of the brightest front strands go into `sparkPts` (tile units) for the glints. */
function paintBranches(o: CanvasRenderingContext2D, L: Layout, f: Foil, list: readonly Branch[], r: Rng, back: boolean, sparkPts: [number, number][]): void {
  const s = L.s;
  const paths: Path2D[] = Array.from({ length: BUCKETS }, () => new Path2D());
  const seg = (k: number, x0: number, y0: number, x1: number, y1: number) => {
    const p = paths[Math.max(0, Math.min(BUCKETS - 1, k | 0))];
    p.moveTo(X(L, x0), Y(L, y0));
    p.lineTo(X(L, x1), Y(L, y1));
  };
  // A foil strip's brightness: mostly dull, a few catching the light full on.
  const bright = (boost: number) => {
    const q = r();
    const b = q > 0.92 ? 0.82 + r() * 0.18 : Math.pow(r(), 2.1) * 0.62;
    return Math.min(BUCKETS - 1, (b + boost) * (BUCKETS - 1) * (back ? 0.62 : 1));
  };
  const strand = (px: number, py: number, ang: number, l: number, boost: number) => {
    // Crinkled: two segments with a kink, each catching the light differently.
    const kx = px + Math.cos(ang) * l * 0.5;
    const ky = py + Math.sin(ang) * l * 0.5;
    const a2 = ang + (r() - 0.5) * 0.9;
    const ex = kx + Math.cos(a2) * l * 0.5;
    const ey = ky + Math.sin(a2) * l * 0.5 + l * 0.12;
    seg(bright(boost), px, py, kx, ky);
    const b2 = bright(boost);
    seg(b2, kx, ky, ex, ey);
    if (!back && b2 > BUCKETS * 0.85 && r() < 0.5) sparkPts.push([ex, ey]);
  };
  for (const b of list) {
    const rodA = Math.atan2(b.y1 - b.v, b.x1);
    const steps = Math.ceil(b.len / 0.05);
    const near = clamp01(0.5 + 0.5 * b.z);
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const px = b.x1 * t;
      const py = b.v + (b.y1 - b.v) * t;
      const nb = 3;
      for (let q = 0; q < nb; q++) {
        const across = r() < 0.72;
        const ang = across ? rodA + (r() < 0.5 ? 1 : -1) * (Math.PI / 2 + (r() - 0.5) * 1.1) : r() * TAU;
        const l = (0.11 + r() * 0.1) * (1 - 0.25 * t) * (0.55 + 0.45 * r());
        strand(px, py, ang, l, 0.04 * near);
      }
    }
    // The pom: a crinkled burst at the tip.
    const pomN = 46 + Math.round(b.len * 4);
    const pr = 0.24 + Math.min(0.14, b.len * 0.025);
    for (let q = 0; q < pomN; q++) {
      const ang = r() * TAU;
      const l = pr * (0.45 + 0.55 * Math.sqrt(r()));
      strand(b.x1 + (r() - 0.5) * 0.06, b.y1 + (r() - 0.5) * 0.06, ang, l, 0.1 + 0.08 * near);
    }
  }
  o.lineCap = 'round';
  o.lineWidth = Math.max(0.55, s * (back ? 0.017 : 0.014));
  for (let k = 0; k < BUCKETS; k++) {
    o.strokeStyle = css(bucketColor(f, k), back ? 0.75 : 0.92);
    o.stroke(paths[k]);
  }
}

function paintPole(o: CanvasRenderingContext2D, L: Layout, f: Foil): void {
  const s = L.s;
  const w = 0.075;
  const g = o.createLinearGradient(X(L, -w), 0, X(L, w), 0);
  g.addColorStop(0, css(mixRgb(f.dark, [0, 0, 0], 0.4)));
  g.addColorStop(0.3, css(f.pole));
  g.addColorStop(0.42, css(f.hi));
  g.addColorStop(0.6, css(f.mid));
  g.addColorStop(1, css(mixRgb(f.dark, [0, 0, 0], 0.5)));
  o.fillStyle = g;
  o.beginPath();
  o.moveTo(X(L, -0.03), Y(L, -0.95));
  o.lineTo(X(L, 0.03), Y(L, -0.95));
  o.lineTo(X(L, w), Y(L, 9.9));
  o.lineTo(X(L, -w), Y(L, 9.9));
  o.fill();
  // The branch holes down the pole, tiny dark notches.
  o.fillStyle = 'rgba(0,0,0,.45)';
  for (let v = -0.6; v < 9.6; v += 0.6) o.fillRect(X(L, -0.03), Y(L, v), 0.06 * s, 0.035 * s);
}

function radial(c: CanvasRenderingContext2D, x: number, y: number, r: number, stops: readonly (readonly [number, string])[]): void {
  if (r <= 0) return;
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  for (const [o, col] of stops) g.addColorStop(o, col);
  c.fillStyle = g;
  c.fillRect(x - r, y - r, 2 * r, 2 * r);
}

function glint(o: CanvasRenderingContext2D, x: number, y: number, len: number, a: number, col: string): void {
  o.strokeStyle = col;
  o.globalAlpha = a;
  o.lineWidth = Math.max(0.6, len * 0.07);
  o.beginPath();
  o.moveTo(x - len, y);
  o.lineTo(x + len, y);
  o.moveTo(x, y - len * 0.8);
  o.lineTo(x, y + len * 0.8);
  o.stroke();
  radial(o, x, y, len * 0.45, [[0, col], [1, 'rgba(255,255,255,0)']]);
  o.globalAlpha = 1;
}

export function paintTinsel(c: CanvasRenderingContext2D, L: Layout, sc: Scene): void {
  const r = mulberry32(1962);
  const f = foilFor(sc);
  const s = L.s;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, c.canvas.width, c.canvas.height);
  const sparkPts: [number, number][] = [];

  // A dark, soft body behind the foil: the room seen through the branches, deep enough that pale wires read.
  blurredLayer(c, L.dpr, s * 0.5, (o) => {
    o.globalAlpha = f.bodyA;
    o.fillStyle = f.body;
    o.beginPath();
    o.moveTo(X(L, 0), Y(L, -0.6));
    for (let v = -0.6; v <= 9.6; v += 0.2) o.lineTo(X(L, Math.min(envelope(v) * 0.86, (v + 0.7) * 0.95)), Y(L, v + 0.2));
    for (let v = 9.6; v >= -0.6; v -= 0.2) o.lineTo(X(L, -Math.min(envelope(v) * 0.86, (v + 0.7) * 0.95)), Y(L, v + 0.2));
    o.fill();
  });

  const list = branches(r);
  const back = list.filter((b) => b.z < -0.15);
  const front = list.filter((b) => b.z >= -0.15);
  blurredLayer(c, L.dpr, 0.9, (o) => paintBranches(o, L, f, back, r, true, sparkPts));
  blurredLayer(c, L.dpr, 0, (o) => {
    paintPole(o, L, f);
    paintBranches(o, L, f, front, r, false, sparkPts);
    // Scene light on the foil (inside it only).
    o.globalCompositeOperation = 'source-atop';
    let lg: CanvasGradient;
    if (sc.light === 'fire') {
      lg = o.createLinearGradient(X(L, -9), 0, X(L, 9), 0);
      lg.addColorStop(0, 'rgba(255,150,70,.38)');
      lg.addColorStop(0.35, 'rgba(255,130,60,.08)');
      lg.addColorStop(0.6, 'rgba(0,0,0,0)');
      lg.addColorStop(1, 'rgba(0,0,0,.42)');
    } else if (sc.light === 'moon') {
      lg = o.createLinearGradient(X(L, -9), 0, X(L, 9), 0);
      lg.addColorStop(0, 'rgba(0,0,0,.3)');
      lg.addColorStop(0.55, 'rgba(0,0,0,0)');
      lg.addColorStop(1, 'rgba(150,180,240,.24)');
    } else if (sc.light === 'day') {
      lg = o.createLinearGradient(0, Y(L, -1), 0, Y(L, 10));
      lg.addColorStop(0, 'rgba(255,255,255,.06)');
      lg.addColorStop(1, 'rgba(20,30,50,.22)');
    } else {
      lg = o.createLinearGradient(0, Y(L, -1), 0, Y(L, 10));
      lg.addColorStop(0, 'rgba(120,255,210,.12)');
      lg.addColorStop(1, 'rgba(0,0,0,.3)');
    }
    o.fillStyle = lg;
    o.fillRect(0, 0, L.w, L.h);
    const ao = o.createRadialGradient(X(L, 0), Y(L, 5.5), 0, X(L, 0), Y(L, 5.5), s * 6.5);
    ao.addColorStop(0, 'rgba(0,0,0,.28)');
    ao.addColorStop(1, 'rgba(0,0,0,0)');
    o.fillStyle = ao;
    o.fillRect(0, 0, L.w, L.h);
    o.globalCompositeOperation = 'source-over';
    // Static glints on the brightest foil.
    const hot = css(f.hi);
    for (let k = 0; k < 110 && k < sparkPts.length; k++) {
      const [u, v] = sparkPts[Math.floor(r() * sparkPts.length)];
      glint(o, X(L, u), Y(L, v), s * (0.06 + r() * 0.08), 0.5 + r() * 0.4, hot);
    }
  });
}
