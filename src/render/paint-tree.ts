import { mulberry32, type Rng } from '../core/rng';
import { blurredLayer } from './blur';
import { X, Y, type Layout } from './layout';
import type { Scene } from './scenes';

interface NeedlePass {
  blur: number;
  bright: number;
  frac: number;
  alpha: number;
  len: number;
}

/** Back (soft), middle, front (crisp) needle passes (spec §4.3). */
const PASSES: readonly NeedlePass[] = [
  { blur: 2.0, bright: 0.6, frac: 1, alpha: 0.9, len: 1.04 },
  { blur: 0.5, bright: 0.9, frac: 0.9, alpha: 0.95, len: 0.97 },
  { blur: 0, bright: 1.15, frac: 0.55, alpha: 0.85, len: 0.9 },
];

/** Half-width of the foliage envelope at row `v` (covers every tile of the mask). */
const envelope = (v: number): number => Math.min(9.3, 1.3 + Math.max(0, v));

/** Procedural fir, painted once per resize/scene change. */
export function paintTree(c: CanvasRenderingContext2D, L: Layout, sc: Scene): void {
  const r = mulberry32(11);
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, c.canvas.width, c.canvas.height);
  const needleColor = (): number[] => {
    const k = r();
    return sc.needleA.map((v, i) => v + (sc.needleB[i] - v) * k);
  };

  // Soft body under the needles: tapers to a point, heavily blurred so it never shows an edge.
  blurredLayer(c, L.dpr, L.s * 0.45, (o) => {
    const w = (v: number) => Math.min(envelope(v) * 0.78, (v + 0.9) * 0.9);
    o.globalAlpha = 0.95;
    o.fillStyle = `rgb(${sc.needleA.map((v) => (v * 0.75) | 0).join(',')})`;
    o.beginPath();
    o.moveTo(X(L, 0), Y(L, -0.9));
    for (let v = -0.9; v <= 9.5; v += 0.2) o.lineTo(X(L, w(v)), Y(L, v + 0.25));
    for (let v = 9.5; v >= -0.9; v -= 0.2) o.lineTo(X(L, -w(v)), Y(L, v + 0.25));
    o.fill();
  });

  for (const pass of PASSES) blurredLayer(c, L.dpr, pass.blur, (o) => paintNeedles(o, L, sc, r, needleColor, pass));
}

function paintNeedles(o: CanvasRenderingContext2D, L: Layout, sc: Scene, r: Rng, needleColor: () => number[], P: NeedlePass): void {
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
  for (let v = -0.4; v < 9.5; v += 0.19) {
    for (const side of [-1, 1]) {
      if (r() > P.frac) continue;
      const vv = v + (r() - 0.5) * 0.14;
      const len = envelope(vv) * (0.7 + r() * 0.36) * P.len;
      const x0 = side * -0.12, y0 = vv; // cross the axis slightly so no seam shows down the middle
      const x1 = side * len * 0.5, y1 = vv - 0.08 + r() * 0.12;
      const x2 = side * len, y2 = vv + 0.3 + 0.09 * len;
      const stem = needleColor();
      o.strokeStyle = `rgba(${stem.map((v2) => (v2 * P.bright * 0.6) | 0).join(',')},${0.6 * P.alpha})`;
      o.lineWidth = Math.max(0.6, s * 0.028);
      o.beginPath();
      o.moveTo(X(L, x0), Y(L, y0));
      o.quadraticCurveTo(X(L, x1), Y(L, y1), X(L, x2), Y(L, y2));
      o.stroke();
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
          let dy = tx * Math.sin(an) + ty * Math.cos(an) + 0.4; // droop
          const dl = Math.hypot(dx, dy);
          dx /= dl;
          dy /= dl;
          const nc = needleColor();
          const br = P.bright * (0.75 + r() * 0.5);
          o.strokeStyle = `rgba(${nc.map((v2) => Math.min(255, v2 * br) | 0).join(',')},${P.alpha * (0.45 + r() * 0.55)})`;
          o.lineWidth = Math.max(0.5, s * (0.016 + r() * 0.012));
          o.beginPath();
          o.moveTo(X(L, px), Y(L, py));
          o.lineTo(X(L, px + dx * nl), Y(L, py + dy * nl));
          o.stroke();
        }
        if (sc.snowDust && P.blur < 1 && t > 0.3 && r() < 0.06) {
          o.strokeStyle = `rgba(255,255,255,${0.45 + r() * 0.35})`;
          o.lineWidth = Math.max(0.8, s * 0.03);
          o.beginPath();
          o.moveTo(X(L, px - tx * 0.08), Y(L, py - 0.05));
          o.lineTo(X(L, px + tx * 0.14), Y(L, py + ty * 0.14 - 0.05));
          o.stroke();
        }
      }
    }
  }
  // Lighting for this pass (source-atop keeps it inside the needles)
  o.globalCompositeOperation = 'source-atop';
  let lg: CanvasGradient;
  if (sc.light === 'moon') {
    lg = o.createLinearGradient(X(L, -9), 0, X(L, 9), 0);
    lg.addColorStop(0, 'rgba(0,0,0,.28)');
    lg.addColorStop(0.6, 'rgba(0,0,0,0)');
    lg.addColorStop(1, 'rgba(160,190,240,.26)');
  } else if (sc.light === 'fire') {
    lg = o.createLinearGradient(X(L, -9), 0, X(L, 9), 0);
    lg.addColorStop(0, 'rgba(255,140,60,.42)');
    lg.addColorStop(0.3, 'rgba(255,120,50,.10)');
    lg.addColorStop(0.55, 'rgba(0,0,0,0)');
    lg.addColorStop(1, 'rgba(0,0,0,.45)');
  } else if (sc.light === 'aurora') {
    // Aurora light from above, the skirt in shadow.
    lg = o.createLinearGradient(0, Y(L, -1), 0, Y(L, 10));
    lg.addColorStop(0, 'rgba(120,255,210,.14)');
    lg.addColorStop(0.5, 'rgba(0,0,0,0)');
    lg.addColorStop(1, 'rgba(0,0,0,.30)');
  } else {
    lg = o.createLinearGradient(0, Y(L, -1), 0, Y(L, 10));
    lg.addColorStop(0, 'rgba(255,255,255,.05)');
    lg.addColorStop(1, 'rgba(0,0,0,.10)');
  }
  o.fillStyle = lg;
  o.fillRect(0, 0, L.w, L.h);
  const ao = o.createRadialGradient(X(L, 0), Y(L, 6), 0, X(L, 0), Y(L, 6), s * 7);
  ao.addColorStop(0, 'rgba(0,0,0,.18)');
  ao.addColorStop(1, 'rgba(0,0,0,0)');
  o.fillStyle = ao;
  o.fillRect(0, 0, L.w, L.h);
  o.globalCompositeOperation = 'source-over';
}
