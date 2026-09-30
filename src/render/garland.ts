import { mix, rgba, shade } from './color';
import type { Scene } from './scenes';

/**
 * Garland progress (spec §4.8): a swag of C9 bulbs on a dark wire across the top of the frame, below the HUD.
 * Bulb k of n lights once the lit fraction reaches (k + 1) / n. Drawn in screen space (it does not zoom with the
 * board) and lit bulbs feed the glow layer, so they take bloom like the tree's bulbs.
 */

const TAU = Math.PI * 2;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export const GARLAND_FADE_MS = 170;
/** Win: every bulb blazes (a wave out from the centre), then settles into a gentle chase. */
export const BLAZE_MS = 1600;

export interface GarlandBulb {
  /** Where the socket clips onto the wire (CSS px). */
  x: number;
  y: number;
  /** Hang angle in radians; 0 points straight down. */
  angle: number;
}

export interface GarlandGeometry {
  n: number;
  /** Anchor height of the wire at the ends and the centre (CSS px). */
  y0: number;
  sag: number;
  /** Length of a bulb's glass (CSS px); the socket adds ~0.36 of this. */
  size: number;
  /** Swag spans as [x0, x1] pairs; each is a parabola from y0 down by `sag` and back. */
  swags: readonly (readonly [number, number])[];
  bulbs: readonly GarlandBulb[];
  /** Lowest point of any bulb (CSS px). */
  bottom: number;
}

/** Number of lit garland bulbs: bulb k lights once `frac ≥ (k + 1) / n`. */
export function garlandLitCount(frac: number, n: number): number {
  return Math.max(0, Math.min(n, Math.floor(frac * n + 1e-9)));
}

export function garlandWireY(g: Pick<GarlandGeometry, 'y0' | 'sag' | 'swags'>, x: number): number {
  for (const [a, b] of g.swags) {
    if (x >= a && x <= b) {
      const k = (x - a) / (b - a);
      return g.y0 + g.sag * 4 * k * (1 - k);
    }
  }
  return g.y0;
}

function wireSlope(g: Pick<GarlandGeometry, 'y0' | 'sag' | 'swags'>, x: number): number {
  for (const [a, b] of g.swags) {
    if (x >= a && x <= b) return (g.sag * 4 * (1 - 2 * ((x - a) / (b - a)))) / (b - a);
  }
  return 0;
}

/** Socket + glass extent below the clip point, in multiples of `size`. */
const BULB_REACH = 1.38;

/**
 * Lays the swag out for a viewport. `chromeBottom` is the lowest edge of the wordmark and HUD (CSS px), so the wire
 * always hangs clear below them. `s` is the tile size; it keeps the two centre bulbs clear of the star.
 */
export function garlandGeometry(w: number, s: number, chromeBottom: number): GarlandGeometry {
  const phone = w < 600;
  const n = phone ? 12 : 18;
  const m = n / 2;
  const y0 = Math.round(chromeBottom + (phone ? 10 : 9));
  const size = phone ? 13 : Math.min(21, Math.max(13, s * 0.33));
  const sag = phone ? 24 : Math.min(40, Math.max(26, w * 0.026));
  const swags: [number, number][] = [
    [-0.03 * w, w / 2],
    [w / 2, 1.03 * w],
  ];
  const half = w / 2;
  const pitch = half / m;
  const inset = pitch * 0.55;
  const centreGap = Math.max(pitch / 2, 0.95 * s);
  const bulbs: GarlandBulb[] = [];
  const geo = { y0, sag, swags };
  for (let k = 0; k < n; k++) {
    const j = k < m ? k : n - 1 - k;
    const off = inset + (j * (half - inset - centreGap)) / (m - 1);
    const x = k < m ? off : w - off;
    const y = garlandWireY(geo, x);
    bulbs.push({ x, y, angle: -Math.atan(wireSlope(geo, x)) * 0.7 });
  }
  let bottom = 0;
  for (const b of bulbs) bottom = Math.max(bottom, b.y + size * BULB_REACH * Math.cos(b.angle) + 2);
  return { n, y0, sag, size, swags, bulbs, bottom };
}

