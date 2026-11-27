/**
 * Framing of a profile picture inside the round frame.
 * zoom: 1 = the picture just covers the frame, up to ZOOM_MAX.
 * x, y: offset of the picture centre from the frame centre, as a fraction of the frame size.
 */
export type Framing = { zoom: number; x: number; y: number };

export const ZOOM_MAX = 3;
const OUTPUT = 512;

/** Keeps the zoom in range and the picture covering the whole frame. */
export function clampFraming(w: number, h: number, f: Framing): Framing {
  const zoom = Math.min(ZOOM_MAX, Math.max(1, f.zoom));
  const m = Math.min(w, h);
  const maxX = ((w / m) * zoom - 1) / 2;
  const maxY = ((h / m) * zoom - 1) / 2;
  const clamp = (v: number, max: number) => Math.min(max, Math.max(-max, v)) + 0;
  return { zoom, x: clamp(f.x, maxX), y: clamp(f.y, maxY) };
}

/** The square of the original picture (in its pixels) that the frame shows. */
export function cropRect(w: number, h: number, framing: Framing): { sx: number; sy: number; size: number } {
  const f = clampFraming(w, h, framing);
  const size = Math.min(w, h) / f.zoom;
  return { sx: w / 2 - size / 2 - f.x * size, sy: h / 2 - size / 2 - f.y * size, size };
}

/** Draws the framed square into a 512 px picture of the same type. */
export async function cropToFile(src: string, framing: Framing, type: string): Promise<File> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const { sx, sy, size } = cropRect(img.naturalWidth, img.naturalHeight, framing);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = OUTPUT;
  canvas.getContext('2d')!.drawImage(img, sx, sy, size, size, 0, 0, OUTPUT, OUTPUT);
  const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, type, 0.9));
  if (!blob) throw new Error('crop_failed');
  return new File([blob], 'avatar', { type });
}
