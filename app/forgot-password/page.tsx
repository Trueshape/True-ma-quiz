'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { KeyRound, Mail } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { RESET_ERRORS, nicknameEmail, resetPasswordWithCode, sendResetEmail } from '@/lib/recovery';
import { HeaderBack, HeaderEnd } from '@/components/header-controls';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type Way = 'code' | 'email';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [way, setWay] = useState<Way>('code');
  const [nickname, setNickname] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const withCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8 || password.length > 72) return setError(RESET_ERRORS.invalid_password);
    if (password !== repeat) return setError('The two passwords are different.');
    setBusy(true);
    setError(null);
    const res = await resetPasswordWithCode(nickname.trim(), code, password);
    if (!res.ok) {
      setBusy(false);
      setError(RESET_ERRORS[res.error ?? 'failed']);
      return;
    }
    // Signed in right away; the profile then offers a new code (the old one is used up).
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: nicknameEmail(nickname), password });
    setBusy(false);
    router.push(signInError ? '/?reset=1' : '/profile?code=used');
  };

  const withEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes('@')) return setError('Type the email address of your account.');
    setBusy(true);
    setError(null);
    await sendResetEmail(email);
    setBusy(false);
    setSent(true); // Same answer whether or not the address has an account.
  };

  return (
    <div className="min-h-screen bg-grid relative">
      <div className="absolute top-0 right-0 w-96 h-96 bg-primary/20 rounded-full blur-3xl" />
      <div className="relative z-10 max-w-md mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <HeaderBack href="/" label="Back to sign in" />
          <HeaderEnd account={false} />
        </div>

        <Card className="border-border bg-card/80 backdrop-blur-md">
          <CardHeader>
            <CardTitle>Choose a new password</CardTitle>
            <CardDescription>Use the recovery code you saved, or the email you added to your account.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex gap-1 p-1 rounded-lg bg-muted/50" role="tablist">
              {([
                ['code', 'Recovery code', <KeyRound key="k" className="w-4 h-4" />],
                ['email', 'Email', <Mail key="m" className="w-4 h-4" />],
              ] as [Way, string, React.ReactNode][]).map(([value, label, icon]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={way === value}
                  onClick={() => {
                    setWay(value);
                    setError(null);
                  }}
                  className={cn('flex-1 py-2 text-sm font-medium rounded-md flex items-center justify-center gap-1.5 transition-colors', way === value ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground')}
                >
                  {icon} {label}
                </button>
              ))}
            </div>

            {way === 'code' ? (
              <form onSubmit={withCode} className="space-y-3">
                <Input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="Nickname" aria-label="Nickname" autoComplete="username" maxLength={20} />
                <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXX-XXXX-XXXX" aria-label="Recovery code" className="font-mono tracking-widest" autoComplete="one-time-code" maxLength={20} />
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password (at least 8 characters)" aria-label="New password" autoComplete="new-password" maxLength={72} />
                <Input type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} placeholder="New password again" aria-label="New password again" autoComplete="new-password" maxLength={72} />
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={busy || !nickname.trim() || !code.trim()}>
                  {busy ? 'Please wait…' : 'Set new password'}
                </Button>
              </form>
            ) : sent ? (
              <p className="text-sm" role="status">
                If an account uses <span className="font-semibold">{email.trim()}</span>, an email with a link is on its way. Open it on this device to choose a new password.
              </p>
            ) : (
              <form onSubmit={withEmail} className="space-y-3">
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" aria-label="Email" autoComplete="email" />
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? 'Please wait…' : 'Send me a link'}
                </Button>
                <p className="text-xs text-muted-foreground">Works only if you added this email in your profile.</p>
              </form>
            )}

            <p className="text-xs text-muted-foreground">
              Signed up with Google? You have no password here: <Link href="/" className="underline">sign in with Google</Link>.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
