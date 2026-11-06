/**
 * The strands' wire (season two, C3; ported from the lab's strands-wire): each strand brings its own, run between the end
 * tiles in place of the light path (Decision 10). Unlit and fully lit wires are cached sprites per tile shape; a tile
 * mid-fill draws its lit part live (a few frames per tile, then it switches to the sprite).
 */
import type { StrandKind } from '../../store/look';
import { heads, type Prim } from '../geometry';
import { GLINT_NEAR, GLINT_WIDE, type LitArgs } from '../paths';
import type { Scene } from '../scenes';
import { blit, css, devScale, lerp3, mul3, paintChain, paintCord, rgb, sprite, strokeAll, TAU, WHITE, type ChainLook, type CordLook, type RGB } from './kit';

/** A strand other than the game's own bulbs. */
export type StrandId = Exclude<StrandKind, 'bulbs'>;

const day = (sc: Scene): boolean => sc.light === 'day';

/** A tile's wire shape as a cache key (order-free, so the lit and unlit geometry share it). */
export function primsKey(prims: readonly Prim[]): string {
  return prims
    .map((p) => (p.kind === 'line' ? `l${p.x0 + p.x1},${p.y0 + p.y1}` : `a${p.cx},${p.cy}`))
    .sort()
    .join('');
}

const sceneKey = (sc: Scene): string => `${sc.id}|${sc.light}|${sc.glow}|${sc.core}`;

/* ---------- looks ---------- */

/** Bubble lights: a period two-strand cotton-covered cord, dark green-brown, warm when lit. */
function bubbleCord(sc: Scene, lit: boolean): CordLook {
  const w = 0.078;
  const half = 0.042;
  if (lit) {
    const glow = rgb(sc.glow);
    return {
      w, half,
      under: css(glow, 0.22), underW: 2.0,
      under2: css(lerp3(glow, WHITE, 0.45), 0.5), under2W: 1.25,
      core: sc.core, coreW: 0.7,
      strand: lerp3(rgb(sc.core), lerp3(glow, [255, 200, 96], 0.6), 0.3), back: 0.86, hi: 'rgba(255,253,246,.95)',
    };
  }
  if (day(sc)) {
    return {
      w, half,
      under: GLINT_WIDE, underW: 3.6, under2: GLINT_NEAR, under2W: 2.4,
      strand: [92, 84, 58], back: 0.72, hi: 'rgba(255,248,226,.9)',
    };
  }
  const fire = sc.light === 'fire';
  return {
    w, half,
    under: 'rgba(0,0,0,.18)', underW: 1.5,
    strand: fire ? [74, 62, 38] : [58, 62, 48], back: 0.62, hi: fire ? 'rgba(236,200,146,.62)' : 'rgba(200,214,224,.55)',
  };
}

/** C9: the thick green twisted pair of the 1950s–60s outdoor strings. */
function c9Cord(sc: Scene, lit: boolean): CordLook {
  const w = 0.1;
  const half = 0.05;
  if (lit) {
    const glow = rgb(sc.glow);
    return {
      w, half,
      under: css(glow, 0.3), underW: 1.9,
      under2: css(lerp3(glow, WHITE, 0.25), 0.5), under2W: 1.15,
      core: sc.core, coreW: 0.62,
      strand: lerp3([84, 168, 88], [255, 226, 160], 0.56), back: 0.8, hi: 'rgba(255,252,236,.95)',
    };
  }
  if (day(sc)) {
    return {
      w, half,
      under: GLINT_WIDE, underW: 3.0, under2: GLINT_NEAR, under2W: 2.0,
      strand: [58, 116, 76], back: 0.7, hi: 'rgba(236,255,240,.85)',
    };
  }
  return {
    w, half,
    under: 'rgba(0,0,0,.2)', underW: 1.45,
    strand: sc.light === 'fire' ? [48, 92, 52] : [42, 92, 70], back: 0.6, hi: sc.light === 'fire' ? 'rgba(220,230,170,.55)' : 'rgba(190,230,214,.55)',
  };
}

/** Victorian candles: a fine brass chain. */
function candleChain(sc: Scene, lit: boolean): ChainLook {
  const link = 0.085;
  const wire = 0.017;
  if (lit) {
    const glow = rgb(sc.glow);
    return {
      link, wire,
      under: css(lerp3(glow, WHITE, 0.2), 0.45), underW: 0.07,
      body: lerp3([255, 214, 140], WHITE, 0.25), hi: '#fffdf6', lo: css(mul3(glow, 0.8), 0.9),
    };
  }
  if (day(sc)) {
    return { link, wire, under: GLINT_NEAR, underW: 0.16, body: [196, 160, 92], hi: 'rgba(255,250,228,.95)', lo: 'rgba(60,42,18,.55)' };
  }
  return { link, wire, under: 'rgba(0,0,0,.16)', underW: 0.07, body: sc.light === 'fire' ? [170, 128, 66] : [150, 132, 100], hi: 'rgba(255,232,180,.8)', lo: 'rgba(0,0,0,.45)' };
}

