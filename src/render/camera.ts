/** Pinch-zoom camera: screen = world × scale + t. */
export interface Camera {
  scale: number;
  tx: number;
  ty: number;
}

export const IDENTITY: Camera = { scale: 1, tx: 0, ty: 0 };
export const MAX_ZOOM = 3;

export const toWorld = (c: Camera, x: number, y: number): [number, number] => [(x - c.tx) / c.scale, (y - c.ty) / c.scale];
export const toScreen = (c: Camera, x: number, y: number): [number, number] => [x * c.scale + c.tx, y * c.scale + c.ty];

export function zoomAt(c: Camera, factor: number, fx: number, fy: number): Camera {
  const scale = Math.min(MAX_ZOOM, Math.max(1, c.scale * factor));
  const k = scale / c.scale;
  return { scale, tx: fx - (fx - c.tx) * k, ty: fy - (fy - c.ty) * k };
}

export const panBy = (c: Camera, dx: number, dy: number): Camera => ({ scale: c.scale, tx: c.tx + dx, ty: c.ty + dy });

/** Keep the scaled world covering the viewport. */
export function clampCamera(c: Camera, w: number, h: number): Camera {
  const minX = w - w * c.scale;
  const minY = h - h * c.scale;
  return { scale: c.scale, tx: Math.min(0, Math.max(minX, c.tx)), ty: Math.min(0, Math.max(minY, c.ty)) };
}

export const isZoomed = (c: Camera): boolean => c.scale > 1.01;
