import { formatTime } from '../core/score';
import { drawBlurred } from '../render/blur';

export const shareText = (seconds: number): string => `Lit the tree in ${formatTime(seconds)} · aglow.lukeghanna.com`;

const W = 1080;
const H = 1350;

/** The largest centred rectangle inside `w`×`h` with the aspect ratio `aspect` (width / height). */
export function coverRect(w: number, h: number, aspect: number): { x: number; y: number; w: number; h: number } {
  const cw = Math.min(w, h * aspect);
  const ch = Math.min(h, w / aspect);
  return { x: (w - cw) / 2, y: (h - ch) / 2, w: cw, h: ch };
}

function context2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const x = c.getContext('2d');
  if (!x) throw new Error('Canvas 2D unavailable');
  return x;
}

/** 1080×1350 image: blurred scene fill, the player's lit tree, their time and the URL (spec §6, step 7). */
export async function makeShareImage(stage: HTMLCanvasElement, rect: { x: number; y: number; w: number; h: number }, seconds: number, ink: string): Promise<Blob> {
  await document.fonts.load('italic 88px "Instrument Serif"');
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = context2d(c);
  // Background: a 4:5 cover crop of the stage (never stretched), blurred with the filter-less fallback where needed.
  const cover = coverRect(stage.width, stage.height, W / H);
  const fill = document.createElement('canvas');
  fill.width = W / 2;
  fill.height = H / 2;
  context2d(fill).drawImage(stage, cover.x, cover.y, cover.w, cover.h, 0, 0, fill.width, fill.height);
  drawBlurred(x, fill, 40, 'share');
  fill.width = fill.height = 0;
  x.fillStyle = 'rgba(0,0,0,0.2)'; // brightness(0.8)
  x.fillRect(0, 0, W, H);
  // The tree (with its garland and presents) is centred in the space above the caption.
  const top = 50;
  const room = H - 300 - top;
  const k = Math.min(W / rect.w, room / rect.h);
  const dw = rect.w * k;
  const dh = rect.h * k;
  // Feather the crop into the blurred fill so it has no hard edges.
  const crop = document.createElement('canvas');
  crop.width = Math.round(dw);
  crop.height = Math.round(dh);
  const cx = context2d(crop);
  cx.drawImage(stage, rect.x, rect.y, rect.w, rect.h, 0, 0, crop.width, crop.height);
  cx.globalCompositeOperation = 'destination-in';
  for (const [x1, y1, e] of [[0, crop.height, 0.07], [crop.width, 0, 0.035]]) {
    const f = cx.createLinearGradient(0, 0, x1, y1);
    f.addColorStop(0, 'rgba(0,0,0,0)');
    f.addColorStop(e, '#000');
    f.addColorStop(1 - e, '#000');
    f.addColorStop(1, 'rgba(0,0,0,0)');
    cx.fillStyle = f;
    cx.fillRect(0, 0, crop.width, crop.height);
  }
  x.drawImage(crop, (W - dw) / 2, top + (room - dh) / 2, dw, dh);
  crop.width = crop.height = 0;
  x.fillStyle = ink;
  x.textAlign = 'center';
  x.font = 'italic 88px "Instrument Serif"';
  x.fillText(`Lit in ${formatTime(seconds)}`, W / 2, H - 140);
  x.font = '500 24px Inter, sans-serif';
  x.globalAlpha = 0.7;
  x.fillText('A G L O W   ·   A G L O W . L U K E G H A N N A . C O M', W / 2, H - 80);
  return new Promise((resolve, reject) =>
    c.toBlob((b) => {
      c.width = c.height = 0;
      if (b) resolve(b);
      else reject(new Error('toBlob failed'));
    }, 'image/png'),
  );
}

/** A share image prepared ahead of the tap: `blob` is filled in once `pending` resolves. */
export interface ShareImage {
  pending: Promise<Blob>;
  blob: Blob | null;
}

export function prepareShareImage(make: () => Promise<Blob>): ShareImage {
  const image: ShareImage = { pending: make(), blob: null };
  image.pending.then(
    (b) => {
      image.blob = b;
    },
    () => {}, // a failed render surfaces through shareResult's fallbacks
  );
  return image;
}

export type ShareOutcome = 'shared' | 'cancelled' | 'copied-image' | 'copied-text' | 'failed';

/**
 * Phones: native share sheet with the image. Desktop: copy the image plus the text; fallback: copy the text (spec §6, step 7).
 * Call it straight from the tap handler. WebKit only allows share and clipboard writes while the tap's user activation
 * lasts, so nothing is awaited before them: the image is prepared ahead, and the clipboard takes it as a promise.
 */
export async function shareResult(image: ShareImage, seconds: number): Promise<ShareOutcome> {
  const text = shareText(seconds);
  const file = image.blob && new File([image.blob], 'aglow.png', { type: 'image/png' });
  if (file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    const textBlob = new Blob([text], { type: 'text/plain' });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': image.pending, 'text/plain': textBlob })]);
    return 'copied-image';
  } catch {
    // fall through to text
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied-text';
  } catch {
    return 'failed';
  }
}
