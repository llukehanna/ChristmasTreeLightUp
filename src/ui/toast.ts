export class Toast {
  private timer = 0;
  /** Stops waiting for a toast held for a hidden tab (showWhenSeen). */
  private unwait: (() => void) | null = null;
  constructor(private readonly node: HTMLElement) {}
  show(text: string, ms = 2200): void {
    this.cancelWait();
    this.node.textContent = text;
    this.node.classList.add('show');
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.node.classList.remove('show'), ms);
  }
  /**
   * Shows the toast now in a visible tab; in a hidden one it waits until the tab is shown, then stays its usual time
   * (shown while hidden, it would expire unseen). A newer toast, or hide(), drops it.
   */
  showWhenSeen(text: string, ms?: number): void {
    if (!document.hidden) return this.show(text, ms);
    this.cancelWait();
    const onVisible = () => {
      if (!document.hidden) this.show(text, ms);
    };
    document.addEventListener('visibilitychange', onVisible);
    this.unwait = () => document.removeEventListener('visibilitychange', onVisible);
  }

  private cancelWait(): void {
    this.unwait?.();
    this.unwait = null;
  }

  /** Takes the toast away now, whatever is left of its time, and drops one waiting to be seen. */
  hide(): void {
    this.cancelWait();
    clearTimeout(this.timer);
    this.node.classList.remove('show');
  }
}
