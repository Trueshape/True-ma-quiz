'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Home, LogOut } from 'lucide-react';
import { supabase, getGuestSession, clearGuestSession } from '@/lib/supabase';
import { deleteQuiz } from '@/lib/game-api';
import { getMyProfile } from '@/lib/profile';
import { Button } from '@/components/ui/button';
import { VolumeControl } from '@/components/volume-control';
import { ThemeSwitcher } from '@/components/theme-switcher';

/*
  Header layout used on every page:
  - left:  an optional back button, then the logo or page title
  - right: page actions, then HeaderEnd. From left to right HeaderEnd shows:
           theme, volume, home, log out, account name (last).
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

type Account = { nickname: string; guest: boolean; avatarUrl?: string | null };

function useAccount(enabled: boolean) {
  const [account, setAccount] = useState<Account | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const guest = getGuestSession();
    if (guest) {
      setAccount({ nickname: guest.nickname, guest: true });
      return;
    }
    let alive = true;
    // The profile (username and picture) wins over the name stored in the sign-in token.
    const show = async (user: { id: string; user_metadata?: { nickname?: string } } | undefined) => {
      if (!user) return setAccount(null);
      setAccount({ nickname: user.user_metadata?.nickname ?? '', guest: false });
      const profile = await getMyProfile(user.id);
      if (alive && profile) setAccount({ nickname: profile.nickname, guest: false, avatarUrl: profile.avatar_url });
    };
    supabase.auth.getSession().then(({ data }) => show(data.session?.user));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      show(session?.user);
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
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
      {account && (
        <Link
          href={account.guest ? '/dashboard' : '/profile'}
          title={account.guest ? 'My quizzes' : 'My profile'}
          className="flex items-center gap-2 h-10 pl-2 pr-3 ml-2 rounded-lg transition-colors hover:bg-accent"
        >
          <span
            className={`w-7 h-7 rounded-full overflow-hidden flex items-center justify-center text-sm font-semibold ${
              account.guest ? 'bg-amber-500 text-amber-950' : 'bg-primary text-primary-foreground'
            }`}
          >
            {account.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={account.avatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              (account.nickname || '?').charAt(0).toUpperCase()
            )}
          </span>
          <span className="text-sm font-medium">{account.nickname}</span>
          {account.guest && <span className="text-xs text-amber-500 hidden sm:inline">Guest</span>}
        </Link>
      )}
    </div>
  );
}
