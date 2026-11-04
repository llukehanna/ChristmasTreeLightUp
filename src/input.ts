import type { Turn } from './core/dirs';

export interface InputHandlers {
  /** `dir`: 1 clockwise (left click, touch, pen), -1 counter-clockwise (right click). */
  tap(x: number, y: number, dir: Turn): void;
  hover(x: number, y: number): void;
  leave(): void;
  zoom(factor: number, fx: number, fy: number): void;
  pan(dx: number, dy: number): void;
}

interface Pt {
  x: number;
  y: number;
  x0: number;
  y0: number;
  t0: number;
  dragging: boolean;
}

/** A Mac (and so Ctrl+click is its right click). Read from userAgentData where there is one, else navigator.platform. */
export function onMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac/i.test(nav.userAgentData?.platform || nav.platform || '');
}

/**
 * Mouse: rotate on pointerdown (instant): left button clockwise, right button counter-clockwise (the browser's context
 * menu is off on the stage only). On a Mac, Ctrl+click is a right click (`mac`, injectable for tests). A right press
 * while the left button is already held arrives as a pointermove carrying button 2: it turns back too. Touch/pen: rotate on a quick, still tap; two fingers pinch-zoom
 * and pan; one-finger drags pan while zoomed (spec §6.1). Trackpad pinch arrives as ctrl+wheel.
 */
export function bindInput(el: HTMLElement, h: InputHandlers, mac: boolean = onMac()): () => void {
  const pts = new Map<number, Pt>();
  let pinched = false;
  let lastDist = 0;
  let lastMid: [number, number] | null = null;

  const pair = (): [Pt, Pt] => [...pts.values()].slice(0, 2) as [Pt, Pt];

  const down = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') {
      if (e.button === 0) h.tap(e.clientX, e.clientY, mac && e.ctrlKey ? -1 : 1);
      else if (e.button === 2) h.tap(e.clientX, e.clientY, -1);
      return;
    }
    el.setPointerCapture?.(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t0: e.timeStamp, dragging: false });
    if (pts.size === 2) {
      pinched = true;
      const [a, b] = pair();
      lastDist = Math.hypot(a.x - b.x, a.y - b.y);
      lastMid = [(a.x + b.x) / 2, (a.y + b.y) / 2];
    }
  };

  const move = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') {
      h.hover(e.clientX, e.clientY);
      if (e.button === 2) h.tap(e.clientX, e.clientY, -1);
      return;
    }
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (pts.size >= 2) {
      const [a, b] = pair();
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid: [number, number] = [(a.x + b.x) / 2, (a.y + b.y) / 2];
      if (lastDist > 0) h.zoom(dist / lastDist, mid[0], mid[1]);
      if (lastMid) h.pan(mid[0] - lastMid[0], mid[1] - lastMid[1]);
      lastDist = dist;
      lastMid = mid;
    } else if (p.dragging || Math.hypot(p.x - p.x0, p.y - p.y0) > 10) {
      p.dragging = true;
      h.pan(dx, dy);
    }
  };

  const up = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    const p = pts.get(e.pointerId);
    pts.delete(e.pointerId);
    if (p && !pinched && !p.dragging && e.timeStamp - p.t0 < 500) h.tap(p.x0, p.y0, 1);
    if (pts.size < 2) {
      lastDist = 0;
      lastMid = null;
    }
    if (pts.size === 0) pinched = false;
  };

  const cancel = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    pts.delete(e.pointerId);
    if (pts.size < 2) {
      lastDist = 0;
      lastMid = null;
    }
    if (pts.size === 0) pinched = false;
  };

  const wheel = (e: WheelEvent) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    h.zoom(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
  };

  const leave = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') h.leave();
  };

  const menu = (e: Event) => e.preventDefault();

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', cancel);
  el.addEventListener('pointerleave', leave);
  el.addEventListener('wheel', wheel, { passive: false });
  el.addEventListener('contextmenu', menu);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', cancel);
    el.removeEventListener('pointerleave', leave);
    el.removeEventListener('wheel', wheel);
    el.removeEventListener('contextmenu', menu);
  };
}
