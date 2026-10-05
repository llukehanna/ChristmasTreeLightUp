import { formatTime } from '../core/score';
import { FIREPLACE_ID, MUSIC_BOX_ID, MUSIC_BOX_META } from '../radio/builtin';
import { EMBED_PRESETS } from '../radio/embed';
import type { Radio, RadioView } from '../radio/radio';
import { el } from './dom';

/** Static markup only: every title, credit and station name is set later with textContent. */
const ICON = {
  shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h3c5 0 5 10 10 10h3M4 17h3c1.6 0 2.7-1 3.6-2.4M14 9.4C15 8 16 7 17 7h3M18 4l3 3-3 3M18 14l3 3-3 3"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="5.5" y="6" width="2.4" height="12" rx="1"/><path d="M19.2 6.9v10.2a.9.9 0 0 1-1.4.75l-7.6-5.1a.9.9 0 0 1 0-1.5l7.6-5.1a.9.9 0 0 1 1.4.75z"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="16.1" y="6" width="2.4" height="12" rx="1"/><path d="M4.8 6.9v10.2a.9.9 0 0 0 1.4.75l7.6-5.1a.9.9 0 0 0 0-1.5L6.2 6.15a.9.9 0 0 0-1.4.75z"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8.6 5.3v13.4a1 1 0 0 0 1.53.85l10.4-6.7a1 1 0 0 0 0-1.7L10.13 4.45A1 1 0 0 0 8.6 5.3z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6.6" y="5" width="3.8" height="14" rx="1.3"/><rect x="13.6" y="5" width="3.8" height="14" rx="1.3"/></svg>',
  show: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v2.6M12 18.9v2.6M2.5 12h2.6M18.9 12h2.6M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 4.6 18.5 3v11.4a2.8 2.4 0 1 1-1.8-2.24V6.9L11.8 7.8v8.6a2.8 2.4 0 1 1-1.8-2.24z"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 3.2 2.5 5.4 5.9.7-4.4 4 1.2 5.8L12 16.2l-5.2 2.9L8 13.3l-4.4-4 5.9-.7z"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.4a1.3 1.3 0 0 1 1.3 1.3v.5a5.6 5.6 0 0 1 4.3 5.5v3.4l1.6 2.3a.8.8 0 0 1-.66 1.25H5.46a.8.8 0 0 1-.66-1.25l1.6-2.3v-3.4a5.6 5.6 0 0 1 4.3-5.5v-.5A1.3 1.3 0 0 1 12 3.4zM9.8 18.9h4.4a2.2 2.2 0 0 1-4.4 0z"/></svg>',
  flame: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.3 2.8c.5 3-1.4 4.6-2.9 6.3C7.9 10.8 6.6 12.6 6.6 15a5.4 5.4 0 0 0 10.8 0c0-2.2-.9-3.7-2-5.1-.2 1.4-.9 2.4-1.9 2.9.5-3.6-.3-7.4-1.2-10zM12 20.2a2.6 2.6 0 0 1-2.6-2.6c0-1.6 1.3-2.6 2.2-3.8.3 1.2 1.1 1.7 1.8 2.1.8.5 1.2 1 1.2 1.7a2.6 2.6 0 0 1-2.6 2.6z"/></svg>',
  playlist: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 6.5h11M4 11.5h11M4 16.5h6.5"/><path d="M17.5 9.5v8.1" /><circle cx="15.6" cy="17.6" r="1.95" fill="currentColor" stroke="none"/><path d="M17.5 9.5c1.1.3 2.1 1 2.5 2"/></svg>',
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9.5 6 6 6-6 6"/></svg>',
};

