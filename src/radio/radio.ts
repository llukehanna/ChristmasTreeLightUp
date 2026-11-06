import { audio } from '../audio/context';
import type { SceneId } from '../render/scenes';
import { loadRadioSettings, saveRadioSettings, type RadioSettings } from '../store/radio-settings';
import { whenIdle } from '../ui/idle';
import { AMBIENT_ID, type AmbientKind, ambientKind, CELESTA_ID, isAmbient, isSynthSource, MUSIC_BOX_ID, SCENE_STATION } from './builtin';
import type { AmbientSynth } from './ambient-kit';
import { CAROLS } from './carols';
import { loadCatalog } from './catalog';
import { parseEmbed, type Embed } from './embed';
import { Fireplace } from './fireplace';
import { FIREPLACE_ID, isSecretSource, SECRET_ID } from './ids';
import { LightShow } from './lightshow';
import { CELESTA, MusicBox } from './musicbox';
import { RadioPlayer, type RemoteAction } from './player';
import { Rain } from './rain';
import type { Station, Track } from './schema';
import type { RadioSnapshot, SecretEvent, SecretState, secretStep } from './secret';
import { Storm } from './storm';

export type SourceKind = 'station' | 'musicbox' | 'celesta' | AmbientKind | 'embed';

export interface RadioView {
  kind: SourceKind | null;
  playing: boolean;
  station: Station | null;
  track: Track | null;
  position: number;
  duration: number;
  stations: Station[];
  unavailable: (id: string) => boolean;
  embed: Embed | null;
  remoteOk: boolean;
  settings: RadioSettings;
  /** Secret mode is on (spec 2026-10-08 secret mode): the panel shows the Secret row. */
  secretMode: boolean;
  /** The catalog's Secret station, playable or not (never in `stations`). */
  secretStation: Station | null;
}

const FIRST_FADE_S = 2;

/** The order the ambiences are pre-generated in, after the remembered one. */
const WARM_ORDER: readonly AmbientKind[] = ['fireplace', 'rain', 'storm'];

/** `whenIdle`, but a hidden tab does no work: a slice that comes due there waits for the tab to be visible again. */
function idleWhileVisible(fn: () => void): void {
  whenIdle(() => {
    if (document.visibilityState === 'visible') return fn();
    const back = (): void => {
      if (document.visibilityState !== 'visible') return;
      document.removeEventListener('visibilitychange', back);
      idleWhileVisible(fn);
    };
    document.addEventListener('visibilitychange', back);
  });
}

export class Radio {
  onChange: (() => void) | null = null;
  /** A source the player hasn't earned yet (Rain, Storm: src/core/catalogue.ts). Remembered, it is never autoplayed. */
  locked: (source: string) => boolean = () => false;
  readonly show: LightShow;
  private settings = loadRadioSettings();
  private catalog: Station[] = [];
  private remoteOk = true;
  private readonly player = new RadioPlayer(() => audio.music);
  private readonly fireplace = new Fireplace();
  private readonly rain = new Rain();
  private readonly storm = new Storm();
  private readonly musicbox = new MusicBox();
  /** Secret mode's fallback when the Secret station can't play. */
  private readonly celesta = new MusicBox(CAROLS, Math.random, CELESTA);
  private secret: SecretState = { on: false, saved: null };
  /** Secret mode's hold on the radio (src/radio/secret.ts, an egg): handed over once the eggs have loaded. */
  private secretStep: typeof secretStep | null = null;
  /** Switched on by hand before the catalog arrived: play the Secret station (or the celesta) when it does. */
  private pendingSecret = false;
  /** The player's first move has been handled (it may come after secret mode already primed the bus). */
  private greeted = false;
  private embed: Embed | null;
  private kind: SourceKind | null = null;
  private started = false;
  /** AudioContext time until which the first-gesture fade-in is still ramping the music bus. */
  private fadeInUntil = 0;
  /** AudioContext time until which a duck holds the music down (a win ad-lib's length): a later, shorter duck keeps it. */
  private duckUntil = 0;
  private loaded = false;
  /** The first gesture came before the catalog did: start the preferred station as soon as it arrives. */
  private pendingStart = false;
  private catalogSeq = 0;
  private sceneId: SceneId = 'fireside';
  private analyser: AnalyserNode | null = null;
  /** prewarm() has run. */
  private warmed = false;

