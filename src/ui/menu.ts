import type { Settings } from '../store/settings';
import { el } from './dom';

export interface MenuHandlers {
  onChange(s: Settings): void;
  onNewTree(): void;
  /** True while a game is in progress (New tree then needs a second tap). */
  needsConfirm(): boolean;
}

export class Menu {
  private readonly root = el('menu');
  private readonly button = el('menu-btn');
  private readonly newTree = el('new-tree');
  private readonly volume = el<HTMLInputElement>('effects-volume');
  private readonly haptics = el<HTMLInputElement>('haptics');
  private armedUntil = 0;

  constructor(private settings: Settings, private readonly h: MenuHandlers) {
    this.button.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.root.hidden) this.open();
      else this.close();
    });
    document.addEventListener('pointerdown', (e) => {
      const t = e.target as Node;
      if (!this.root.hidden && !this.root.contains(t) && !this.button.contains(t) && t !== el('stage')) this.close();
    });
    this.root.querySelectorAll<HTMLElement>('.seg').forEach((seg) =>
      seg.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('button');
        if (!b?.dataset.value) return;
        const key = seg.dataset.setting as 'scene' | 'pathStyle';
        this.update({ [key]: b.dataset.value } as Partial<Settings>);
      }),
    );
    this.volume.addEventListener('input', () => this.update({ effectsVolume: Number(this.volume.value) }));
    this.haptics.addEventListener('change', () => this.update({ haptics: this.haptics.checked }));
    if (!('vibrate' in navigator)) el('haptics-row').hidden = true;
    this.newTree.addEventListener('click', () => this.onNewTree());
    this.render();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(): void {
    this.root.hidden = false;
    this.button.setAttribute('aria-expanded', 'true');
  }

  close(): void {
    this.root.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
    this.armedUntil = 0;
    this.render();
  }

  private onNewTree(): void {
    const now = performance.now();
    if (!this.h.needsConfirm() || now < this.armedUntil) {
      this.close();
      this.h.onNewTree();
      return;
    }
    this.armedUntil = now + 3000;
    this.render();
    window.setTimeout(() => this.render(), 3050);
  }

  private update(p: Partial<Settings>): void {
    this.settings = { ...this.settings, ...p };
    this.render();
    this.h.onChange(this.settings);
  }

  private render(): void {
    this.root.querySelectorAll<HTMLElement>('.seg').forEach((seg) => {
      const key = seg.dataset.setting as 'scene' | 'pathStyle';
      seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === this.settings[key])));
    });
    this.volume.value = String(this.settings.effectsVolume);
    this.haptics.checked = this.settings.haptics;
    const armed = performance.now() < this.armedUntil;
    this.newTree.textContent = armed ? 'Tap again to start over' : 'New tree';
    this.newTree.classList.toggle('armed', armed);
  }
}