/** The settings menu's gold bow, with its own gradient ids (an SVG gradient inside a hidden element doesn't paint). */
const BOW = `<svg class="bow" viewBox="0 0 64 40" aria-hidden="true" focusable="false">
  <defs>
    <linearGradient id="rbow-loop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbe3a4"/><stop offset=".45" stop-color="#d9a74e"/><stop offset="1" stop-color="#8f5f1e"/></linearGradient>
    <linearGradient id="rbow-tail" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e9c16c"/><stop offset="1" stop-color="#90601f"/></linearGradient>
    <radialGradient id="rbow-knot" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="#fff2c8"/><stop offset=".5" stop-color="#e2b25a"/><stop offset="1" stop-color="#8a5a1c"/></radialGradient>
  </defs>
  <path d="M29 22l-10 16 6-2.2 3.4 3.6 3.2-16.4zM35 22l10 16-6-2.2-3.4 3.6-3.2-16.4z" fill="url(#rbow-tail)" />
  <path d="M32 20C22 4 5 3 7 15c1 8 14 9 25 5z" fill="url(#rbow-loop)" />
  <path d="M32 20C42 4 59 3 57 15c-1 8-14 9-25 5z" fill="url(#rbow-loop)" />
  <path d="M30 19C22 9 12 7 11 13c0 3 4 5 10 5M34 19C42 9 52 7 53 13c0 3-4 5-10 5" fill="none" stroke="rgba(90,52,10,.45)" stroke-width="1.2" />
  <path d="M12 9.5c4-3 10-1 15 5M52 9.5c-4-3-10-1-15 5" fill="none" stroke="rgba(255,248,220,.7)" stroke-width=".9" stroke-linecap="round" />
  <ellipse cx="32" cy="20" rx="5.2" ry="4.6" fill="url(#rbow-knot)" />
</svg>`;

const EQ = '<span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>';

const PANEL_HTML = `
  <div class="grab" aria-hidden="true"></div>
  ${BOW}
  <div class="body">
    <div class="now">
      <div class="art" aria-hidden="true"><span class="bulb"></span></div>
      <div class="meta"><div class="station"></div><div class="title"></div><div class="artist"></div></div>
    </div>
    <div class="prog">
      <input class="scrub" type="range" min="0" max="1000" value="0" aria-label="Seek" />
      <div class="times"><span class="pos">0:00</span><span class="dur">0:00</span></div>
    </div>
    <div class="ctl">
      <button class="shuffle" type="button" aria-label="Shuffle">${ICON.shuffle}</button>
      <button class="prev" type="button" aria-label="Previous">${ICON.prev}</button>
      <button class="play" type="button" aria-label="Play">${ICON.play}</button>
      <button class="next" type="button" aria-label="Next">${ICON.next}</button>
      <button class="show" type="button" aria-label="Light show after you win">${ICON.show}</button>
    </div>
    <div class="sec">
      <h2>Stations</h2>
      <div class="stations"></div>
      <p class="warn" hidden>Some stations are unavailable right now.</p>
    </div>
    <div class="sec">
      <h2>Your music</h2>
      <button class="st embed-row" type="button" aria-expanded="false">
        <span class="dot">${ICON.playlist}</span>
        <span class="txt"><span class="n">Spotify or Apple Music</span><span class="d">Paste a playlist link</span></span>
        <span class="r"><span class="lbl"></span><span class="chev">${ICON.chev}</span></span>
      </button>
      <div class="embed-form" hidden>
        <input type="url" class="embed-input" placeholder="Paste a playlist link" aria-label="Spotify or Apple Music playlist link" autocomplete="off" spellcheck="false" />
        <div class="presets"></div>
        <p class="err" role="alert" hidden>That link isn't a playlist we can play.</p>
      </div>
      <div class="embed-frame"></div>
    </div>
    <div class="sec mix">
      <label class="sl"><span>Music</span><input type="range" class="vol-music" min="0" max="1" step="0.05" /></label>
      <label class="sl"><span>Effects</span><input type="range" class="vol-fx" min="0" max="1" step="0.05" /></label>
    </div>
    <p class="credit"></p>
  </div>`;

interface Row {
  id: string;
  name: string;
  desc: string;
  icon: string;
  node?: HTMLButtonElement;
}

export interface RadioPanelHooks {
  /** The panel is about to open (the app closes the settings menu). */
  onOpen?(): void;
  /** The pill's label changed, so the HUD may have changed width. */
  onPillChange?(): void;
}

const shortName = (name: string): string => name.replace(/^Christmas\s+/i, '');

