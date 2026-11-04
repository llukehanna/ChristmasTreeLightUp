/**
 * The pause as a frosted windowpane. The stage behind fogs over, frost ferns grow in from the edges, condensation beads
 * the glass, and "Paused" is written in it with a fingertip. Drag to wipe the glass clear (it slowly fogs back, and the
 * odd drop runs down). A click or tap on the glass resumes: that is the host's own click handler (App), not this class.
 *
 * Snappy: the glass fades in over FROST_IN_MS, the ferns grow in FERNS_MS and the caption follows, and clearing takes
 * CLEAR_MS. The host keeps `hidden` while the game is not paused; this class owns it, so the clear-away can play out.
 */

/** Timings (ms). The CSS reads them from custom properties set in the constructor, so these are the one source. */
export const FROST_IN_MS = 160; // the glass fades in
export const FERNS_MS = 200; // the ferns grow in from the edges
export const CAPTION_DELAY_MS = 200; // the caption appears after the glass
export const CAPTION_FADE_MS = 200;
export const CLEAR_MS = 150; // the melt, then the host is hidden again

const WORD_AT = 40; // "Paused" is written a beat after the frost starts...
const WORD_MS = 180; // ...and takes this long, left to right
const WIPE_MOVE = 6; // px of travel before a press is a wipe rather than a tap

interface Seg {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  w: number;
  born: number; // 0..1 of the grow-in
  a: number;
}
interface Drop {
  x: number;
  y: number;
  r: number;
  vy: number;
  rest: number;
}
/** What one showing of the glass needs while it is up. */
interface Glass {
  k: number;
  stroke(x0: number, y0: number, x1: number, y1: number): void;
}

const mk = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
};

export class FrostPause {
  private readonly view: HTMLCanvasElement;
  private readonly caption: HTMLElement;
  private isOpen = false;
  private raf = 0;
  private clearTimer: ReturnType<typeof setTimeout> | undefined;
  private glass: Glass | null = null;
  private down: { lx: number; ly: number; moved: number } | null = null;
  /** The press that just ended wiped the glass, so the click that follows it is not a tap to resume. */
  private wiped = false;

  constructor(private readonly host: HTMLElement) {
    const view = host.querySelector<HTMLCanvasElement>('canvas.frost-cv');
    if (view) this.view = view;
    else {
      this.view = document.createElement('canvas');
      this.view.className = 'frost-cv';
      host.prepend(this.view);
    }
    let cap = host.querySelector<HTMLElement>('.frost-cap');
    if (!cap) {
      cap = document.createElement('div');
      cap.className = 'frost-cap';
      cap.innerHTML = '<span>tap to resume</span><small>or drag to wipe the glass</small>';
      host.append(cap);
    }
    this.caption = cap;
    host.style.setProperty('--frost-in', `${FROST_IN_MS}ms`);
    host.style.setProperty('--frost-clear', `${CLEAR_MS}ms`);
    host.style.setProperty('--frost-cap-delay', `${CAPTION_DELAY_MS}ms`);
    host.style.setProperty('--frost-cap-fade', `${CAPTION_FADE_MS}ms`);

    // A press that dragged is a wipe: the click it ends with must not reach the host's resume handler.
    host.addEventListener('click', (e) => {
      if (!this.wiped) return;
      this.wiped = false;
      e.stopImmediatePropagation();
    }, true);
    host.addEventListener('pointerdown', (e) => {
      this.wiped = false;
      const g = this.glass;
      if (!g) return;
      try {
        host.setPointerCapture(e.pointerId);
      } catch {
        /* a synthetic pointer has nothing to capture */
      }
      this.down = { lx: e.clientX * g.k, ly: e.clientY * g.k, moved: 0 };
    });
    host.addEventListener('pointermove', (e) => {
      const g = this.glass;
      const d = this.down;
      if (!g || !d) return;
      const x = e.clientX * g.k;
      const y = e.clientY * g.k;
      d.moved += Math.hypot(x - d.lx, y - d.ly);
      if (d.moved < WIPE_MOVE * g.k) return;
      g.stroke(d.lx, d.ly, x, y);
      d.lx = x;
      d.ly = y;
      this.caption.classList.add('dim');
    });
    const end = (): void => {
      const d = this.down;
      this.down = null;
      if (d && this.glass && d.moved >= WIPE_MOVE * this.glass.k) this.wiped = true;
    };
    host.addEventListener('pointerup', end);
    host.addEventListener('pointercancel', end);
  }

  get open(): boolean {
    return this.isOpen;
  }