/* ---------- drawing ---------- */

/** C9 glass outline in bulb space (y down from the clip point), scaled by `z`. */
function glassPath(c: CanvasRenderingContext2D, z: number): void {
  const g0 = 0.36 * z;
  c.beginPath();
  c.moveTo(-0.2 * z, g0);
  c.bezierCurveTo(-0.42 * z, g0 + 0.16 * z, -0.36 * z, g0 + 0.62 * z, -0.09 * z, g0 + 0.95 * z);
  c.quadraticCurveTo(0, g0 + 1.03 * z, 0.09 * z, g0 + 0.95 * z);
  c.bezierCurveTo(0.36 * z, g0 + 0.62 * z, 0.42 * z, g0 + 0.16 * z, 0.2 * z, g0);
  c.closePath();
}

/** Centre of the glass in bulb space. */
const glassCentre = (z: number): number => 0.36 * z + 0.42 * z;

export class Garland {
  geo: GarlandGeometry = garlandGeometry(1, 8, 0);
  private onAt: number[] = [];
  private offAt: number[] = [];
  private wire: Path2D | null = null;
  private twist: Path2D | null = null;
  private lastCount = -1;

  layout(w: number, s: number, chromeBottom: number): void {
    const prev = this.onAt;
    this.geo = garlandGeometry(w, s, chromeBottom);
    this.onAt = new Array<number>(this.geo.n).fill(-1);
    this.offAt = new Array<number>(this.geo.n).fill(-Infinity);
    for (let k = 0; k < Math.min(prev.length, this.geo.n); k++) this.onAt[k] = prev[k] >= 0 ? 0 : -1;
    this.wire = null;
    this.twist = null;
    this.lastCount = -1;
  }

  /** Switches bulbs on/off from the (visual) lit fraction. */
  update(frac: number, now: number): void {
    const count = garlandLitCount(frac, this.geo.n);
    if (count === this.lastCount) return;
    this.lastCount = count;
    for (let k = 0; k < this.geo.n; k++) {
      const on = k < count;
      if (on && this.onAt[k] < 0) this.onAt[k] = now;
      else if (!on && this.onAt[k] >= 0) {
        this.onAt[k] = -1;
        this.offAt[k] = now;
      }
    }
  }

  /** Brightness of bulb k: 0 = dark glass, 1 = lit, >1 = the ignite pop, the win blaze or the chase peak. */
  amount(k: number, now: number, winAt: number | null, reduced: boolean): number {
    const on = this.onAt[k];
    if (on < 0) return reduced ? 0 : Math.max(0, 1 - (now - this.offAt[k]) / GARLAND_FADE_MS);
    if (reduced) return 1;
    const t = now - on;
    let a = clamp01(t / 70) + 0.75 * Math.exp(-Math.max(0, t) / 190) * clamp01(t / 30);
    if (winAt !== null && now >= winAt) {
      const g = this.geo;
      const w = g.swags[1][0] * 2;
      const tw = now - winAt - (Math.abs(g.bulbs[k].x - w / 2) / (w / 2)) * 380;
      const blaze = tw > 0 ? 0.95 * clamp01(tw / 90) * Math.exp(-tw / 650) : 0;
      const chaseW = smooth(BLAZE_MS - 400, BLAZE_MS + 900, now - winAt);
      const phase = (now - winAt) * 0.0028 - k * 0.62;
      const chase = 0.8 + 0.42 * Math.pow(0.5 + 0.5 * Math.cos(phase), 4);
      a = Math.max(1, a) + blaze;
      a = a * (1 - chaseW) + chase * chaseW;
    }
    return a;
  }