  constructor() {
    this.player.onChange = () => this.onChange?.();
    this.player.onRemote = (action) => this.onRemote(action);
    this.player.onUnavailable = (wasPlaying) => this.onStationUnavailable(wasPlaying);
    this.musicbox.onChange = () => {
      if (this.kind === 'musicbox') this.syncMusicBoxSession();
      this.onChange?.();
    };
    this.celesta.onChange = () => {
      if (this.kind === 'celesta') this.syncMusicBoxSession();
      this.onChange?.();
    };
    this.show = new LightShow(() => this.analyser);
    this.embed = this.settings.embedUrl ? parseEmbed(this.settings.embedUrl) : null;
    void this.refreshCatalog();
  }

  async refreshCatalog(): Promise<void> {
    const seq = ++this.catalogSeq;
    const c = await loadCatalog();
    if (seq !== this.catalogSeq) return; // a newer refresh is in flight: the last one started wins
    this.catalog = c.stations;
    this.remoteOk = c.remoteOk;
    this.loaded = true;
    // Decks were primed and the context unlocked inside the first gesture, so this non-gesture start is allowed.
    if (this.pendingSecret) {
      this.pendingStart = false;
      this.playSecret();
    } else if (this.pendingStart) {
      this.pendingStart = false;
      if (this.settings.on) this.startPreferred();
    }
    this.onChange?.();
  }

  /** The station catalog has been fetched (or given up on). */
  get catalogLoaded(): boolean {
    return this.loaded;
  }

  /**
   * Call from every user gesture. The first one fades music in and starts the remembered source or the suggestion
   * (spec §5.2), unless something already plays or is waiting for the catalog.
   */
  firstGesture(): void {
    this.prepare();
    if (this.greeted) return;
    this.greeted = true;
    if (this.settings.on && this.kind === null && !this.pendingStart && !this.pendingSecret) this.startPreferred();
  }

  /**
   * Makes the ambiences' noise at idle, a buffer at a time, so starting one never stalls (100 to 190 ms in Chrome otherwise):
   * the remembered ambience first, then the others. Once only, and nothing before the context exists. A buffer can
   * take over 100 ms to make, so a slice runs only while `canWork` says so (the app: never during a run); otherwise
   * it waits for the next idle moment and asks again.
   */
  prewarm(canWork: () => boolean = () => true): void {
    const ctx = audio.ctx;
    if (this.warmed || !ctx) return;
    this.warmed = true;
    const first = ambientKind(this.remembered());
    const order = [...(first ? [first] : []), ...WARM_ORDER.filter((k) => k !== first)];
    const slice = (fn: () => void): void => idleWhileVisible(() => (canWork() ? fn() : slice(fn)));
    void (async () => {
      for (const kind of order) await this.ambience(kind).prewarm(ctx, slice);
    })().catch(() => {
      /* nothing is lost: a start makes whatever is missing (and reports a real failure itself) */
    });
  }

  setScene(id: SceneId): void {
    this.sceneId = id;
  }

  /** Secret mode is on (spec 2026-10-08 secret mode §4.4). */
  get secretMode(): boolean {
    return this.secret.on;
  }

  /**
   * Inside the gesture that is turning secret mode on: unlock, fade the bus in and prime the decks, so the start that
   * follows the sticker's load (outside the gesture) may play.
   */
  primeSecret(): void {
    this.prepare();
    this.player.prime();
  }

  /** The eggs have loaded (src/eggs/load.ts): secret mode can take the radio over from now on. */
  attachSecret(step: typeof secretStep): void {
    this.secretStep = step;
  }

