export interface InputHandlers {
  tap(x: number, y: number): void;
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

/**
 * Mouse: rotate on pointerdown (instant). Touch/pen: rotate on a quick, still tap; two fingers pinch-zoom
 * and pan; one-finger drags pan while zoomed (spec §6.1). Trackpad pinch arrives as ctrl+wheel.
 */
export function bindInput(el: HTMLElement, h: InputHandlers): () => void {
  const pts = new Map<number, Pt>();
  let pinched = false;
  let lastDist = 0;
  let lastMid: [number, number] | null = null;

  const pair = (): [Pt, Pt] => [...pts.values()].slice(0, 2) as [Pt, Pt];

  const down = (e: PointerEvent) => {
    if (e.pointerType === 'mouse') {
      if (e.button === 0) h.tap(e.clientX, e.clientY);
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
    if (p && !pinched && !p.dragging && e.timeStamp - p.t0 < 500) h.tap(p.x0, p.y0);
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

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', leave);
  el.addEventListener('wheel', wheel, { passive: false });
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
    el.removeEventListener('pointerleave', leave);
    el.removeEventListener('wheel', wheel);
  };
}
