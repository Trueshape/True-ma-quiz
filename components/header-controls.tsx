'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, LogOut, User, UserX } from 'lucide-react';
import { supabase, getGuestSession, clearGuestSession } from '@/lib/supabase';
import { deleteQuiz } from '@/lib/game-api';
import { Button } from '@/components/ui/button';
import { VolumeControl } from '@/components/volume-control';
import { ThemeSwitcher } from '@/components/theme-switcher';

/*
  Header layout used on every page:
  - left:  one back button (always the same icon), then the logo or page title
  - right: page actions, then HeaderUtilities (volume, theme), then AccountMenu
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

export function HeaderUtilities() {
  return (
    <div className="flex items-center gap-2">
      <VolumeControl />
      <ThemeSwitcher />
    </div>
  );
}

type Account = { nickname: string; guest: boolean };

export function AccountMenu() {
  const [account, setAccount] = useState<Account | null>(null);

  useEffect(() => {
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
  }, []);

  if (!account) return null;

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

  return (
    <div className="flex items-center gap-2">
      <Link
        href="/dashboard"
        title="My quizzes"
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors hover:border-primary/50 ${
          account.guest ? 'bg-amber-500/10 border-amber-500/30' : 'bg-primary/10 border-primary/20'
        }`}
      >
        {account.guest ? <UserX className="w-4 h-4 text-amber-500" /> : <User className="w-4 h-4 text-primary" />}
        <span className="text-sm font-medium">{account.nickname}</span>
        {account.guest && <span className="text-xs text-amber-500/80 hidden sm:inline">Guest</span>}
      </Link>
      <Button variant="ghost" size="icon" onClick={logout} title="Log out" aria-label="Log out">
        <LogOut className="w-4 h-4" />
      </Button>
    </div>
  );
}