/** The HUD's radio pill and the radio's desktop popover / phone bottom sheet (spec §5.3). */
export class RadioPanel {
  private readonly pill = document.createElement('button');
  private readonly panel = document.createElement('div');
  private rows: Row[] = [];
  private rowsKey: string | null = null;
  private embedSrc = '';
  private pillKey = '';
  private scrubbing = false;
  private ticker = 0;
  /** The bottom-sheet layout (spec §5.3), where the panel is modal and keeps Tab inside it. */
  private readonly phone = window.matchMedia('(max-width: 600px)');

  constructor(
    private readonly radio: Radio,
    private readonly fx: { get(): number; set(v: number): void },
    private readonly hooks: RadioPanelHooks = {},
  ) {
    this.pill.type = 'button';
    this.pill.className = 'pill radio-pill';
    this.pill.id = 'radio-pill';
    this.pill.dataset.fit = 'full';
    this.pill.setAttribute('aria-haspopup', 'dialog');
    this.pill.setAttribute('aria-expanded', 'false');
    this.pill.setAttribute('aria-controls', 'radio-panel');
    this.pill.innerHTML = `${EQ}<span class="rp-name"></span><span class="rp-short"></span><span class="rp-track"></span><span class="rp-artist"></span>`;
    this.panel.className = 'radio';
    this.panel.id = 'radio-panel';
    this.panel.setAttribute('role', 'dialog');
    this.panel.setAttribute('aria-label', 'Radio');
    this.panel.hidden = true;
    this.panel.innerHTML = PANEL_HTML;
    el('radio-slot').append(this.pill);
    document.body.append(this.panel);
    this.bind();
    radio.onChange = () => this.render();
    this.render();
  }

  get isOpen(): boolean {
    return !this.panel.hidden;
  }

  /** Keyboard focus is inside the open panel (the game's keys stand aside only then). */
  get hasFocus(): boolean {
    return this.isOpen && this.panel.contains(document.activeElement);
  }

  open(): void {
    if (this.isOpen) return;
    this.hooks.onOpen?.();
    this.panel.hidden = false;
    this.pill.setAttribute('aria-expanded', 'true');
    this.render();
    // Position and the Music Box carol move without change events: keep the scrubber and times live while open.
    this.ticker = window.setInterval(() => this.render(), 250);
    this.q('.play').focus({ preventScroll: true });
  }

  close(): void {
    if (!this.isOpen) return;
    const active = document.activeElement;
    this.panel.hidden = true;
    this.pill.setAttribute('aria-expanded', 'false');
    window.clearInterval(this.ticker);
    this.scrubbing = false;
    // Hand focus back to the pill unless the user has moved it somewhere else on purpose.
    if (!active || active === document.body || this.panel.contains(active)) this.pill.focus({ preventScroll: true });
  }

  /** The panel's focusable controls, in order, skipping disabled and hidden ones. */
  private tabStops(): HTMLElement[] {
    const all = this.panel.querySelectorAll<HTMLElement>('button, input, iframe, [tabindex]:not([tabindex="-1"])');
    return [...all].filter((n) => !(n as HTMLButtonElement).disabled && n.tabIndex >= 0 && n.getClientRects().length > 0);
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string): T {
    const n = this.panel.querySelector<T>(sel);
    if (!n) throw new Error(`radio panel is missing ${sel}`);
    return n;
  }

