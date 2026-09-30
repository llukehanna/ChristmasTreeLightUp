import { formatTime } from '../core/score';

export const shareText = (seconds: number): string => `Lit the tree in ${formatTime(seconds)} · aglow.lukeghanna.com`;

/** 1080×1350 image: blurred scene fill, the player's lit tree, their time and the URL (spec §6, step 7). */
export async function makeShareImage(stage: HTMLCanvasElement, rect: { x: number; y: number; w: number; h: number }, seconds: number, ink: string): Promise<Blob> {
  await document.fonts.load('italic 88px "Instrument Serif"');
  const W = 1080;
  const H = 1350;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d');
  if (!x) throw new Error('Canvas 2D unavailable');
  x.filter = 'blur(40px) brightness(0.8)';
  x.drawImage(stage, 0, 0, W, H);
  x.filter = 'none';
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
  const cx = crop.getContext('2d');
  if (!cx) throw new Error('Canvas 2D unavailable');
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
  x.fillStyle = ink;
  x.textAlign = 'center';
  x.font = 'italic 88px "Instrument Serif"';
  x.fillText(`Lit in ${formatTime(seconds)}`, W / 2, H - 140);
  x.font = '500 24px Inter, sans-serif';
  x.globalAlpha = 0.7;
  x.fillText('A G L O W   ·   A G L O W . L U K E G H A N N A . C O M', W / 2, H - 80);
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png'));
}

export type ShareOutcome = 'shared' | 'cancelled' | 'copied-image' | 'copied-text' | 'failed';

/** Phones: native share sheet with the image. Desktop: copy the image; fallback: copy the text (spec §6, step 7). */
export async function shareResult(image: Blob, seconds: number): Promise<ShareOutcome> {
  const text = shareText(seconds);
  const file = new File([image], 'aglow.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': image })]);
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
