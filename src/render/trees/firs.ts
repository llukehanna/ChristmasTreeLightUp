/**
 * The flocked fir and the 1900s German goose-feather tree (season two, C3; ported from the lab's trees-firs). Each is
 * painted once into the tree layer, like the game's fir (paint-tree.ts), whenever the layout, the scene or the tree changes.
 *
 * Flocked: the game's procedural fir (the same three needle passes as paint-tree.ts, in a cooler, muted green) with
 * clumps of flocking settled on the tops of the branches, densest at the tips, so the green still shows in the
 * shadows underneath and the pale unlit wires keep something dark to read against. The flock takes the scene's
 * light: blue-grey under the moon, apricot by the fire, white by day.
 *
 * Feather: a green-painted dowel with sparse whorls of wire branches wrapped in dyed goose feathers, a red
 * composition berry at each tip, standing in a white-painted turned base. Lots of air between the tiers.
 */
import { mulberry32, type Rng } from '../../core/rng';
import { blurredLayer } from '../blur';
import { envelope, X, Y, type Layout } from '../layout';
import { css, mixRgb, TAU } from '../paint-util';
import type { Rgb, Scene } from '../scenes';

interface NeedlePass {
  blur: number;
  bright: number;
  frac: number;
  alpha: number;
  len: number;
  flock: number;
}

const PASSES: readonly NeedlePass[] = [
  { blur: 2.0, bright: 0.6, frac: 1, alpha: 0.9, len: 1.04, flock: 0.12 },
  { blur: 0.5, bright: 0.9, frac: 0.9, alpha: 0.95, len: 0.97, flock: 0.32 },
  { blur: 0, bright: 1.15, frac: 0.55, alpha: 0.85, len: 0.9, flock: 0.5 },
];

function flockColor(sc: Scene): Rgb {
  switch (sc.light) {
    case 'day':
      return [228, 234, 240];
    case 'fire':
      return [150, 124, 102];
    case 'aurora':
      return [112, 140, 160];
    default:
      return [104, 116, 142];
  }
}

function sideLight(o: CanvasRenderingContext2D, L: Layout, sc: Scene): void {
  o.globalCompositeOperation = 'source-atop';
  let lg: CanvasGradient;
  if (sc.light === 'moon') {
    lg = o.createLinearGradient(X(L, -9), 0, X(L, 9), 0);
    lg.addColorStop(0, 'rgba(0,0,0,.3)');
    lg.addColorStop(0.6, 'rgba(0,0,0,0)');
    lg.addColorStop(1, 'rgba(160,190,240,.26)');
  } else if (sc.light === 'fire') {
    lg = o.createLinearGradient(X(L, -9), 0, X(L, 9), 0);
    lg.addColorStop(0, 'rgba(255,140,60,.42)');
    lg.addColorStop(0.3, 'rgba(255,120,50,.10)');
    lg.addColorStop(0.55, 'rgba(0,0,0,0)');
    lg.addColorStop(1, 'rgba(0,0,0,.45)');
  } else if (sc.light === 'aurora') {
    lg = o.createLinearGradient(0, Y(L, -1), 0, Y(L, 10));
    lg.addColorStop(0, 'rgba(120,255,210,.14)');
    lg.addColorStop(0.5, 'rgba(0,0,0,0)');
    lg.addColorStop(1, 'rgba(0,0,0,.30)');
  } else {
    lg = o.createLinearGradient(0, Y(L, -1), 0, Y(L, 10));
    lg.addColorStop(0, 'rgba(255,255,255,.05)');
    lg.addColorStop(1, 'rgba(0,0,0,.12)');
  }
  o.fillStyle = lg;
  o.fillRect(0, 0, L.w, L.h);
  const ao = o.createRadialGradient(X(L, 0), Y(L, 6), 0, X(L, 0), Y(L, 6), L.s * 7);
  ao.addColorStop(0, 'rgba(0,0,0,.2)');
  ao.addColorStop(1, 'rgba(0,0,0,0)');
  o.fillStyle = ao;
  o.fillRect(0, 0, L.w, L.h);
  o.globalCompositeOperation = 'source-over';
}

/* ---------- flocked fir ---------- */

