import type { Board } from '../core/board';
import { degree } from '../core/dirs';
import { GRID } from '../core/mask';
import type { EggModules } from '../eggs/load';
import type { Aurora } from './aurora';
import { paintBackdrop, type Backdrop } from './backdrop';
import { drawBlurred } from './blur';
import { drawBulb, drawBulbGlint, drawBulbHalo, drawFaceBulb } from './bulbs';
import type { Camera } from './camera';
import { paintDecor, skirtBottom } from './decor';
import {
  Confetti, Current, Embers, SPARKS, Snowfall, drawFirelight, drawFlashGlows, drawFlashRings, drawFrontier, drawGroundPool,
  drawHover, drawSourceCore, drawSourceGlow, drawStarGlow, easeSnap, starState,
} from './effects';
import type { FaceSprites } from './face-sprites';
import { FACE_ORNAMENT_H } from './bulbs';
import { FACE_GARLAND_H, Garland } from './garland';
import type { HomeAloneLayer } from './home-alone';
import { tileGeometry } from './geometry';
import { Y, computeLayout, tileCenter, type Layout } from './layout';
import { paintBackground } from './paint-background';
import { paintTree } from './paint-tree';
import type { PizzaSprite } from './pizza';
import { STARTER_LOOK, type Dress } from '../store/look';
import { TwinkleClock, drawLitCore, drawLitGlow, drawUnlit, type PathStyle } from './paths';
import { Presents } from './presents';
import { Topper } from './topper';
import { QualityGovernor } from './quality';
import { SCENES, type Scene } from './scenes';
import { SkySweep, type SceneChange } from './sky-sweep';
import { TILE_FILL_MS, type VisualState } from './visual-state';
import type { Opening } from '../ui/opening';

const GLOW_SCALE = 0.5;
/**
 * Bloom passes (spec §4.6): [blur radius in tiles, additive weight, exposure power]. A tight halo that keeps the lit
 * line warm, a soft glow, and a faint atmosphere. Auto-exposure bites hardest on the wide passes, which are what fog
 * a well-lit tree, and least on the tight halo.
 */
const BLOOM: readonly (readonly [number, number, number])[] = [
  [0.14, 0.95, 0.5],
  [0.45, 0.55, 1],
  [1.3, 0.22, 2],
];
/** Auto-exposure (spec §4.5 item 8): exposure = 1 − DROP · litFraction^POW, raised to each pass's power. */
const EXPOSURE_DROP = 0.5;
const EXPOSURE_POW = 1.3;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** How much of a feature shows during a fade at `alpha`: the leaving scene's (`had`) at 1 − alpha, the arriving one's (`has`) at alpha. */
export const share = (had: boolean, has: boolean, alpha: number): number => (had ? 1 - alpha : 0) + (has ? alpha : 0);

/** Secret mode's beat (spec 2026-10-08 secret mode §5): when the last onset landed, how hard (0.3..1), the palette step. */
export interface BeatFrame {
  at: number;
  strength: number;
  hue: number;
}

export interface FrameInput {
  board: Board;
  vis: VisualState;
  now: number;
  dt: number;
  camera: Camera;
  hover: number;
  revealAt: number;
  winAt: number | null;
  reducedMotion: boolean;
  /** Light show (Plan 2): extra brightness for a bulb tile. */
  extraBulb?: (tile: number) => number;
  /** Light show (Plan 2): low-band energy 0..1 that breathes the ground pool and star. */
  ambient?: number;
  /** Light show: high-band energy 0..1 that speeds the fairy twinkle and the filament sparkle rate. */
  highs?: number;
  /** A calm frame (ambient motion only, drawn at a reduced rate): its long interval says nothing about the device. */
  calm?: boolean;
  /** Secret mode while music drives it: the nod, the bulb pulse, the palette step and the garland face's bob. */
  beat?: BeatFrame;
  /** The first-visit opening: while it is on, its darkness and lights are the last thing drawn. */
  opening?: Opening;
}

