import type { SweepFrame, SweepRun } from './aurora';
import { PAINT_EVERY, PaintCan, TARANTULA_EVERY, Tarantula, TrapScheduler, drawPaintCan, drawTarantula, makePaintCan, type KnockTarget } from './home-alone-traps';
import { BANDIT_WALK_MS, BanditTimer, IRON_ODDS, IRON_WALK_MS, WindowGags } from './home-alone-window';
import type { Layout } from './layout';
import type { Scene } from './scenes';

/** Home Alone mode's moving parts (spec 2026-10-14 §3–4), stepped by the app and drawn by the renderer. */
export type TrapKind = 'bandits' | 'iron' | 'paint' | 'tarantula';

/** `running`: not paused (a hidden tab draws no frames, so it is paused too). `inPlay`: after the first move, before the win. */
export interface HomeAloneGate { running: boolean; inPlay: boolean; reduced: boolean }

export interface HomeAloneLayerState {
  bandits: boolean;
  iron: boolean;
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
  private partyT = 0;
  /** ms into the bandits' walk; −1: none. */
  private walkT = -1;
  private iron = false;
  private readonly timer = new BanditTimer();
  private readonly gags = new WindowGags();
  private readonly paint = new PaintCan();
  private readonly spider = new Tarantula();
  private readonly paintEvery: TrapScheduler;
  private readonly spiderEvery: TrapScheduler;
  private canSprite: HTMLCanvasElement | null = null;
  private canFor: Layout | null = null;

  constructor(private readonly garland: KnockTarget, private readonly rng: () => number = Math.random) {
    this.paintEvery = new TrapScheduler(PAINT_EVERY, this.rng);
    this.spiderEvery = new TrapScheduler(TARANTULA_EVERY, this.rng);
  }

  get partyMs(): number {
    return this.partyT;
  }

  /** A tap, key, pointer move, wheel or pinch: the bandits' idle clock starts over. */
  input(): void {
    this.timer.input();
  }

  step(now: number, dt: number, g: HomeAloneGate, L: Layout): void {
    if (g.reduced) {
      // Switched on mid-walk or mid-trap: a still room has neither.
      this.walkT = -1;
      this.cancelTraps();
    }
    if (g.reduced || !g.running) return;
    this.partyT += dt;
    if (this.walkT >= 0) {
      this.walkT += dt;
      if (this.walkT >= (this.iron ? IRON_WALK_MS : BANDIT_WALK_MS)) this.walkT = -1;
    }
    if (this.timer.step(dt, this.walkT >= 0)) this.walk(this.rng() < IRON_ODDS);
    // Traps: only while a tree is in play (spec §4); a win (or a new tree) clears any under way at once.
    if (!g.inPlay) {
      this.cancelTraps();
      return;
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
    else this.walk(kind === 'iron');
    return true;
  }

  /** A tap at (x, y), CSS px: true when it sent the tarantula scurrying. The tap itself is the caller's, untouched. */
  scare(x: number, y: number): boolean {
    return this.spider.scare(x, y);
  }

  /** The house has gone from the stage (the renderer calls it once it has faded out): nothing carries over to the next visit. */
  reset(): void {
    this.walkT = -1;
    this.cancelTraps();
  }

  state(): HomeAloneLayerState {
    return {
      bandits: this.walkT >= 0,
      iron: this.walkT >= 0 && this.iron,
      paint: this.paint.active,
      tarantula: this.spider.mode,
      tarantulaAt: this.spider.mode ? [this.spider.pos.x, this.spider.pos.y] : null,
    };
  }

  /** Behind the tree (screen space, CSS px transform). Nothing at all under reduced motion: a still room. */
  drawWindow(c: CanvasRenderingContext2D, L: Layout, alpha: number, tier: number, reduced: boolean): void {
    if (reduced || alpha <= 0) return;
    this.gags.draw(c, L, alpha, tier, this.partyT, this.walkT, this.iron);
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
  }

  private walk(iron: boolean): void {
    this.walkT = 0;
    this.iron = iron;
    this.timer.started();
  }
}