  /** The wire body, plus a second strand that twists around it (a sine about the wire, cached per layout). */
  private wirePaths(): [Path2D, Path2D] {
    if (this.wire && this.twist) return [this.wire, this.twist];
    const body = new Path2D();
    const twist = new Path2D();
    for (const [a, b] of this.geo.swags) {
      const steps = Math.max(48, Math.ceil((b - a) / 2.5));
      for (let i = 0; i <= steps; i++) {
        const x = a + ((b - a) * i) / steps;
        const y = garlandWireY(this.geo, x);
        const ty = y + Math.sin(x * 0.72) * 0.9;
        if (i === 0) {
          body.moveTo(x, y);
          twist.moveTo(x, ty);
        } else {
          body.lineTo(x, y);
          twist.lineTo(x, ty);
        }
      }
    }
    this.wire = body;
    this.twist = twist;
    return [body, twist];
  }

  /** Wire, sockets and dark glass. Screen space (CSS px transform), before bloom so lit halos fall on it. */
  drawBack(c: CanvasRenderingContext2D, sc: Scene): void {
    const g = this.geo;
    const day = sc.light === 'day';
    c.save();
    c.lineCap = 'round';
    c.lineJoin = 'round';
    const [wire, twist] = this.wirePaths();
    // A two-strand twisted wire: a dark body, a second strand wound round it, and a faint lit upper edge.
    c.strokeStyle = day ? 'rgba(18,40,28,.9)' : 'rgba(8,18,11,.95)';
    c.lineWidth = 2.1;
    c.stroke(wire);
    c.strokeStyle = day ? 'rgba(46,86,60,.9)' : 'rgba(34,62,42,.9)';
    c.lineWidth = 1.1;
    c.stroke(twist);
    c.translate(0, -0.7);
    c.strokeStyle = day ? 'rgba(170,205,180,.45)' : 'rgba(150,190,150,.16)';
    c.lineWidth = 0.5;
    c.stroke(wire);
    c.translate(0, 0.7);
    for (let k = 0; k < g.n; k++) {
      const b = g.bulbs[k];
      c.save();
      c.translate(b.x, b.y);
      c.rotate(b.angle);
      this.socket(c, g.size, day);
      this.glassUnlit(c, sc.bulbs[k % sc.bulbs.length], g.size, day);
      c.restore();
    }
    c.restore();
  }

