import { mulberry32, type Rng } from '../core/rng';
import { blurredLayer } from './blur';
import { X, Y, type Layout } from './layout';
import type { Scene } from './scenes';

const TAU = Math.PI * 2;

/** Static scene backdrop, painted once per resize/scene change (spec §4.3). */
export function paintBackground(c: CanvasRenderingContext2D, L: Layout, sc: Scene): void {
  const r = mulberry32(3);
  const hz = Y(L, 10.05);
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, c.canvas.width, c.canvas.height);
  c.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
  let gr = c.createLinearGradient(0, 0, 0, hz);
  gr.addColorStop(0, sc.sky[0]);
  gr.addColorStop(0.6, sc.sky[1]);
  gr.addColorStop(1, sc.sky[2]);
  c.fillStyle = gr;
  c.fillRect(0, 0, L.w, hz + 2);
  gr = c.createLinearGradient(0, hz, 0, L.h);
  gr.addColorStop(0, sc.ground[0]);
  gr.addColorStop(1, sc.ground[1]);
  c.fillStyle = gr;
  c.fillRect(0, hz, L.w, L.h - hz);
  if (sc.light === 'moon') paintMoonlit(c, L, r, hz);
  else if (sc.light === 'fire') paintFireside(c, L, r, hz);
  else if (sc.light === 'aurora') paintAurora(c, L, r, hz);
  else paintDaylight(c, L, hz);
}

function disc(c: CanvasRenderingContext2D, x: number, y: number, rad: number): void {
  c.beginPath();
  c.arc(x, y, rad, 0, TAU);
  c.fill();
}

function paintMoonlit(c: CanvasRenderingContext2D, L: Layout, r: Rng, hz: number): void {
  const { w, h, s } = L;
  for (let i = 0; i < 110; i++) {
    const x = r() * w;
    const y = r() * hz * 0.7;
    const z = r();
    c.fillStyle = `rgba(220,230,255,${0.04 + z * z * 0.45})`;
    disc(c, x, y, 0.35 + z * 0.7);
  }
  const rg = c.createRadialGradient(w * 0.82, h * 0.08, 0, w * 0.82, h * 0.08, w * 0.55);
  rg.addColorStop(0, 'rgba(120,150,220,.16)');
  rg.addColorStop(1, 'rgba(120,150,220,0)');
  c.fillStyle = rg;
  c.fillRect(0, 0, w, h);
  // distant village lights along the horizon
  blurredLayer(c, L.dpr, 1.2, (o) => {
    for (let i = 0; i < 70; i++) {
      const x = r() * w;
      const y = hz - r() * r() * s * 0.45;
      o.fillStyle = `rgba(255,${(190 + r() * 40) | 0},${(120 + r() * 60) | 0},${0.25 + r() * 0.45})`;
      disc(o, x, y, 0.5 + r() * 1.1);
    }
  });
  // a few defocused lights
  blurredLayer(c, L.dpr, s * 0.35, (o) => {
    for (let i = 0; i < 9; i++) {
      o.fillStyle = `rgba(${r() < 0.5 ? '150,180,255' : '255,210,160'},${0.035 + r() * 0.05})`;
      disc(o, r() * w, hz * (0.25 + r() * 0.6), s * (0.4 + r() * 1.1));
    }
  });
  c.strokeStyle = 'rgba(170,195,240,.10)';
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(0, hz);
  c.lineTo(w, hz);
  c.stroke();
  for (let i = 0; i < 160; i++) {
    c.fillStyle = `rgba(210,225,255,${r() * 0.25})`;
    c.fillRect(r() * w, hz + r() * (h - hz), 1, 1);
  }
}