export function paintFlocked(c: CanvasRenderingContext2D, L: Layout, sc: Scene): void {
  const r = mulberry32(23);
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, c.canvas.width, c.canvas.height);
  // A cooler, greyer green than the fir: flocked trees are usually a blue-green spruce under the snow.
  const day = sc.light === 'day';
  const A: Rgb = mixRgb(sc.needleA, [30, 50, 52], 0.35);
  const B: Rgb = mixRgb(sc.needleB, [70, 100, 100], 0.4);
  const needle = (): Rgb => mixRgb(A, B, r());
  const flock = flockColor(sc);
  blurredLayer(c, L.dpr, L.s * 0.45, (o) => {
    const w = (v: number) => Math.min(envelope(v) * 0.78, (v + 0.9) * 0.9);
    o.globalAlpha = 0.95;
    o.fillStyle = css(mixRgb(mul(A, 0.75), flock, day ? 0.12 : 0.08));
    o.beginPath();
    o.moveTo(X(L, 0), Y(L, -0.9));
    for (let v = -0.9; v <= 9.5; v += 0.2) o.lineTo(X(L, w(v)), Y(L, v + 0.25));
    for (let v = 9.5; v >= -0.9; v -= 0.2) o.lineTo(X(L, -w(v)), Y(L, v + 0.25));
    o.fill();
  });
  for (const pass of PASSES) blurredLayer(c, L.dpr, pass.blur, (o) => {
    firNeedles(o, L, sc, r, needle, pass, flock);
    sideLight(o, L, sc);
  });
}

const mul = (c: Rgb, k: number): Rgb => [c[0] * k, c[1] * k, c[2] * k];

