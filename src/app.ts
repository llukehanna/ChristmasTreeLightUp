import { Board, type BoardEvent } from './core/board';
import { GameClock } from './core/clock';
import { GRID } from './core/mask';
import { formatTime, scoreFor, wholeSeconds } from './core/score';
import { Sfx } from './audio/sfx';
import { bindInput } from './input';
import { IDENTITY, clampCamera, isZoomed, panBy, toScreen, toWorld, zoomAt, type Camera } from './render/camera';
import { tileAt, tileCenter } from './render/layout';
import { Renderer } from './render/renderer';
import { SCENES, sceneForHour, type SceneId } from './render/scenes';
import { VisualState } from './render/visual-state';
import { clearGame, loadGame, saveGame } from './store/progress';
import { loadSettings, saveSettings, type Settings } from './store/settings';
import { loadStats, localDay, recordWin, saveStats } from './store/stats';
import { readJSON, writeJSON } from './store/storage';
import { el } from './ui/dom';
import { Menu } from './ui/menu';
import { Results } from './ui/results';
import { makeShareImage, shareResult } from './ui/share';
import { Toast } from './ui/toast';

export const REVEAL_MS = 900;
const INTRO_KEY = 'aglow.seenIntro';
const INK: Record<SceneId, string> = { midnight: '#f3ead8', fireside: '#f4e6cf', frost: '#15261f' };

