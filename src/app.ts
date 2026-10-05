import { Board, type BoardEvent } from './core/board';
import { GameClock } from './core/clock';
import { GRID } from './core/mask';
import { formatTime, scoreFor, wholeSeconds } from './core/score';
import { Sfx } from './audio/sfx';
import { bindInput } from './input';
import { Radio } from './radio/radio';
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
import { RadioPanel } from './ui/radio-panel';
import { Results } from './ui/results';
import { makeShareImage, prepareShareImage, shareResult, type ShareImage } from './ui/share';
import { Toast } from './ui/toast';

export const REVEAL_MS = 900;

/** Typing into a field never drives the game's keyboard shortcuts. */
function isEditable(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement);
}
const INTRO_KEY = 'aglow.seenIntro';
const INK: Record<SceneId, string> = { midnight: '#f3ead8', fireside: '#f4e6cf', frost: '#15261f' };

export class App {
  board!: Board;
  interactiveAt = 0;
  readonly sfx = new Sfx();
  readonly renderer: Renderer;
  readonly radio = new Radio();
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
  /** The paused frame has been drawn; the renderer idles until resume. */
  private pausedDrawn = false;
  private resizeQueued = false;
  /** The first resize has measured the stage (the HUD fit and tagline placement need it). */
  private laidOut = false;
  /** The results card's share image, rendered when the card appears so the Share tap needs no await. */
  private shareImage: ShareImage | null = null;
  private lastFrame = 0;
  private lastTime = '';
  private lastLit = '';
  private lastCanPause = false;
  private sceneId: SceneId = 'fireside';
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)');
  private readonly toast = new Toast(el('toast'));
  private readonly results: Results;
  private readonly menu: Menu;
  private readonly radioPanel: RadioPanel;

  constructor() {
    this.renderer = new Renderer(el<HTMLCanvasElement>('stage'));
    this.results = new Results({ onNew: () => this.newGame(), onShare: () => void this.share(), onKeep: () => this.keepWatching() });
    this.menu = new Menu(this.settings, {
      onChange: (s) => this.applySettings(s),
      onNewTree: () => this.newGame(),
      needsConfirm: () => this.winAt === null && this.board.lighting.count > 0 && this.clock.elapsedMs(performance.now()) > 3000,
      onOpen: () => this.radioPanel.close(),
    });
    this.radioPanel = new RadioPanel(
      this.radio,
      {
        get: () => this.settings.effectsVolume,
        set: (v) => this.applySettings({ ...this.settings, effectsVolume: v }),
      },
      { onOpen: () => this.menu.close(), onPillChange: () => this.fitHud() },
    );
    // Game sounds duck the music (spec §5.1), alongside anything else already listening.
    const onSound = this.sfx.onSound;
    this.sfx.onSound = () => {
      onSound?.();
      this.radio.duck();
    };
  }

  start(): void {
    this.applySettings(this.settings, false);
    this.resize();
    addEventListener('resize', () => {
      if (this.resizeQueued) return;
      this.resizeQueued = true;
      requestAnimationFrame(() => {
        this.resizeQueued = false;
        this.resize();
      });
    });
    const now = performance.now();
    const saved = loadGame(GRID);
    if (saved) {
      this.beginGame(now, new Board(GRID, saved.state), saved.elapsedMs);
      this.moved = true;
      this.toast.show(`Welcome back · ${formatTime(wholeSeconds(saved.elapsedMs))}`, 2600);
      // Saved during the final turn: the restored board is already solved, so finish the win properly.
      if (this.board.lighting.count === GRID.ids.length) this.handle(this.board.settleWin(), now);
    } else {
      this.beginGame(now, Board.random(GRID, Math.random), 0);
    }
    if (!this.board.won) this.showIntro();
    void document.fonts?.ready.then(() => this.fitHud());
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
    this.shareImage = null;
    this.moved = false;
    this.camera = IDENTITY;
    this.setPaused(false);
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
          if (this.paused) break; // a turn finishing under the pause overlay stays silent
          this.sfx.tick();
          if (this.settings.haptics) navigator.vibrate?.(8);
          break;
        case 'rotateFinished':
          this.vis.onRotateFinished(this.board, e.tile, now);
          settled = true;
          break;
        case 'lightingChanged': {
          // Connection flashes (burst + ring): not under reduced motion, and not for filament, whose flow is the whole show.
          const flashes = !this.reduced.matches && this.renderer.style !== 'filament';
          const bulbs = this.vis.onLightingChanged(this.board, e.newlyLit, e.lost, now, flashes);
          if (e.newlyLit.length && !this.paused) this.sfx.wave(e.newlyLit.length, bulbs.map((t) => t - now));
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
    // A buffered turn can win under the pause overlay: lift it, and let the results card take over focus.
    if (this.paused) this.setPaused(false);
    this.clock.pause(now);
    clearGame();
    this.menu.close();
    this.radioPanel.close();
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
    setTimeout(() => {
      if (this.board !== game) return;
      this.prepareShare();
      this.results.show({ seconds, score, newBest, stats });
    }, delay + 1500);
  }

  private keepWatching(): void {
    this.results.hide();
    el('corner-new').hidden = false;
  }

  /** Renders the share image from the stage as it is now (the lit tree, identity camera). */
  private prepareShare(): ShareImage {
    const image = prepareShareImage(() => makeShareImage(this.renderer.canvas, this.renderer.treeRect(), this.lastSeconds, INK[this.sceneId]));
    this.shareImage = image;
    return image;
  }

  /** Straight from the tap: no await before the share sheet or clipboard write (WebKit user activation). */
  private async share(): Promise<void> {
    try {
      const outcome = await shareResult(this.shareImage ?? this.prepareShare(), this.lastSeconds);
      if (outcome === 'copied-image') this.toast.show('Image copied');
      else if (outcome === 'copied-text') this.toast.show('Copied to clipboard');
      else if (outcome === 'failed') this.toast.show("Couldn't share, try a screenshot");
    } catch {
      this.toast.show("Couldn't share, try a screenshot");
    }
  }

  /** After a win, a scene or size change re-renders the share image once the stage has redrawn. */
  private refreshShare(): void {
    if (!this.shareImage) return;
    const game = this.board;
    requestAnimationFrame(() => requestAnimationFrame(() => this.board === game && this.shareImage && this.prepareShare()));
  }

  /* ---------- frame loop ---------- */

  private loop(now: number): void {
    requestAnimationFrame((t) => this.loop(t));
    const dt = Math.min(50, now - (this.lastFrame || now));
    this.lastFrame = now;
    if (!this.paused && this.winAt === null && !this.clock.running && now >= this.interactiveAt) this.clock.resume(now);
    this.handle(this.board.tick(now), now);
    this.updateHud(now);
    // While paused the stage is blurred behind the overlay: draw one frame, then idle until resume.
    if (this.paused) {
      if (this.pausedDrawn) return;
      this.pausedDrawn = true;
    } else this.pausedDrawn = false;
    // The post-win light show (spec §5.4): beats pulse the bulbs up the tree, the low band breathes the glow.
    const show = this.winAt !== null && this.radio.lightShowActive && !this.reduced.matches;
    if (show) this.radio.show.sample(now);
    this.renderer.frame({
      board: this.board, vis: this.vis, now, dt, camera: this.camera, hover: this.hover,
      revealAt: this.revealAt, winAt: this.winAt, reducedMotion: this.reduced.matches,
      extraBulb: show ? (i) => this.radio.show.extraBulb(Math.floor(i / GRID.w), now) : undefined,
      ambient: show ? this.radio.show.low : 0,
    });
  }

  private updateHud(now: number): void {
    const t = formatTime(wholeSeconds(this.clock.elapsedMs(now)));
    if (t !== this.lastTime) {
      el('time').textContent = t;
      this.lastTime = t;
    }
    // Pausing makes no sense during the reveal (the clock hasn't started) or after the win (it has stopped).
    const canPause = this.canPause(now);
    if (canPause !== this.lastCanPause) {
      el('pause-btn').hidden = !canPause;
      this.lastCanPause = canPause;
      this.fitHud(); // the pause pill came or went: the HUD changed width
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
    // Any HUD button can be the first gesture: unlock audio inside it (the music itself waits for the first tap).
    for (const id of ['radio-pill', 'pause-btn', 'menu-btn']) el(id).addEventListener('click', () => this.sfx.unlock());
    el('zoom-reset').addEventListener('click', () => this.setCamera(IDENTITY));
    el('corner-new').addEventListener('click', () => this.newGame());
  }

  private tap(x: number, y: number): void {
    const now = performance.now();
    this.sfx.unlock();
    // The first tap fades the music in (spec §5.2); it must run synchronously inside the gesture.
    this.radio.firstGesture();
    if (this.menu.isOpen || this.radioPanel.isOpen) {
      this.menu.close();
      this.radioPanel.close();
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
    this.menu.sync(s);
    this.pausedDrawn = false;
    if (persist) saveSettings(s);
    this.sfx.setVolume(s.effectsVolume);
    const restyle = s.pathStyle !== this.renderer.style;
    if (restyle) this.renderer.setStyle(s.pathStyle);
    const rescene = this.setScene(s.scene === 'auto' ? sceneForHour(new Date().getHours()) : s.scene);
    if (restyle || rescene) this.refreshShare();
  }

  /** Returns whether the scene changed. */
  private setScene(id: SceneId): boolean {
    this.radio.setScene(id);
    if (id === this.sceneId && this.renderer.scene === SCENES[id]) return false;
    this.sceneId = id;
    document.body.dataset.scene = id;
    this.renderer.setScene(SCENES[id]);
    return true;
  }

  private refreshAutoScene(): void {
    if (this.settings.scene === 'auto' && this.setScene(sceneForHour(new Date().getHours()))) this.refreshShare();
  }

  /**
   * The radio pill takes the widest label (station · track, station, short name, icon only) that leaves the
   * wordmark clear, then the tagline is placed around the HUD's new width.
   */
  private fitHud(): void {
    if (!this.laidOut) return;
    const pill = document.getElementById('radio-pill');
    const hud = document.querySelector('.hud');
    const mark = document.querySelector('.wordmark');
    if (pill && hud && mark) {
      const markRight = mark.getBoundingClientRect().right;
      for (const fit of ['full', 'name', 'short', 'icon']) {
        pill.dataset.fit = fit;
        if (hud.getBoundingClientRect().left - markRight >= 16) break;
      }
    }
    this.placeIntro();
  }

  /**
   * Where the tagline goes: centred in the HUD row when it has real breathing room beside the wordmark and HUD,
   * otherwise hanging below the garland (always on phones), unless that would put it on the star.
   */
  private placeIntro(): void {
    const body = document.body;
    body.classList.remove('intro-low');
    const intro = el('intro');
    const half = intro.offsetWidth / 2;
    const mark = document.querySelector('.wordmark')?.getBoundingClientRect().right ?? 0;
    const hud = document.querySelector('.hud')?.getBoundingClientRect().left ?? innerWidth;
    const rowGap = Math.min(innerWidth / 2 - half - mark, hud - (innerWidth / 2 + half));
    const lowClear = this.renderer.garland.geo.bottom + 8 + intro.offsetHeight + 8 < this.renderer.starTop();
    const low = innerWidth < 600 || !(rowGap >= 64 || (!lowClear && rowGap >= 16));
    body.classList.toggle('intro-low', low);
  }

  private resize(): void {
    // The garland hangs below the wordmark and HUD wherever safe-area insets put them.
    let chromeBottom = 0;
    for (const sel of ['.hud', '.wordmark']) chromeBottom = Math.max(chromeBottom, document.querySelector(sel)?.getBoundingClientRect().bottom ?? 0);
    this.renderer.resize(innerWidth, innerHeight, Math.min(2, devicePixelRatio || 1), chromeBottom || undefined);
    document.body.style.setProperty('--garland-bottom', `${Math.round(this.renderer.garland.geo.bottom)}px`);
    this.laidOut = true;
    this.fitHud();
    this.camera = IDENTITY;
    el('zoom-reset').hidden = true;
    this.pausedDrawn = false; // resizing clears the stage
    this.refreshShare();
  }

  private bindLifecycle(): void {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) return;
      if (this.canPause(performance.now())) this.pause(false);
      // During the reveal the clock hasn't started: nothing to pause, but a restored game is still saved.
      else if (this.winAt === null && this.moved) saveGame(this.board, this.clock.elapsedMs(performance.now()));
    });
    addEventListener('pagehide', () => {
      if (this.winAt === null && this.moved) saveGame(this.board, this.clock.elapsedMs(performance.now()));
    });
    const overlay = el('pause');
    // The overlay sits above the stage, so the tap that resumes never reaches a tile underneath.
    overlay.addEventListener('click', () => this.resume());
    // Enter/Space resume on keyup: resuming on keydown would move focus to the pause pill in time for the key's
    // own keyup (Space) to click it again; held keys repeat keydown only.
    const activates = (e: KeyboardEvent) => e.key === 'Enter' || e.key === ' ';
    overlay.addEventListener('keydown', (e) => {
      if (activates(e)) e.preventDefault();
    });
    overlay.addEventListener('keyup', (e) => {
      if (!activates(e)) return;
      e.preventDefault();
      this.resume();
    });
    el('pause-btn').addEventListener('click', () => this.pause(true));
    document.addEventListener('keydown', (e) => {
      // The settings and radio dialogs handle their own Escape (and mark it handled); keys never reach the game while
      // either is open.
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || this.menu.isOpen || this.radioPanel.isOpen || isEditable(e.target)) return;
      if (e.key === 'Escape' && this.paused) {
        e.preventDefault();
        this.resume();
      } else if ((e.key === 'p' || e.key === 'P') && !e.repeat) {
        e.preventDefault();
        if (this.paused) this.resume();
        else this.pause(true);
      }
    });
  }

  /** Pausing makes sense only while the clock can run: after the reveal and before the win. */
  private canPause(now: number): boolean {
    return now >= this.interactiveAt && this.winAt === null;
  }

  /**
   * The pause button, the P key and a hidden tab all land here: stop the clock, blur the stage behind the overlay
   * and save. `focus` moves keyboard focus onto the overlay (a user-initiated pause), so Enter or Space resumes.
   */
  private pause(focus: boolean): void {
    const now = performance.now();
    if (this.paused || !this.canPause(now)) return;
    this.clock.pause(now);
    this.setPaused(true);
    if (focus) el('pause').focus({ preventScroll: true });
    if (this.moved) saveGame(this.board, this.clock.elapsedMs(now));
  }

  private resume(): void {
    if (!this.paused) return;
    const hadFocus = document.activeElement === el('pause');
    this.setPaused(false);
    const btn = el('pause-btn');
    if (hadFocus && !btn.hidden) btn.focus({ preventScroll: true });
  }

  /** Pause state and its DOM: blurred stage, overlay, and the controls beneath it taken out of reach (inert). */
  private setPaused(on: boolean): void {
    this.paused = on;
    this.pausedDrawn = false;
    document.body.classList.toggle('paused', on);
    el('pause').hidden = !on;
    for (const sel of ['.hud', '#menu', '#radio-panel']) {
      const node = document.querySelector<HTMLElement>(sel);
      if (node) node.inert = on;
    }
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