function paintFireside(c: CanvasRenderingContext2D, L: Layout, r: Rng, hz: number): void {
  const { w, h, s } = L;
  // faint wall planks
  for (let x = 0; x < w; x += s * 1.35) {
    const pw = s * 1.35;
    const g = c.createLinearGradient(x, 0, x + pw, 0);
    g.addColorStop(0, 'rgba(0,0,0,.08)');
    g.addColorStop(0.04, 'rgba(255,200,150,.012)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(x, 0, pw, hz);
  }
  // warm room bokeh
  blurredLayer(c, L.dpr, s * 0.5, (o) => {
    for (let i = 0; i < 8; i++) {
      const col = ['255,150,70', '255,90,50', '255,190,90'][i % 3];
      const x = r() * w;
      const y = hz * (0.15 + r() * 0.7);
      const rad = s * (0.9 + r() * 1.6);
      o.fillStyle = `rgba(${col},${0.04 + r() * 0.05})`;
      disc(o, x, y, rad);
      o.strokeStyle = `rgba(${col},.06)`;
      o.lineWidth = s * 0.08;
      o.stroke();
    }
  });
  // out-of-focus garland across the top of the frame
  const lights = Array.from({ length: 15 }, (_, k) => {
    const f = k / 14;
    return {
      x: -w * 0.04 + f * w * 1.08,
      y: h * 0.035 + Math.sin(f * Math.PI) * h * 0.13 + (r() - 0.5) * s * 0.2,
      col: ['255,176,90', '255,120,70', '255,214,150', '255,150,80'][k % 4],
      rad: s * (0.42 + r() * 0.28),
    };
  });
  blurredLayer(c, L.dpr, s * 0.5, (o) => {
    for (const l of lights) {
      o.fillStyle = `rgba(${l.col},.10)`;
      disc(o, l.x, l.y, l.rad * 2.2);
    }
  });
  blurredLayer(c, L.dpr, s * 0.22, (o) => {
    for (const l of lights) {
      o.fillStyle = `rgba(${l.col},.22)`;
      disc(o, l.x, l.y, l.rad);
      o.strokeStyle = `rgba(${l.col},.30)`;
      o.lineWidth = s * 0.05;
      o.stroke();
    }
  });
  // wood floor
  const fg = c.createLinearGradient(0, hz, 0, h);
  fg.addColorStop(0, 'rgba(255,170,100,.06)');
  fg.addColorStop(0.2, 'rgba(0,0,0,0)');
  c.fillStyle = fg;
  c.fillRect(0, hz, w, h - hz);
  c.strokeStyle = 'rgba(0,0,0,.25)';
  c.lineWidth = 1;
  for (let y = hz + s * 0.3; y < h; y += s * 0.42 + (y - hz) * 0.08) {
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(w, y);
    c.stroke();
  }
}

/** Secret mode's sky (spec 2026-10-08 secret mode §2.2): violet at the horizon, stars, a faint baked haze, snow. The curtains are aurora.ts's. */
function paintAurora(c: CanvasRenderingContext2D, L: Layout, r: Rng, hz: number): void {
  const { w, h, s } = L;
  const glow = c.createRadialGradient(w * 0.5, hz, 0, w * 0.5, hz, w * 0.7);
  glow.addColorStop(0, 'rgba(150,110,255,.14)');
  glow.addColorStop(1, 'rgba(150,110,255,0)');
  c.fillStyle = glow;
  c.fillRect(0, 0, w, hz);
  for (let i = 0; i < 140; i++) {
    const x = r() * w;
    const y = r() * hz * 0.75;
    const z = r();
    c.fillStyle = `rgba(225,235,255,${0.05 + z * z * 0.5})`;
    disc(c, x, y, 0.35 + z * 0.75);
  }
  // A faint haze where the curtains hang, so a still frame (reduced motion, the lowest quality tier) still reads as aurora.
  blurredLayer(c, L.dpr, s * 1.2, (o) => {
    o.fillStyle = 'rgba(90,255,180,.06)';
    o.beginPath();
    o.ellipse(w * 0.5, hz * 0.25, w * 0.55, hz * 0.09, 0, 0, TAU);
    o.fill();
  });
  c.strokeStyle = 'rgba(160,190,255,.12)';
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(0, hz);
  c.lineTo(w, hz);
  c.stroke();
  for (let i = 0; i < 160; i++) {
    c.fillStyle = `rgba(200,225,255,${r() * 0.3})`;
    c.fillRect(r() * w, hz + r() * (h - hz), 1, 1);
  }
}

function paintDaylight(c: CanvasRenderingContext2D, L: Layout, hz: number): void {
  const { w, h, s } = L;
  const rg = c.createRadialGradient(w * 0.5, hz, 0, w * 0.5, hz, w * 0.7);
  rg.addColorStop(0, 'rgba(255,255,255,.7)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = rg;
  c.fillRect(0, 0, w, h);
  const mist = c.createLinearGradient(0, hz - s * 2.2, 0, hz);
  mist.addColorStop(0, 'rgba(170,190,200,0)');
  mist.addColorStop(1, 'rgba(170,190,200,.28)');
  c.fillStyle = mist;
  c.fillRect(0, hz - s * 2.2, w, s * 2.2);
  c.fillStyle = '#fbfcfd';
  c.fillRect(0, hz, w, h - hz);
  const shade = c.createLinearGradient(0, hz, 0, hz + s * 1.2);
  shade.addColorStop(0, 'rgba(120,150,170,.10)');
  shade.addColorStop(1, 'rgba(120,150,170,0)');
  c.fillStyle = shade;
  c.fillRect(0, hz, w, s * 1.2);
  blurredLayer(c, L.dpr, s * 0.3, (o) => {
    o.fillStyle = 'rgba(80,110,130,.20)';
    o.beginPath();
    o.ellipse(X(L, 1.2), Y(L, 10.3), s * 9.5, s * 0.45, 0, 0, TAU);
    o.fill();
  });
}
