import { ApiError, api, finishWithRetry, setUnauthorizedHandler } from './api/client';
import { addClaim, claimBatches, coalesced, readClaims, removeClaims } from './api/claims';
import type { RunOutcome } from './api/outcome';
import { Session } from './api/session';
import type { AccountStats, ClaimResponse, FinishResult } from './api/types';
import { Board, type BoardEvent } from './core/board';
import type { GameClock } from './core/clock';
import type { Turn } from './core/dirs';
import { CLOCK_TOLERANCE_MS } from './core/judge';
import type { LogEntry } from './core/log';
import { GRID } from './core/mask';
import { Run } from './core/run';
import { formatTime, scoreFor, wholeSeconds } from './core/score';
import { seededBoard } from './core/seeded';
import { audio } from './audio/context';
import { chimeStep, Sfx } from './audio/sfx';
import { bindInput } from './input';
import { Radio } from './radio/radio';
import type { WinSound } from './radio/win-sound';
import type { HomeAloneClip, HomeAloneSounds, KevinCall } from './audio/home-alone-sounds';
import { EGGS_BOOT_WAIT_MS, loadEggs, settledWithin, type EggModules } from './eggs/load';
import { IDENTITY, clampCamera, isZoomed, panBy, toScreen, toWorld, zoomAt, type Camera } from './render/camera';
import { CONFETTI_MS, starCenter } from './render/effects';
import { tileAt, tileCenter, treeRightEdge } from './render/layout';
import { CALM_AFTER_MS, frameDue, isCalm } from './render/quality';
import { Renderer, type BeatFrame } from './render/renderer';
import type { SceneChange } from './render/sky-sweep';
import type { HomeAloneGate, HomeAloneLayerState, TrapKind } from './render/home-alone';
import { withPalette } from './render/palettes';
import { sceneFor, type SceneId } from './render/scenes';
import { BURST_MS, FLIP_MS, onStar } from './render/topper';
import { VisualState } from './render/visual-state';
import { loadHomeAlone, saveHomeAlone } from './store/home-alone';
import { clearGame, loadGame, markReturn, saveGame, takeReturn, type LoadedGame, type OnlineRun, type WonRun } from './store/progress';
import { loadLook, saveLook, worldLook, type Look } from './store/look';
import { loadSettings, saveSettings, type Settings } from './store/settings';
import { loadStarHead, saveStarHead } from './store/star-head';
import { loadStats, localDay, recordWin, saveStats, shownAccountStats } from './store/stats';
import { readJSON, writeJSON } from './store/storage';
import { Accounts } from './ui/accounts';
import { el, isEditable } from './ui/dom';
import { CARD_HEIGHT, CARD_HIGH_GAP, cardFit, KeyCard, TOUCH_ONLY_QUERY } from './ui/key-card';
import { Decorate } from './ui/decorate';
import { HomeAloneSwitch } from './ui/home-alone';
import { whenIdle } from './ui/idle';
import { Menu, NEW_TREE_CONFIRM_MS } from './ui/menu';
import { markOpened, Opening, OPENING_MS, shouldOpen } from './ui/opening';
import { RadioPanel } from './ui/radio-panel';
import type { HectorDesk, HectorGlare } from './ui/hector';
import { accountStatsView, deviceStatsView, HOME_ALONE_LINE, Results, type StatsView } from './ui/results';
import { renderRibbon, ribbonModel } from './ui/ribbon';
import { makeShareImage, prepareShareImage, shareInk, shareResult, type ShareImage } from './ui/share';
import { FrostPause } from './ui/frost-pause';
import { StarEgg } from './ui/star-egg';
import { Toast } from './ui/toast';

/** A win hurries the flow still in flight this much, and the results tag follows this long after the last bulb. */
const LAST_WAVE_SPEEDUP = 4;
const RESULTS_DELAY_MS = 500;
const INTRO_KEY = 'aglow.seenIntro';

/** Secret mode as the test probe sees it (src/debug.ts). */
export interface SecretState {
  on: boolean;
  /** The stage's scene id. */
  scene: string;
  /** A sky sweep is under way. */
  sweeping: boolean;
  /** Where Luke's face is: the ornament's tile, the present, the garland bulb (-1: not placed). */
  faceTile: number;
  faceGift: number;
  faceGarland: number;
  /** Win ad-libs asked for (secret mode, a fresh win, effects up, a context) and actually started. */
  adlibsAsked: number;
  adlibsPlayed: number;
}

/** Home Alone mode as the test probe sees it (src/debug.ts). Later tasks add fields. */
export interface HomeAloneState extends HomeAloneLayerState {
  on: boolean;
  /** The stage's scene id. */
  scene: string;
  /** A cross-fade (or the head's sweep) is under way. */
  fading: boolean;
  /** Clip plays asked for (every gate passed) and started. */
  asked: Record<HomeAloneClip, number>;
  played: Record<HomeAloneClip, number>;
  /** The results tag shows Home Alone's line. */
  line: boolean;
  /** Share images rendered for this tree's win, and whether the last one carries the line (null: none yet). */
  shares: number;
  shareLine: boolean | null;
  /** Mr. Hector's glare (spec §9.4) is on screen now, and the glares called for on this page (shown or not). */
  hector: boolean;
  glares: number;
}

/** Home Alone's layer as the probe sees it before the eggs have loaded: nothing on screen. */
const NO_LAYER: HomeAloneLayerState = {
  gag: null, bandits: false, iron: false, tooth: false, fire: false, marv: false, van: false, beam: false, dings: 0, paint: false,
  tarantula: null, tarantulaAt: null,
};
const noClips = (): Record<HomeAloneClip, number> => ({
  scream: 0, kevin: 0, 'filthy-animal': 0, 'hector-credit-card': 0, 'hector-mistaken': 0, 'hector-love': 0,
});

/** The App state that says whether heavy idle work may run. */
export interface RunFlags {
  /** A board exists. */
  live: boolean;
  /** A new tree is waiting for the server's seed. */
  starting: boolean;
  /** When the tree was won (performance.now()), or null. */
  winAt: number | null;
  paused: boolean;
  /** performance.now(), as the gate is asked. */
  now: number;
}

/**
 * The win's staging has played out by this long after it: the topper's 1200 ms burst, the results tag's 500 ms delay
 * and its arrival, and some margin.
 */
const WIN_SETTLE_MS = 2000;

/**
 * Heavy work that could stall a frame or a tap (the radio's prewarm) may run: with no board, while a seed is pending,
 * behind the pause or once the win has settled (not during its confetti, the topper's flare and the tag's arrival).
 * Never while a tree is in play: not during its reveal (animation the player watches) and not once the clock runs,
 * which it does from the reveal's end (Run.frame), first move or not.
 */
export const quietForWork = (f: RunFlags): boolean =>
  !f.live || f.starting || f.paused || (f.winAt !== null && f.now >= f.winAt + WIN_SETTLE_MS);

