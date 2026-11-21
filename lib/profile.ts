import { supabase } from '@/lib/supabase';

export type Profile = { user_id: string; nickname: string; avatar_url: string | null };

export const NICKNAME_MIN = 4;
export const NICKNAME_MAX = 20;
export const AVATAR_MAX_BYTES = 1024 * 1024;
export const AVATAR_TYPES = ['image/jpeg', 'image/png'];

/** Returns an error message for a picture that cannot be used, or null when it is fine. */
export function checkAvatarFile(file: { type: string; size: number }): string | null {
  if (!AVATAR_TYPES.includes(file.type)) return 'Use a JPG or PNG image.';
  if (file.size > AVATAR_MAX_BYTES) return 'The image must be 1 MB or smaller.';
  return null;
}

export async function getMyProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase.from('profiles').select('user_id, nickname, avatar_url').eq('user_id', userId).maybeSingle();
  return (data as Profile | null) ?? null;
}

export async function nicknameAvailable(nickname: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('nickname_available', { p_nickname: nickname });
  return !error && data === true;
}

export async function setProfile(nickname: string, avatarUrl?: string | null): Promise<{ profile?: Profile; error?: string }> {
  const { data, error } = await supabase.rpc('set_profile', { p_nickname: nickname, p_avatar_url: avatarUrl ?? null });
  if (error) {
    const known = ['nickname_taken', 'invalid_nickname', 'invalid_avatar'].find((k) => error.message.includes(k));
    return { error: known ?? 'failed' };
  }
  return { profile: data as Profile };
}

/** Uploads the picture to the user's own folder and returns its public URL (changes on every upload). */
export async function uploadAvatar(userId: string, file: File): Promise<{ url?: string; error?: string }> {
  const invalid = checkAvatarFile(file);
  if (invalid) return { error: invalid };
  const path = `${userId}/avatar`;
  const { error } = await supabase.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
  if (error) return { error: 'Upload failed. Try again.' };
  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return { url: `${data.publicUrl}?v=${Date.now()}` };
}
