export class Toast {
  private timer = 0;
  constructor(private readonly node: HTMLElement) {}
  show(text: string, ms = 2200): void {
    this.node.textContent = text;
    this.node.classList.add('show');
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.node.classList.remove('show'), ms);
  }
}