export class App {
  board!: Board;
  interactiveAt = 0;
  readonly sfx = new Sfx();
  readonly renderer: Renderer;
  private vis!: VisualState;
  private clock!: GameClock;
  private settings: Settings = loadSettings();
  private stats = loadStats();
  private camera: Camera = IDENTITY;
  private revealAt = 0;
  private winAt: number | null = null;
  private lastSeconds = 0;
  private hover = -1;
  private introHidden = false;
  private moved = false;
  private paused = false;
  private lastFrame = 0;
  private lastTime = '';
  private lastLit = '';
  private sceneId: SceneId = 'fireside';
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)');
  private readonly toast = new Toast(el('toast'));
  private readonly results: Results;
  private readonly menu: Menu;

  constructor() {
    this.renderer = new Renderer(el<HTMLCanvasElement>('stage'));
    this.results = new Results({ onNew: () => this.newGame(), onShare: () => void this.share(), onKeep: () => this.keepWatching() });
    this.menu = new Menu(this.settings, {
      onChange: (s) => this.applySettings(s),
      onNewTree: () => this.newGame(),
      needsConfirm: () => this.winAt === null && this.board.lighting.count > 0 && this.clock.elapsedMs(performance.now()) > 3000,
    });
  }

  start(): void {
    this.resize();
    this.applySettings(this.settings, false);
    addEventListener('resize', () => this.resize());
    const now = performance.now();
    const saved = loadGame(GRID);
    if (saved) {
      this.beginGame(now, new Board(GRID, saved.state), saved.elapsedMs);
      this.moved = true;
      this.toast.show(`Welcome back · ${formatTime(wholeSeconds(saved.elapsedMs))}`, 2600);
    } else {
      this.beginGame(now, Board.random(GRID, Math.random), 0);
    }
    this.showIntro();
    this.bindControls();
    this.bindLifecycle();
    setInterval(() => this.refreshAutoScene(), 60_000);
    requestAnimationFrame((t) => this.loop(t));
  }

  /* ---------- game lifecycle ---------- */

  private beginGame(now: number, board: Board, elapsedMs: number): void {
    this.board = board;
    this.vis = new VisualState(GRID.w * GRID.h);
    this.clock = new GameClock(elapsedMs);
    this.revealAt = now;
    this.interactiveAt = now + REVEAL_MS;
    this.winAt = null;
    this.moved = false;
    this.camera = IDENTITY;
    this.results.hide();
    el('corner-new').hidden = true;
    el('zoom-reset').hidden = true;
    // The source "switches on" as the reveal finishes and the initial connected region flows out.
    this.vis.onLightingChanged(board, board.lighting.order, [], this.interactiveAt - 200, false);
  }

  newGame(): void {
    clearGame();
    this.beginGame(performance.now(), Board.random(GRID, Math.random), 0);
  }

  private handle(events: readonly BoardEvent[], now: number): void {
    let settled = false;
    for (const e of events) {
      switch (e.type) {
        case 'rotateStarted':
        case 'tapBuffered':
          if (e.type === 'rotateStarted') this.moved = true;
          this.sfx.tick();
          if (this.settings.haptics) navigator.vibrate?.(8);
          break;
        case 'rotateFinished':
          this.vis.onRotateFinished(e.tile, now);
          settled = true;
          break;
        case 'lightingChanged': {
          const bulbs = this.vis.onLightingChanged(this.board, e.newlyLit, e.lost, now, !this.reduced.matches);
          if (e.newlyLit.length) this.sfx.wave(e.newlyLit.length, bulbs.map((t) => t - now));
          break;
        }
        case 'won':
          this.onWin(now);
          break;
      }
    }
    if (settled && !this.board.won) saveGame(this.board, this.clock.elapsedMs(now));
  }

  private onWin(now: number): void {
    this.clock.pause(now);
    clearGame();
    this.menu.close();
    this.hideIntro();
    this.camera = IDENTITY;
    el('zoom-reset').hidden = true;
    const seconds = wholeSeconds(this.clock.elapsedMs(now));
    const score = scoreFor(seconds);
    const { stats, newBest } = recordWin(this.stats, seconds, score, localDay(new Date()));
    this.stats = stats;
    saveStats(stats);
    this.lastSeconds = seconds;
    this.winAt = this.vis.lastLitAt(this.board);
    const game = this.board;
    const delay = Math.max(0, this.winAt - now);
    setTimeout(() => this.board === game && this.sfx.win(), delay);
    setTimeout(() => this.board === game && this.results.show({ seconds, score, newBest, stats }), delay + 1500);
  }

  private keepWatching(): void {
    this.results.hide();
    el('corner-new').hidden = false;
  }

  private async share(): Promise<void> {
    try {
      const blob = await makeShareImage(this.renderer.canvas, this.renderer.treeRect(), this.lastSeconds, INK[this.sceneId]);
      const outcome = await shareResult(blob, this.lastSeconds);
      if (outcome === 'copied-image') this.toast.show('Image copied');
      else if (outcome === 'copied-text') this.toast.show('Copied to clipboard');
      else if (outcome === 'failed') this.toast.show("Couldn't share, try a screenshot");
    } catch {
      this.toast.show("Couldn't share, try a screenshot");
    }
  }

  /* ---------- frame loop ---------- */

  private loop(now: number): void {
    requestAnimationFrame((t) => this.loop(t));
    const dt = Math.min(50, now - (this.lastFrame || now));
    this.lastFrame = now;
    if (!this.paused && this.winAt === null && !this.clock.running && now >= this.interactiveAt) this.clock.resume(now);
    this.handle(this.board.tick(now), now);
    this.updateHud(now);
    this.renderer.frame({
      board: this.board, vis: this.vis, now, dt, camera: this.camera, hover: this.hover,
      revealAt: this.revealAt, winAt: this.winAt, reducedMotion: this.reduced.matches,
    });
  }

  private updateHud(now: number): void {
    const t = formatTime(wholeSeconds(this.clock.elapsedMs(now)));
    if (t !== this.lastTime) {
      el('time').textContent = t;
      this.lastTime = t;
    }
    const lit = (this.winAt !== null ? 1 : this.board.lighting.count / GRID.ids.length).toFixed(2);
    if (lit !== this.lastLit) {
      document.body.style.setProperty('--lit', lit);
      this.lastLit = lit;
    }
  }

  /* ---------- input ---------- */

  private bindControls(): void {
    const stage = el('stage');
    bindInput(stage, {
      tap: (x, y) => this.tap(x, y),
      hover: (x, y) => {
        const [wx, wy] = toWorld(this.camera, x, y);
        this.hover = tileAt(this.renderer.layout, GRID, wx, wy);
        stage.style.cursor = this.hover >= 0 && this.winAt === null ? 'pointer' : 'default';
      },
      leave: () => (this.hover = -1),
      zoom: (f, fx, fy) => {
        if (this.winAt === null) this.setCamera(zoomAt(this.camera, f, fx, fy));
      },
      pan: (dx, dy) => {
        if (this.winAt === null) this.setCamera(panBy(this.camera, dx, dy));
      },
    });
    el('zoom-reset').addEventListener('click', () => this.setCamera(IDENTITY));
    el('corner-new').addEventListener('click', () => this.newGame());
  }

  private tap(x: number, y: number): void {
    const now = performance.now();
    this.sfx.unlock();
    if (this.menu.isOpen) {
      this.menu.close();
      return;
    }
    if (this.paused) {
      this.resume();
      return;
    }
    if (now < this.interactiveAt) return;
    const [wx, wy] = toWorld(this.camera, x, y);
    const i = tileAt(this.renderer.layout, GRID, wx, wy);
    if (i < 0) return;
    this.hideIntro();
    this.handle(this.board.tap(i, now), now);
  }

  private setCamera(c: Camera): void {
    this.camera = clampCamera(c, this.renderer.layout.w, this.renderer.layout.h);
    el('zoom-reset').hidden = !isZoomed(this.camera) || this.winAt !== null;
  }

  /* ---------- settings, scenes, lifecycle ---------- */

  private applySettings(s: Settings, persist = true): void {
    this.settings = s;
    if (persist) saveSettings(s);
    this.sfx.setVolume(s.effectsVolume);
    this.renderer.setStyle(s.pathStyle);
    this.setScene(s.scene === 'auto' ? sceneForHour(new Date().getHours()) : s.scene);
  }

  private setScene(id: SceneId): void {
    this.sceneId = id;
    document.body.dataset.scene = id;
    this.renderer.setScene(SCENES[id]);
  }

  private refreshAutoScene(): void {
    if (this.settings.scene === 'auto') this.setScene(sceneForHour(new Date().getHours()));
  }

  private resize(): void {
    this.renderer.resize(innerWidth, innerHeight, Math.min(2, devicePixelRatio || 1));
    this.camera = IDENTITY;
    el('zoom-reset').hidden = true;
  }

  private bindLifecycle(): void {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden || this.winAt !== null) return;
      const now = performance.now();
      this.clock.pause(now);
      this.paused = true;
      document.body.classList.add('paused');
      el('pause').hidden = false;
      if (this.moved) saveGame(this.board, this.clock.elapsedMs(now));
    });
    addEventListener('pagehide', () => {
      if (this.winAt === null && this.moved) saveGame(this.board, this.clock.elapsedMs(performance.now()));
    });
    el('pause').addEventListener('click', () => this.resume());
  }

  private resume(): void {
    this.paused = false;
    document.body.classList.remove('paused');
    el('pause').hidden = true;
  }

  private showIntro(): void {
    const intro = el('intro');
    requestAnimationFrame(() => intro.classList.add('show'));
    if (readJSON(INTRO_KEY, (v): v is true => v === true)) setTimeout(() => intro.classList.remove('show'), 3200);
  }

  private hideIntro(): void {
    if (this.introHidden) return;
    this.introHidden = true;
    el('intro').classList.remove('show');
    writeJSON(INTRO_KEY, true);
  }

  /* ---------- test hooks (see debug.ts) ---------- */

  tileScreenCenter(i: number): [number, number] {
    const [x, y] = tileCenter(this.renderer.layout, GRID, i);
    return toScreen(this.camera, x, y);
  }

  debugSolve(): void {
    const now = performance.now();
    this.handle(this.board.debugSolve(), now);
  }
}