  /** Frosts the window over, from the stage as it is now. `reduced`: fully formed at once, nothing grows. */
  show(reduced: boolean): void {
    if (this.isOpen) return;
    this.isOpen = true;
    clearTimeout(this.clearTimer);
    this.clearTimer = undefined;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    const host = this.host;
    host.classList.remove('melt');
    host.classList.toggle('reduced', reduced);
    this.caption.classList.remove('dim');
    host.hidden = false;
    this.paint(reduced);
    // The frame with opacity 0 must be styled before .show, or the fade-in has nothing to start from.
    void host.offsetWidth;
    host.classList.add('show');
  }

  /** Clears the glass (it melts away over CLEAR_MS), then hides the host. */
  hide(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.down = null;
    this.wiped = false;
    this.glass = null;
    this.host.classList.remove('show');
    this.host.classList.add('melt');
    this.clearTimer = setTimeout(() => {
      this.clearTimer = undefined;
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.host.classList.remove('melt');
      this.host.hidden = true;
      this.view.width = this.view.height = 0; // the layers are not kept while the game runs
    }, CLEAR_MS);
  }

  private paint(reduced: boolean): void {
    const W = innerWidth;
    const H = innerHeight;
    const k = Math.min(devicePixelRatio || 1, 1.5);
    const cw = Math.round(W * k);
    const ch = Math.round(H * k);
    const view = this.view;
    view.width = cw;
    view.height = ch;
    const v = view.getContext('2d')!;

    /* ---------- the fogged glass: blurred stage, milky haze, beads ---------- */
    const [fog, f] = mk(cw, ch);
    f.filter = 'blur(16px) saturate(1.3) brightness(1.02)';
    const stage = document.getElementById('stage');
    if (stage instanceof HTMLCanvasElement) f.drawImage(stage, -24 * k, -24 * k, cw + 48 * k, ch + 48 * k);
    f.filter = 'none';
    // Milky haze, thicker toward the frame.
    const g = f.createRadialGradient(cw / 2, ch * 0.48, Math.min(cw, ch) * 0.15, cw / 2, ch / 2, Math.hypot(cw, ch) * 0.58);
    g.addColorStop(0, 'rgba(214,228,240,0.22)');
    g.addColorStop(0.65, 'rgba(222,234,244,0.38)');
    g.addColorStop(1, 'rgba(236,244,250,0.78)');
    f.fillStyle = g;
    f.fillRect(0, 0, cw, ch);
    // Grain of the fog: fine speckle.
    const [noise, nx] = mk(256, 256);
    const id = nx.createImageData(256, 256);
    for (let i = 0; i < id.data.length; i += 4) {
      const n = Math.random();
      id.data[i] = id.data[i + 1] = id.data[i + 2] = 255;
      id.data[i + 3] = n > 0.82 ? (n - 0.82) * 260 : 0;
    }
    nx.putImageData(id, 0, 0);
    f.globalAlpha = 0.5;
    f.fillStyle = f.createPattern(noise, 'repeat') ?? 'transparent';
    f.fillRect(0, 0, cw, ch);
    f.globalAlpha = 1;
    // Condensation beads: tiny lenses, dark below, a highlight above.
    for (let i = 0; i < 1400; i++) {
      const x = Math.random() * cw;
      const y = Math.random() * ch;
      const edge = Math.min(x, y, cw - x, ch - y) / Math.min(cw, ch);
      if (Math.random() < edge * 1.6) continue;
      const r = (0.6 + Math.random() * Math.random() * 3.2) * k;
      f.fillStyle = 'rgba(40,50,70,0.16)';
      f.beginPath();
      f.arc(x, y + r * 0.25, r, 0, Math.PI * 2);
      f.fill();
      f.fillStyle = 'rgba(255,255,255,0.55)';
      f.beginPath();
      f.arc(x - r * 0.25, y - r * 0.3, r * 0.42, 0, Math.PI * 2);
      f.fill();
    }

    /* ---------- frost ferns, grown in from the edges ---------- */
    const segs: Seg[] = [];
    // A dendrite: a gently curving stem that throws paired side-branches at ±60° (ice's own angle), each of which
    // throws its own smaller pairs. Thin, translucent, many: rime, not twigs.
    const fern = (x: number, y: number, ang: number, len: number, w: number, depth: number, t: number): void => {
      const step = (depth === 0 ? 7 : 5) * k;
      const steps = Math.max(2, Math.round(len / step));
      let px = x;
      let py = y;
      let a = ang;
      const bend = (Math.random() - 0.5) * 0.05;
      for (let s = 0; s < steps; s++) {
        a += bend + (Math.random() - 0.5) * 0.08;
        const qx = px + Math.cos(a) * step;
        const qy = py + Math.sin(a) * step;
        const fr = s / steps;
        const born = t + fr * (0.6 / (depth + 1));
        segs.push({
          x0: px,
          y0: py,
          x1: qx,
          y1: qy,
          w: w * (1 - fr * 0.7),
          born,
          a: (depth === 0 ? 0.62 : depth === 1 ? 0.48 : 0.36) * (1 - fr * 0.4),
        });
        if (depth < 2 && s % (depth === 0 ? 2 : 1) === 0 && s > 0) {
          const bl = len * (depth === 0 ? 0.42 : 0.5) * (1 - fr) * (0.6 + Math.random() * 0.5);
          if (bl > 3 * k)
            for (const side of [-1, 1])
              if (Math.random() < 0.9) fern(qx, qy, a + side * (Math.PI / 3 + (Math.random() - 0.5) * 0.15), bl, w * 0.6, depth + 1, born);
        }
        px = qx;
        py = qy;
      }
    };
    const seeds = Math.round((W + H) / 11);
    for (let i = 0; i < seeds; i++) {
      const side = i % 4;
      // More, and longer, toward the corners, where frost gathers first.
      const along = Math.random();
      const corner = Math.pow(Math.abs(along - 0.5) * 2, 2.2);
      if (Math.random() > 0.35 + corner * 0.65) continue;
      const len = (18 + corner * 120 + Math.random() * 40) * k;
      let x = 0;
      let y = 0;
      let ang = 0;
      if (side === 0) [x, y, ang] = [along * cw, 0, Math.PI / 2];
      else if (side === 1) [x, y, ang] = [cw, along * ch, Math.PI];
      else if (side === 2) [x, y, ang] = [along * cw, ch, -Math.PI / 2];
      else [x, y, ang] = [0, along * ch, 0];
      // Corner frost leans in toward the middle.
      const toward = Math.atan2(ch / 2 - y, cw / 2 - x);
      const lean = ang + Math.atan2(Math.sin(toward - ang), Math.cos(toward - ang)) * corner * 0.8;
      fern(x, y, lean + (Math.random() - 0.5) * 0.9, len, (0.9 + Math.random() * 0.5) * k, 0, Math.random() * 0.3);
    }
    const [frost, fr] = mk(cw, ch);
    const drawFrost = (p: number): void => {
      fr.clearRect(0, 0, cw, ch);
      fr.lineCap = 'round';
      for (const s of segs) {
        if (s.born > p) continue;
        fr.strokeStyle = `rgba(242,249,255,${s.a})`;
        fr.lineWidth = s.w;
        fr.beginPath();
        fr.moveTo(s.x0, s.y0);
        fr.lineTo(s.x1, s.y1);
        fr.stroke();
      }
      // Once grown, the ferns get a soft bloom of their own.
      if (p >= 1) {
        const [tmp, tx] = mk(cw, ch);
        tx.filter = `blur(${2.5 * k}px)`;
        tx.drawImage(frost, 0, 0);
        fr.globalCompositeOperation = 'lighter';
        fr.globalAlpha = 0.8;
        fr.drawImage(tmp, 0, 0);
        fr.globalAlpha = 1;
        fr.globalCompositeOperation = 'source-over';
      }
      // A soft rime along the frame.
      const e = 70 * k;
      for (const [x0, y0, x1, y1] of [
        [0, 0, 0, e],
        [0, ch, 0, ch - e],
        [0, 0, e, 0],
        [cw, 0, cw - e, 0],
      ]) {
        const lg = fr.createLinearGradient(x0, y0, x1, y1);
        lg.addColorStop(0, `rgba(245,250,255,${0.55 * Math.min(1, p * 2)})`);
        lg.addColorStop(1, 'rgba(245,250,255,0)');
        fr.fillStyle = lg;
        fr.fillRect(0, 0, cw, ch);
      }
    };

    /* ---------- what's been wiped clear (decays), and the written word (stays) ---------- */
    const [wipe, wp] = mk(cw, ch);
    const [word, wd] = mk(cw, ch);
    const fs = Math.min(132, W * 0.11) * k;
    wd.font = `italic 400 ${fs}px 'Instrument Serif', serif`;
    wd.textAlign = 'center';
    wd.textBaseline = 'middle';
    wd.shadowColor = '#000';
    wd.shadowBlur = 5 * k;
    wd.fillStyle = '#000';
    const wordY = ch * 0.42;
    const wordW = wd.measureText('Paused').width;

    const brush = (x: number, y: number, r: number, a = 1): void => {
      const bg = wp.createRadialGradient(x, y, 0, x, y, r);
      bg.addColorStop(0, `rgba(0,0,0,${a})`);
      bg.addColorStop(0.55, `rgba(0,0,0,${a * 0.85})`);
      bg.addColorStop(1, 'rgba(0,0,0,0)');
      wp.fillStyle = bg;
      wp.fillRect(x - r, y - r, r * 2, r * 2);
    };

    const drops: Drop[] = [];
    const t0 = performance.now();
    let lastWipe = -1e9;
    let writeP = -1; // how much of the word is written; -1: not drawn yet
    let grown = false;

    const compose = (now: number): void => {
      const grow = reduced ? 1 : Math.min(1, (now - t0) / FERNS_MS);
      if (grow < 1) drawFrost(grow);
      else if (!grown) {
        grown = true;
        drawFrost(1);
      }
      // The word is written left to right, a beat after the frost.
      const wp1 = reduced ? 1 : Math.min(1, Math.max(0, (now - t0 - WORD_AT) / WORD_MS));
      if (wp1 !== writeP) {
        writeP = wp1;
        wd.clearRect(0, 0, cw, ch);
        wd.save();
        wd.beginPath();
        wd.rect(cw / 2 - wordW / 2 - 20 * k, 0, (wordW + 40 * k) * writeP, ch);
        wd.clip();
        wd.fillText('Paused', cw / 2, wordY);
        wd.restore();
      }
      // Refog: the wiped glass mists over again.
      if (now - lastWipe > 400) {
        wp.globalCompositeOperation = 'destination-out';
        wp.fillStyle = 'rgba(0,0,0,0.012)';
        wp.fillRect(0, 0, cw, ch);
        wp.globalCompositeOperation = 'source-over';
      }
      // Drops run down, clearing a thin trail.
      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i];
        if (d.rest > 0) d.rest -= 1;
        else {
          d.vy = Math.min(d.vy + 0.05 * k, 2.4 * k);
          if (Math.random() < 0.02) d.rest = 10 + Math.random() * 40;
          const ny = d.y + d.vy;
          wp.strokeStyle = 'rgba(0,0,0,0.55)';
          wp.lineWidth = d.r * 0.9;
          wp.lineCap = 'round';
          wp.beginPath();
          wp.moveTo(d.x, d.y);
          d.x += (Math.random() - 0.5) * 0.6 * k;
          wp.lineTo(d.x, ny);
          wp.stroke();
          d.y = ny;
          d.r *= 0.9985;
        }
        if (d.y > ch + 10 || d.r < 0.8 * k) drops.splice(i, 1);
      }

