/** Pausable game timer. The timer starts after the reveal and pauses while the tab is hidden (spec §2.7). */
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
