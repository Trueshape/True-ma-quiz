import { supabase } from '@/lib/supabase';

export const QUESTION_IMAGE_MAX_SIDE = 1600;
export const QUESTION_IMAGE_MAX_MB = 1;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif', 'image/bmp'];
export const QUESTION_IMAGE_ACCEPT = ACCEPTED.join(',');

/** Returns an error message for a picture that cannot be uploaded, or null when it is fine. */
export function checkQuestionImage(file: { type: string; size: number }): string | null {
  if (!ACCEPTED.includes(file.type)) return 'Use a JPG, PNG, WebP, GIF, AVIF or BMP image.';
  if (file.size > QUESTION_IMAGE_MAX_MB * 1024 * 1024) return `The image must be ${QUESTION_IMAGE_MAX_MB} MB or smaller.`;
  return null;
}

/** Longest side at most `maxSide` px, saved as JPEG, so pictures load fast on phones. */
export async function resizeImage(file: Blob, maxSide = QUESTION_IMAGE_MAX_SIDE, quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no_canvas');
  ctx.fillStyle = '#fff'; // transparent areas become white instead of black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode_failed'))), 'image/jpeg', quality)
  );
}

/** Resizes a picture from the device and uploads it to the signed-in user's folder. Returns its public URL. */
export async function uploadQuestionImage(file: File): Promise<{ url?: string; error?: string }> {
  const invalid = checkQuestionImage(file);
  if (invalid) return { error: invalid };
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return { error: 'Sign in to upload images, or paste an image URL.' };
  let blob: Blob;
  try {
    blob = await resizeImage(file);
  } catch {
    return { error: 'This image could not be read.' };
  }
  const path = `${userId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage.from('question-images').upload(path, blob, { contentType: 'image/jpeg' });
  if (error) return { error: 'Upload failed. Try again.' };
  return { url: supabase.storage.from('question-images').getPublicUrl(path).data.publicUrl };
}
