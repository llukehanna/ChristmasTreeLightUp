/**
 * The spark cursor (season two, C3: a secret's unlock; ported from the lab's menus-spark). On a desktop mouse the pointer
 * becomes a small glowing ember that sheds a few fading sparkles, and burns brighter over a tile.
 *
 * It is chrome: its own fixed canvas over the page that takes no pointer events, drawn additively (it brightens, never
 * covers, a tile), with only the dirty rectangle cleared each frame. The app's frame loop drives it (`frame`); it sleeps
 * once the mouse has rested a while and its sparks have burnt out, leaving the ember drawn. It never runs while the tab
 * is hidden or under prefers-reduced-motion, and off it holds no canvas and no listeners. The system cursor hides only
 * while the ember is shown (after a real mouse move inside the page), so there is never no cursor at all.
 *
 * Only trusted events move it: the Decorate drawer re-sends pointer events on the scaled stage in stage coordinates
 * (src/ui/decorate.ts, remap), and those are not where the pointer is.
 */

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  r: number;
  star: boolean;
  hue: number;
}

export interface SparkHooks {
  /** Whether a viewport point is over a tile of the board. */
  overTile(x: number, y: number): boolean;
  /** Whether a pointer event came from the user (default: `isTrusted`; a test stands in for it, as jsdom can't make one). */
  trusted?(e: Event): boolean;
}

/** How long the ember keeps shedding sparks after the mouse last moved; then it sleeps until the next move. */
const IDLE_MS = 4000;
const MAX_SPARKS = 160;
/** Where the system cursor stays (and no ember is drawn): text fields keep their caret. */
const OWN_CURSOR = 'input, textarea, [contenteditable="true"]';

export class SparkCursor {
  /** The look has the spark on. */
  private wanted = false;
  /** Drawing: wanted, the tab seen, a fine pointer and motion allowed. */
  private on = false;
  private fine: MediaQueryList | null = null;
  private reduced: MediaQueryList | null = null;
  private cv: HTMLCanvasElement | null = null;
  private c: CanvasRenderingContext2D | null = null;
  /** Something is moving: frames draw until it settles. */
  private awake = false;
  private x = -100;
  private y = -100;
  private px = -100;
  private py = -100;
  private inside = false;
  private overUi = false;
  /** 0..1, eased: how much the ember sits over a tile. */
  private over = 0;
  /** The mouse moved since the last frame (the frame stamps it with its own clock). */
  private moved = false;
  private lastMove = 0;
  private last = -1;
  private dirty = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private readonly ps: Spark[] = [];

  constructor(private readonly h: SparkHooks) {}

  get running(): boolean {
    return this.on;
  }

  /** The look wants the spark: it runs whenever the tab is seen, the pointer is a mouse and motion is allowed. */
  start(): void {
    if (this.wanted) return;
    this.wanted = true;
    this.fine ??= matchMedia('(pointer: fine)');
    this.reduced ??= matchMedia('(prefers-reduced-motion: reduce)');
    this.fine.addEventListener('change', this.update);
    this.reduced.addEventListener('change', this.update);
    document.addEventListener('visibilitychange', this.update);
    this.update();
  }

  stop(): void {
    if (!this.wanted) return;
    this.wanted = false;
    this.fine?.removeEventListener('change', this.update);
    this.reduced?.removeEventListener('change', this.update);
    document.removeEventListener('visibilitychange', this.update);
    this.update();
  }

  private readonly update = (): void => {
    const run = this.wanted && !document.hidden && this.fine!.matches && !this.reduced!.matches;
    if (run === this.on) return;
    this.on = run;
    if (run) this.attach();
    else this.detach();
  };

  private attach(): void {
    const cv = document.createElement('canvas');
    cv.className = 'spark-cursor';
    cv.setAttribute('aria-hidden', 'true');
    document.body.append(cv);
    this.cv = cv;
    this.c = cv.getContext('2d');
    this.resize();
    addEventListener('pointermove', this.move, true);
    addEventListener('pointerdown', this.down, true);
    addEventListener('resize', this.resize);
    document.documentElement.addEventListener('pointerleave', this.leave);
  }

