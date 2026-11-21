import { supabase } from '@/lib/supabase';

/*
  Password recovery for nickname-and-password accounts, two ways:
  - a recovery code (shown once, kept hashed on the server): nickname + code + new password
  - an email address the user adds in the profile: Supabase sends a reset link

  Accounts made with a nickname sign in with a made-up address (nick@truemaquiz.local).
  After a real email is added and confirmed, the account signs in with that email.
*/

export const FAKE_EMAIL_DOMAIN = '@truemaquiz.local';
export const nicknameEmail = (nickname: string) => `${nickname.trim().toLowerCase()}${FAKE_EMAIL_DOMAIN}`;
export const isRealEmail = (email: string | null | undefined) => !!email && !email.endsWith(FAKE_EMAIL_DOMAIN);

/** A new recovery code for the signed-in account; the previous one stops working. */
export async function createRecoveryCode(): Promise<string | null> {
  const { data, error } = await supabase.rpc('create_recovery_code');
  return error ? null : (data as string);
}

export async function hasRecoveryCode(): Promise<boolean> {
  const { data, error } = await supabase.rpc('has_recovery_code');
  return !error && data === true;
}

export type ResetError = 'invalid_code' | 'invalid_password' | 'too_many_attempts' | 'failed';

export async function resetPasswordWithCode(nickname: string, code: string, newPassword: string): Promise<{ ok: boolean; error?: ResetError }> {
  const { data, error } = await supabase.rpc('reset_password_with_code', { p_nickname: nickname, p_code: code, p_new_password: newPassword });
  if (error || !data) return { ok: false, error: 'failed' };
  return data as { ok: boolean; error?: ResetError };
}

/** True when the account with this nickname now signs in with its own email address. */
export async function nicknameUsesEmail(nickname: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('nickname_uses_email', { p_nickname: nickname });
  return !error && data === true;
}

/** Supabase emails a link that opens /reset-password signed in for a password change. */
export async function sendResetEmail(email: string): Promise<boolean> {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/reset-password` });
  return !error;
}

/** Adds or changes the account email; Supabase sends a confirmation link to it first. */
export async function setRecoveryEmail(email: string): Promise<{ ok: boolean; message?: string }> {
  const { error } = await supabase.auth.updateUser({ email: email.trim() }, { emailRedirectTo: `${window.location.origin}/profile` });
  return error ? { ok: false, message: error.message } : { ok: true };
}

export const RESET_ERRORS: Record<ResetError, string> = {
  invalid_code: 'That nickname and code do not match.',
  invalid_password: 'The new password must be 8 to 72 characters.',
  too_many_attempts: 'Too many wrong codes. Try again in 15 minutes.',
  failed: 'Something went wrong. Try again.',
};
