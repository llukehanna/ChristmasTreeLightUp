import { Board } from './core/board';
import { GRID } from './core/mask';
import { IDENTITY } from './render/camera';
import { tileAt } from './render/layout';
import { Renderer } from './render/renderer';
import { VisualState } from './render/visual-state';

export function startMinimal(canvas: HTMLCanvasElement): void {
  const renderer = new Renderer(canvas);
  const board = Board.random(GRID, Math.random);
  const vis = new VisualState(GRID.w * GRID.h);
  const revealAt = performance.now();
  vis.onLightingChanged(board, board.lighting.order, [], revealAt + 700, false);
  const resize = () => renderer.resize(innerWidth, innerHeight, Math.min(2, devicePixelRatio || 1));
  resize();
  addEventListener('resize', resize);
  canvas.addEventListener('pointerdown', (e) => {
    const now = performance.now();
    const i = tileAt(renderer.layout, GRID, e.clientX, e.clientY);
    if (i < 0) return;
    for (const ev of board.tap(i, now)) if (ev.type === 'lightingChanged') vis.onLightingChanged(board, ev.newlyLit, ev.lost, now, true);
  });
  let last = performance.now();
  const loop = (now: number) => {
    requestAnimationFrame(loop);
    for (const ev of board.tick(now)) {
      if (ev.type === 'rotateFinished') vis.onRotateFinished(ev.tile, now);
      if (ev.type === 'lightingChanged') vis.onLightingChanged(board, ev.newlyLit, ev.lost, now, true);
    }
    renderer.frame({ board, vis, now, dt: Math.min(50, now - last), camera: IDENTITY, hover: -1, revealAt, winAt: null, reducedMotion: false });
    last = now;
  };
  requestAnimationFrame(loop);
}