      v.globalCompositeOperation = 'source-over';
      v.clearRect(0, 0, cw, ch);
      v.drawImage(fog, 0, 0);
      v.drawImage(frost, 0, 0);
      v.globalCompositeOperation = 'destination-out';
      v.drawImage(wipe, 0, 0);
      v.drawImage(word, 0, 0);
      v.globalCompositeOperation = 'source-over';
      // A wet rim catches the light around the letters.
      v.globalAlpha = 0.18;
      v.drawImage(word, 0, -1.5 * k);
      v.globalAlpha = 1;
      for (const d of drops) {
        v.fillStyle = 'rgba(20,28,40,0.35)';
        v.beginPath();
        v.arc(d.x, d.y + d.r * 0.2, d.r, 0, Math.PI * 2);
        v.fill();
        v.fillStyle = 'rgba(255,255,255,0.75)';
        v.beginPath();
        v.arc(d.x - d.r * 0.3, d.y - d.r * 0.3, d.r * 0.38, 0, Math.PI * 2);
        v.fill();
      }
    };

    // The glass animates on its own frames, not the game's: while paused the game loop draws one frame and idles.
    const frame = (now: number): void => {
      compose(now);
      const busy = now - t0 < WORD_AT + WORD_MS + 200 || now - lastWipe < 12000 || drops.length > 0;
      this.raf = busy ? requestAnimationFrame(frame) : 0;
    };
    const kick = (): void => {
      if (!this.raf) this.raf = requestAnimationFrame(frame);
    };
    compose(t0);
    this.raf = requestAnimationFrame(frame);

    this.glass = {
      k,
      stroke: (x0, y0, x1, y1) => {
        const r = 44 * k;
        const dist = Math.hypot(x1 - x0, y1 - y0);
        const n = Math.max(1, Math.ceil(dist / (r * 0.2)));
        for (let i = 1; i <= n; i++) brush(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, r, 0.5);
        // Water gathers at the edge of the wipe and sometimes runs.
        if (Math.random() < 0.07 && drops.length < 18) {
          const a = Math.PI * (0.25 + Math.random() * 0.5);
          drops.push({
            x: x1 + Math.cos(a) * r * 0.85,
            y: y1 + Math.sin(a) * r * 0.85,
            r: (2.2 + Math.random() * 2.4) * k,
            vy: 0,
            rest: 20 + Math.random() * 50,
          });
        }
        lastWipe = performance.now();
        kick();
      },
    };
  }
}
