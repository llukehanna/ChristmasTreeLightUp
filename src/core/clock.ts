/** The reveal before the clock starts (base spec §6): the server takes it off every ranked time. */
export const REVEAL_MS = 900;

/** Pausable game timer. The timer starts after the reveal and stops while the game is paused: the pause pill, P, or a hidden tab (spec §2.7, §6). */
export class GameClock {
  private accumulated: number;
  private since = 0;
  running = false;

  constructor(initialMs = 0) {
    this.accumulated = initialMs;
  }

  resume(now: number): void {
    if (this.running) return;
    this.since = now;
    this.running = true;
  }

  pause(now: number): void {
    if (!this.running) return;
    this.accumulated += now - this.since;
    this.running = false;
  }

  elapsedMs(now: number): number {
    return this.accumulated + (this.running ? now - this.since : 0);
  }
}