  /** Halos on the glow layer (caller sets a CSS px screen transform). */
  drawGlow(c: CanvasRenderingContext2D, sc: Scene, now: number, winAt: number | null, reduced: boolean): void {
    const g = this.geo;
    for (let k = 0; k < g.n; k++) {
      const a = this.amount(k, now, winAt, reduced);
      if (a <= 0) continue;
      const b = g.bulbs[k];
      const col = sc.bulbs[k % sc.bulbs.length];
      const cy = glassCentre(g.size);
      const x = b.x - Math.sin(b.angle) * cy;
      const y = b.y + Math.cos(b.angle) * cy;
      const rad = g.size * (1.7 + 0.5 * Math.max(0, a - 1)) * Math.min(1, a);
      const gr = c.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, rgba(col, Math.min(1, 0.95 * a)));
      gr.addColorStop(0.3, rgba(col, Math.min(1, 0.4 * a)));
      gr.addColorStop(1, rgba(col, 0));
      c.fillStyle = gr;
      c.fillRect(x - rad, y - rad, 2 * rad, 2 * rad);
    }
  }

  /** Crisp lit glass after bloom (screen space, CSS px transform). */
  drawLit(c: CanvasRenderingContext2D, sc: Scene, now: number, winAt: number | null, reduced: boolean): void {
    const g = this.geo;
    const z = g.size;
    c.save();
    for (let k = 0; k < g.n; k++) {
      const a = this.amount(k, now, winAt, reduced);
      if (a <= 0) continue;
      const b = g.bulbs[k];
      const col = sc.bulbs[k % sc.bulbs.length];
      c.save();
      c.translate(b.x, b.y);
      c.rotate(b.angle);
      const cy = glassCentre(z);
      const gr = c.createRadialGradient(-0.05 * z, cy - 0.12 * z, 0.02 * z, 0, cy, 0.62 * z);
      gr.addColorStop(0, '#ffffff');
      gr.addColorStop(0.22, mix(col, '#ffffff', 0.55));
      gr.addColorStop(0.62, col);
      gr.addColorStop(1, shade(col, 0.78));
      c.globalAlpha = Math.min(1, a);
      c.fillStyle = gr;
      glassPath(c, z);
      c.fill();
      // Filament hot spot and a glass specular that stays visible on the lit bulb.
      if (a > 1) {
        c.globalAlpha = Math.min(1, (a - 1) * 0.9);
        c.globalCompositeOperation = 'lighter';
        const hot = c.createRadialGradient(0, cy - 0.05 * z, 0, 0, cy - 0.05 * z, 0.5 * z);
        hot.addColorStop(0, 'rgba(255,255,255,.9)');
        hot.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = hot;
        glassPath(c, z);
        c.fill();
        c.globalCompositeOperation = 'source-over';
      }
      c.globalAlpha = Math.min(1, a) * 0.55;
      c.fillStyle = '#fff';
      c.beginPath();
      c.ellipse(-0.14 * z, cy - 0.12 * z, 0.045 * z, 0.2 * z, 0.12, 0, TAU);
      c.fill();
      c.restore();
    }
    c.restore();
  }

  private socket(c: CanvasRenderingContext2D, z: number, day: boolean): void {
    const w = 0.4 * z;
    const top = -0.06 * z;
    const h = 0.46 * z;
    const gr = c.createLinearGradient(-w / 2, 0, w / 2, 0);
    gr.addColorStop(0, day ? '#0e2a1b' : '#0a1f13');
    gr.addColorStop(0.38, day ? '#3f7a55' : '#2c5a3c');
    gr.addColorStop(0.62, day ? '#1f4a31' : '#173a25');
    gr.addColorStop(1, '#07160d');
    c.fillStyle = gr;
    c.beginPath();
    c.roundRect(-w / 2, top, w, h, 0.07 * z);
    c.fill();
    // Ridges and the collar where the glass seats.
    c.strokeStyle = 'rgba(0,0,0,.45)';
    c.lineWidth = Math.max(0.6, 0.035 * z);
    c.beginPath();
    c.moveTo(-w / 2, top + h * 0.35);
    c.lineTo(w / 2, top + h * 0.35);
    c.moveTo(-w / 2, top + h * 0.62);
    c.lineTo(w / 2, top + h * 0.62);
    c.stroke();
    c.fillStyle = 'rgba(0,0,0,.35)';
    c.fillRect(-w * 0.55, top + h - 0.05 * z, w * 1.1, 0.07 * z);
  }

  private glassUnlit(c: CanvasRenderingContext2D, col: string, z: number, day: boolean): void {
    const cy = glassCentre(z);
    const gr = c.createRadialGradient(-0.12 * z, cy - 0.16 * z, 0.02 * z, 0, cy, 0.62 * z);
    gr.addColorStop(0, shade(col, day ? 0.95 : 0.72));
    gr.addColorStop(0.45, shade(col, day ? 0.62 : 0.42));
    gr.addColorStop(1, shade(col, day ? 0.34 : 0.2));
    c.fillStyle = gr;
    glassPath(c, z);
    c.fill();
    // Rim light on the far edge, then the specular highlight (spec §4.4: dim glass with a highlight).
    c.save();
    glassPath(c, z);
    c.clip();
    const rim = c.createLinearGradient(-0.4 * z, 0, 0.4 * z, 0);
    rim.addColorStop(0, 'rgba(255,255,255,0)');
    rim.addColorStop(0.8, 'rgba(255,255,255,0)');
    rim.addColorStop(1, `rgba(255,255,255,${day ? 0.3 : 0.16})`);
    c.fillStyle = rim;
    c.fillRect(-0.5 * z, 0, z, 1.5 * z);
    c.restore();
    c.fillStyle = `rgba(255,255,255,${day ? 0.7 : 0.5})`;
    c.beginPath();
    c.ellipse(-0.14 * z, cy - 0.12 * z, 0.045 * z, 0.19 * z, 0.12, 0, TAU);
    c.fill();
    c.fillStyle = `rgba(255,255,255,${day ? 0.55 : 0.35})`;
    c.beginPath();
    c.arc(0.06 * z, cy + 0.36 * z, 0.035 * z, 0, TAU);
    c.fill();
  }
}