export class App {
  /**
   * A first visit (src/ui/opening.ts), read first of all: before this page load writes any of the play data it looks
   * for (the fields below load the settings, the look, the stats and the radio's settings).
   */
  private readonly firstVisit = shouldOpen();
  readonly sfx = new Sfx();
  readonly renderer: Renderer;
  readonly radio = new Radio();
  /** The tree in play: its board, clock and log, kept in step with the server's replay (src/core/run.ts). */
  private run!: Run;
  private vis!: VisualState;
  /** Read first: the look migrates from a v1 settings record, which must still hold its scene and path. */
  private look: Look = loadLook();
  private settings: Settings = loadSettings();
  private stats = loadStats();
  private camera: Camera = IDENTITY;
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
  /** The test probe's view of the share images: how many this win, and whether the last carries Home Alone's line. */
  private readonly shareSeen = { n: 0, line: null as boolean | null };
  private lastFrame = 0;
  private looping = false;
  /** Full frame rate until then: something the player caused is still moving. */
  private busyUntil = 0;
  private lastTime = '';
  private lastLit = '';
  private lastCanPause = false;
  private sceneId: SceneId = 'fireside';
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)');
  /** The radio panel's breakpoint (radio.css): below it the panel is a bottom sheet. */
  private readonly phone = matchMedia('(max-width: 600px)');
  /** A touch tablet: no Tab key and no pointer to hover, so no key card, hint or settings row. */
  private readonly touchOnly = matchMedia(TOUCH_ONLY_QUERY);
  /** The post-win light show drew this frame (read by the test probe). */
  lightShowOn = false;
  private readonly toast = new Toast(el('toast'));
  private readonly results: Results;
  private readonly menu: Menu;
  /** The Decorate drawer: the look, picked live (it opens from the menu). */
  private readonly decorate: Decorate;
  private readonly radioPanel: RadioPanel;
  /** The HUD account chip and menu, and the account sheets (spec 2026-10-07 §6). */
  private readonly accounts: Accounts;
  /** The signed-in player (spec 2026-10-07): loaded at start, changed by sign-in, naming and sign-out. */
  readonly session = new Session();
  /** A board exists: the first tree waits for the server (1.5 s at most). */
  private live = false;
  /** A new tree is waiting for the server's seed. */
  private starting = false;
  private online: OnlineRun | null = null;
  /** The solved tree's results-tag data while its run still matters. */
  private won: WonRun | null = null;
  private outcome: RunOutcome | null = null;
  /** claimOnce, one at a time: a call while one runs (a new run's claim was just stored) goes again right after it. */
  private readonly claimAll = coalesced(() => this.claimOnce());
  /** This run's claim after naming: it failed ('stuck', Retry), or the server didn't take it ('gone'). */
  private claimState: 'stuck' | 'gone' | null = null;
  /** Back from Google for this run (the return marker matched): "Saving…" while /api/me is in flight. */
  private returning = false;
  /** The account's stats as shown, with this device's baseline added (spec 2026-10-08 §6.2), for the solved tree on the tag; null: the device's. */
  private accountStats: AccountStats | null = null;
  /** Bumped by each syncStats and each new tree, so an older answer never paints over a newer one. */
  private statsSeq = 0;
  /** The star-head egg: taps on the star and "hohoho" swap the topper (src/ui/star-egg.ts). */
  private readonly egg: StarEgg;
  /** Secret mode (spec 2026-10-08 secret mode): on exactly while the head tops the tree. */
  private secret = false;
  /** Home Alone mode (spec 2026-10-14): on exactly while the switch is. */
  private homeAlone = false;
  /** The Home Alone layer's gates, reused every frame. */
  private readonly haGate: HomeAloneGate = { running: false, inPlay: false, reduced: false };
  /** Typing "kevin" switches Home Alone mode (src/ui/home-alone.ts). */
  private readonly alone: HomeAloneSwitch;
  /**
   * The eggs (src/eggs/load.ts): Home Alone, secret mode and the faces load on first use, or before the first frame
   * when a saved mode needs them. Until then the parts below that come from them are null.
   */
  private eggs: EggModules | null = null;
  /** A mode saved in this browser (the house, or the head and its secret mode) needs the eggs from the first frame. */
  private readonly eggsAtBoot = loadHomeAlone() || loadStarHead();
  /** The load under way or done (null: not asked for yet, or it failed and the next ask tries again). */
  private eggsLoading: Promise<void> | null = null;
  /** Switches to an egg made before the eggs had loaded, in order: they take effect when the load resolves. */
  private readonly waiting: (() => void)[] = [];
  /** The Secret station's win ad-lib. */
  private winSound: WinSound | null = null;
  /** Win ad-libs asked for (every gate passed) and started: the test probe's view. */
  private readonly adlibs = { asked: 0, played: 0 };
  /** Home Alone's clips, on the effects bus (spec 2026-10-14 §5). */
  private sounds: HomeAloneSounds | null = null;
  private kevin: KevinCall | null = null;
  /** Mr. Hector (spec 2026-10-14 §9.4): which clip a Home Alone win says, and his glare beside the tag. */
  private hector: HectorDesk | null = null;
  private glare: HectorGlare | null = null;
  /** The pause: the window frosts over (#pause is its host). */
  private readonly frost = new FrostPause(el('pause'));
  private readonly keyCard = new KeyCard(document.body);
  private glares = 0;
  /** The beat handed to the renderer, reused every frame. */
  private readonly beat: BeatFrame = { at: Number.NEGATIVE_INFINITY, strength: 0, hue: 0 };
  /** The room lighting up on a first visit (src/ui/opening.ts): the first tree is asked for once the room is lit. */
  private readonly opening = new Opening({
    garland: () => this.renderer.garland.geo,
    bulbs: () => this.renderer.scene.bulbs,
    camera: () => this.camera,
  });

  constructor() {
    this.renderer = new Renderer(el<HTMLCanvasElement>('stage'));
    this.results = new Results({ onNew: () => this.newGame(), onShare: () => void this.share(), onKeep: () => this.keepWatching() });
    this.menu = new Menu(this.settings, {
      onChange: (s) => this.applySettings(s),
      onDecorate: () => this.openDecorate(),
      onNewTree: () => this.newGame(),
      needsConfirm: () => this.live && this.winAt === null && this.board.lighting.count > 0 && this.clock.elapsedMs(performance.now()) > 3000,
      onOpen: () => {
        this.radioPanel.close();
        this.accounts.closeMenu();
        // A pinned key card would sit over the open menu (it docks at the same edge).
        this.keyCard.close();
      },
      onKeys: () => this.keyCard.pin(),
    });
    this.decorate = new Decorate({
      look: () => this.look,
      onLook: (patch) => this.applyLook({ ...this.look, ...patch }),
      world: () => this.world,
    });
    this.radioPanel = new RadioPanel(
      this.radio,
      {
        get: () => this.settings.effectsVolume,
        set: (v) => this.applySettings({ ...this.settings, effectsVolume: v }),
      },
      {
        onOpen: () => {
          this.menu.close();
          this.accounts.closeMenu();
        },
        onPillChange: () => this.fitHud(),
      },
    );
    this.accounts = new Accounts(this.session, {
      pause: () => this.pause(false),
      closeOthers: () => {
        this.menu.close();
        this.radioPanel.close();
      },
      fitHud: () => this.fitHud(),
      toast: (text, ms) => this.toast.show(text, ms),
    });
    // Game sounds duck the music (spec §5.1), alongside anything else already listening.
    const onSound = this.sfx.onSound;
    this.sfx.onSound = () => {
      onSound?.();
      this.radio.duck();
    };
    // A 401 on any signed-in call means the session is gone: sign out locally (spec §5.4).
    setUnauthorizedHandler(() => this.session.set(null));
    this.session.subscribe(() => this.accountChanged());
    this.egg = new StarEgg(
      this.session,
      {
        topper: this.renderer.topper,
        sfx: this.sfx,
        toast: (text) => this.toast.show(text),
        vibrate: (p) => {
          if (this.settings.haptics) navigator.vibrate?.(p);
        },
        save: saveStarHead,
        put: (on) => api.setStarHead(on),
        // After a win the share image shows the topper: render it again once the flip and its flecks have settled.
        flipped: () => setTimeout(() => this.refreshShare(), FLIP_MS / 2 + BURST_MS + 100),
        // Inside the completing gesture: the Secret station may only start later, so the radio is primed now.
        gesture: (on) => {
          if (on) this.radio.primeSecret();
        },
        mode: (on, how) => this.setSecret(on, how),
      },
      loadStarHead(),
    );
    this.alone = new HomeAloneSwitch(
      this.session,
      {
        save: saveHomeAlone,
        put: (on) => api.setHomeAlone(on),
        head: () => this.egg.isOn || this.session.current?.starHead === true,
        // Inside the completing keydown: the scream needs an unlocked audio context.
        gesture: () => this.sfx.unlock(),
        mode: (on, how) => this.setHomeAlone(on, how),
      },
      loadHomeAlone(),
    );
  }

  get board(): Board {
    return this.run.board;
  }

  /** performance.now() when the reveal ends and the tree takes taps. */
  get interactiveAt(): number {
    return this.run.interactiveAt;
  }

  private get clock(): GameClock {
    return this.run.clock;
  }

  start(): void {
    this.applySettings(this.settings, false);
    this.applyLook(this.look, false);
    this.resize();
    addEventListener('resize', () => {
      if (this.resizeQueued) return;
      this.resizeQueued = true;
      requestAnimationFrame(() => {
        this.resizeQueued = false;
        this.resize();
      });
    });
    void document.fonts?.ready.then(() => this.fitHud());
    this.touchOnly.addEventListener?.('change', () => this.fitKeyCard());
    this.bindControls();
    this.bindLifecycle();
    // A first visit opens in the dark, and the first tree waits for the room to light (boot). Never in a tab opened in
    // the background, where it would play unseen: it waits for a visit that shows it. The first key or press skips it.
    if (!document.hidden && this.firstVisit) {
      markOpened();
      const now = performance.now();
      this.opening.play(now);
      this.busy(now + OPENING_MS);
    }
    // With a saved mode the first frame and the account's answer (which can switch a mode) wait for the eggs, so they
    // land after the saved mode's start, as they did when the eggs were in the main chunk. The wait is bounded: a load
    // that stalls must not leave a blank stage. The mode's 'start' switch then stays queued, and attachEggs brings the
    // scene up when the chunk lands.
    const eggsReady = this.eggsAtBoot ? settledWithin(this.requestEggs(), EGGS_BOOT_WAIT_MS) : Promise.resolve(true);
    void eggsReady.then(() => this.session.load());
    void this.boot(eggsReady);
  }

  /**
   * The first tree: a saved game resumes; otherwise a new one starts (online when the server answers in time). With a
   * saved mode the tree waits for `eggsReady` (bounded, see start()), and its fetch starts only after that: the server
   * stamps the run's start when the request arrives and the log's time 0 is beginGame, so the two stay one response apart
   * (an early answer parked behind the eggs would eat the ranking's clock tolerance).
   */
  private async boot(eggsReady: Promise<boolean>): Promise<void> {
    const saved = loadGame(GRID);
    const returning = takeReturn();
    const restoreWin = saved?.won && saved.online && (saved.won.result === null || returning === saved.online.gameId);
    const resume = !restoreWin && saved && !saved.won;
    if (saved && !restoreWin && !resume) clearGame();
    // A new tree is under way from now (N and the saves wait for it), though its request goes out only after the eggs.
    if (!restoreWin && !resume) this.starting = true;
    // A saved mode is up from the first frame: the eggs first (in or out of time). Its 'start' switch, made in the
    // constructor, has already asked for them.
    await eggsReady;
    const now = performance.now();
    if (saved?.won && restoreWin) {
      this.restoreWin(saved, saved.won, now, returning === saved.online?.gameId);
    } else if (saved && resume) {
      this.beginGame(now, new Board(GRID, saved.state), saved.elapsedMs, saved);
      this.moved = true;
      this.toast.show(`Welcome back · ${formatTime(wholeSeconds(saved.elapsedMs))}`, 2600);
      // A reload counts as a pause (spec §5.2): the log resumes when the clock does, after the reveal.
      this.run.markAway(now);
      // Saved during the final turn: the restored board is already solved, so finish the win properly.
      if (this.board.lighting.count === GRID.ids.length) this.handle(this.board.settleWin(), now);
    } else {
      // A first visit: the room lights up before the tree is asked for, so the server's start and the clock begin
      // with the room lit (or the skip), and the time in the dark is never on the run.
      if (this.opening.on) {
        this.prelude();
        await this.opening.roomLit();
      }
      await this.freshTree();
    }
    if (!this.board.won) this.showIntro();
    this.startLoop();
    // Otherwise the eggs load once the first tree takes taps and the browser has a moment.
    setTimeout(() => whenIdle(() => void this.requestEggs()), Math.max(0, this.interactiveAt - performance.now()));
  }

  /**
   * Loads the eggs, once (src/eggs/load.ts); resolves when they are in place and any switch made meanwhile has taken
   * effect. A failed load shows nothing: the eggs stay off (the switches keep waiting), and the next ask (a key, a tap on
   * the star) asks again.
   */
  private requestEggs(): Promise<void> {
    if (this.eggs) return Promise.resolve();
    this.eggsLoading ??= loadEggs().then(
      (e) => this.attachEggs(e),
      () => {
        this.eggsLoading = null;
      },
    );
    return this.eggsLoading;
  }

  /** The eggs have loaded: their parts come into being, then the switches that waited for them take effect, in order. */
  private attachEggs(e: EggModules): void {
    if (this.eggs) return;
    this.eggs = e;
    this.renderer.attachEggs(e);
    // Harry's gold tooth (spec 2026-10-14 §9.1): a synth ding on the effects bus, silent with the effects volume at 0.
    if (this.renderer.homeAlone) this.renderer.homeAlone.onDing = () => this.sfx.ding();
    this.radio.attachSecret(e.secret.secretStep);
    this.radio.show.beat = new e.beat.BeatTracker();
    this.winSound = new e.winSound.WinSound();
    this.sounds = new e.homeAloneSounds.HomeAloneSounds(
      () => ({ ctx: audio.ctx, out: audio.sfx, volume: this.settings.effectsVolume }),
      (seconds) => this.radio.duck(seconds),
    );
    this.kevin = new e.homeAloneSounds.KevinCall();
    this.hector = new e.hector.HectorDesk();
    this.glare = new e.hector.HectorGlare(() => el('results'), e.homeAloneSounds.hectorImageUrl());
    const waiting = this.waiting.splice(0);
    for (const run of waiting) run();
    // A 'start' switch leaves the scene to the first applyLook, which has been and gone: put it up now (a load,
    // so at once). A switch by hand has already brought its scene in with its sweep or fade.
    if (waiting.length) {
      this.pausedDrawn = false;
      if (this.setScene(this.sceneId)) this.refreshShare();
    }
  }

  /**
   * A switch to an egg before the eggs have loaded waits for them (and asks for them); so does any switch after one
   * that is waiting, so they keep their order. Switching off what was never on needs nothing: it goes ahead.
   */
  private waitForEggs(on: boolean, run: () => void): boolean {
    if (this.eggs || (!on && this.waiting.length === 0)) return false;
    this.waiting.push(run);
    void this.requestEggs();
    return true;
  }

  /* ---------- game lifecycle ---------- */

  private beginGame(now: number, board: Board, elapsedMs: number, run: { online: OnlineRun | null; startEpoch: number; log: readonly LogEntry[] }): void {
    this.run = new Run(board, { now, epochNow: Date.now(), startEpoch: run.startEpoch, elapsedMs, log: run.log });
    this.live = true;
    this.online = run.online;
    this.won = null;
    this.claimState = null;
    this.returning = false;
    this.accountStats = null;
    this.statsSeq++;
    this.hector?.end();
    this.glare?.cancel();
    this.setOutcome(null);
    this.vis = new VisualState(GRID.w * GRID.h);
    this.winAt = null;
    this.shareImage = null;
    this.shareSeen.n = 0;
    this.shareSeen.line = null;
    this.moved = false;
    this.camera = IDENTITY;
    this.fitKeyCard();
    this.setPaused(false);
    this.results.hide();
    el('corner-new').hidden = true;
    el('zoom-reset').hidden = true;
    // The source "switches on" as the reveal finishes and the initial connected region flows out.
    this.vis.onLightingChanged(board, board.lighting.order, [], this.interactiveAt - 200, false);
    this.busy(this.vis.lastLitAt(board));
  }

  /**
   * The room under the opening, drawn before the first tree is asked for: a stand-in board that is never revealed (no
   * tile is drawn, none lit) and never live (it takes no taps, has no clock to run and is never saved).
   */
  private prelude(): void {
    this.run = new Run(Board.random(GRID, Math.random), {
      now: Number.POSITIVE_INFINITY, epochNow: Date.now(), startEpoch: Date.now(), elapsedMs: 0, log: [],
    });
    this.vis = new VisualState(GRID.w * GRID.h);
    this.startLoop();
  }

  /** Something the player caused is moving until `until`: hold the full frame rate (plus a grace period). */
  private busy(until: number): void {
    this.busyUntil = Math.max(this.busyUntil, until + CALM_AFTER_MS);
  }

  /** The server's seed when it answers within 1.5 s, else nothing (a local tree, unranked "offline"). Marks the start under way. */
  private async fetchTree(): Promise<{ board: Board | null; online: OnlineRun | null }> {
    this.starting = true;
    try {
      const s = await api.start();
      const board = seededBoard(s.seed, s.genVersion);
      if (board) return { board, online: { gameId: s.id, seed: s.seed, genVersion: s.genVersion, claim: s.claim } };
    } catch {
      // Unreachable, slow, rate-limited (429) or not configured: play a local tree. Play is never blocked.
    }
    return { board: null, online: null };
  }

  /** A new tree: from the server's seed (asked for now), else a local one. */
  private async freshTree(): Promise<void> {
    const { board, online } = await this.fetchTree();
    this.starting = false;
    this.beginGame(performance.now(), board ?? Board.random(GRID, Math.random), 0, { online, startEpoch: Date.now(), log: [] });
  }

  newGame(): void {
    if (this.starting) return;
    clearGame();
    // The old tree stays on screen until the new one is ready (1.5 s at most), without its results card.
    this.results.hide();
    this.glare?.cancel();
    el('corner-new').hidden = true;
    // "Press N again" has done its job: it must not linger over the new tree.
    this.toast.hide();
    void this.freshTree();
  }

  private snapshot(won: WonRun | null = null) {
    return { startEpoch: this.run.startEpoch, online: this.online, log: this.run.log.entries, won };
  }

  /** Saves the tree in play (never the old tree while a new one starts: newGame has just cleared it). */
  private save(now: number): void {
    if (!this.starting) saveGame(this.board, this.clock.elapsedMs(now), this.snapshot());
  }

  /** The solved tree and its run stay in aglow.game until a new tree starts (spec §8): resent after a reload, back after sign-in. */
  private saveWon(): void {
    if (this.won && !this.starting) saveGame(this.board, this.clock.elapsedMs(performance.now()), this.snapshot(this.won));
  }

  private handle(events: readonly BoardEvent[], now: number): void {
    let settled = false;
    for (const e of events) {
      switch (e.type) {
        case 'rotateStarted':
        case 'tapBuffered':
          this.busy(now + this.board.rotateMs);
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
          const pops = this.vis.onLightingChanged(this.board, e.newlyLit, e.lost, now, flashes);
          this.busy(Math.max(now, this.vis.lastLitAt(this.board)));
          if (e.newlyLit.length && !this.paused) {
            // Pitch follows height: the bottom of the tree rings lowest, so a wave climbing the tree plays a rising line.
            const chimes = pops.map((p) => ({ delayMs: p.at - now, step: chimeStep(Math.floor(p.tile / GRID.w), GRID.h) }));
            this.sfx.wave(e.newlyLit.length, chimes);
          }
          break;
        }
        case 'won':
          this.onWin(now);
          break;
      }
    }
    if (settled && !this.board.won) this.save(now);
  }

  private onWin(now: number): void {
    // A buffered turn can win under the pause overlay: lift it, and let the results card take over focus.
    if (this.paused) this.setPaused(false);
    this.clock.pause(now);
    const seconds = wholeSeconds(this.clock.elapsedMs(now));
    const score = scoreFor(seconds);
    const { stats, newBest } = recordWin(this.stats, seconds, score, localDay(new Date()));
    this.stats = stats;
    saveStats(stats);
    this.won = { seconds, score, newBest, result: null };
    if (this.online && !this.run.log.overflowed) {
      this.saveWon();
      void this.sendFinish();
    } else {
      clearGame();
      // Past 5,000 log entries the log no longer matches the game: the server would refuse it, so it isn't sent.
      this.setOutcome({ kind: this.online ? 'unverified' : 'offline' });
    }
    this.presentWin(now, this.won, true);
  }

  /**
   * The win's staging. A live win lands at once: the light still travelling hurries along and the sound and the confetti
   * start now, so silence means a light is still dark. The results tag follows RESULTS_DELAY_MS later. A restore after a
   * reload keeps the tree's own last-lit time.
   */
  private presentWin(now: number, won: WonRun, sound: boolean): void {
    this.menu.close();
    // The win's confetti and its tag want the whole stage.
    this.decorate.close();
    this.radioPanel.close();
    this.accounts.closeMenu();
    this.hideIntro();
    this.camera = IDENTITY;
    this.fitKeyCard();
    el('zoom-reset').hidden = true;
    this.lastSeconds = won.seconds;
    this.winAt = sound ? now : this.vis.lastLitAt(this.board);
    this.busy(this.winAt + CONFETTI_MS);
    const game = this.board;
    const delay = sound ? 0 : Math.max(0, this.winAt - now);
    // A live win in Home Alone mode says one clip (spec 2026-10-14 §6, §9.4), and an unverified one brings Hector.
    if (sound) this.hector?.begin(won.newBest);
    if (sound) {
      setTimeout(() => {
        if (this.board !== game) return;
        this.sfx.win();
        if (this.secret) this.playWinSound(game);
        this.hector?.soundDue();
        this.hectorStep();
      }, delay);
    }
    setTimeout(() => {
      if (this.board !== game || this.starting) return;
      this.prepareShare();
      this.results.show({
        seconds: won.seconds, newBest: won.newBest, stats: this.stats, view: this.statsView(), line: this.homeAlone ? HOME_ALONE_LINE : null,
      });
      this.hector?.tagShown();
      this.hectorStep();
    }, delay + RESULTS_DELAY_MS);
    // Last, once the win's state is all set: the light still travelling and its chimes come along faster.
    if (sound) {
      this.vis.hurry(now, LAST_WAVE_SPEEDUP);
      this.sfx.hurryChimes(LAST_WAVE_SPEEDUP);
    }
  }

  /**
   * Home Alone's win, as far as it can be told now (at the sound, at the tag, and as the server answers): the filthy
   * animal, "I love you" for a new best, or (unranked and unverified, the log or the clock, once the tag is up)
   * Hector's glare with one of his lines. A clip never plays over a new tree or with the mode switched off.
   */
  private hectorStep(): void {
    // No desk before the eggs have loaded: the mode is off until then, and a win out of the mode says nothing.
    const s = this.hector?.step(this.homeAlone, this.outcome);
    if (!s) return;
    if (s.glare) {
      this.glares++;
      this.glare?.show(this.reduced.matches);
    }
    if (s.clip) {
      const game = this.board;
      this.sounds?.play(s.clip, () => this.board === game && this.homeAlone);
    }
  }

  /**
   * Secret mode's win ad-lib (spec §4.6): a game sound, so only with the effects volume up. The music ducks under it
   * for its whole length (a later game sound's shorter duck keeps that hold).
   */
  private playWinSound(game: Board): void {
    const url = this.radio.secretWinSound();
    const ctx = audio.ctx;
    const winSound = this.winSound; // there whenever secret mode is: it waits for the eggs
    if (!url || !ctx || !audio.sfx || this.settings.effectsVolume <= 0 || !winSound) return;
    this.adlibs.asked++;
    // Decoded late (up to WIN_SOUND_LATE_MS), it must not talk over a new tree, or a world switched back.
    const still = (): boolean => this.board === game && this.secret;
    void winSound.play(url, ctx, audio.sfx, undefined, still).then((played) => {
      if (!played) return;
      this.adlibs.played++;
      this.radio.duck(winSound.lastDurationS);
    });
  }

  /** Back from sign-in, or a reload before the finish was answered: the solved tree and its results tag again (stats were recorded at the win). */
  private restoreWin(saved: LoadedGame, won: WonRun, now: number, returning: boolean): void {
    this.beginGame(now, new Board(GRID, saved.state), saved.elapsedMs, saved);
    this.moved = true;
    this.board.settleWin();
    this.won = won;
    this.returning = returning;
    this.presentWin(now, won, false);
    if (won.result) {
      this.setOutcome({ kind: 'done', result: won.result });
      void this.syncStats();
    } else void this.sendFinish();
  }

  /** Sends the finished run (retrying once), then keeps and shows the server's answer. */
  private async sendFinish(): Promise<void> {
    const run = this.online;
    const won = this.won;
    if (!run || !won) return;
    const game = this.board;
    // This run's log and start, held now: a new tree during the retry wait must not change what is measured.
    const entries = this.run.log.entries;
    const startEpoch = this.run.startEpoch;
    // Sent (or resent, after a reload or a Retry) past the judge's clock tolerance: the server keeps the run but can't
    // time it ('clock'). Remembered with the run, so the tag can say why after a reload or sign-in.
    // Checked ahead of every attempt, the automatic retry included: it can be the one that lands past the tolerance.
    const markLate = (): void => {
      const last = entries.at(-1);
      if (!won.late && Date.now() - (startEpoch + (last?.t ?? 0)) > CLOCK_TOLERANCE_MS) {
        won.late = true;
        this.saveWon();
      }
    };
    this.setOutcome({ kind: 'saving' });
    try {
      const result = await finishWithRetry(run.gameId, entries, undefined, markLate);
      // Started signed out: the run (ranked once claimed, or not) waits on this browser to be claimed (90 days), even
      // if a new tree has started meanwhile.
      if (run.claim) addClaim({ id: run.gameId, claim: run.claim }, Date.now());
      void this.claimAll();
      if (this.board !== game) return;
      won.result = result;
      this.saveWon();
      this.setOutcome({ kind: 'done', result });
      void this.syncStats();
    } catch (e) {
      if (this.board !== game) return;
      // 422: the log didn't replay and the server dropped the game; 404: it was already gone.
      if (e instanceof ApiError && (e.status === 422 || e.status === 404)) {
        if (!this.starting) clearGame();
        this.setOutcome({ kind: 'unverified' });
      } else this.setOutcome({ kind: 'failed' });
    }
  }

  /** The results tag's Retry, after "Couldn't save this run". */
  retryFinish(): void {
    if (this.outcome?.kind === 'failed') void this.sendFinish();
  }

  /**
   * Signed-out runs saved on this browser join the account, 8 per request, once it has a name (spec §5.4). The run on
   * the results tag says how its claim went: a failed request offers Retry; a claim the server didn't take (claimed in
   * another tab, or gone) can't be retried, and says the run is saved to Your games.
   */
  private async claimOnce(): Promise<void> {
    if (!this.session.current?.name) return;
    const current = this.won && this.online ? this.online.gameId : null;
    const stillHere = (): boolean => current !== null && this.online?.gameId === current;
    // The server has answered for this run's claim (taken, or not taken).
    let answered = false;
    try {
      for (const batch of claimBatches(readClaims(Date.now()))) {
        const mine = current !== null && batch.some((c) => c.id === current);
        if (mine && this.claimState === 'stuck') this.setClaimState(null);
        let res: ClaimResponse;
        try {
          res = await api.claim(batch);
        } catch {
          return; // keep them for next time
        }
        removeClaims(batch.map((c) => c.id));
        for (const r of res.results) this.onClaimed(r);
        if (mine) {
          answered = true;
          if (stillHere() && !res.results.some((r) => r.id === current)) this.setClaimState('gone');
        }
      }
    } finally {
      // Ended without an answer for this run's claim (its batch or an earlier one failed, or another tab already took
      // the claim out of storage): never leave "Saving…" up. Retry if the claim is still here to send, else the run
      // is in Your games.
      const o = this.outcome;
      if (current !== null && !answered && stillHere() && o?.kind === 'done' && !o.result.ranked && o.result.reason === 'anonymous' && this.claimState === null) {
        this.setClaimState(readClaims(Date.now()).some((c) => c.id === current) ? 'stuck' : 'gone');
      }
    }
  }

  private setClaimState(s: 'stuck' | 'gone' | null): void {
    this.claimState = s;
    this.setOutcome(this.outcome);
  }

  /** The ribbon's Retry: the finish that never arrived, or the claim that failed. */
  private retry(): void {
    if (this.outcome?.kind === 'failed') this.retryFinish();
    else if (this.claimState === 'stuck') {
      this.setClaimState(null);
      void this.claimAll();
    }
  }

  private onClaimed(r: FinishResult): void {
    if (!this.won || this.online?.gameId !== r.id) return;
    this.won.result = r;
    this.saveWon();
    this.setOutcome({ kind: 'done', result: r });
    void this.syncStats();
  }

  /** Who is playing changed (sign-in, a new name, sign-out): claim what waits here, and redraw the run's outcome. */
  accountChanged(): void {
    void this.claimAll();
    this.setOutcome(this.outcome);
    void this.syncStats();
  }

  /** The numbers on the tag: the account's as shown once they have arrived, else this device's. */
  private statsView(): StatsView {
    return this.accountStats ? accountStatsView(this.accountStats) : deviceStatsView(this.stats);
  }

  /**
   * The results tag's Solved, Average and Day streak: the account's when signed in, plus this device's baseline from
   * before accounts (`shownAccountStats`), and this device's while they load, offline, or signed out. The device keeps
   * recording its own either way.
   */
  private async syncStats(): Promise<void> {
    const seq = ++this.statsSeq;
    if (!this.won || !this.session.current) {
      this.accountStats = null;
      this.results.setStats(deviceStatsView(this.stats));
      return;
    }
    try {
      const a = await api.myStats();
      if (seq !== this.statsSeq) return;
      this.accountStats = shownAccountStats(a, this.stats, localDay(new Date()));
      this.results.setStats(this.statsView());
    } catch {
      // offline, or signed out meanwhile: the device's numbers stay
    }
  }

  /** The run's outcome on the results tag (pick 3B): drawn now, so it is there when the tag appears. */
  private setOutcome(o: RunOutcome | null): void {
    this.outcome = o;
    this.hectorStep(); // a Home Alone win waiting on the server's answer
    const ctx = { claim: this.claimState, late: this.won?.late === true, returning: this.returning };
    renderRibbon(el('results'), o && ribbonModel(o, this.session.current, ctx), {
      board: () => this.accounts.openBoard(null, 'all'), // the rosette's rank and total are all-time ones
      save: () => this.saveRun(),
      retry: () => this.retry(),
    });
  }

  /**
   * "Save to leaderboard": the sign-in card; after Google, the page comes back to this results tag (boot() restores the
   * won run). Signed in without a name (the name card was put off), the name card: naming claims the run.
   */
  private saveRun(): void {
    const run = this.online;
    if (!run) return;
    const from = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (this.session.current) this.accounts.openName(from);
    else this.accounts.openSignIn({ pendingMs: this.won?.result?.ms ?? null, beforeLeave: () => markReturn(run.gameId) }, from);
  }

  private keepWatching(): void {
    this.results.hide();
    this.glare?.cancel();
    el('corner-new').hidden = false;
  }

  /** Renders the share image from the stage as it is now (the lit tree, identity camera). */
  private prepareShare(): ShareImage {
    const line = this.homeAlone ? HOME_ALONE_LINE : null;
    this.shareSeen.n++;
    this.shareSeen.line = line !== null;
    const image = prepareShareImage(() => makeShareImage(this.renderer.canvas, this.renderer.treeRect(), this.lastSeconds, shareInk(this.renderer.scene), line));
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

  /** After a win, a scene or size change re-renders the share image once the stage has redrawn (and any sky sweep has landed). */
  private refreshShare(): void {
    if (!this.shareImage) return;
    const game = this.board;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (this.board !== game || !this.shareImage) return;
        if (this.renderer.sweeping) this.refreshShare(); // never a half-swept sky with its seam
        else this.prepareShare();
      }),
    );
  }

  /* ---------- frame loop ---------- */

  /** The frame loop, once (the opening's prelude may have started it before the first tree). */
  private startLoop(): void {
    if (this.looping) return;
    this.looping = true;
    requestAnimationFrame((t) => this.loop(t));
  }

  private loop(now: number): void {
    requestAnimationFrame((t) => this.loop(t));
    // Ambient-only frames draw at 30 Hz. Never calm: during a sky sweep or a topper flip (the player caused them), and,
    // unpaused, while the player's motion settles, the post-win light show runs, or secret mode's beat is on (they
    // follow the music). A paused loop is calm: one blurred frame, so no wake at every vsync.
    const calm = isCalm({
      now, busyUntil: this.busyUntil, paused: this.paused, sweeping: this.renderer.sweeping,
      topperNeedsFrame: this.renderer.topper.needsFrame(now),
      musicDriven: this.lightShowOn || (this.secret && this.radio.lightShowActive),
    });
    if (!frameDue(now - this.lastFrame, calm)) return;
    const dt = Math.min(50, now - (this.lastFrame || now));
    this.lastFrame = now;
    // A sheet over the game (opened during the reveal, say) never lets the clock run underneath it.
    if (this.accounts.sheetOpen && !this.paused && this.canPause(now)) this.pause(false);
    // The clock starts (or resumes, after a pause or a reload, logging the 'r') once the reveal is over; turns due finish.
    this.handle(this.run.frame(now, Date.now()), now);
    this.updateHud(now);
    // While paused the stage is blurred behind the overlay: draw one frame, then idle until resume. The topper is the
    // exception: a flip that lands under the overlay (the account's choice arriving) or a sticker that finishes
    // loading keeps drawing until it has settled, so the paused frame shows it. So does a sky sweep, which would
    // otherwise freeze half-swept with its seam in the paused frame, and the opening, whose skip fade (a skip, then P
    // within 900 ms) would otherwise freeze half-dark.
    if (this.paused) {
      if (this.pausedDrawn && !this.renderer.topper.needsFrame(now) && !this.renderer.sweeping && !this.opening.on) return;
      this.pausedDrawn = true;
    } else this.pausedDrawn = false;
    // The post-win light show (spec §5.4): beats pulse the bulbs up the tree, the low band breathes the glow.
    const show = this.winAt !== null && this.radio.lightShowActive && !this.reduced.matches;
    this.lightShowOn = show;
    // Secret mode's beat (spec 2026-10-08 secret mode §5.2): the same analyser, before and after the win, and under
    // reduced motion too (its gentle pulse).
    const beating = this.secret && this.radio.lightShowActive;
    if (show || beating) this.radio.show.sample(now);
    // Switched off, the house fades out still moving (the renderer resets the layer once it has gone). No layer before
    // the eggs have loaded, and no house either: the mode waits for them.
    const house = this.renderer.homeAlone;
    if (house && (this.homeAlone || this.renderer.homeAloneShowing)) {
      const g = this.haGate;
      g.running = !this.paused;
      g.inPlay = this.homeAlone && this.live && !this.starting && this.moved && this.winAt === null && !this.paused;
      g.reduced = this.reduced.matches;
      house.step(now, dt, g, this.renderer.layout);
    }
    // Secret mode's beat comes with the eggs (secret mode waits for them).
    const eggs = this.eggs;
    const tracker = this.radio.show.beat;
    this.renderer.frame({
      board: this.board, vis: this.vis, now, dt, camera: this.camera, hover: this.hover, calm,
      revealAt: this.run.revealAt, winAt: this.winAt, reducedMotion: this.reduced.matches,
      extraBulb: show ? (i) => this.radio.show.extraBulb(Math.floor(i / GRID.w), now) : undefined,
      ambient: show ? this.radio.show.low : 0,
      highs: show ? this.radio.show.high : 0,
      // While secret mode is on: the onset only while beating, the palette step held through a music pause.
      beat: this.secret && eggs && tracker ? eggs.beatFrame.fillBeatFrame(this.beat, tracker, beating, this.reduced.matches) : undefined,
      opening: this.opening,
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
      tap: (x, y, dir) => this.tap(x, y, dir),
      hover: (x, y) => {
        this.renderer.homeAlone?.input();
        const [wx, wy] = toWorld(this.camera, x, y);
        const hover = tileAt(this.renderer.layout, GRID, wx, wy);
        if (hover !== this.hover) this.busy(performance.now());
        this.hover = hover;
        stage.style.cursor = this.hover >= 0 && this.winAt === null ? 'pointer' : 'default';
      },
      leave: () => {
        if (this.hover >= 0) this.busy(performance.now());
        this.hover = -1;
      },
      zoom: (f, fx, fy) => {
        this.renderer.homeAlone?.input();
        if (this.winAt === null) this.setCamera(zoomAt(this.camera, f, fx, fy));
      },
      pan: (dx, dy) => {
        this.renderer.homeAlone?.input();
        if (this.winAt === null) this.setCamera(panBy(this.camera, dx, dy));
      },
    });
    // Any HUD button can be the first gesture: unlock audio inside it (the music itself waits for the first tap).
    for (const id of ['radio-pill', 'pause-btn', 'menu-btn', 'account-chip']) el(id).addEventListener('click', () => this.sfx.unlock());
    el('zoom-reset').addEventListener('click', () => this.setCamera(IDENTITY));
    el('corner-new').addEventListener('click', () => this.newGame());
  }

  private tap(x: number, y: number, dir: Turn): void {
    const now = performance.now();
    this.renderer.homeAlone?.input();
    this.sfx.unlock();
    if (this.menu.isOpen) {
      this.menu.close();
      return;
    }
    if (this.accounts.menuOpen) {
      this.accounts.closeMenu();
      return;
    }
    if (this.accounts.sheetOpen) return;
    // On desktop the game stays playable behind the radio popover (spec §5.3); the phone sheet closes like the menu.
    if (this.radioPanel.isOpen && this.phone.matches) {
      this.radioPanel.close();
      return;
    }
    if (this.paused) {
      this.resume();
      return;
    }
    // A tap by the tarantula sends it scurrying (spec 2026-10-14 §4); the tap itself goes on to the game unchanged. Not
    // a tap that only closed a menu or resumed from pause: that one never reached the stage.
    const house = this.renderer.homeAlone;
    if (house?.scare(x, y)) this.busy(now + house.scurryMs(this.renderer.layout)); // the scurry is the player's: full rate
    const [wx, wy] = toWorld(this.camera, x, y);
    // The star is not a tile: its taps go to the egg and never reach the board, the log or the clock.
    if (onStar(this.renderer.layout, wx, wy)) {
      if (dir === 1) {
        // Only a left tap counts toward the egg (a right-click on the star does nothing); the first starts the eggs loading.
        if (!this.eggs) void this.requestEggs();
        this.egg.tap(now);
      }
      return;
    }
    const i = tileAt(this.renderer.layout, GRID, wx, wy);
    if (i >= 0) this.tapTile(i, now, dir);
  }

  /** A tap on tile `i` (also the e2e probe's way in). Turns due finish first: the same order the server's replay uses. */
  tapTile(i: number, now = performance.now(), dir: Turn = 1): void {
    if (!this.live || this.starting || this.paused || now < this.interactiveAt) return;
    this.hideIntro();
    // The first tile tap fades the music in (spec §5.2); it must run synchronously inside the gesture.
    this.radio.firstGesture();
    this.radio.prewarm(() => quietForWork(this.runFlags())); // once: the context exists now
    // A page loaded in secret mode had no audio context (or catalog) to preload the ad-lib with: once both exist. Once per URL.
    if (this.secret) this.winSound?.preload(this.radio.secretWinSound(), audio.ctx);
    if (this.homeAlone) this.sounds?.preload(); // a page loaded in the mode had no audio context to preload with
    this.handle(this.run.tap(i, now, Date.now(), dir), now);
  }

  private setCamera(c: Camera): void {
    this.busy(performance.now());
    this.camera = clampCamera(c, this.renderer.layout.w, this.renderer.layout.h);
    el('zoom-reset').hidden = !isZoomed(this.camera) || this.winAt !== null;
    this.fitKeyCard();
  }

  /* ---------- settings, scenes, lifecycle ---------- */

  private applySettings(s: Settings, persist = true): void {
    this.settings = s;
    this.menu.sync(s);
    this.pausedDrawn = false;
    if (persist) saveSettings(s);
    this.sfx.setVolume(s.effectsVolume);
    if (this.homeAlone) this.sounds?.preload(); // the effects volume may just have come up
  }

  /** The scene and light path, and the dress. A change of any of them re-renders the share image. */
  private applyLook(l: Look, persist = true): void {
    this.look = l;
    this.pausedDrawn = false;
    if (persist) saveLook(l);
    const restyle = l.path !== this.renderer.style;
    if (restyle) this.renderer.setStyle(l.path);
    const rescene = this.setScene(l.scene);
    const redressed = this.dress();
    if (restyle || rescene || redressed) this.refreshShare();
  }

  /** The egg world the stage is in, if any (secret mode and Home Alone keep their own tree). */
  private get world(): 'secret' | 'home-alone' | null {
    return this.secret ? 'secret' : this.homeAlone ? 'home-alone' : null;
  }

  /**
   * Dress the tree: the look, less what the egg world takes away. The drawer shows the look, and the world it waits out.
   * Says whether the stage repainted.
   */
  private dress(): boolean {
    const repainted = this.renderer.setDress(worldLook(this.look, this.world));
    this.decorate.sync();
    return repainted;
  }

  /** From the menu (closed by now): whatever would sit over the drawer or the framed stage goes first. */
  private openDecorate(): void {
    this.radioPanel.close();
    this.accounts.closeMenu();
    this.keyCard.close();
    // The frame crops around the tree as it stands at rest.
    if (isZoomed(this.camera)) this.setCamera(IDENTITY);
    this.decorate.open();
  }

  /**
   * Secret mode follows the head (spec 2026-10-08 secret mode §1). 'start': the first applyLook puts the scene up.
   * 'loud' (the player's toggle): the sky sweeps from the flip's midpoint and the Secret station plays. 'quiet' (a
   * sign-in, a sticker that failed): at once, and nothing starts. The egg's `flipped` re-renders the share image.
   */
  private setSecret(on: boolean, how: 'start' | 'loud' | 'quiet'): void {
    if (this.waitForEggs(on, () => this.setSecret(on, how))) return;
    const changed = on !== this.secret;
    this.secret = on;
    this.dress();
    // Never both (spec 2026-10-14 §1): the head turns Home Alone off, kept off here and on the account.
    if (on && this.homeAlone) this.alone.off();
    this.radio.setSecret(on, how === 'loud');
    if (on && changed) {
      this.radio.show.beat?.reset();
      this.winSound?.preload(this.radio.secretWinSound(), audio.ctx);
    }
    if (how === 'start' || !changed) return;
    if (!on && this.homeAlone) return; // Home Alone is taking over: it puts its own scene up
    const reduced = this.reduced.matches;
    const sweep = how === 'loud' ? { now: performance.now() + (reduced ? 0 : FLIP_MS / 2), reduced, kind: 'sweep' as const } : null;
    this.pausedDrawn = false;
    this.setScene(this.sceneId, sweep);
  }

  /**
   * Home Alone mode (spec 2026-10-14 §1). Never with the head: switching on turns it off (kept off), and secret mode
   * leaves with it. The radio is never touched here. 'start': the first applyLook puts the scene up.
   */
  private setHomeAlone(on: boolean, how: 'start' | 'loud' | 'quiet'): void {
    if (this.waitForEggs(on, () => this.setHomeAlone(on, how))) return;
    const changed = on !== this.homeAlone;
    this.homeAlone = on;
    this.dress();
    // Also while the account's head is still loading (not on yet): off() drops it and tells the account.
    if (on) this.egg.off();
    if (on) {
      this.sounds?.preload();
      this.glare?.preload();
    } else this.glare?.cancel();
    this.results.setLine(on ? HOME_ALONE_LINE : null); // a tag already up follows the mode (its share image re-renders with the scene)
    if (how === 'start' || !changed) return;
    this.pausedDrawn = false;
    if (!on && this.secret) return; // the head is taking over: its own sweep re-scenes
    // The player's own switch cross-fades (instant under reduced motion); a load or sign-in switches at once.
    const reduced = this.reduced.matches;
    const fade = how === 'loud' && !reduced ? { now: performance.now(), reduced, kind: 'fade' as const } : null;
    if (this.setScene(this.sceneId, fade)) this.refreshShare();
    // The player's own switch-on screams (spec §5), and Harry and Marv walk by to welcome them (§9.1); a load or
    // sign-in is silent and still.
    if (on && how === 'loud') {
      this.sounds?.play('scream', () => this.homeAlone);
      const house = this.renderer.homeAlone;
      house?.welcome();
      if (house) this.busy(performance.now() + house.welcomeMs()); // the walk-by they asked for: full rate
    }
  }

  /**
   * Returns whether the scene changed. In secret mode the stage shows the aurora whatever the hour, in Home Alone mode
   * the house; `id` still drives the radio's suggestion.
   */
  private setScene(id: SceneId, change: SceneChange | null = null): boolean {
    this.radio.setScene(id);
    const scene = withPalette(sceneFor(id, this.secret, this.homeAlone), worldLook(this.look, this.world).palette);
    if (id === this.sceneId && this.renderer.scene === scene) return false;
    this.sceneId = id;
    document.body.dataset.scene = scene.id;
    this.renderer.setScene(scene, change);
    return true;
  }

  /**
   * The radio pill takes the widest label (station · title · artist, station · title, station, short name, icon only)
   * that leaves the wordmark clear, first beside the account chip's full name, then beside its initial alone; then the
   * tagline is placed around the HUD's new width.
   */
  private fitHud(): void {
    if (!this.laidOut) return;
    const pill = document.getElementById('radio-pill');
    const chip = document.getElementById('account-chip');
    const hud = document.querySelector('.hud');
    const mark = document.querySelector('.wordmark');
    if (pill && hud && mark) {
      const markRight = mark.getBoundingClientRect().right;
      const clear = (): boolean => hud.getBoundingClientRect().left - markRight >= 16;
      fit: for (const chipFit of ['full', 'icon']) {
        if (chip) chip.dataset.fit = chipFit;
        for (const fit of ['full', 'title', 'name', 'short', 'icon']) {
          pill.dataset.fit = fit;
          if (clear()) break fit;
        }
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
    this.fitKeyCard();
    el('zoom-reset').hidden = true;
    this.pausedDrawn = false; // resizing clears the stage
    this.refreshShare();
  }

  /**
   * The key card takes the room right of the tree, never over it: centred if it stands clear of the tree's edge across
   * its band (wide, else slim); failing that docked high, its top just under the garland where the tree is narrow
   * (wide, else slim); failing that it and its hint stay away. Run on every resize and when the camera moves (a zoomed
   * tree has no card).
   */
  private fitKeyCard(): void {
    const L = this.renderer.layout;
    if (isZoomed(this.camera)) return this.keyCard.fit(0);
    const centreBottom = L.h / 2 + CARD_HEIGHT / 2;
    const highTop = Math.ceil(this.renderer.garland.geo.bottom) + CARD_HIGH_GAP;
    const highEdge = highTop + CARD_HEIGHT <= L.h - CARD_HIGH_GAP ? treeRightEdge(L, highTop + CARD_HEIGHT) : Infinity;
    const f = cardFit(L.w, treeRightEdge(L, centreBottom), highEdge, this.touchOnly.matches);
    this.keyCard.fit(f.width, f.dock, highTop);
  }

  /** A run in progress in the house: the moment for "Kevin!". */
  private runInHouse(): boolean {
    return this.homeAlone && this.live && !this.starting && this.moved && this.winAt === null;
  }

  private runFlags(): RunFlags {
    return { live: this.live, starting: this.starting, winAt: this.winAt, paused: this.paused, now: performance.now() };
  }

  private bindLifecycle(): void {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden || !this.live) return;
      const now = performance.now();
      if (this.canPause(now)) this.pause(false);
      else if (this.winAt === null && !this.starting) {
        // During the reveal the clock hasn't started: the log notes the time away (it resumes with the clock), and a
        // restored game is still saved.
        this.run.markAway(now);
        if (this.moved) this.save(now);
      }
    });
    // "Kevin!" (spec 2026-10-14 §5): back after ≥ 3 s away while a run is in progress.
    // The context is resumed first (a phone's may be suspended in the background), and the call dropped if, by the time
    // it is ready, the tab is hidden again or the run is over.
    document.addEventListener('visibilitychange', () => {
      const now = Date.now();
      if (document.hidden) {
        this.kevin?.hide(now);
        return;
      }
      // No run yet while the first tree loads (a tab shown during the load).
      const board = this.run?.board;
      const still = () => !document.hidden && this.run?.board === board && this.runInHouse();
      // (No call before the eggs have loaded: the house waits for them, so no run was in it.)
      void this.kevin?.show(now, this.runInHouse(), () => this.sounds?.playResumed('kevin', still) ?? false);
    });
    addEventListener('pagehide', () => {
      if (!this.live || this.starting || this.winAt !== null) return;
      const now = performance.now();
      // A reload counts as a pause (spec §5.2): the log says so, and a page back from the back-forward cache shows the pause overlay.
      if (this.canPause(now)) this.pause(false);
      else this.run.markAway(now);
      if (this.moved) this.save(now);
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
    // The hint under the HUD pills pins the card; clicking it again, or Escape or Tab, closes it.
    el('keys-hint').addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.keyCard.open) this.keyCard.close();
      else this.keyCard.pin();
    });
    // Tab held shows the card, so its release hides it (a pinned card stays). Not guarded: a release is always safe.
    document.addEventListener('keyup', (e) => {
      if (e.key === 'Tab') this.keyCard.hide();
    });
    addEventListener('blur', () => this.keyCard.hide());
    document.addEventListener('keydown', (e) => {
      this.renderer.homeAlone?.input();
      // The settings and radio dialogs and the Decorate drawer handle their own Escape (and mark it handled). Keys never
      // reach the game while the menu or the drawer is open, or while focus is inside the radio panel; the desktop popover
      // stays open while you play, so with focus back on the game (or nowhere) P still pauses.
      if (
        e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || this.menu.isOpen || this.decorate.isOpen || this.radioPanel.hasFocus ||
        this.accounts.blocksKeys || isEditable(e.target)
      )
        return;
      // The first letter of an egg's word ("hohoho", "kevin") starts loading the eggs, if they aren't in yet.
      if (!this.paused && !this.eggs && (e.key === 'h' || e.key === 'H' || e.key === 'k' || e.key === 'K')) void this.requestEggs();
      // "hohoho" swaps the topper, as five taps on the star do (not under the pause overlay, like the taps).
      if (!this.paused && this.egg.key(e, performance.now())) {
        this.sfx.unlock();
        return;
      }
      // "kevin" switches Home Alone mode (spec 2026-10-14 §1), under the same rules as "hohoho".
      if (!this.paused && this.alone.key(e, performance.now())) return;
      if (e.key === 'Tab') {
        // Tab is the game's only where the card fits beside the tree; elsewhere (and with Shift) it moves focus as usual.
        if (e.shiftKey || this.paused || !this.keyCard.fitted) return;
        e.preventDefault();
        // Only the first press acts: a held Tab repeats keydown, and a repeat must not reopen what it just closed.
        if (e.repeat) return;
        if (this.keyCard.isPinned) this.keyCard.close();
        else this.keyCard.show();
      } else if (e.key === 'Escape') {
        // Escape pauses and resumes, like P (pause() checks canPause: nothing to pause at the reveal or after the win).
        e.preventDefault();
        // A held key repeats keydown: only the first press toggles (as for P).
        if (e.repeat) return;
        if (this.paused) this.resume();
        else this.pause(true);
      } else if ((e.key === 'p' || e.key === 'P') && !e.repeat) {
        e.preventDefault();
        if (this.paused) this.resume();
        else this.pause(true);
      } else if ((e.key === 'n' || e.key === 'N') && !e.repeat && !this.paused && !this.starting) {
        // N is the New tree button: mid-run the first press only asks (the menu's 3 s confirm), the second starts.
        e.preventDefault();
        if (this.menu.requestNewTree() === 'armed') this.toast.show('Press N again for a new tree', NEW_TREE_CONFIRM_MS);
      }
    });
  }

  /** Pausing makes sense only while the clock can run: a tree on screen, after the reveal and before the win. */
  private canPause(now: number): boolean {
    return this.live && !this.starting && now >= this.interactiveAt && this.winAt === null;
  }

  /**
   * The pause button, the P key and a hidden tab all land here: stop the clock, blur the stage behind the overlay
   * and save. `focus` moves keyboard focus onto the overlay (a user-initiated pause), so Enter or Space resumes.
   */
  private pause(focus: boolean): void {
    const now = performance.now();
    if (this.paused || !this.canPause(now)) return;
    this.run.pause(now);
    this.setPaused(true);
    if (focus) el('pause').focus({ preventScroll: true });
    if (this.moved) this.save(now);
  }

  private resume(): void {
    if (!this.paused) return;
    const hadFocus = document.activeElement === el('pause');
    this.setPaused(false);
    // The clock (and the log) resume right away, so a tap before the next frame is never logged inside the pause.
    // Date.now() lets the log catch up with time a sleeping phone hid from performance.now() (Run.resumeIfDue).
    const now = performance.now();
    this.handle(this.run.resume(now, Date.now()), now);
    const btn = el('pause-btn');
    if (hadFocus && !btn.hidden) btn.focus({ preventScroll: true });
  }

  /** Pause state and its DOM: blurred stage, overlay, and the controls beneath it taken out of reach (inert). */
  private setPaused(on: boolean): void {
    if (on) {
      // The dialogs would otherwise sit on top of the pause overlay, inert.
      this.menu.close();
      this.decorate.close();
      this.radioPanel.close();
      this.accounts.closeMenu();
    }
    if (on) this.keyCard.close();
    this.paused = on;
    this.pausedDrawn = false;
    document.body.classList.toggle('paused', on);
    if (on) this.frost.show(this.reduced.matches);
    else this.frost.hide();
    for (const sel of ['.hud', '#menu', '#radio-panel', '#account-menu']) {
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

  /** The star's centre on screen (the camera applied): where a finger taps it. */
  starScreenCenter(): [number, number] {
    const [x, y] = starCenter(this.renderer.layout);
    return toScreen(this.camera, x, y);
  }

  /** The egg's state: the head is (or is landing) on top; a flip is under way; the star taps toward the next toggle. */
  get starHead(): { head: boolean; flipping: boolean; taps: number } {
    return { head: this.egg.isOn, flipping: this.renderer.topper.busy(performance.now()), taps: this.egg.tapCount };
  }

  /** Secret mode for the test probe: see SecretState. */
  get secretState(): SecretState {
    const f = this.renderer.faceInfo();
    return {
      on: this.secret, scene: this.renderer.scene.id, sweeping: this.renderer.sweeping, faceTile: f.tile, faceGift: f.gift, faceGarland: f.garland,
      adlibsAsked: this.adlibs.asked, adlibsPlayed: this.adlibs.played,
    };
  }

  /** Home Alone mode for the test probe: see HomeAloneState. */
  get homeAloneState(): HomeAloneState {
    return {
      on: this.homeAlone, scene: this.renderer.scene.id, fading: this.renderer.sweeping, ...(this.renderer.homeAlone?.state() ?? NO_LAYER),
      asked: { ...(this.sounds?.asked ?? noClips()) }, played: { ...(this.sounds?.played ?? noClips()) },
      line: document.getElementById('r-merry')?.textContent === HOME_ALONE_LINE,
      shares: this.shareSeen.n, shareLine: this.shareSeen.line,
      hector: this.glare?.showing ?? false, glares: this.glares,
    };
  }

  /** The probe's way to a trap or gag now (the mode on, motion allowed); false if it couldn't. */
  forceTrap(kind: TrapKind, at?: [number, number]): boolean {
    if (!this.homeAlone || this.reduced.matches) return false;
    return this.renderer.homeAlone?.force(kind, performance.now(), this.renderer.layout, at) ?? false;
  }

  debugSolve(): void {
    if (!this.live) return;
    const now = performance.now();
    this.handle(this.board.debugSolve(), now);
  }

  get started(): boolean {
    return this.live;
  }
  get isStarting(): boolean {
    return this.starting;
  }
  get gameId(): string | null {
    return this.online?.gameId ?? null;
  }
  get runOutcome(): RunOutcome | null {
    return this.outcome;
  }
  /** The game clock's reading now (0 until the reveal ends and it starts). */
  get clockMs(): number {
    return this.run ? this.clock.elapsedMs(performance.now()) : 0;
  }
  get logLength(): number {
    return this.run?.log.entries.length ?? 0;
  }
}
