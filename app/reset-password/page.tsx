'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { HeaderEnd } from '@/components/header-controls';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** Opened from the email link: Supabase signs the user in for a password change. */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [ready, setReady] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // The link signs the user in (PASSWORD_RECOVERY); give it a moment, then check.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || session) setReady(true);
    });
    const t = setTimeout(() => {
      supabase.auth.getSession().then(({ data }) => setReady((r) => r ?? !!data.session));
    }, 1500);
    return () => {
      clearTimeout(t);
      sub.subscription.unsubscribe();
    };
  }, []);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8 || password.length > 72) return setError('The new password must be 8 to 72 characters.');
    if (password !== repeat) return setError('The two passwords are different.');
    setBusy(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) return setError(updateError.message);
    router.push('/dashboard');
  };

  return (
    <div className="min-h-screen bg-grid relative">
      <div className="relative z-10 max-w-md mx-auto px-6 py-8">
        <div className="flex justify-end mb-8">
          <HeaderEnd account={false} />
        </div>
        <Card className="border-border bg-card/80 backdrop-blur-md">
          <CardHeader>
            <CardTitle>New password</CardTitle>
            <CardDescription>Choose the password you will use from now on.</CardDescription>
          </CardHeader>
          <CardContent>
            {ready === false ? (
              <p className="text-sm">
                This link has expired or was already used. <Link href="/forgot-password" className="underline">Ask for a new one</Link>.
              </p>
            ) : (
              <form onSubmit={save} className="space-y-3">
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password (at least 8 characters)" aria-label="New password" autoComplete="new-password" maxLength={72} />
                <Input type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} placeholder="New password again" aria-label="New password again" autoComplete="new-password" maxLength={72} />
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={busy || !ready}>
                  {busy ? 'Saving…' : ready ? 'Save password' : 'Checking the link…'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