  private bind(): void {
    this.pill.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.isOpen) this.close();
      else this.open();
    });
    document.addEventListener('pointerdown', (e) => {
      const t = e.target as Node;
      // Stage taps go to the app's tap handler: on desktop the game stays playable behind the popover, and on phones
      // the tap only closes the sheet (it never also turns a tile).
      if (this.isOpen && !this.panel.contains(t) && !this.pill.contains(t) && t !== el('stage')) this.close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen && !e.defaultPrevented) {
        e.preventDefault();
        this.close();
      }
    });
    // The phone sheet covers the game like a modal: Tab and Shift+Tab cycle inside it while it's open.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab' || !this.isOpen || !this.phone.matches || e.defaultPrevented) return;
      const stops = this.tabStops();
      if (stops.length === 0) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      const at = document.activeElement;
      if (!this.panel.contains(at) || (e.shiftKey && at === first) || (!e.shiftKey && at === last)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus({ preventScroll: true });
      }
    });
    this.q('.play').addEventListener('click', () => this.radio.playPause());
    this.q('.next').addEventListener('click', () => this.radio.next());
    this.q('.prev').addEventListener('click', () => this.radio.prev());
    this.q('.shuffle').addEventListener('click', () => this.radio.setShuffle(!this.radio.view().settings.shuffle));
    this.q('.show').addEventListener('click', () => this.radio.setLightShow(!this.radio.view().settings.lightShow));
    const scrub = this.q<HTMLInputElement>('.scrub');
    scrub.addEventListener('input', () => {
      this.scrubbing = true;
      const d = this.radio.view().duration;
      fill(scrub, Number(scrub.value) / 1000);
      const pos = Math.floor((Number(scrub.value) / 1000) * d);
      setText(this.q('.pos'), formatTime(pos));
      setValueText(scrub, pos, d);
    });
    scrub.addEventListener('change', () => {
      this.scrubbing = false;
      this.radio.seek((Number(scrub.value) / 1000) * this.radio.view().duration);
    });
    const vm = this.q<HTMLInputElement>('.vol-music');
    vm.addEventListener('input', () => {
      fill(vm, Number(vm.value));
      this.radio.setVolume(Number(vm.value));
    });
    const vf = this.q<HTMLInputElement>('.vol-fx');
    vf.addEventListener('input', () => {
      fill(vf, Number(vf.value));
      this.fx.set(Number(vf.value));
    });
    const row = this.q('.embed-row');
    const form = this.q('.embed-form');
    const input = this.q<HTMLInputElement>('.embed-input');
    row.addEventListener('click', () => {
      form.hidden = !form.hidden;
      row.setAttribute('aria-expanded', String(!form.hidden));
      if (!form.hidden) input.focus({ preventScroll: true });
    });
    const submit = (url: string) => {
      const ok = this.radio.setEmbed(url) !== null;
      this.q('.err').hidden = ok;
      if (ok) {
        input.value = '';
        form.hidden = true;
        row.setAttribute('aria-expanded', 'false');
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit(input.value);
      }
    });
    input.addEventListener('input', () => (this.q('.err').hidden = true));
    input.addEventListener('paste', () => setTimeout(() => submit(input.value), 0));
    const presets = this.q('.presets');
    for (const p of EMBED_PRESETS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = p.name;
      b.addEventListener('click', () => submit(p.url));
      presets.append(b);
    }
  }

  private render(): void {
    const v = this.radio.view();
    this.renderPill(v);
    this.renderEmbed(v);
    if (!this.isOpen) return;
    this.panel.dataset.kind = v.kind ?? 'none';
    this.panel.dataset.source = v.kind === 'station' ? (v.station?.id ?? '') : (v.kind ?? '');
    this.panel.classList.toggle('playing', v.playing);

    // Now playing
    const carol = v.kind === 'musicbox';
    setText(this.q('.station'), sourceName(v) ?? 'Aglow Radio');
    setText(
      this.q('.title'),
      v.kind === 'fireplace' ? 'Crackle & wind'
      : v.kind === 'embed' ? 'Press play in the player below'
      : v.track?.title ?? (v.settings.on ? 'Ready when you are' : 'Music off'),
    );
    setText(
      this.q('.artist'),
      v.kind === 'fireplace' ? 'No music, just the fire'
      : v.kind === 'embed' ? (v.embed?.provider === 'apple' ? 'Apple Music' : 'Spotify')
      : carol || v.kind === 'station' ? (v.track?.artist ?? '')
      : v.settings.on ? 'Starts with your first move' : 'Pick a station, or press play',
    );
    const cover = v.track?.cover ?? v.station?.cover;
    const art = this.q('.art');
    const bg = cover ? `url("${encodeURI(cover)}")` : '';
    if (art.style.backgroundImage !== bg) art.style.backgroundImage = bg;
    art.classList.toggle('cover', !!cover);
    setText(this.q('.credit'), creditLine(v));

    // Controls
    const steps = v.kind === 'station' || carol;
    this.q<HTMLButtonElement>('.next').disabled = !steps;
    this.q<HTMLButtonElement>('.prev').disabled = !steps;
    const shuffle = this.q<HTMLButtonElement>('.shuffle');
    shuffle.disabled = v.kind !== 'station';
    shuffle.setAttribute('aria-pressed', String(v.settings.shuffle));
    const show = this.q<HTMLButtonElement>('.show');
    show.disabled = v.kind === 'embed';
    show.setAttribute('aria-pressed', String(v.settings.lightShow && v.kind !== 'embed'));
    show.title = v.kind === 'embed' ? "Playlists can't drive the light show" : 'Light show after you win';
    const play = this.q('.play');
    const label = v.playing ? 'Pause' : 'Play';
    if (play.getAttribute('aria-label') !== label) {
      play.setAttribute('aria-label', label);
      play.innerHTML = v.playing ? ICON.pause : ICON.play;
    }

    // Progress: stations seek; a carol shows its place but can't be scrubbed; the fire and embeds have none.
    const prog = this.q('.prog');
    prog.hidden = !steps;
    const scrub = this.q<HTMLInputElement>('.scrub');
    scrub.disabled = v.kind !== 'station' || !v.duration;
    if (!this.scrubbing) {
      const f = v.duration ? Math.min(1, v.position / v.duration) : 0;
      const value = String(Math.round(f * 1000));
      if (scrub.value !== value) scrub.value = value;
      fill(scrub, f);
      setText(this.q('.pos'), formatTime(Math.floor(v.position)));
      setValueText(scrub, Math.floor(v.position), v.duration);
    }
    setText(this.q('.dur'), v.duration ? formatTime(Math.floor(v.duration)) : '–:––');

    this.renderStations(v);
    this.q('.warn').hidden = v.remoteOk;
    const embedRow = this.q('.embed-row');
    embedRow.setAttribute('aria-current', String(v.kind === 'embed'));
    setText(embedRow.querySelector('.d') as HTMLElement, v.kind === 'embed' && v.embed ? v.embed.label : 'Paste a playlist link');
    setText(embedRow.querySelector('.lbl') as HTMLElement, v.kind === 'embed' ? 'Playing' : '');

    // Sliders
    const vm = this.q<HTMLInputElement>('.vol-music');
    const vf = this.q<HTMLInputElement>('.vol-fx');
    if (document.activeElement !== vm) vm.value = String(v.settings.volume);
    if (document.activeElement !== vf) vf.value = String(this.fx.get());
    fill(vm, Number(vm.value));
    fill(vf, Number(vf.value));
  }

  private renderPill(v: RadioView): void {
    const name = sourceName(v);
    const on = v.playing && name !== null;
    const full = on ? name : v.settings.on && v.kind === null ? 'Radio' : 'Music off';
    const short = on ? shortName(name) : full === 'Radio' ? 'Radio' : 'Off';
    const song = on && (v.kind === 'station' || v.kind === 'musicbox') && v.track ? v.track : null;
    const track = song?.title ?? '';
    const artist = song?.artist ?? '';
    const key = `${on}|${full}|${short}|${track}|${artist}`;
    if (key === this.pillKey) return;
    this.pillKey = key;
    this.pill.classList.toggle('muted', !on);
    setText(this.pill.querySelector('.rp-name') as HTMLElement, full);
    setText(this.pill.querySelector('.rp-short') as HTMLElement, short);
    setText(this.pill.querySelector('.rp-track') as HTMLElement, track);
    setText(this.pill.querySelector('.rp-artist') as HTMLElement, artist);
    const label = [full, track, track && artist ? `by ${artist}` : ''].filter(Boolean).join(', ');
    this.pill.setAttribute('aria-label', on ? `Radio: ${label}` : `Radio: ${full.toLowerCase()}`);
    this.hooks.onPillChange?.();
  }

  /** The embed iframe exists only while the embed is the source, whether or not the panel is open. */
  private renderEmbed(v: RadioView): void {
    const src = v.kind === 'embed' && v.embed ? v.embed.src : '';
    if (src === this.embedSrc) return;
    this.embedSrc = src;
    const frame = this.q('.embed-frame');
    frame.replaceChildren();
    if (!src || !v.embed) return;
    const f = document.createElement('iframe');
    f.src = src;
    f.height = String(v.embed.height);
    f.allow = 'autoplay *; encrypted-media *; clipboard-write';
    f.loading = 'lazy';
    f.title = v.embed.label;
    frame.append(f);
  }

  /** Rows are built when the list changes and updated in place otherwise, so keyboard focus survives a pick. */
  private renderStations(v: RadioView): void {
    const key = v.stations.map((s) => s.id).join(',');
    if (key !== this.rowsKey) {
      this.rowsKey = key;
      this.rows = [
        ...v.stations.map((s) => ({
          id: s.id,
          name: s.name,
          desc: s.description || `${s.tracks.length} tracks`,
          icon: /classic/i.test(s.id) ? ICON.star : ICON.note,
        })),
        { id: MUSIC_BOX_ID, name: MUSIC_BOX_META.name, desc: 'Public-domain carols, always on', icon: ICON.bell },
        { id: FIREPLACE_ID, name: 'Fireplace', desc: 'Crackle & wind, no music', icon: ICON.flame },
      ];
      const box = this.q('.stations');
      box.replaceChildren();
      for (const r of this.rows) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'st';
        b.dataset.id = r.id;
        const dot = document.createElement('span');
        dot.className = 'dot';
        dot.innerHTML = r.icon; // static icon markup, not data
        const text = document.createElement('span');
        text.className = 'txt';
        const n = document.createElement('span');
        n.className = 'n';
        n.textContent = r.name;
        const d = document.createElement('span');
        d.className = 'd';
        const right = document.createElement('span');
        right.className = 'r';
        right.innerHTML = `${EQ}<span class="lbl"></span><span class="chev">${ICON.chev}</span>`;
        text.append(n, d);
        b.append(dot, text, right);
        b.addEventListener('click', () => this.radio.select(r.id));
        r.node = b;
        box.append(b);
      }
    }
    for (const r of this.rows) {
      const b = r.node;
      if (!b) continue;
      const current =
        r.id === FIREPLACE_ID ? v.kind === 'fireplace'
        : r.id === MUSIC_BOX_ID ? v.kind === 'musicbox'
        : v.kind === 'station' && v.station?.id === r.id;
      const unavailable = r.id !== FIREPLACE_ID && r.id !== MUSIC_BOX_ID && v.unavailable(r.id);
      b.setAttribute('aria-current', String(current));
      b.classList.toggle('live', current && v.playing);
      b.disabled = unavailable && !current;
      setText(b.querySelector('.d') as HTMLElement, unavailable ? 'Unavailable right now' : r.desc);
      setText(b.querySelector('.lbl') as HTMLElement, current ? (v.playing ? 'Playing' : 'Paused') : '');
    }
  }
}