  private detach(): void {
    this.cv?.remove();
    this.cv = null;
    this.c = null;
    this.ps.length = 0;
    this.awake = false;
    this.inside = false;
    this.over = 0;
    this.dirty = { x0: 0, y0: 0, x1: 0, y1: 0 };
    this.hideCursor(false);
    removeEventListener('pointermove', this.move, true);
    removeEventListener('pointerdown', this.down, true);
    removeEventListener('resize', this.resize);
    document.documentElement.removeEventListener('pointerleave', this.leave);
  }

  private readonly resize = (): void => {
    if (!this.cv || !this.c) return;
    const dpr = devicePixelRatio || 1;
    this.cv.width = Math.round(innerWidth * dpr);
    this.cv.height = Math.round(innerHeight * dpr);
    this.c.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.wake();
  };

  /** The system cursor hides exactly while the ember stands in for it. */
  private hideCursor(v: boolean): void {
    document.body.classList.toggle('spark-on', v);
  }

  private trusted(e: Event): boolean {
    return this.h.trusted ? this.h.trusted(e) : e.isTrusted;
  }

  private wake(): void {
    if (this.awake) return;
    this.awake = true;
    this.last = -1;
  }

  private readonly move = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse' || !this.trusted(e)) return;
    this.x = e.clientX;
    this.y = e.clientY;
    this.inside = true;
    const t = e.target as Element | null;
    this.overUi = !!t?.closest?.(OWN_CURSOR);
    this.hideCursor(!this.overUi);
    this.moved = true;
    const d = Math.hypot(this.x - this.px, this.y - this.py);
    if (!this.overUi) this.spawn(Math.min(4, Math.floor(d / (9 - this.over * 4))));
    this.wake();
  };

  private readonly down = (e: PointerEvent): void => {
    if (e.pointerType !== 'mouse' || this.overUi || !this.trusted(e)) return;
    this.spawn(16 + Math.round(this.over * 12), true);
    this.wake();
  };

  private readonly leave = (): void => {
    this.inside = false;
    this.hideCursor(false);
    this.wake();
  };

  private spawn(n: number, burst = false): void {
    const over = this.over;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (burst ? 60 + Math.random() * 140 : 8 + Math.random() * 30) * (1 + over * 0.6);
      const max = 0.45 + Math.random() * (0.5 + over * 0.4);
      this.ps.push({
        x: this.x + (Math.random() - 0.5) * 4,
        y: this.y + (Math.random() - 0.5) * 4,
        vx: Math.cos(a) * sp + (this.x - this.px) * 1.5,
        vy: Math.sin(a) * sp - 14,
        life: max,
        max,
        r: 0.7 + Math.random() * (1.3 + over),
        star: Math.random() < 0.28,
        hue: 32 + Math.random() * 20,
      });
    }
    if (this.ps.length > MAX_SPARKS) this.ps.splice(0, this.ps.length - MAX_SPARKS);
  }

  /** One frame, from the app's loop. Nothing at all while off, hidden or asleep. */
  frame(now: number): void {
    if (!this.on || !this.awake || !this.c || !this.cv) return;
    const g = this.c;
    const dt = this.last < 0 ? 0 : Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (this.moved) {
      this.lastMove = now;
      this.moved = false;
    }
    const shown = this.inside && !this.overUi;
    const resting = now - this.lastMove >= IDLE_MS;
    const target = shown && this.h.overTile(this.x, this.y) ? 1 : 0;
    this.over += (target - this.over) * Math.min(1, dt * 10);
    const d = this.dirty;
    g.clearRect(d.x0 - 2, d.y0 - 2, d.x1 - d.x0 + 4, d.y1 - d.y0 + 4);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    const grow = (ax: number, ay: number, r: number) => {
      x0 = Math.min(x0, ax - r);
      y0 = Math.min(y0, ay - r);
      x1 = Math.max(x1, ax + r);
      y1 = Math.max(y1, ay + r);
    };
    // The ember still sheds now and then while the mouse is about; over a tile, more.
    if (shown && !resting && Math.random() < dt * (3 + this.over * 14)) this.spawn(1);

    g.globalCompositeOperation = 'lighter';
    const ps = this.ps;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) {
        ps.splice(i, 1);
        continue;
      }
      p.vx *= 1 - dt * 2.4;
      p.vy = p.vy * (1 - dt * 2.4) + 30 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const k = p.life / p.max;
      const tw = p.star ? 0.6 + 0.4 * Math.sin(now / 60 + i) : 1;
      const a = k * k * tw;
      const r = p.r * (0.5 + k * 0.7);
      const halo = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 4);
      halo.addColorStop(0, `hsla(${p.hue},100%,80%,${a * 0.55})`);
      halo.addColorStop(1, `hsla(${p.hue},100%,55%,0)`);
      g.fillStyle = halo;
      g.fillRect(p.x - r * 4, p.y - r * 4, r * 8, r * 8);
      g.fillStyle = `hsla(${p.hue},100%,${86 + k * 12}%,${a})`;
      if (p.star) {
        const s = r * 3.2;
        g.beginPath();
        g.moveTo(p.x, p.y - s);
        g.quadraticCurveTo(p.x, p.y, p.x + s, p.y);
        g.quadraticCurveTo(p.x, p.y, p.x, p.y + s);
        g.quadraticCurveTo(p.x, p.y, p.x - s, p.y);
        g.quadraticCurveTo(p.x, p.y, p.x, p.y - s);
        g.fill();
      } else {
        g.beginPath();
        g.arc(p.x, p.y, r, 0, Math.PI * 2);
        g.fill();
      }
      grow(p.x, p.y, r * 4 + 1);
    }

    // Asleep next: the last frame draws the ember steady, so it stays put without a flicker to keep up.
    const busy = ps.length > 0 || (shown && !resting) || Math.abs(target - this.over) > 0.01;
    if (shown) {
      // The ember: a hot white core in a gold glow, flickering; over a tile, bigger and whiter.
      const x = this.x;
      const y = this.y;
      const over = this.over;
      const fl = busy ? 0.85 + 0.15 * Math.sin(now / 47) * Math.sin(now / 131) : 1;
      const R = (11 + over * 9) * fl;
      const glow = g.createRadialGradient(x, y, 0, x, y, R * 2.2);
      glow.addColorStop(0, `rgba(255,236,190,${0.55 + over * 0.3})`);
      glow.addColorStop(0.25, `rgba(255,176,80,${0.32 + over * 0.2})`);
      glow.addColorStop(1, 'rgba(255,120,40,0)');
      g.fillStyle = glow;
      g.fillRect(x - R * 2.2, y - R * 2.2, R * 4.4, R * 4.4);
      g.globalCompositeOperation = 'source-over';
      const core = g.createRadialGradient(x - 0.6, y - 0.6, 0, x, y, 3.6 + over);
      core.addColorStop(0, '#ffffff');
      core.addColorStop(0.45, '#fff2c8');
      core.addColorStop(1, 'rgba(255,190,90,0)');
      g.fillStyle = core;
      g.beginPath();
      g.arc(x, y, 3.6 + over, 0, Math.PI * 2);
      g.fill();
      grow(x, y, R * 2.2 + 1);
    }
    g.globalCompositeOperation = 'source-over';
    this.dirty = x0 === Infinity ? { x0: 0, y0: 0, x1: 0, y1: 0 } : { x0, y0, x1, y1 };
    this.px = this.x;
    this.py = this.y;
    if (!busy) this.awake = false;
  }
}
