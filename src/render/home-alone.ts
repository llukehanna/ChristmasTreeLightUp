import type { SweepFrame, SweepRun } from './sky-sweep';
import { PAINT_EVERY, PaintCan, TARANTULA_EVERY, Tarantula, TrapScheduler, drawPaintCan, drawTarantula, makePaintCan, scurryMs, type KnockTarget } from './home-alone-traps';
import {
  GagClock, IRON_ODDS, MARV_MS, MarvClock, TOOTH_GLINT_AT, VAN_EVERY, VAN_FIRST, VAN_MS, WELCOME_MS, WindowGags, gagMs, nextGag, vanPose,
  type GagFrame, type VanPose, type WindowGag,
} from './home-alone-window';
import type { Layout } from './layout';
import type { Scene } from './scenes';

/** Home Alone mode's moving parts (spec 2026-10-14 §3–4), stepped by the app and drawn by the renderer. */
export type TrapKind = 'bandits' | 'iron' | 'tooth' | 'fire' | 'marv' | 'van' | 'paint' | 'tarantula';

/** `running`: not paused (a hidden tab draws no frames, so it is paused too). `inPlay`: after the first move, before the win. */
export interface HomeAloneGate { running: boolean; inPlay: boolean; reduced: boolean }

export interface HomeAloneLayerState {
  /** The window gag under way (spec §9.1), if any; `bandits`, `tooth` and `fire` say the same per gag. */
  gag: WindowGag | null;
  bandits: boolean;
  iron: boolean;
  tooth: boolean;
  fire: boolean;
  marv: boolean;
  van: boolean;
  /** The van's headlights sweeping the room. */
  beam: boolean;
  /** Gold-tooth dings asked of the effects bus. */
  dings: number;
  paint: boolean;
  tarantula: 'crawl' | 'scurry' | null;
  tarantulaAt: [number, number] | null;
}

/** How much of the house's window shows this frame: all of it in the house, faded with the cross-fade, none during a sweep. */
export function homeAloneAlpha(scene: Pick<Scene, 'id'>, run: Pick<SweepRun, 'kind' | 'fromScene'> | null, fr: Pick<SweepFrame, 'alpha'> | null): number {
  if (run && fr) {
    if (run.kind === 'sweep') return 0;
    if (scene.id === 'home-alone') return fr.alpha;
    return run.fromScene.id === 'home-alone' ? 1 - fr.alpha : 0;
  }
  return scene.id === 'home-alone' ? 1 : 0;
}

export class HomeAloneLayer {
  /** The window gag under way and how far into it (`frame.t`, ms), Marv's and the van's: what the window draws, reused. */
  private readonly frame: GagFrame = { gag: null, t: -1, iron: false, marvT: -1, vanT: -1, vanDir: 1 };
  private lastGag: WindowGag | null = null;
  private dings = 0;
  private readonly clock: GagClock;
  private readonly marvClock: MarvClock;
  private readonly van: VanPose = { x: 0, beam: -1, done: false };
  private readonly vanEvery: TrapScheduler;
  private readonly gags = new WindowGags();
  /** The gold tooth's glint (spec §9.1): the app plays its ding on the effects bus. */
  onDing: (() => void) | null = null;
  private readonly paint = new PaintCan();
  private readonly spider = new Tarantula();
  private readonly paintEvery: TrapScheduler;
  private readonly spiderEvery: TrapScheduler;
  private canSprite: HTMLCanvasElement | null = null;
  private canFor: Layout | null = null;

  constructor(private readonly garland: KnockTarget, private readonly rng: () => number = Math.random) {
    this.paintEvery = new TrapScheduler(PAINT_EVERY, this.rng);
    this.spiderEvery = new TrapScheduler(TARANTULA_EVERY, this.rng);
    this.vanEvery = new TrapScheduler(VAN_EVERY, this.rng, VAN_FIRST);
    this.clock = new GagClock(this.rng);
    this.marvClock = new MarvClock(this.rng);
  }

  /** A tap, key, pointer move, wheel or pinch: Marv's idle clock starts over (the rotation doesn't wait for idle). */
  input(): void {
    this.marvClock.input();
  }

  /** The player just switched the mode on (typed): Harry and Marv walk by in WELCOME_MS, before any move (spec §9.1). */
  welcome(): void {
    this.clock.welcome();
  }

  /** How long the welcome moves for from `welcome()`: the wait, then the walk-by. The app holds the full frame rate that long. */
  welcomeMs(): number {
    return WELCOME_MS + gagMs('walk', false);
  }

  /** The longest a scurry takes to leave the stage on `L` (after `scare()` said true). */
  scurryMs(L: Layout): number {
    return scurryMs(L);
  }

