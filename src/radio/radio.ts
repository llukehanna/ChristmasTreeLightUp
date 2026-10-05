import { audio } from '../audio/context';
import type { SceneId } from '../render/scenes';
import { loadRadioSettings, saveRadioSettings, type RadioSettings } from '../store/radio-settings';
import { FIREPLACE_ID, SCENE_STATION } from './builtin';
import { loadCatalog } from './catalog';
import { parseEmbed, type Embed } from './embed';
import { Fireplace } from './fireplace';
import { LightShow } from './lightshow';
import { RadioPlayer, type RemoteAction } from './player';
import type { Station, Track } from './schema';

export type SourceKind = 'station' | 'fireplace' | 'embed';

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
}

const FIRST_FADE_S = 2;

export class Radio {
  onChange: (() => void) | null = null;
  readonly show: LightShow;
  private settings = loadRadioSettings();
  private catalog: Station[] = [];
  private remoteOk = true;
  private readonly player = new RadioPlayer(() => audio.music);
  private readonly fireplace = new Fireplace();
  private embed: Embed | null;
  private kind: SourceKind | null = null;
  private started = false;
  /** AudioContext time until which the first-gesture fade-in is still ramping the music bus. */
  private fadeInUntil = 0;
  private catalogLoaded = false;
  /** The first gesture came before the catalog did: start the preferred station as soon as it arrives. */
  private pendingStart = false;
  private catalogSeq = 0;
  private sceneId: SceneId = 'fireside';
  private analyser: AnalyserNode | null = null;

  constructor() {
    this.player.onChange = () => this.onChange?.();
    this.player.onRemote = (action) => this.onRemote(action);
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
    this.catalogLoaded = true;
    // Decks were primed and the context unlocked inside the first gesture, so this non-gesture start is allowed.
    if (this.pendingStart) {
      this.pendingStart = false;
      if (this.settings.on) this.startPreferred();
    }
    this.onChange?.();
  }

  /** Call from every user gesture. The first one fades music in (spec §5.2). */
  firstGesture(): void {
    const first = this.prepare();
    if (first && this.settings.on) this.startPreferred();
  }

  setScene(id: SceneId): void {
    this.sceneId = id;
  }

  /** An explicit choice by the listener: remembered as the preferred source. */
  select(source: string): void {
    this.play(source, true);
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
    if (this.pendingStart) {
      // Paused while still waiting for the catalog: cancel the pending start.
      this.pendingStart = false;
      this.save({ on: false });
      return;
    }
    if (this.kind === 'station') {
      if (this.player.snapshot().playing) this.player.pause();
      else this.player.resume();
    } else if (this.kind === 'fireplace' || this.kind === 'embed') {
      this.stopAll();
    } else {
      this.startPreferred();
    }
    this.save({ on: this.isPlaying() || this.pendingStart });
  }

  next(): void {
    if (this.kind === 'station') this.player.next();
  }
  prev(): void {
    if (this.kind === 'station') this.player.prev();
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
  }

  setShuffle(on: boolean): void {
    this.player.setShuffle(on);
    this.save({ shuffle: on });
  }

  setLightShow(on: boolean): void {
    this.save({ lightShow: on });
  }

  /** Game sounds duck the music ~4 dB for ~250 ms (spec §5.1). */
  duck(): void {
    const m = audio.music;
    const ctx = audio.ctx;
    if (!m || !ctx || !this.started) return;
    const t = ctx.currentTime;
    // Ducking cancels scheduled gain events; doing that mid fade-in would snap the music to full volume.
    if (t < this.fadeInUntil) return;
    const v = this.settings.volume;
    m.gain.cancelScheduledValues(t);
    m.gain.setValueAtTime(m.gain.value, t);
    m.gain.linearRampToValueAtTime(v * 0.63, t + 0.03);
    m.gain.linearRampToValueAtTime(v, t + 0.28);
  }

  /** The light show needs analysable audio: our stations or the Fireplace, not embeds (spec §5.4). Reduced motion is the caller's check. */
  get lightShowActive(): boolean {
    return this.settings.lightShow && (this.kind === 'station' || this.kind === 'fireplace') && this.isPlaying();
  }

