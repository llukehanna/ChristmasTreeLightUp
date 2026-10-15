import type { RunOutcome } from '../api/outcome';
import type { HomeAloneClip } from '../audio/home-alone-sounds';

/**
 * Mr. Hector (spec 2026-10-14 §9.4). HectorDesk decides whether a Home Alone win gets his glare, and which clip it
 * says; HectorGlare puts the glare on screen. The glare is for every unranked run the tag says couldn't be verified
 * (the server couldn't replay the log, the log outgrew what it takes, or the server couldn't time it: 'clock'); it
 * brings one of his two lines, alternating.
 * A new personal best says "I love you" instead of the filthy animal. A win says one clip at most, and the glare's line
 * beats the others.
 */

export type GlareClip = 'hector-credit-card' | 'hector-mistaken';
/** His lines with the glare, in turn. */
export const GLARE_CLIPS: readonly GlareClip[] = ['hector-credit-card', 'hector-mistaken'];

/**
 * The glare's condition: in the mode, and an unranked run the tag says couldn't be verified, whatever the reason: the
 * log ("couldn't verify this run") or the clock (the server kept it but couldn't time it, e.g. a run that spanned
 * reloads, sent late). Never a ranked one.
 */
export const glares = (mode: boolean, o: RunOutcome | null): boolean =>
  mode && (o?.kind === 'unverified' || (o?.kind === 'done' && !o.result.ranked && o.result.reason === 'clock'));

/** The server's answer is still on its way: the win's clip waits for it (until the tag shows). */
const pending = (o: RunOutcome | null): boolean => o === null || o.kind === 'saving';

/** A new personal best: this device's best time, or the account's best ranked run. */
const best = (newBest: boolean, o: RunOutcome | null): boolean => newBest || (o?.kind === 'done' && o.result.newBest);

export interface HectorStep {
  /** A clip to play now (the effects path still gates it). */
  clip: HomeAloneClip | null;
  /** Show the glare now. */
  glare: boolean;
}

interface Win {
  newBest: boolean;
  /** The win's sound is due (the last bulb lit). */
  due: boolean;
  /** The tag is up: the clip waits no longer for the server. */
  tag: boolean;
  /** This win has had its clip (or its chance at one). */
  spoke: boolean;
  glared: boolean;
}

/** One per page: the live win under way, and whose turn it is among his lines. Pure: the App does the playing and showing. */
export class HectorDesk {
  private turn = 0;
  private win: Win | null = null;

  /** A live win (never a restored one): its sound and its tag are still to come. */
  begin(newBest: boolean): void {
    this.win = { newBest, due: false, tag: false, spoke: false, glared: false };
  }

  /** The win is over (a new tree): nothing more for it. */
  end(): void {
    this.win = null;
  }

  soundDue(): void {
    if (this.win) this.win.due = true;
  }

  tagShown(): void {
    if (this.win) this.win.tag = true;
  }

  /** What to do now, given the mode and the run's outcome: called at the sound, at the tag and whenever the outcome changes. */
  step(mode: boolean, o: RunOutcome | null): HectorStep {
    const w = this.win;
    const out: HectorStep = { clip: null, glare: false };
    if (!w) return out;
    if (w.tag && !w.glared && glares(mode, o)) {
      w.glared = true;
      out.glare = true;
      if (!w.spoke) {
        w.spoke = true;
        out.clip = GLARE_CLIPS[this.turn++ % GLARE_CLIPS.length];
      }
      return out;
    }
    if (!w.due || w.spoke) return out;
    if (!mode) {
      w.spoke = true; // the usual win: no clip, as before the mode
      return out;
    }
    // The glare will speak when the tag shows.
    if (glares(mode, o) || (pending(o) && !w.tag)) return out;
    w.spoke = true;
    out.clip = best(w.newBest, o) ? 'hector-love' : 'filthy-animal';
    return out;
  }
}

/** The glare's timing (spec §9.4): leans in, holds, leans back. */
export const GLARE_IN_MS = 400;
export const GLARE_HOLD_MS = 2500;
export const GLARE_OUT_MS = 400;
/** A still that hasn't arrived this long after the glare was called for is given up on: no Hector this time. */
export const GLARE_WAIT_MS = 1500;

/**
 * The glare on screen: Mr. Hector's still (from Luke's copy of the film, fetched like the clips, never in the repo) as
 * a framed photo tucked behind the results tag, leaning out from its edge (beside it; on a phone, above it), holding,
 * then tucking back. Reduced motion: it fades in and out in place. A still that fails to load shows nothing (the clip,
 * played by the App, is unaffected). Decorative: hidden from assistive tech, never takes a tap.
 */
export class HectorGlare {
  private img: HTMLImageElement | null = null;
  private loaded: Promise<boolean> = Promise.resolve(false);
  private frame: HTMLElement | null = null;
  private timers: ReturnType<typeof setTimeout>[] = [];
  /** Bumped by every show and cancel: a still arriving late only shows for the glare that asked for it. */
  private token = 0;

  constructor(
    private readonly host: () => HTMLElement,
    private readonly url: string,
  ) {}

  /** On screen now (from leaning in until tucked back). */
  get showing(): boolean {
    return this.frame !== null;
  }

  /** Fetches the still ahead of need (the mode is on); after a failure the next call tries again. */
  preload(): void {
    if (this.img) return;
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    this.loaded = new Promise<boolean>((resolve) => {
      img.onload = () => resolve(img.naturalWidth > 0);
      img.onerror = () => {
        if (this.img === img) this.img = null;
        resolve(false);
      };
    });
    img.src = this.url;
    this.img = img;
  }

  show(reduced: boolean): void {
    this.cancel();
    this.preload();
    const token = this.token;
    const late = new Promise<boolean>((r) => this.timers.push(setTimeout(() => r(false), GLARE_WAIT_MS)));
    void Promise.race([this.loaded, late]).then((ok) => {
      if (ok && token === this.token && this.img) this.enter(this.img, reduced);
    });
  }

  /** Gone at once: a new tree, the tag put away, the mode switched off. */
  cancel(): void {
    this.token++;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.frame?.remove();
    this.frame = null;
  }

  private enter(img: HTMLImageElement, reduced: boolean): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    const frame = document.createElement('figure');
    frame.className = reduced ? 'hector still' : 'hector';
    frame.setAttribute('aria-hidden', 'true');
    const photo = img.cloneNode() as HTMLImageElement;
    photo.draggable = false;
    const cap = document.createElement('figcaption');
    cap.textContent = 'Mr. Hector';
    frame.append(photo, cap);
    this.host().append(frame);
    this.frame = frame;
    void frame.offsetWidth; // the start pose is laid out before the move to the end pose
    frame.classList.add('in');
    this.timers.push(
      setTimeout(() => frame.classList.remove('in'), GLARE_IN_MS + GLARE_HOLD_MS),
      setTimeout(() => {
        if (this.frame === frame) this.cancel();
      }, GLARE_IN_MS + GLARE_HOLD_MS + GLARE_OUT_MS),
    );
  }
}