  /**
   * Secret mode switched. `autoplay`: by the player's own hand, so the Secret station plays (unless muted). The app
   * switches it on only once the eggs have loaded; before then it is off, and off again changes nothing.
   */
  setSecret(on: boolean, autoplay: boolean): void {
    const secretStep = this.secretStep;
    if (!secretStep) {
      if (!on) this.onChange?.();
      return;
    }
    const e: SecretEvent = on
      ? { type: 'on', autoplay, muted: this.settings.volume <= 0, current: this.snapshotNow() }
      : { type: 'off', playingSecret: this.playingSecret(), musicOn: this.settings.on };
    const { state, effect } = secretStep(this.secret, e);
    this.secret = state;
    if (!state.on) this.pendingSecret = false;
    if (effect.kind === 'play-secret') this.playSecret();
    else if (effect.kind === 'restore') this.restore(effect.to);
    else if (effect.kind === 'leave') {
      this.stopAll();
      if (effect.resume) this.startPreferred();
    }
    this.onChange?.();
  }

  /** The Secret station's win ad-lib, if it has one. */
  secretWinSound(): string | null {
    return this.catalog.find((s) => s.id === SECRET_ID)?.winSound ?? null;
  }

  /** An explicit choice by the listener: remembered as the preferred source (the Secret row never is). */
  select(source: string): void {
    if (source === CELESTA_ID) return; // reached through the Secret row only
    if (source === SECRET_ID) {
      if (this.secret.on) {
        this.primeSecret(); // this is the gesture: unlock and prime now, in case the start waits for the catalog
        this.playSecret();
      }
      return;
    }
    if (this.play(source, true)) this.choice();
  }

  setEmbed(url: string): Embed | null {
    const e = parseEmbed(url);
    if (!e) return null;
    this.embed = e;
    this.settings = { ...this.settings, embedUrl: url };
    this.select('embed');
    return e;
  }

  playPause(): void {
    this.prepare();
    this.choice();
    if (this.pendingStart) {
      // Paused while still waiting for the catalog: cancel the pending start.
      this.pendingStart = false;
      this.save({ on: false });
      return;
    }
    if (this.kind === 'station') {
      if (this.player.snapshot().playing) this.player.pause();
      else this.player.resume();
    } else if (isAmbient(this.kind) || this.kind === 'musicbox' || this.kind === 'celesta' || this.kind === 'embed') {
      this.stopAll();
    } else {
      this.startPreferred();
    }
    this.save({ on: this.isPlaying() || this.pendingStart });
  }

  next(): void {
    if (this.kind === 'station') this.player.next();
    else if (this.kind === 'musicbox') this.musicbox.next();
    else if (this.kind === 'celesta') this.celesta.next();
  }
  prev(): void {
    if (this.kind === 'station') this.player.prev();
    else if (this.kind === 'musicbox') this.musicbox.prev();
    else if (this.kind === 'celesta') this.celesta.prev();
  }
  seek(sec: number): void {
    if (this.kind === 'station') this.player.seek(sec);
  }

  setVolume(v: number): void {
    const volume = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : this.settings.volume;
    this.save({ volume });
    const m = audio.music;
    const ctx = audio.ctx;
    if (!m || !ctx || !this.started) return;
    // Take over from any ramp in flight (the first-gesture fade-in, a duck) instead of overlapping it.
    const t = ctx.currentTime;
    m.gain.cancelScheduledValues(t);
    m.gain.setValueAtTime(m.gain.value, t);
    m.gain.setTargetAtTime(volume, t, 0.05);
    this.fadeInUntil = 0;
    this.duckUntil = 0; // the listener's level takes over from any held duck
  }

  setLightShow(on: boolean): void {
    this.save({ lightShow: on });
  }

  /**
   * Game sounds duck the music ~4 dB for ~250 ms (spec §5.1). `holdS` keeps it down that much longer: a spoken win
   * ad-lib (secret mode §4.6) ducks for its whole length.
   */
  duck(holdS = 0): void {
    const m = audio.music;
    const ctx = audio.ctx;
    if (!m || !ctx || !this.started) return;
    const t = ctx.currentTime;
    // Ducking cancels scheduled gain events; doing that mid fade-in would snap the music to full volume.
    if (t < this.fadeInUntil) return;
    const v = this.settings.volume;
    const hold = Number.isFinite(holdS) ? Math.max(0, holdS) : 0;
    // A tick under a held ad-lib re-schedules the bus: it keeps the music down until the longer of the two ends.
    const until = Math.max(t + 0.03 + hold, this.duckUntil);
    this.duckUntil = until;
    m.gain.cancelScheduledValues(t);
    m.gain.setValueAtTime(m.gain.value, t);
    m.gain.linearRampToValueAtTime(v * 0.63, t + 0.03);
    if (until > t + 0.03) m.gain.linearRampToValueAtTime(v * 0.63, until);
    m.gain.linearRampToValueAtTime(v, until + 0.25);
  }