function setText(node: HTMLElement, s: string): void {
  if (node.textContent !== s) node.textContent = s;
}

/** What a screen reader announces for the scrubber: "1:23 of 3:40". */
function setValueText(scrub: HTMLInputElement, pos: number, dur: number): void {
  const text = dur ? `${formatTime(pos)} of ${formatTime(Math.floor(dur))}` : formatTime(pos);
  if (scrub.getAttribute('aria-valuetext') !== text) scrub.setAttribute('aria-valuetext', text);
}

/** Gold fill for the custom range tracks. */
function fill(input: HTMLInputElement, f: number): void {
  const p = `${(Math.max(0, Math.min(1, f)) * 100).toFixed(1)}%`;
  if (input.style.getPropertyValue('--p') !== p) input.style.setProperty('--p', p);
}

function sourceName(v: RadioView): string | null {
  switch (v.kind) {
    case 'station':
      return v.station?.name ?? 'Radio';
    case 'musicbox':
      return MUSIC_BOX_META.name;
    case 'fireplace':
      return 'Fireplace';
    case 'embed':
      return v.embed?.label ?? 'Playlist';
    default:
      return null;
  }
}

function creditLine(v: RadioView): string {
  if (v.kind === 'fireplace') return 'Crackle and wind, synthesized live in your browser.';
  if (v.kind === 'embed') return 'Full tracks for listeners signed in to the service; otherwise 30-second previews.';
  return v.track?.credit ?? '';
}
