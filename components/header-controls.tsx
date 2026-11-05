'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Home, LogOut, User, UserX } from 'lucide-react';
import { supabase, getGuestSession, clearGuestSession } from '@/lib/supabase';
import { deleteQuiz } from '@/lib/game-api';
import { Button } from '@/components/ui/button';
import { VolumeControl } from '@/components/volume-control';
import { ThemeSwitcher } from '@/components/theme-switcher';

/*
  Header layout used on every page:
  - left:  an optional back button, then the logo or page title
  - right: page actions, then HeaderEnd. From right to left HeaderEnd shows:
           log out, home, volume, theme, account name.
           All of them are 40px high icon buttons without a border.
*/

export function HeaderBack({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="ghost" size="icon" title={label} aria-label={label}>
      <Link href={href}>
        <ArrowLeft className="w-4 h-4" />
      </Link>
    </Button>
  );
}

type Account = { nickname: string; guest: boolean };

function useAccount(enabled: boolean) {
  const [account, setAccount] = useState<Account | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const guest = getGuestSession();
    if (guest) {
      setAccount({ nickname: guest.nickname, guest: true });
      return;
    }
    const toAccount = (user: { user_metadata?: { nickname?: string } } | undefined): Account | null =>
      user ? { nickname: user.user_metadata?.nickname ?? '', guest: false } : null;
    supabase.auth.getSession().then(({ data }) => setAccount(toAccount(data.session?.user)));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => setAccount(toAccount(session?.user)));
    return () => sub.subscription.unsubscribe();
  }, [enabled]);

  const logout = async () => {
    const guest = getGuestSession();
    if (guest) {
      await Promise.all(guest.quizIds.map((id) => deleteQuiz(id, guest.quizTokens?.[id] ?? null)));
      clearGuestSession();
    } else {
      await supabase.auth.signOut();
    }
    window.location.assign('/');
  };

  return { account, logout };
}

type HeaderEndProps = {
  /** Show the account name and the log out button (pages outside a running game). Default true. */
  account?: boolean;
  /** Show the Home button. The landing page turns it off. Default true. */
  home?: boolean;
  homeLabel?: string;
};

export function HeaderEnd({ account: withAccount = true, home = true, homeLabel = 'Home' }: HeaderEndProps) {
  const { account, logout } = useAccount(withAccount);

  return (
    <div className="flex items-center gap-1">
      {account && (
        <Link
          href="/dashboard"
          title="My quizzes"
          className={`flex items-center gap-2 h-10 px-3 mr-2 rounded-lg border transition-colors hover:border-primary/50 ${
            account.guest ? 'bg-amber-500/10 border-amber-500/30' : 'bg-primary/10 border-primary/20'
          }`}
        >
          {account.guest ? <UserX className="w-4 h-4 text-amber-500" /> : <User className="w-4 h-4 text-primary" />}
          <span className="text-sm font-medium">{account.nickname}</span>
          {account.guest && <span className="text-xs text-amber-500/80 hidden sm:inline">Guest</span>}
        </Link>
      )}
      <ThemeSwitcher />
      <VolumeControl />
      {home && (
        <Button asChild variant="ghost" size="icon" title={homeLabel} aria-label={homeLabel}>
          <Link href="/">
            <Home className="w-4 h-4" />
          </Link>
        </Button>
      )}
      {account && (
        <Button variant="ghost" size="icon" onClick={logout} title="Log out" aria-label="Log out">
          <LogOut className="w-4 h-4" />
        </Button>
      )}
    </div>
  );
}