  /** The light show needs analysable audio: our stations, Music Box or an ambience (Fireplace, Rain, Storm), not embeds (spec §5.4). Reduced motion is the caller's check. */
  get lightShowActive(): boolean {
    return this.settings.lightShow && this.kind !== null && this.kind !== 'embed' && this.isPlaying();
  }

  /** The source playing now (a station's or a built-in's id), or null: a finished run's context. */
  get nowPlaying(): string | null {
    return this.kind === 'celesta' ? CELESTA_ID : this.snapshotNow().source;
  }

  view(): RadioView {
    const snap = this.player.snapshot();
    const box = this.kind === 'musicbox' ? this.musicbox : this.kind === 'celesta' ? this.celesta : null;
    const carol = box?.current() ?? null;
    const boxId = this.kind === 'celesta' ? CELESTA_ID : MUSIC_BOX_ID;
    return {
      kind: this.kind,
      playing: this.isPlaying(),
      station: this.kind === 'station' ? snap.station : null,
      track: carol
        ? { id: `${boxId}:${carol.id}`, url: '', title: carol.title, artist: carol.artist, credit: carol.credit, duration: carol.duration }
        : this.kind === 'station'
          ? snap.track
          : null,
      position: carol ? carol.position : snap.position,
      duration: carol ? carol.duration : snap.duration,
      stations: this.catalog.filter((s) => s.id !== SECRET_ID),
      unavailable: (id) => this.player.isUnavailable(id),
      embed: this.embed,
      remoteOk: this.remoteOk,
      settings: this.settings,
      secretMode: this.secret.on,
      secretStation: this.catalog.find((s) => s.id === SECRET_ID) ?? null,
    };
  }

  /**
   * Unlocks the context, taps the music bus with the analyser and, the first time, fades the bus in.
   * Returns true only on that first successful call. Synchronous, so it stays inside the user gesture.
   */
  private prepare(): boolean {
    const ctx = audio.unlock();
    if (!ctx || !audio.music) return false;
    if (!this.analyser) {
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.6;
      audio.music.connect(this.analyser);
    }
    if (this.started) return false;
    this.started = true;
    audio.music.gain.setValueAtTime(0, ctx.currentTime);
    audio.music.gain.linearRampToValueAtTime(this.settings.volume, ctx.currentTime + FIRST_FADE_S);
    this.fadeInUntil = ctx.currentTime + FIRST_FADE_S;
    return true;
  }

  private isPlaying(): boolean {
    return isAmbient(this.kind) || this.kind === 'musicbox' || this.kind === 'celesta' || this.kind === 'embed' || (this.kind === 'station' && this.player.snapshot().playing);
  }

  private playable(s: Station): boolean {
    return s.tracks.length > 0 && !this.player.isUnavailable(s.id);
  }

  /** Music Box, the ambiences and a set-up embed work without the station catalog, and so does a scene that suggests Music Box. */
  private needsCatalog(): boolean {
    const s = this.remembered();
    if (isSynthSource(s) || (s === 'embed' && this.embed)) return false;
    if (s === null && this.secret.on) return true; // the suggestion is the Secret station, if the catalog has one
    return !(s === null && isSynthSource(SCENE_STATION[this.sceneId]));
  }

  private preferredSource(): string {
    const s = this.remembered();
    // The remembered choice stays saved, so it plays again once earned; until then the Fireplace (always free) stands in.
    if (s !== null && this.locked(s)) return FIREPLACE_ID;
    if (isSynthSource(s) || (s === 'embed' && this.embed)) return s;
    const byId = (id: string | null): Station | undefined => (id === null ? undefined : this.catalog.find((x) => x.id === id && this.playable(x)));
    // In secret mode the Secret station (or the celesta) is the suggestion, as a scene's station is otherwise.
    const suggested = this.secret.on ? this.secretSource() : SCENE_STATION[this.sceneId];
    const chosen =
      byId(s)?.id ??
      (isSynthSource(suggested) ? suggested : byId(suggested)?.id) ??
      this.catalog.find((x) => x.id !== SECRET_ID && this.playable(x))?.id;
    return chosen ?? MUSIC_BOX_ID; // the catalog has loaded with nothing usable: Music Box is always there
  }