function firNeedles(o: CanvasRenderingContext2D, L: Layout, sc: Scene, r: Rng, needleColor: () => Rgb, P: NeedlePass, flock: Rgb): void {
  const s = L.s;
  o.lineCap = 'round';
  if (P.blur > 1.5) {
    o.fillStyle = sc.trunk;
    o.beginPath();
    o.moveTo(X(L, -0.2), Y(L, 8.4));
    o.lineTo(X(L, 0.2), Y(L, 8.4));
    o.lineTo(X(L, 0.34), Y(L, 10.2));
    o.lineTo(X(L, -0.34), Y(L, 10.2));
    o.fill();
  }
  const clumps: [number, number, number, number][] = [];
  const ridges: [number, number, number, number, number, number, number, number][] = [];
  for (let v = -0.4; v < 9.5; v += 0.19) {
    for (const side of [-1, 1]) {
      if (r() > P.frac) continue;
      const vv = v + (r() - 0.5) * 0.14;
      const len = envelope(vv) * (0.7 + r() * 0.36) * P.len;
      const x0 = side * -0.12, y0 = vv;
      const x1 = side * len * 0.5, y1 = vv - 0.08 + r() * 0.12;
      const x2 = side * len, y2 = vv + 0.3 + 0.09 * len;
      const stem = needleColor();
      o.strokeStyle = css(mul(stem, P.bright * 0.6), 0.6 * P.alpha);
      o.lineWidth = Math.max(0.6, s * 0.028);
      o.beginPath();
      o.moveTo(X(L, x0), Y(L, y0));
      o.quadraticCurveTo(X(L, x1), Y(L, y1), X(L, x2), Y(L, y2));
      o.stroke();
      // Snow lying along the top of the branch, in one or two runs.
      if (r() < Math.min(0.95, P.flock * 2)) {
        let t0 = 0.18 + r() * 0.2;
        while (t0 < 0.95) {
          const t1 = Math.min(1, t0 + 0.08 + r() * 0.24);
          ridges.push([x0, y0, x1, y1, x2, y2, t0, t1]);
          t0 = t1 + 0.1 + r() * 0.3;
        }
      }
      const steps = Math.ceil(len / 0.085);
      for (let k = 1; k <= steps; k++) {
        const t = k / steps;
        const mt = 1 - t;
        const px = mt * mt * x0 + 2 * mt * t * x1 + t * t * x2;
        const py = mt * mt * y0 + 2 * mt * t * y1 + t * t * y2;
        let tx = 2 * mt * (x1 - x0) + 2 * t * (x2 - x1);
        let ty = 2 * mt * (y1 - y0) + 2 * t * (y2 - y1);
        const tl = Math.hypot(tx, ty);
        tx /= tl;
        ty /= tl;
        const nl = (0.15 + r() * 0.2) * (1 - 0.4 * t) + 0.07;
        for (const sg of [-1, 1]) {
          const an = (0.85 + r() * 0.4) * sg;
          let dx = tx * Math.cos(an) - ty * Math.sin(an);
          let dy = tx * Math.sin(an) + ty * Math.cos(an) + 0.4;
          const dl = Math.hypot(dx, dy);
          dx /= dl;
          dy /= dl;
          const nc = needleColor();
          const br = P.bright * (0.75 + r() * 0.5);
          o.strokeStyle = css(mul(nc, br), P.alpha * (0.45 + r() * 0.55));
          o.lineWidth = Math.max(0.5, s * (0.016 + r() * 0.012));
          o.beginPath();
          o.moveTo(X(L, px), Y(L, py));
          o.lineTo(X(L, px + dx * nl), Y(L, py + dy * nl));
          o.stroke();
        }
        // Flocking settles on the top of the branch, thickest toward the tips.
        if (t > 0.3 && r() < P.flock * 0.35 * t) clumps.push([px, py - 0.03, 0.035 + r() * 0.05 * (0.6 + t), r()]);
      }
    }
  }
  const along = (q: readonly number[], t: number, dy: number): [number, number] => {
    const mt = 1 - t;
    return [X(L, mt * mt * q[0] + 2 * mt * t * q[2] + t * t * q[4]), Y(L, mt * mt * q[1] + 2 * mt * t * q[3] + t * t * q[5] + dy)];
  };
  // Each run of flocking is a row of overlapping lumps, so it reads as soft snow, never as a line (or a wire).
  const lumps: [number, number, number, number][] = [];
  for (const q of ridges) {
    const len = Math.hypot(q[4] - q[0], q[5] - q[1]);
    const dt = 0.045 / Math.max(0.5, len);
    for (let t = q[6]; t <= q[7]; t += dt * (0.7 + r() * 0.6)) {
      const [x, y] = along(q, t, -0.02 + (r() - 0.5) * 0.03);
      const edge = Math.min(t - q[6], q[7] - t) / Math.max(0.01, q[7] - q[6]);
      lumps.push([x, y, (0.022 + r() * 0.035 + 0.025 * Math.min(1, edge * 3)) * s, r()]);
    }
  }
  for (const [x, y, rr] of lumps) {
    o.fillStyle = css(mul(flock, 0.48 * P.bright), 0.6 * P.alpha);
    o.beginPath();
    o.arc(x + rr * 0.15, y + rr * 0.45, rr * 1.05, 0, TAU);
    o.fill();
  }
  for (const [x, y, rr, k] of lumps) {
    o.fillStyle = css(mul(flock, (0.78 + 0.22 * k) * Math.min(1.05, P.bright)), 0.95 * P.alpha);
    o.beginPath();
    o.arc(x, y, rr, 0, TAU);
    o.fill();
  }
  for (const [x, y, rr, k] of lumps) {
    if (k < 0.45) continue;
    o.fillStyle = css(mixRgb(flock, [255, 255, 255], 0.3), 0.55 * P.alpha);
    o.beginPath();
    o.arc(x - rr * 0.2, y - rr * 0.35, rr * 0.5, 0, TAU);
    o.fill();
  }
  for (const [u, v, rad, k] of clumps) {
    const x = X(L, u);
    const y = Y(L, v);
    const rr = rad * s;
    // Shadowed underside, then the lit top, then a few crisp crystals.
    o.fillStyle = css(mul(flock, 0.55 * P.bright), 0.75 * P.alpha);
    o.beginPath();
    o.ellipse(x, y + rr * 0.3, rr * 1.15, rr * 0.75, 0, 0, TAU);
    o.fill();
    o.fillStyle = css(mul(flock, (0.82 + 0.25 * k) * Math.min(1.05, P.bright)), 0.92 * P.alpha);
    o.beginPath();
    o.ellipse(x - rr * 0.1, y - rr * 0.05, rr, rr * 0.6, 0, 0, TAU);
    o.ellipse(x + rr * 0.55, y + rr * 0.1, rr * 0.6, rr * 0.42, 0, 0, TAU);
    o.fill();
    if (P.blur === 0 && k > 0.7) {
      o.fillStyle = css(mixRgb(flock, [255, 255, 255], 0.6), 0.8);
      o.fillRect(x - rr * 0.4, y - rr * 0.45, Math.max(0.6, s * 0.012), Math.max(0.6, s * 0.012));
    }
  }
}