  step(now: number, dt: number, g: HomeAloneGate, L: Layout): void {
    if (g.reduced) {
      // Switched on mid-gag or mid-trap: a still room has none.
      this.clearWindow();
      this.cancelTraps();
      this.clock.reset();
    }
    if (g.reduced || !g.running) return;
    const f = this.frame;
    if (f.gag) {
      const was = f.t;
      f.t += dt;
      if (f.gag === 'tooth' && was < TOOTH_GLINT_AT && f.t >= TOOTH_GLINT_AT) {
        this.dings++;
        this.onDing?.();
      }
      if (f.t >= gagMs(f.gag, f.iron)) {
        f.gag = null;
        f.t = -1;
      }
    }
    if (f.marvT >= 0) {
      f.marvT += dt;
      if (f.marvT >= MARV_MS) f.marvT = -1;
    }
    // One thing at the glass at a time: the rotation and Marv each wait for the other (spec §9.1–9.2). The rotation
    // runs on play time (the welcome on running time); Marv on idle time, or failing that on play time.
    const busy = f.gag !== null || f.marvT >= 0;
    const due = this.clock.step(dt, f.gag !== null, busy, g.inPlay);
    const marvDue = this.marvClock.step(dt, busy, g.inPlay);
    if (due === 'welcome') this.play('walk', false);
    else if (due === 'next') {
      const gag = nextGag(this.lastGag, this.rng());
      this.play(gag, gag === 'walk' && this.rng() < IRON_ODDS);
    } else if (marvDue) this.marv();
    // Traps and the van: only while a tree is in play (spec §4, §9.3); a win (or a new tree) clears any under way at once.
    if (!g.inPlay) {
      this.cancelTraps();
      return;
    }
    if (this.vanEvery.step(dt) && f.vanT < 0) this.startVan();
    if (f.vanT >= 0) {
      f.vanT += dt;
      if (f.vanT >= VAN_MS) f.vanT = -1;
    }
    if (this.paintEvery.step(dt) && !this.paint.active) {
      const k = this.garland.pickLit(this.rng());
      if (k >= 0) this.paint.start(k);
    }
    if (this.spiderEvery.step(dt) && this.spider.mode === null) this.spider.start(L, this.rng);
    if (this.paint.step(dt)) this.garland.knock(this.paint.bulb, now);
    this.spider.step(dt, L);
  }

  /** The probe's way in: starts it now, whatever its timer says. */
  force(kind: TrapKind, now: number, L: Layout, at?: readonly [number, number]): boolean {
    if (kind === 'paint') {
      const k = this.garland.pickLit(this.rng());
      this.paint.start(k >= 0 ? k : Math.floor(this.garland.geo.n / 2));
    } else if (kind === 'tarantula') this.spider.start(L, this.rng, at);
    else if (kind === 'marv') this.marv();
    else if (kind === 'van') this.startVan();
    else if (kind === 'tooth' || kind === 'fire') this.play(kind, false);
    else this.play('walk', kind === 'iron');
    return true;
  }

  /** A tap at (x, y), CSS px: true when it sent the tarantula scurrying. The tap itself is the caller's, untouched. */
  scare(x: number, y: number): boolean {
    return this.spider.scare(x, y);
  }

  /** The house has gone from the stage (the renderer calls it once it has faded out): nothing carries over to the next visit. */
  reset(): void {
    this.clearWindow();
    this.cancelTraps();
    this.clock.reset();
  }

  state(): HomeAloneLayerState {
    const f = this.frame;
    return {
      gag: f.gag,
      bandits: f.gag === 'walk',
      iron: f.gag === 'walk' && f.iron,
      tooth: f.gag === 'tooth',
      fire: f.gag === 'fire',
      marv: f.marvT >= 0,
      van: f.vanT >= 0,
      beam: f.vanT >= 0 && vanPose(f.vanT, this.van).beam >= 0,
      dings: this.dings,
      paint: this.paint.active,
      tarantula: this.spider.mode,
      tarantulaAt: this.spider.mode ? [this.spider.pos.x, this.spider.pos.y] : null,
    };
  }

  /** Behind the tree (screen space, CSS px transform). Nothing at all under reduced motion: a still room. */
  drawWindow(c: CanvasRenderingContext2D, L: Layout, alpha: number, reduced: boolean): void {
    if (reduced || alpha <= 0) return;
    this.gags.draw(c, L, alpha, this.frame);
  }

  /** The van's headlights sweeping the room (spec §9.3): over the wallpaper and the tree, screen space, CSS px transform. */
  drawBeam(c: CanvasRenderingContext2D, L: Layout, alpha: number, reduced: boolean): void {
    if (reduced || alpha <= 0 || this.frame.vanT < 0) return;
    this.gags.drawBeam(c, L, alpha, this.frame);
  }

  /** Over the board (screen space, CSS px transform): the paint can on its rope, the tarantula. */
  drawTraps(c: CanvasRenderingContext2D, L: Layout): void {
    if (this.paint.active) {
      if (this.canFor !== L) {
        if (this.canSprite) this.canSprite.width = this.canSprite.height = 0;
        this.canSprite = makePaintCan(L);
        this.canFor = L;
      }
      drawPaintCan(c, L, this.paint, this.garland, this.canSprite);
    }
    if (this.spider.mode) drawTarantula(c, L, this.spider);
  }

  /** A win, a new tree, reduced motion, the house gone: no trap under way, and no bulb still sputtering from one. */
  private cancelTraps(): void {
    this.paint.cancel();
    this.spider.cancel();
    this.garland.unknock();
    this.frame.vanT = -1;
  }

  private clearWindow(): void {
    this.frame.gag = null;
    this.frame.t = -1;
    this.frame.marvT = -1;
  }

  /** A window gag now; it counts as the last one, for the rotation and its clock. */
  private play(gag: WindowGag, iron: boolean): void {
    const f = this.frame;
    f.gag = gag;
    f.t = 0;
    f.iron = iron;
    this.lastGag = gag;
    this.clock.started();
  }

  private marv(): void {
    this.frame.marvT = 0;
    this.marvClock.started();
  }

  private startVan(): void {
    this.frame.vanT = 0;
    this.frame.vanDir = this.rng() < 0.5 ? 1 : -1;
  }
}