  /** The listener's remembered source. A secret source is never remembered: one in an old or edited save reads as none. */
  private remembered(): string | null {
    const s = this.settings.source;
    return isSecretSource(s) ? null : s;
  }

  /** Start the remembered source, or the scene's suggestion. Following a suggestion isn't a choice, so `source` is left as it was. */
  private startPreferred(): void {
    if (this.needsCatalog() && !this.loaded) {
      // Prime the decks now (this is the gesture); refreshCatalog starts playback when the catalog arrives.
      this.player.prime();
      this.pendingStart = true;
      return;
    }
    this.play(this.preferredSource(), false);
  }

  /**
   * Lock-screen / headset keys. A playing or paused station, or a playing Music Box, owns them; otherwise they are
   * swallowed, so a remote key never wakes a stopped source.
   */
  private onRemote(action: RemoteAction): boolean {
    if (this.kind === 'musicbox' || this.kind === 'celesta') {
      if (action === 'pause') this.playPause(); // stops it, saving `on`
      else if (action === 'nexttrack') this.next();
      else if (action === 'previoustrack') this.prev();
      return true; // play: already playing; seekto: not supported
    }
    if (this.kind !== 'station') return true;
    const playing = this.player.snapshot().playing;
    if (action === 'play') {
      if (!playing) this.playPause(); // routed through here so `on` is saved
      return true;
    }
    if (action === 'pause') {
      if (playing) this.playPause();
      return true;
    }
    return false; // next / previous / seek: the player handles them
  }

  /**
   * The station failed 3 times in a row (spec §8). A playing one falls back to Music Box (spec §5.2), which is not a
   * choice, so nothing is remembered; a paused one is let go, so the play button starts the preferred source instead
   * of a station that can't play.
   */
  private onStationUnavailable(wasPlaying: boolean): void {
    if (this.kind !== 'station') return; // another source has already taken over
    if (wasPlaying) {
      // The Secret station falls back to the celesta; any other to the Music Box.
      this.play(this.player.snapshot().station?.id === SECRET_ID ? CELESTA_ID : MUSIC_BOX_ID, false);
    } else {
      this.stopAll();
      this.onChange?.();
    }
  }

  /** Returns false when the source can't play (unknown, unplayable, no context): the current source is left alone. */
  private play(source: string, remember: boolean): boolean {
    // Validate before touching anything, so a bad pick leaves the current source playing.
    let station: Station | undefined;
    if (source === 'embed') {
      if (!this.embed) return false;
    } else if (!isSynthSource(source)) {
      station = this.catalog.find((s) => s.id === source);
      if (!station || !this.playable(station)) return false;
    }
    this.prepare();
    const ctx = audio.ctx;
    if (isSynthSource(source) && (!ctx || !audio.music)) return false;
    this.pendingStart = false; // an explicit or resolved choice supersedes any waiting start
    const amb = ambientKind(source);
    const already =
      (amb !== null && this.kind === amb) ||
      (source === MUSIC_BOX_ID && this.kind === 'musicbox') ||
      (source === CELESTA_ID && this.kind === 'celesta') ||
      (source === 'embed' && this.kind === 'embed') ||
      (station !== undefined && this.kind === 'station' && this.player.snapshot().station?.id === station.id);
    if (already) {
      // Re-selecting what is already the source must not restart it (a paused station just resumes).
      if (station && !this.player.snapshot().playing) this.player.resume();
      this.save({ on: true, ...(remember ? { source } : {}) });
      return true;
    }
    this.stopAll();
    if (amb && ctx && audio.music) {
      this.ambience(amb).start(ctx, audio.music);
      this.kind = amb;
    } else if ((source === MUSIC_BOX_ID || source === CELESTA_ID) && ctx && audio.music) {
      const box = source === CELESTA_ID ? this.celesta : this.musicbox;
      box.start(ctx, audio.music);
      this.kind = source === CELESTA_ID ? 'celesta' : 'musicbox';
      this.player.claimMediaSession();
      this.syncMusicBoxSession();
    } else if (station) {
      this.player.playStation(station);
      this.kind = 'station';
    } else {
      this.kind = 'embed';
    }
    this.save({ on: true, ...(remember ? { source } : {}) });
    return true;
  }

