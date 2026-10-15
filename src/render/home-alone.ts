import type { SweepFrame, SweepRun } from './aurora';
import { BANDIT_WALK_MS, BanditTimer, IRON_ODDS, IRON_WALK_MS, WindowGags } from './home-alone-window';
import type { Layout } from './layout';
import type { Scene } from './scenes';

/** Home Alone mode's moving parts (spec 2026-10-14 §3–4), stepped by the app and drawn by the renderer. */
export type TrapKind = 'bandits' | 'iron';

/** `running`: not paused (a hidden tab draws no frames, so it is paused too). `inPlay`: after the first move, before the win. */
export interface HomeAloneGate { running: boolean; inPlay: boolean; reduced: boolean }

export interface HomeAloneLayerState { bandits: boolean; iron: boolean }

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

  constructor(private readonly rng: () => number = Math.random) {}

  get partyMs(): number {
    return this.partyT;
  }

  /** A tap, key, pointer move, wheel or pinch: the bandits' idle clock starts over. */
  input(): void {
    this.timer.input();
  }

  step(now: number, dt: number, g: HomeAloneGate, L: Layout): void {
    if (g.reduced || !g.running) return;
    this.partyT += dt;
    if (this.walkT >= 0) {
      this.walkT += dt;
      if (this.walkT >= (this.iron ? IRON_WALK_MS : BANDIT_WALK_MS)) this.walkT = -1;
    }
    if (this.timer.step(dt, this.walkT >= 0)) this.walk(this.rng() < IRON_ODDS);
  }

  /** The probe's way in: starts it now, whatever its timer says. */
  force(kind: TrapKind, now: number, L: Layout, at?: readonly [number, number]): boolean {
    this.walk(kind === 'iron');
    return true;
  }

  /** The mode switched off: nothing carries over to the next visit. */
  reset(): void {
    this.walkT = -1;
  }

  state(): HomeAloneLayerState {
    return { bandits: this.walkT >= 0, iron: this.walkT >= 0 && this.iron };
  }

  /** Behind the tree (screen space, CSS px transform). Nothing at all under reduced motion: a still room. */
  drawWindow(c: CanvasRenderingContext2D, L: Layout, alpha: number, tier: number, reduced: boolean): void {
    if (reduced || alpha <= 0) return;
    this.gags.draw(c, L, alpha, tier, this.partyT, this.walkT, this.iron);
  }

  private walk(iron: boolean): void {
    this.walkT = 0;
    this.iron = iron;
  }
}
