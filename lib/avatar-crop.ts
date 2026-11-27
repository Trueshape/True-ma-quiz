/**
 * Framing of a profile picture inside the round frame.
 * zoom: 1 = the picture just covers the frame, from 1 to ZOOM_MAX.
 * x, y: offset of the picture centre from the frame centre, as a fraction of the frame size.
 * The picture can be moved freely: parts of the frame it leaves empty stay empty.
 */
export type Framing = { zoom: number; x: number; y: number };

export const ZOOM_MAX = 3;
const OUTPUT = 512;

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(1, zoom));
}

/** The square of the original picture (in its pixels) that the frame shows. */
export function cropRect(w: number, h: number, f: Framing): { sx: number; sy: number; size: number } {
  const size = Math.min(w, h) / clampZoom(f.zoom);
  return { sx: w / 2 - size / 2 - f.x * size, sy: h / 2 - size / 2 - f.y * size, size };
}

/** Draws the framed square into a 512 px picture of the same type (empty parts white in a JPG). */
export async function cropToFile(src: string, framing: Framing, type: string): Promise<File> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const { sx, sy, size } = cropRect(img.naturalWidth, img.naturalHeight, framing);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = OUTPUT;
  const ctx = canvas.getContext('2d')!;
  if (type === 'image/jpeg') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, OUTPUT, OUTPUT);
  }
  const k = OUTPUT / size;
  ctx.drawImage(img, -sx * k, -sy * k, img.naturalWidth * k, img.naturalHeight * k);
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, type, 0.9));
  if (!blob) throw new Error('crop_failed');
  return new File([blob], 'avatar', { type });
}