  private ambience(kind: AmbientKind): AmbientSynth {
    return kind === 'rain' ? this.rain : kind === 'storm' ? this.storm : this.fireplace;
  }

  private stopAll(): void {
    this.player.stop();
    this.player.releaseMediaSession();
    this.fireplace.stop(audio.ctx);
    this.rain.stop(audio.ctx);
    this.storm.stop(audio.ctx);
    this.musicbox.stop(audio.ctx);
    this.celesta.stop(audio.ctx);
    this.kind = null;
  }

  /** What the radio is doing now, for secret mode to put back later. */
  private snapshotNow(): RadioSnapshot {
    let source: string | null = null;
    if (this.isPlaying()) {
      if (this.kind === 'station') source = this.player.snapshot().station?.id ?? null;
      else if (this.kind === 'musicbox') source = MUSIC_BOX_ID;
      else if (isAmbient(this.kind)) source = AMBIENT_ID[this.kind];
      else if (this.kind === 'embed') source = 'embed';
    }
    const pending = source === null && this.pendingStart && this.settings.on;
    return { source, pending, on: this.settings.on, remembered: this.settings.source };
  }

  private playingSecret(): boolean {
    return this.kind === 'celesta' || (this.kind === 'station' && this.player.snapshot().station?.id === SECRET_ID);
  }

  /** The Secret station if it can play, else the celesta. */
  private secretSource(): string {
    const s = this.catalog.find((x) => x.id === SECRET_ID);
    return s && this.playable(s) ? SECRET_ID : CELESTA_ID;
  }

  /** Plays the Secret station (or the celesta), never remembered. Before the catalog has loaded, waits for it. */
  private playSecret(): void {
    if (!this.loaded) {
      this.pendingSecret = true;
      return;
    }
    this.pendingSecret = false;
    this.play(this.secretSource(), false);
  }

  /** Puts back what secret mode took over: its source (or silence) and the listener's saved settings. */
  private restore(to: RadioSnapshot): void {
    const back = to.source !== null && this.play(to.source, false);
    if (!back) this.stopAll();
    this.save({ on: to.on, source: to.remembered });
    // The first move had asked for music that secret mode then took over: start it now.
    if (!back && to.pending && to.on) this.startPreferred();
  }

  /** The listener's own choice: secret mode no longer puts the old source back over it. */
  private choice(): void {
    const held = this.secret.saved !== null;
    if (this.secretStep) this.secret = this.secretStep(this.secret, { type: 'choice' }).state; // never on before it loads
    this.pendingSecret = false;
    if (held) saveRadioSettings(this.settings); // the live settings are the listener's own again: persist them
  }

  /** Lock-screen metadata for the carol that is playing. */
  private syncMusicBoxSession(): void {
    if (!('mediaSession' in navigator)) return;
    const c = (this.kind === 'celesta' ? this.celesta : this.musicbox).current();
    try {
      navigator.mediaSession.metadata =
        c && typeof MediaMetadata === 'function' ? new MediaMetadata({ title: c.title, artist: c.artist, album: 'Aglow Radio' }) : null;
      navigator.mediaSession.playbackState = 'playing';
    } catch {
      /* unsupported: ignore */
    }
  }

  /**
   * While secret mode holds a snapshot, storage keeps the music on/off and remembered source that switching off would
   * restore; the live values stay in memory. A reload mid secret mode (which loses the snapshot) then never turns the
   * listener's music back on.
   */
  private save(p: Partial<RadioSettings>): void {
    this.settings = { ...this.settings, ...p };
    const held = this.secret.saved;
    saveRadioSettings(held ? { ...this.settings, on: held.on, source: held.remembered } : this.settings);
    this.onChange?.();
  }
}