  view(): RadioView {
    const snap = this.player.snapshot();
    return {
      kind: this.kind,
      playing: this.isPlaying(),
      station: this.kind === 'station' ? snap.station : null,
      track: this.kind === 'station' ? snap.track : null,
      position: snap.position,
      duration: snap.duration,
      stations: this.catalog,
      unavailable: (id) => this.player.isUnavailable(id),
      embed: this.embed,
      remoteOk: this.remoteOk,
      settings: this.settings,
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
    return this.kind === 'fireplace' || this.kind === 'embed' || (this.kind === 'station' && this.player.snapshot().playing);
  }

  private playable(s: Station): boolean {
    return s.tracks.length > 0 && !this.player.isUnavailable(s.id);
  }

  /** Fireplace and a set-up embed work without the station catalog. */
  private needsCatalog(): boolean {
    const s = this.settings.source;
    return !(s === FIREPLACE_ID || (s === 'embed' && this.embed));
  }

  private preferredSource(): string {
    const s = this.settings.source;
    if (s === FIREPLACE_ID || (s === 'embed' && this.embed)) return s;
    const byId = (id: string | null): Station | undefined => (id === null ? undefined : this.catalog.find((x) => x.id === id && this.playable(x)));
    const chosen = byId(s) ?? byId(SCENE_STATION[this.sceneId]) ?? this.catalog.find((x) => this.playable(x));
    return chosen?.id ?? FIREPLACE_ID; // only reached once the catalog has loaded and has nothing usable
  }

  /** Start the remembered source, or the scene's suggestion. Following a suggestion isn't a choice, so `source` is left as it was. */
  private startPreferred(): void {
    if (this.needsCatalog() && !this.catalogLoaded) {
      // Prime the decks now (this is the gesture); refreshCatalog starts playback when the catalog arrives.
      this.player.prime();
      this.pendingStart = true;
      return;
    }
    this.play(this.preferredSource(), false);
  }

  /** Lock-screen / headset keys. Only a playing or paused station owns them; otherwise they are swallowed. */
  private onRemote(action: RemoteAction): boolean {
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

  private play(source: string, remember: boolean): void {
    // Validate before touching anything, so a bad pick leaves the current source playing.
    let station: Station | undefined;
    if (source === 'embed') {
      if (!this.embed) return;
    } else if (source !== FIREPLACE_ID) {
      station = this.catalog.find((s) => s.id === source);
      if (!station || !this.playable(station)) return;
    }
    this.prepare();
    const ctx = audio.ctx;
    if (source === FIREPLACE_ID && (!ctx || !audio.music)) return;
    this.pendingStart = false; // an explicit or resolved choice supersedes any waiting start
    const already =
      (source === FIREPLACE_ID && this.kind === 'fireplace') ||
      (source === 'embed' && this.kind === 'embed') ||
      (station !== undefined && this.kind === 'station' && this.player.snapshot().station?.id === station.id);
    if (already) {
      // Re-selecting what is already the source must not restart it (a paused station just resumes).
      if (station && !this.player.snapshot().playing) this.player.resume();
      this.save({ on: true, ...(remember ? { source } : {}) });
      return;
    }
    this.stopAll();
    if (source === FIREPLACE_ID && ctx && audio.music) {
      this.fireplace.start(ctx, audio.music);
      this.kind = 'fireplace';
    } else if (station) {
      this.player.playStation(station, this.settings.shuffle);
      this.kind = 'station';
    } else {
      this.kind = 'embed';
    }
    this.save({ on: true, ...(remember ? { source } : {}) });
  }

  private stopAll(): void {
    this.player.stop();
    this.player.releaseMediaSession();
    this.fireplace.stop(audio.ctx);
    this.kind = null;
  }

  private save(p: Partial<RadioSettings>): void {
    this.settings = { ...this.settings, ...p };
    saveRadioSettings(this.settings);
    this.onChange?.();
  }
}