function ctx2d(c: HTMLCanvasElement, opts?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D {
  const x = c.getContext('2d', opts);
  if (!x) throw new Error('Canvas 2D is unavailable');
  return x;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly glow = document.createElement('canvas');
  private readonly g: CanvasRenderingContext2D;
  /** The scene's backdrop (`sky.bg`), and the sky sweep when secret mode is switched by hand (spec 2026-10-08 secret mode §2.4). */
  private readonly sky = new SkySweep();
  /** The eggs (src/eggs/load.ts), once loaded: until then their layers below are null and draw nothing. */
  private eggs: EggModules | null = null;
  /** Secret mode's curtains (spec 2026-10-08 secret mode §2). */
  private aurora: Aurora | null = null;
  /**
   * The scene's own room's per-frame parts (the Sash's window snow, the Parlour's candles), and whose they are; null for a
   * painted-once sky.
   */
  private backdrop: Backdrop | null = null;
  private backdropOf: Scene['id'] | null = null;
  /** The layout and sky canvas the backdrop was painted for: a dress change (a live pick) keeps it, and its falling snow. */
  private backdropAt: { layout: Layout; bg: HTMLCanvasElement } | null = null;
  private readonly tree = document.createElement('canvas');
  layout: Layout = computeLayout(1, 1, 1);
  scene: Scene = SCENES.fireside;
  style: PathStyle = 'filament';
  /** What the tree is dressed with, from the look (src/store/look.ts). */
  private dress: Dress = { palette: STARTER_LOOK.palette, topper: STARTER_LOOK.topper, decor: STARTER_LOOK.decor, presents: STARTER_LOOK.presents, pile: Infinity };
  readonly quality = new QualityGovernor();
  private readonly snow = new Snowfall();
  private readonly embers = new Embers();
  private readonly current = new Current();
  private readonly twinkle = new TwinkleClock();
  private readonly confetti = new Confetti();
  /** Home Alone's confetti: Little Nero's slices (spec 2026-10-14 §6). */
  private pizza: PizzaSprite | null = null;
  readonly garland = new Garland();
  /** Home Alone mode's window gags and traps (spec 2026-10-14). */
  homeAlone: HomeAloneLayer | null = null;
  private readonly presents = new Presents();
  /** The star on top, or the star-head egg's sticker (src/render/topper.ts). */
  readonly topper = new Topper();
  /** Secret mode's faces, from the topper's sticker (spec 2026-10-08 secret mode §3). */
  faces: FaceSprites | null = null;
  /** The presents and garland were last laid out with the faces. */
  private faced = false;
  /** The face ornament's tile, worked out once per tree. */
  private faceBoard: Board | null = null;
  private faceTile = -1;
  /** Fraction of tiles whose light has visibly arrived (last frame). */
  private visFrac = 0;
  /** Set by the first resize: until then a scene change has nothing to repaint. */
  private sized = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    // Opaque: the background covers every pixel, so the compositor needn't blend the stage with the page.
    this.ctx = ctx2d(canvas, { alpha: false });
    this.g = ctx2d(this.glow);
    this.topper.setKind(this.dress.topper);
  }

  /**
   * The eggs have loaded: their layers come into being (the app switches an egg on only after this). Only a stage
   * already showing an egg's scene (the house's room, the aurora's faces) is painted again: the load usually lands as
   * the first tree takes taps, and a repaint there would be a burst of work at the start of a run for nothing.
   */
  attachEggs(e: EggModules): void {
    if (this.eggs) return;
    this.eggs = e;
    this.aurora = new e.aurora.Aurora();
    this.pizza = new e.pizza.PizzaSprite();
    this.homeAlone = new e.homeAlone.HomeAloneLayer(this.garland);
    this.faces = new e.faceSprites.FaceSprites(() => this.topper.image);
    this.topper.attachBeat(e.beatFx);
    if (this.sized && (this.secret || this.scene.id === 'home-alone')) this.repaint();
  }

  /** `chromeBottom`: lowest edge of the wordmark and HUD in CSS px (the garland hangs below it). */
  resize(w: number, h: number, dpr: number, chromeBottom = w < 600 ? 46 : 58): void {
    this.sky.end();
    for (const c of [this.canvas, this.sky.bg, this.tree]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    this.glow.width = Math.round(w * dpr * GLOW_SCALE);
    this.glow.height = Math.round(h * dpr * GLOW_SCALE);
    this.layout = computeLayout(w, h, dpr);
    this.garland.layout(w, this.layout.s, chromeBottom);
    this.sized = true;
    this.repaint();
  }

  /**
   * Switches the scene. With `change` (secret mode switched by hand) and a change into or out of the aurora, the sky
   * sweeps from `change.now` (spec §2.4); with `kind: 'fade'` (Home Alone switched by hand) the backdrop cross-fades
   * over FADE_MS (spec 2026-10-14 §1). The tree, presents and garland change at once.
   */
  setScene(scene: Scene, change: SceneChange | null = null): void {
    if (scene === this.scene) return;
    this.sky.change(this.scene, scene, change, this.sized);
    this.scene = scene;
    if (this.sized) this.repaint();
  }

  setStyle(style: PathStyle): void {
    this.style = style;
    this.current.clear();
  }

  /**
   * The tree's dress: the topper, decorations and presents are drawn from it. The palette is kept but never read here:
   * it reaches the stage as the scene's colours (setScene), so a palette alone repaints nothing. Says whether it
   * repainted (a change, on a sized stage), so the share image can follow.
   */
  setDress(d: Dress): boolean {
    const same = this.dress.topper === d.topper && this.dress.presents === d.presents && this.dress.pile === d.pile &&
      (Object.keys(d.decor) as (keyof Dress['decor'])[]).every((k) => this.dress.decor[k] === d.decor[k]);
    this.dress = d;
    if (same) return false;
    this.topper.setKind(d.topper);
    if (!this.sized) return false;
    this.repaint();
    return true;
  }

  /** Secret mode: the aurora scene is up. */
  get secret(): boolean {
    return this.scene.id === 'aurora';
  }

  /** A sky sweep is under way (the e2e probe). */
  get sweeping(): boolean {
    return this.sky.current !== null;
  }

  /** The house is on the stage, or still fading out: its window gags keep moving until it has gone. */
  get homeAloneShowing(): boolean {
    const run = this.sky.current;
    return this.scene.id === 'home-alone' || (run !== null && run.kind === 'fade' && run.fromScene.id === 'home-alone');
  }

  /** Top of the star (CSS px, identity camera). */
  starTop(): number {
    return Y(this.layout, -1.3) - 0.8 * this.layout.s;
  }

  /** Device-pixel rectangle around the tree and its presents (share image). Valid for the identity camera. */
  treeRect(): { x: number; y: number; w: number; h: number } {
    const L = this.layout;
    let x0 = L.ox - 10.5 * L.s;
    let x1 = L.ox + 10.5 * L.s;
    const y0 = Y(L, -2.8);
    let y1 = Y(L, 10.8);
    // The skirt's fur and floor shadow hang below the tree's own rows.
    if (this.dress.decor.skirt) y1 = Math.max(y1, skirtBottom(L));
    const gifts = this.presents.bounds();
    if (gifts) {
      x0 = Math.min(x0, gifts.x0 - 0.3 * L.s);
      x1 = Math.max(x1, gifts.x1 + 0.3 * L.s);
      y1 = Math.max(y1, gifts.y1 + 0.3 * L.s);
    }
    const x = Math.max(0, x0 * L.dpr);
    const y = Math.max(0, y0 * L.dpr);
    return { x, y, w: Math.min(this.canvas.width, x1 * L.dpr) - x, h: Math.min(this.canvas.height, y1 * L.dpr) - y };
  }

  private repaint(): void {
    // The room the backdrop paints depends on the layout and the scene's id alone: kept unless either (or the sky's canvas,
    // which a sweep or fade swaps) has changed since it was painted.
    const at = this.backdropAt;
    const keep = this.backdrop !== null && this.backdropOf === this.scene.id && at !== null && at.layout === this.layout && at.bg === this.sky.bg;
    if (!keep) {
      const bg = ctx2d(this.sky.bg);
      this.backdrop = paintBackdrop(bg, this.layout, this.scene);
      this.backdropOf = this.backdrop ? this.scene.id : null;
      this.backdropAt = this.backdrop ? { layout: this.layout, bg: this.sky.bg } : null;
      if (!this.backdrop) paintBackground(bg, this.layout, this.scene, this.eggs?.homeAloneRoom.paintHomeAlone ?? null);
    }
    const tree = ctx2d(this.tree);
    paintTree(tree, this.layout, this.scene);
    // The decorations go on the tree layer, which is drawn before every wire, glass and bulb: they never cover one.
    tree.setTransform(this.layout.dpr, 0, 0, this.layout.dpr, 0, 0);
    paintDecor(tree, this.layout, this.scene, this.dress.decor);
    tree.setTransform(1, 0, 0, 1, 0, 0);
    this.topper.prepare(this.layout, this.scene);
    this.layFaces();
  }

  /** Presents and garland: in secret mode, once the sticker has loaded, with the face paper and the face bulb. */
  private layFaces(): void {
    const faces = this.readyFaces();
    this.presents.layout(this.layout, GRID, this.scene, faces, this.dress.presents, this.dress.pile);
    this.garland.paint(this.scene, this.layout.dpr, faces && this.eggs ? this.eggs.faces.faceGarlandIndex(this.garland.geo) : -1);
    this.faced = faces !== null;
  }

  /** The faces, in secret mode with the sticker loaded (and the eggs: the faces are one); else null. */
  private readyFaces(): FaceSprites | null {
    return this.secret && this.faces?.ready ? this.faces : null;
  }

  /** Where the faces are (the e2e probe): the ornament's tile, the present and the garland bulb, or -1. */
  faceInfo(): { tile: number; gift: number; garland: number } {
    return { tile: this.readyFaces() ? this.faceTile : -1, gift: this.presents.faceIndex, garland: this.garland.face };
  }

  frame(f: FrameInput): void {
    const workStart = performance.now();
    this.draw(f);
    // The rAF interval catches GPU-bound devices; the work time lets a steady 30 Hz cap (iOS Low Power Mode) pass.
    // A calm frame's interval is by design (28 ms or more), so it must not read as a slow device.
    if (!f.calm) this.quality.sample(f.dt, performance.now() - workStart);
  }

  private draw(f: FrameInput): void {
    const { board, vis, now, camera: cam } = f;
    const L = this.layout;
    const s = L.s;
    const sc = this.scene;
    const style = this.style;
    const ctx = this.ctx;
    const g = this.g;
    const dpr = L.dpr;
    const tier = this.quality.tier;
    const won = f.winAt !== null;
    const litFrac = won ? 1 : board.lighting.count / GRID.ids.length;
    const motionDt = f.reducedMotion ? 0 : f.dt;
    const density = tier >= 2 ? 0.5 : 1;
    const world = (c: CanvasRenderingContext2D, k: number) => c.setTransform(k * cam.scale, 0, 0, k * cam.scale, k * cam.tx, k * cam.ty);

    vis.prune(now);
    // The eggs' layers (null until the eggs have loaded: no egg is on before then, so none is drawn).
    const eggs = this.eggs;
    const aurora = this.aurora;
    const homeAlone = this.homeAlone;
    // Secret mode's faces: lay the presents and garland out again once the sticker arrives; one ornament per tree.
    const secret = this.secret;
    const faces = this.readyFaces();
    if (faces && !this.faced) this.layFaces();
    // …and plain again if the faces can no longer be drawn (a lost 2D context), rather than a bulb with no glass.
    else if (this.faced && !faces) this.layFaces();
    if (secret && eggs && board !== this.faceBoard) {
      this.faceBoard = board;
      this.faceTile = eggs.faces.faceBulbTile(board.solution, GRID.ids);
    }
    const faceTile = faces ? this.faceTile : -1;
    const facePx = FACE_ORNAMENT_H * s * dpr * cam.scale;
    // On the beat (spec 2026-10-08 secret mode §5.3); no palette step under reduced motion.
    const beatAt = f.beat ? f.beat.at : Number.NEGATIVE_INFINITY;
    const beatPower = f.beat ? f.beat.strength : 0;
    const hue = f.beat && !f.reducedMotion ? f.beat.hue : 0;
    // The beat's flash is the same for every lit bulb: worked out once a frame.
    const pulse = f.beat && eggs ? eggs.beatFx.beatPulse(now - f.beat.at, f.beat.strength, f.reducedMotion) : 0;
    const nb = sc.bulbs.length;
    this.topper.nod(beatAt, beatPower);
    const highs = f.highs ?? 0;
    const twinkleT = this.twinkle.step(f.dt, highs);
    if (style === 'filament' && tier < 2) this.current.step(board, vis, now, f.dt, 1 + 2 * highs);
    else this.current.clear();

    // 1. Background (screen space) + dynamic back layers. Secret mode adds the aurora's curtains; a sweep brings them in or out.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const fr = this.sky.frame(now);
    const sw = this.sky.current;
    // The scene's own room, while no sweep or fade is over it: its motion and its glow are drawn (else null).
    const room = !sw && this.backdropOf === sc.id ? this.backdrop : null;
    // During a sweep, firelight and embers belong to the non-aurora side of the sky.
    let back = sc;
    // During a fade, the scene it leaves and the arriving one's alpha (else null and -1).
    let leaving: Scene | null = null;
    let fadeA = -1;
    if (fr && sw && sw.kind === 'fade') {
      // Home Alone's cross-fade (spec 2026-10-14 §1): the old backdrop, the new one over it. The firelight, embers and
      // snow of each side fade with it. Leaving the aurora (kevin mid-head), its curtains fade out with its sky.
      leaving = sw.fromScene;
      fadeA = fr.alpha;
      ctx.drawImage(sw.from, 0, 0);
      if (sw.fromScene.id === 'aurora' && aurora) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        aurora.draw(ctx, L, now, tier, f.reducedMotion);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }
      ctx.globalAlpha = fr.alpha;
      ctx.drawImage(this.sky.bg, 0, 0);
      ctx.globalAlpha = 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    } else if (fr && sw && aurora) {
      // (A sweep only ever starts with the eggs loaded: the head's switch waits for them.)
      if (sw.dir === 'down') back = sw.fromScene;
      // The non-aurora sky in full; the aurora's backdrop and curtains over the covered part; the hem at its edge.
      ctx.drawImage(sw.dir === 'down' ? sw.from : this.sky.bg, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const y = fr.cover * L.h;
      if (y > 0 && fr.alpha > 0) {
        ctx.save();
        aurora.clipSky(ctx, L, y, fr.edge, now);
        ctx.globalAlpha = fr.alpha;
        // Device pixels, 1:1 (the clip survives the transform change): no resampling at fractional DPRs.
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(sw.dir === 'down' ? this.sky.bg : sw.from, 0, 0);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        aurora.draw(ctx, L, now, tier, f.reducedMotion, fr.alpha);
        ctx.restore();
      }
      aurora.drawSeam(ctx, L, y, fr.edge, now);
    } else {
      ctx.drawImage(this.sky.bg, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // The room's own motion: the Sash's snow, the Parlour's candles, coals, clock and window snow (ambient: it may
      // drop to the calm rate). A sweep or fade (about a second) shows none, nor its glow below.
      room?.back(ctx, now, f.reducedMotion, tier);
      if (this.secret) aurora?.draw(ctx, L, now, tier, f.reducedMotion);
    }
    // Home Alone's window gags, behind the tree (spec 2026-10-14 §3): faded with the house, never during a sweep.
    const ha = eggs && homeAlone ? eggs.homeAlone.homeAloneAlpha(sc, sw, fr) : 0;
    if (ha > 0) homeAlone?.drawWindow(ctx, L, ha, f.reducedMotion);
    else if (sc.id !== 'home-alone') homeAlone?.reset(); // gone (faded out, or switched at once): a walk ends with it
    const fire = leaving ? share(leaving.light === 'fire', sc.light === 'fire', fadeA) : back.light === 'fire' ? 1 : 0;
    if (fire > 0) drawFirelight(ctx, L, now, fire);
    const embers = leaving ? share(leaving.embers, sc.embers, fadeA) : back.embers ? 1 : 0;
    if (embers > 0 && tier < 3) {
      ctx.globalAlpha = embers;
      this.embers.draw(ctx, L, motionDt, now);
      ctx.globalAlpha = 1;
    }
    this.drawSnow(sc, leaving, fadeA, false, motionDt, now, density);

    // 2. Tree + hover (world space)
    world(ctx, dpr);
    ctx.drawImage(this.tree, 0, 0, L.w, L.h);
    // Presents catch the tree's light: dark when unlit, warming as it lights (spec §4.8).
    const warm = (sc.light === 'day' ? 0.45 : 1) * (0.05 + 0.95 * Math.pow(this.visFrac, 0.85)) * (1 + (f.ambient ?? 0) * 0.3);
    this.presents.draw(ctx, warm);
    if (f.hover >= 0 && !won) drawHover(ctx, L, f.hover, sc);

    // Garland wire, sockets and dark glass (screen space; lit halos bloom over them), then back to world space
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.garland.drawBack(ctx);
    world(ctx, dpr);

    // 3. Pass 1: unlit wires + glass on main; lit glow on the half-res glow layer
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.glow.width, this.glow.height);
    world(g, dpr * GLOW_SCALE);
    let visLit = 0;
    for (const i of GRID.ids) {
      const row = Math.floor(i / GRID.w);
      const reveal = clamp01((now - f.revealAt - (GRID.h - 1 - row) * 55) / 380);
      if (reveal <= 0) continue;
      const [cx, cy] = tileCenter(L, GRID, i);
      const rot = board.rotating.get(i);
      const shown = rot ? rot.from : board.bits[i];
      const angle = rot ? rot.dir * (Math.PI / 2) * easeSnap(clamp01((now - rot.t0) / board.rotateMs)) : 0;
      const k = f.reducedMotion ? 1 : vis.settleScale(i, now);
      const isBulb = degree(board.solution[i]) === 1;
      ctx.save();
      ctx.globalAlpha = reveal;
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.scale(k, k);
      drawUnlit(ctx, tileGeometry(shown, 0), s, sc, style);
      if (isBulb) {
        const face = i === faceTile && faces ? faces.get('ornament', facePx, false) : null;
        if (face) drawFaceBulb(ctx, shown, 0, s, sc, face, angle);
        else drawBulb(ctx, shown, sc.bulbs[board.colors[i]], 0, s, sc, style);
      }
      ctx.restore();

      const { q, alpha } = vis.fill(board, i, now);
      if (alpha <= 0) continue;
      if (q >= 1 && board.lighting.lit[i]) visLit++;
      const prims = tileGeometry(board.bits[i], board.lighting.entry[i]);
      g.save();
      g.translate(cx, cy);
      g.scale(k, k);
      drawLitGlow(g, prims, s, sc, style, { q, alpha, seed: i, now, twinkleT });
      if (isBulb && q >= 1) drawBulbHalo(g, sc.bulbs[(board.colors[i] + hue) % nb], this.bulbAmount(f, i, pulse) * alpha, s);
      g.restore();
      if (q >= 1 && board.lighting.lit[i] && !won) drawFrontier(g, board, L, i, now, sc, false);
    }
    if (!f.reducedMotion) drawFlashGlows(g, vis, L, now, sc);
    drawSourceGlow(g, L, sc);
    drawGroundPool(g, L, sc, litFrac + (f.ambient ?? 0) * 0.5);
    if (room) {
      // The room's own light that blooms (the Sash's street lamp, the square's lamps, the Parlour's candles), in screen
      // space like the room; only while the room's own motion is drawn, so no bloom floats without its source.
      g.setTransform(dpr * GLOW_SCALE, 0, 0, dpr * GLOW_SCALE, 0, 0);
      room.glow(g, now, f.reducedMotion, tier);
      world(g, dpr * GLOW_SCALE);
    }
    const st = starState(now, f.winAt, litFrac, f.reducedMotion);
    st.glow *= 1 + (f.ambient ?? 0) * 0.3;
    // A tap on the star, or the topper's flip, flares the halo for a moment (not the topper's own brightness).
    const kick = this.topper.glowKick(now);
    st.glow += kick;
    drawStarGlow(g, L, sc, st, won);
    st.glow -= kick;
    this.topper.drawGlow(g, L, sc, st, won, litFrac, now, f.winAt, f.reducedMotion, dpr * GLOW_SCALE * cam.scale);
    this.current.draw(g, board, L, s * SPARKS.glowR, SPARKS.glowA, now);
    // Garland progress follows the light as it visibly arrives, not the logical count (spec §4.8).
    this.visFrac = visLit / GRID.ids.length;
    this.garland.update(this.visFrac, now);
    g.setTransform(dpr * GLOW_SCALE, 0, 0, dpr * GLOW_SCALE, 0, 0);
    this.garland.drawGlow(g, sc, now, f.winAt, f.reducedMotion);

    // 4. Bloom: blurred copies of the glow layer, additive, with auto-exposure (spec §4.5 item 8)
    const expo = 1 - EXPOSURE_DROP * Math.pow(litFrac, EXPOSURE_POW);
    const unit = s * cam.scale * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    const passes = tier >= 1 ? 2 : 3;
    for (let idx = 0; idx < passes; idx++) {
      const [radius, weight, power] = BLOOM[idx];
      ctx.globalAlpha = weight * Math.pow(expo, power) * sc.bloom;
      drawBlurred(ctx, this.glow, radius * unit, `bloom${idx}`);
    }
    if (sc.reflect && tier < 3) {
      const hz = (Y(L, 10.05) * cam.scale + cam.ty) * dpr;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, hz, this.canvas.width, this.canvas.height - hz);
      ctx.clip();
      ctx.setTransform(1, 0, 0, -1, 0, 2 * hz);
      ctx.globalAlpha = 0.34;
      drawBlurred(ctx, this.glow, 0.22 * unit, 'reflect');
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // 5. Pass 2: crisp lit cores, lit bulbs, glints, frontier cores
    world(ctx, dpr);
    for (const i of GRID.ids) {
      const { q, alpha } = vis.fill(board, i, now);
      if (alpha <= 0) continue;
      const [cx, cy] = tileCenter(L, GRID, i);
      const k = f.reducedMotion ? 1 : vis.settleScale(i, now);
      const prims = tileGeometry(board.bits[i], board.lighting.entry[i]);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(k, k);
      drawLitCore(ctx, prims, s, sc, style, { q, alpha, seed: i, now, twinkleT });
      if (degree(board.solution[i]) === 1 && q >= 1) {
        const amt = this.bulbAmount(f, i, pulse) * alpha;
        const face = i === faceTile && faces ? faces.get('ornament', facePx, true) : null;
        if (face) drawFaceBulb(ctx, board.bits[i], amt, s, sc, face);
        else drawBulb(ctx, board.bits[i], sc.bulbs[(board.colors[i] + hue) % nb], amt, s, sc, style);
        if (!f.reducedMotion) drawBulbGlint(ctx, now - (vis.litStart[i] + TILE_FILL_MS), s);
      }
      ctx.restore();
      if (q >= 1 && board.lighting.lit[i] && !won) drawFrontier(ctx, board, L, i, now, sc, true);
    }
    if (!f.reducedMotion) drawFlashRings(ctx, vis, L, now);
    drawSourceCore(ctx, L, sc);
    this.current.draw(ctx, board, L, s * SPARKS.coreR, SPARKS.coreA, now);
    this.topper.draw(ctx, L, sc, st, won, litFrac, now, f.winAt, f.reducedMotion, dpr * cam.scale);

    // 6. Lit garland glass, foreground snow, then win confetti (screen space)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.garland.drawLit(ctx, sc, now, f.winAt, f.reducedMotion);
    // Home Alone's van headlights sweeping the room (spec 2026-10-14 §9.3), then its traps (§4): over the board, decoration only.
    if (ha > 0) homeAlone?.drawBeam(ctx, L, ha, f.reducedMotion);
    if (sc.id === 'home-alone' && !f.reducedMotion) homeAlone?.drawTraps(ctx, L);
    if (secret && eggs && this.faces) {
      const px = FACE_GARLAND_H * this.garland.geo.size * dpr;
      this.garland.drawFace(ctx, now, f.winAt, f.reducedMotion, this.faces.get('garland', px, true), this.faces.get('garland', px, false), eggs.beatFx.garlandBob(now, beatAt, beatPower, f.reducedMotion));
    }
    this.drawSnow(sc, leaving, fadeA, true, motionDt, now, density);
    if (!f.reducedMotion) {
      // Secret mode's mini heads or Home Alone's pizza (spec 2026-10-14 §6), asked for only while the confetti falls.
      const falling = this.confetti.count(now, f.winAt, density) > 0;
      const sprite = !falling || !eggs
        ? null
        : secret
          ? (this.faces?.get('confetti', eggs.faces.FACE_CONFETTI_PX * dpr, true) ?? null)
          : sc.id === 'home-alone'
            ? (this.pizza?.get(eggs.pizza.PIZZA_PX * dpr) ?? null)
            : null;
      this.confetti.draw(ctx, L, now, f.winAt, density, sc, sprite);
    }
    if (f.opening?.on) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      f.opening.front(ctx, L, now);
    }
  }

  /**
   * Snow (the back or `front` layer): during a fade, the arriving scene's at `alpha` and the `leaving` one's at
   * 1 − alpha, the flakes moving once.
   */
  private drawSnow(sc: Scene, leaving: Scene | null, alpha: number, front: boolean, dt: number, now: number, density: number): void {
    const ctx = this.ctx;
    const L = this.layout;
    if (!leaving) {
      this.snow.draw(ctx, L, sc, front, dt, now, density);
      return;
    }
    ctx.globalAlpha = alpha;
    this.snow.draw(ctx, L, sc, front, dt, now, density);
    ctx.globalAlpha = 1 - alpha;
    this.snow.draw(ctx, L, leaving, front, sc.snowAlpha ? 0 : dt, now, density);
    ctx.globalAlpha = 1;
  }

  /** Pop intensity + light-show boost + the bottom-to-top win wave (spec §4.5 item 10) + secret mode's beat `pulse`. */
  private bulbAmount(f: FrameInput, i: number, pulse: number): number {
    let a = f.vis.bulbIntensity(i, f.now) + (f.extraBulb?.(i) ?? 0);
    if (f.winAt !== null && !f.reducedMotion) {
      const row = Math.floor(i / GRID.w);
      const w = f.now - f.winAt - (GRID.h - 1 - row) * 70;
      a += 0.6 * Math.exp(-(w * w) / (2 * 110 * 110));
    }
    return a + pulse;
  }
}
