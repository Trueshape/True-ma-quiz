import { supabase } from '@/lib/supabase';

export const QUESTION_IMAGE_MAX_SIDE = 1600;
const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_INPUT_BYTES = 20 * 1024 * 1024;

/** Longest side at most `maxSide` px, saved as JPEG: big photos become a few hundred KB. */
export async function resizeImage(file: Blob, maxSide = QUESTION_IMAGE_MAX_SIDE, quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no_canvas');
  ctx.fillStyle = '#fff'; // transparent PNG areas become white instead of black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode_failed'))), 'image/jpeg', quality)
  );
}

/** Resizes a picture and uploads it to the signed-in user's folder. Returns its public URL. */
export async function uploadQuestionImage(file: File): Promise<{ url?: string; error?: string }> {
  if (!ACCEPTED.includes(file.type)) return { error: 'Use a JPG, PNG or WebP image.' };
  if (file.size > MAX_INPUT_BYTES) return { error: 'The image is larger than 20 MB.' };
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