/* ---------- junction nodes ---------- */

function paintNode(c: CanvasRenderingContext2D, id: StrandId, sc: Scene, lit: boolean): void {
  if (id === 'candle') {
    // A small brass ring where the chains meet.
    const look = candleChain(sc, lit);
    c.lineWidth = look.wire * 1.6;
    c.strokeStyle = look.lo;
    c.beginPath();
    c.arc(0.004, 0.006, 0.036, 0, TAU);
    c.stroke();
    c.strokeStyle = css(look.body);
    c.beginPath();
    c.arc(0, 0, 0.036, 0, TAU);
    c.stroke();
    c.strokeStyle = look.hi;
    c.lineWidth = look.wire * 0.6;
    c.beginPath();
    c.arc(0, 0, 0.036, Math.PI * 1.05, Math.PI * 1.6);
    c.stroke();
    return;
  }
  // A moulded splice: a rounded block in the cord's colour.
  const look = id === 'bubble' ? bubbleCord(sc, lit) : c9Cord(sc, lit);
  const r = look.w * 0.85;
  const base: RGB = look.strand;
  const gr = c.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
  gr.addColorStop(0, css(lerp3(base, WHITE, lit ? 0.6 : 0.35)));
  gr.addColorStop(0.5, css(base));
  gr.addColorStop(1, css(mul3(base, lit ? 0.85 : 0.55)));
  c.fillStyle = gr;
  c.beginPath();
  c.arc(0, 0, r, 0, TAU);
  c.fill();
}

/* ---------- per-frame entry points ---------- */

const BOX = [-0.62, -0.62, 1.24, 1.24] as const;

function paintWire(c: CanvasRenderingContext2D, id: StrandId, prims: readonly Prim[], sc: Scene, lit: boolean): void {
  if (id === 'candle') paintChain(c, prims, candleChain(sc, lit));
  else paintCord(c, prims, id === 'bubble' ? bubbleCord(sc, lit) : c9Cord(sc, lit));
  if (prims.length > 2) paintNode(c, id, sc, lit);
}

export function wireUnlit(c: CanvasRenderingContext2D, id: StrandId, prims: readonly Prim[], s: number, sc: Scene): void {
  if (prims.length === 0) return;
  const sp = sprite(`w|${id}|0|${sceneKey(sc)}|${primsKey(prims)}`, s, devScale(c), BOX, (cc) => paintWire(cc, id, prims, sc, false));
  blit(c, sp);
}

/** The lit wire's light on the glow layer (bloomed). */
export function wireGlow(g: CanvasRenderingContext2D, id: StrandId, prims: readonly Prim[], s: number, sc: Scene, a: LitArgs): void {
  g.save();
  g.scale(s, s);
  g.lineCap = 'round';
  g.globalAlpha = a.alpha * (id === 'candle' ? 0.85 : 1);
  g.strokeStyle = sc.glow;
  g.lineWidth = id === 'candle' ? 0.15 : id === 'c9' ? 0.2 : 0.19;
  strokeAll(g, prims, a.q);
  g.globalAlpha = a.alpha;
  g.fillStyle = '#fff';
  for (const [x, y] of heads(prims, a.q)) {
    g.beginPath();
    g.arc(x, y, 0.34, 0, TAU);
    g.fill();
  }
  g.restore();
}

/** The lit wire, crisp, on the main canvas after bloom. */
export function wireLit(c: CanvasRenderingContext2D, id: StrandId, prims: readonly Prim[], s: number, sc: Scene, a: LitArgs): void {
  if (prims.length === 0) return;
  c.save();
  c.globalAlpha = a.alpha;
  if (a.q >= 1) {
    blit(c, sprite(`w|${id}|1|${sceneKey(sc)}|${primsKey(prims)}`, s, devScale(c), BOX, (cc) => paintWire(cc, id, prims, sc, true)));
  } else {
    // Mid-fill (a few frames): the light running along a plain core, with its hot head.
    c.scale(s, s);
    c.lineCap = 'round';
    c.strokeStyle = sc.core;
    c.lineWidth = id === 'c9' ? 0.07 : 0.055;
    strokeAll(c, prims, a.q);
    c.fillStyle = '#fff';
    for (const [x, y] of heads(prims, a.q)) {
      c.beginPath();
      c.arc(x, y, 0.085, 0, TAU);
      c.fill();
    }
  }
  c.restore();
}