/* ---------- German feather tree ---------- */

interface Limb {
  v: number;
  x1: number;
  y1: number;
  z: number;
  len: number;
}

function feathers(o: CanvasRenderingContext2D, L: Layout, list: readonly Limb[], r: Rng, base: Rgb, back: boolean, berry: Rgb, sc: Scene): void {
  const s = L.s;
  o.lineCap = 'round';
  for (const b of list) {
    const x0 = 0;
    const y0 = b.v;
    // The wire limb, slightly curving up at its tip.
    const cx = b.x1 * 0.6;
    const cy = b.v + (b.y1 - b.v) * 0.4 + 0.06;
    o.strokeStyle = css(mul(base, 0.45), 0.9);
    o.lineWidth = Math.max(0.7, s * 0.03);
    o.beginPath();
    o.moveTo(X(L, x0), Y(L, y0));
    o.quadraticCurveTo(X(L, cx), Y(L, cy), X(L, b.x1), Y(L, b.y1));
    o.stroke();
    // Goose-feather barbs wrapped around it: soft, drooping, longer near the trunk.
    const steps = Math.ceil(b.len / 0.035);
    const near = 0.75 + 0.25 * b.z;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const mt = 1 - t;
      const px = mt * mt * x0 + 2 * mt * t * cx + t * t * b.x1;
      const py = mt * mt * y0 + 2 * mt * t * cy + t * t * b.y1;
      const tx = 2 * mt * (cx - x0) + 2 * t * (b.x1 - cx);
      const ty = 2 * mt * (cy - y0) + 2 * t * (b.y1 - cy);
      const tl = Math.hypot(tx, ty) || 1;
      for (let q = 0; q < 3; q++) {
        const sg = q === 2 ? (r() < 0.5 ? 1 : -1) : q ? 1 : -1;
        const an = Math.atan2(ty / tl, tx / tl) + sg * (1.0 + r() * 0.6);
        const l = (0.13 + r() * 0.09) * (1 - 0.45 * t) + 0.04;
        const ex = px + Math.cos(an) * l;
        const ey = py + Math.sin(an) * l + 0.06 * l + 0.03;
        const col = mul(mixRgb(base, [150, 170, 120], r() * 0.25), (0.65 + r() * 0.55) * near * (back ? 0.65 : 1));
        o.strokeStyle = css(col, 0.5 + r() * 0.35);
        o.lineWidth = Math.max(0.5, s * (0.012 + r() * 0.01));
        o.beginPath();
        o.moveTo(X(L, px), Y(L, py));
        o.quadraticCurveTo(X(L, px + (ex - px) * 0.5), Y(L, py + (ey - py) * 0.3 - 0.02), X(L, ex), Y(L, ey));
        o.stroke();
      }
    }
    // A red composition berry at the tip.
    const bx = X(L, b.x1);
    const by = Y(L, b.y1 - 0.02);
    const br = s * 0.065 * (0.85 + 0.25 * b.z);
    const lt = sc.light === 'day' ? 1 : sc.light === 'fire' ? 0.75 : 0.62;
    const g = o.createRadialGradient(bx - br * 0.35, by - br * 0.4, br * 0.05, bx, by, br);
    g.addColorStop(0, css(mixRgb(berry, [255, 230, 220], 0.55), 1));
    g.addColorStop(0.35, css(mul(berry, lt * (back ? 0.7 : 1))));
    g.addColorStop(1, css(mul(berry, lt * 0.35)));
    o.fillStyle = g;
    o.beginPath();
    o.arc(bx, by, br, 0, TAU);
    o.fill();
  }
}

