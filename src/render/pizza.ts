import { FACE_CONFETTI_PX } from './faces';

/** Little Nero's (spec 2026-10-14 §6): a slice from one cached size, like secret mode's mini heads. */
export const PIZZA_PX = FACE_CONFETTI_PX;

/** A cached vector slice, `px` device px tall: tip down, crust across the top, cheese, three pepperoni. */
export class PizzaSprite {
  private canvas: HTMLCanvasElement | null = null;
  private px = 0;
  private broken = false;

  get(px: number): HTMLCanvasElement | null {
    if (this.broken) return null;
    const h = Math.max(4, Math.round(px));
    if (this.canvas && this.px === h) return this.canvas;
    const c = document.createElement('canvas');
    c.height = h;
    c.width = Math.round(h * 0.9);
    const x = c.getContext('2d');
    if (!x) {
      this.broken = true;
      return null;
    }
    paintSlice(x, c.width, h);
    if (this.canvas) this.canvas.width = this.canvas.height = 0;
    this.canvas = c;
    this.px = h;
    return c;
  }
}

/** The slice, painted once into its `w`×`h` canvas. */
function paintSlice(x: CanvasRenderingContext2D, w: number, h: number): void {
  // Cheese: a triangle from the crust down to the tip, warm gold to a baked orange.
  const cheese = x.createLinearGradient(0, 0.18 * h, 0, h);
  cheese.addColorStop(0, '#ffd45a');
  cheese.addColorStop(1, '#f4b13a');
  x.fillStyle = cheese;
  x.beginPath();
  x.moveTo(0.08 * w, 0.18 * h);
  x.lineTo(0.92 * w, 0.18 * h);
  x.lineTo(0.5 * w, h);
  x.closePath();
  x.fill();
  // Melted-cheese drips along the edges.
  x.fillStyle = '#f6c64a';
  for (const [cx, cy, r] of [
    [0.22, 0.46, 0.07],
    [0.79, 0.4, 0.06],
    [0.36, 0.74, 0.05],
  ] as const) {
    x.beginPath();
    x.ellipse(cx * w, cy * h, r * w, r * w * 1.6, 0, 0, Math.PI * 2);
    x.fill();
  }
  // Crust: a rounded band across the top, with a lighter baked highlight.
  const top = 0.02 * h;
  const bottom = 0.2 * h;
  x.fillStyle = '#c9852f';
  x.beginPath();
  x.moveTo(0.04 * w, bottom);
  x.quadraticCurveTo(0, top, 0.18 * w, top);
  x.lineTo(0.82 * w, top);
  x.quadraticCurveTo(w, top, 0.96 * w, bottom);
  x.closePath();
  x.fill();
  x.strokeStyle = '#e3a24f';
  x.lineWidth = Math.max(1, 0.035 * h);
  x.lineCap = 'round';
  x.beginPath();
  x.moveTo(0.18 * w, 0.07 * h);
  x.quadraticCurveTo(0.5 * w, 0.04 * h, 0.82 * w, 0.07 * h);
  x.stroke();
  // Three pepperoni.
  x.fillStyle = '#b3261e';
  for (const [cx, cy] of [
    [0.38, 0.35],
    [0.62, 0.42],
    [0.48, 0.62],
  ] as const) {
    x.beginPath();
    x.arc(cx * w, cy * h, 0.09 * w, 0, Math.PI * 2);
    x.fill();
  }
}
