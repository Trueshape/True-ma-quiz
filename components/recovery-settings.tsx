'use client';

import { useEffect, useState } from 'react';
import { KeyRound, Mail } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { createRecoveryCode, hasRecoveryCode, isRealEmail, setRecoveryEmail } from '@/lib/recovery';
import { RecoveryCodeBox } from '@/components/recovery-code-box';
import { HelpTip } from '@/components/help-tip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Profile section for nickname-and-password accounts: make a new recovery code, and add an
 * email for reset links. Google accounts have no password here, so it stays hidden.
 * `fresh` makes a new code at once (after the old one was used to reset the password).
 */
export function RecoverySettings({ fresh = false }: { fresh?: boolean }) {
  const [hasPassword, setHasPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [savedEmail, setSavedEmail] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [hasCode, setHasCode] = useState<boolean | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const user = data.session?.user;
      if (!user || user.app_metadata?.provider !== 'email') return;
      setHasPassword(true);
      setSavedEmail(isRealEmail(user.email) ? user.email! : null);
      setPendingEmail(user.new_email ?? null);
      if (fresh) {
        const c = await createRecoveryCode();
        setCode(c);
        setHasCode(!!c);
      } else {
        setHasCode(await hasRecoveryCode());
      }
    });
  }, [fresh]);

  if (!hasPassword) return null;

  const newCode = async () => {
    setBusy(true);
    const c = await createRecoveryCode();
    setBusy(false);
    setCode(c);
    if (c) setHasCode(true);
    else setMessage({ text: 'Could not make a code. Try again.', error: true });
  };

  const saveEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.includes('@')) return setMessage({ text: 'Type a full email address.', error: true });
    setBusy(true);
    const res = await setRecoveryEmail(email);
    setBusy(false);
    if (!res.ok) return setMessage({ text: res.message ?? 'Could not save the email.', error: true });
    const { data } = await supabase.auth.getUser();
    const now = data.user?.email;
    if (isRealEmail(now)) {
      setSavedEmail(now!);
      setMessage({ text: 'Email saved. From now on, sign in with this email instead of the nickname.' });
    } else {
      setPendingEmail(email.trim());
      setMessage({ text: 'Check your inbox and open the link to confirm the email.' });
    }
    setEmail('');
  };

  return (
    <Card className="mt-6 border-border bg-card/80 backdrop-blur-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          Password recovery
          <HelpTip>Two ways to choose a new password if you forget it: a recovery code you keep somewhere safe, or a reset link sent to your email.</HelpTip>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <p className="text-sm font-medium flex items-center gap-2">
            <KeyRound className="w-4 h-4" /> Recovery code
            <span className="text-xs font-normal text-muted-foreground">{hasCode ? '· you have one' : hasCode === false ? '· none yet' : ''}</span>
          </p>
          {code ? (
            <>
              <RecoveryCodeBox code={code} />
              <p className="text-xs text-muted-foreground">Shown only now. Save it: with your nickname it lets you choose a new password.</p>
            </>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={newCode} disabled={busy}>
              {hasCode ? 'Make a new code (the old one stops working)' : 'Make a recovery code'}
            </Button>
          )}
        </div>

        <form onSubmit={saveEmail} className="space-y-2">
          <p className="text-sm font-medium flex items-center gap-2">
            <Mail className="w-4 h-4" /> Recovery email <span className="text-xs font-normal text-muted-foreground">(optional)</span>
            <HelpTip>With an email on the account you can get a reset link. After adding it, you sign in with the email instead of the nickname; your nickname does not change.</HelpTip>
          </p>
          {savedEmail && <p className="text-sm">Current: <span className="font-semibold">{savedEmail}</span></p>}
          {pendingEmail && <p className="text-xs text-amber-400">Waiting for confirmation: {pendingEmail}</p>}
          <div className="flex gap-2">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" aria-label="Recovery email" autoComplete="email" />
            <Button type="submit" variant="outline" disabled={busy || !email.trim()}>{savedEmail ? 'Change' : 'Add'}</Button>
          </div>
        </form>

        {message && <p role={message.error ? 'alert' : 'status'} className={message.error ? 'text-sm text-destructive' : 'text-sm text-emerald-400'}>{message.text}</p>}
      </CardContent>
    </Card>
  );
}