export function paintFeather(c: CanvasRenderingContext2D, L: Layout, sc: Scene): void {
  const r = mulberry32(1900);
  const s = L.s;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, c.canvas.width, c.canvas.height);
  const day = sc.light === 'day';
  // Dyed goose feathers: a muted, slightly blue green.
  const base: Rgb = day ? [62, 98, 70] : sc.light === 'fire' ? [58, 86, 52] : [50, 86, 72];
  const berry: Rgb = [196, 28, 30];

  // A faint shadowy haze where the tree stands: just enough for pale wires to read between the sparse tiers.
  blurredLayer(c, L.dpr, s * 0.8, (o) => {
    o.globalAlpha = day ? 0.32 : 0.45;
    o.fillStyle = day ? 'rgb(60,78,72)' : 'rgb(4,8,8)';
    o.beginPath();
    o.moveTo(X(L, 0), Y(L, -0.5));
    for (let v = -0.5; v <= 9.4; v += 0.2) o.lineTo(X(L, Math.min(envelope(v) * 0.8, (v + 0.6) * 0.9)), Y(L, v + 0.2));
    for (let v = 9.4; v >= -0.5; v -= 0.2) o.lineTo(X(L, -Math.min(envelope(v) * 0.8, (v + 0.6) * 0.9)), Y(L, v + 0.2));
    o.fill();
  });

  // Whorls of limbs: a few per tier, the tiers well apart (the tree is all air).
  const limbs: Limb[] = [];
  let phase = 0.4;
  for (let v = -0.55; v < 9.2; v += 0.95) {
    const len0 = Math.min(8.8, envelope(v + 0.55) * 0.97);
    const n = Math.max(3, Math.round(3 + len0 * 0.7));
    phase += 2.39996;
    for (let j = 0; j < n; j++) {
      const phi = phase + (j * TAU) / n + (r() - 0.5) * 0.4;
      const len = Math.max(0.4, len0 * (0.9 + r() * 0.12));
      const z = Math.cos(phi);
      limbs.push({ v, x1: len * Math.sin(phi), y1: v - len * 0.07 + z * len * 0.1, z, len });
    }
  }
  limbs.sort((a, b) => a.z - b.z);
  const back = limbs.filter((b) => b.z < 0);
  const front = limbs.filter((b) => b.z >= 0);
  blurredLayer(c, L.dpr, 1.1, (o) => feathers(o, L, back, r, base, true, berry, sc));
  blurredLayer(c, L.dpr, 0, (o) => {
    // The turned base: a white-painted block with a little shadowed lip.
    const bw = 0.95;
    const g = o.createLinearGradient(X(L, -bw), 0, X(L, bw), 0);
    const cream: Rgb = day ? [232, 228, 218] : sc.light === 'fire' ? [150, 120, 96] : [96, 104, 122];
    g.addColorStop(0, css(mul(cream, 0.6)));
    g.addColorStop(0.35, css(cream));
    g.addColorStop(1, css(mul(cream, 0.5)));
    o.fillStyle = g;
    o.fillRect(X(L, -bw), Y(L, 9.55), bw * 2 * s, 0.55 * s);
    o.fillStyle = css(mul(cream, 1.08));
    o.fillRect(X(L, -bw - 0.08), Y(L, 9.5), (bw + 0.08) * 2 * s, 0.08 * s);
    o.fillStyle = 'rgba(0,0,0,.25)';
    o.fillRect(X(L, -bw), Y(L, 9.58), bw * 2 * s, 0.04 * s);
    // The dowel trunk, painted green.
    const tg = o.createLinearGradient(X(L, -0.08), 0, X(L, 0.08), 0);
    tg.addColorStop(0, css(mul(base, 0.35)));
    tg.addColorStop(0.4, css(mul(base, 0.95)));
    tg.addColorStop(1, css(mul(base, 0.3)));
    o.fillStyle = tg;
    o.beginPath();
    o.moveTo(X(L, -0.025), Y(L, -0.9));
    o.lineTo(X(L, 0.025), Y(L, -0.9));
    o.lineTo(X(L, 0.075), Y(L, 9.55));
    o.lineTo(X(L, -0.075), Y(L, 9.55));
    o.fill();
    feathers(o, L, front, r, base, false, berry, sc);
    sideLight(o, L, sc);
  });
}
