'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Zap, Trophy, Pencil, Users, ArrowRight, Sparkles, LogOut, User, UserX } from 'lucide-react';
// Google icon is not in lucide-react, so we use a small inline SVG component
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" width="20" height="20">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z" />
    </svg>
  );
}
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { VolumeControl } from '@/components/volume-control';
import { ThemeSwitcher } from '@/components/theme-switcher';
import { useAudio } from '@/components/audio-provider';
import { supabase, getGuestSession, setGuestSession, clearGuestSession } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';

function randomGuestNickname(): string {
  const adj = ['Swift', 'Bold', 'Bright', 'Keen', 'Quick', 'Calm', 'Sharp', 'Cool'];
  const noun = ['Fox', 'Owl', 'Wolf', 'Hawk', 'Bear', 'Lion', 'Lynx', 'Crow'];
  const n = Math.floor(Math.random() * 900) + 100;
  return `${adj[Math.floor(Math.random() * adj.length)]}${noun[Math.floor(Math.random() * noun.length)]}${n}`;
}

export default function Home() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const { playTrackIfDifferent } = useAudio();
  const { toast } = useToast();

  const [authMode, setAuthMode] = useState<'login' | 'register' | 'guest'>('login');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ id: string; nickname: string } | null>(null);
  const [guestUser, setGuestUser] = useState<{ nickname: string } | null>(null);

  useEffect(() => {
    playTrackIfDifferent('menu');
  }, [playTrackIfDifferent]);

  useEffect(() => {
    const guest = getGuestSession();
    if (guest) {
      setGuestUser({ nickname: guest.nickname });
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        const meta = data.session.user.user_metadata;
        setCurrentUser({ id: data.session.user.id, nickname: meta?.nickname ?? 'User' });
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        const meta = session.user.user_metadata;
        setCurrentUser({ id: session.user.id, nickname: meta?.nickname ?? 'User' });
      } else {
        setCurrentUser(null);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const join = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    router.push(`/join/${trimmed}`);
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    const nick = nickname.trim();
    if (nick.length < 4 || nick.length > 20) {
      toast({ title: 'Nickname must be 4–20 characters', variant: 'destructive' });
      return;
    }
    if (password.length < 4 || password.length > 20) {
      toast({ title: 'Password must be 4–20 characters', variant: 'destructive' });
      return;
    }
    setAuthBusy(true);
    const fakeEmail = `${nick.toLowerCase()}@truemaquiz.local`;

    if (authMode === 'register') {
      const { data, error } = await supabase.auth.signUp({
        email: fakeEmail,
        password,
        options: { data: { nickname: nick } },
      });
      setAuthBusy(false);
      if (error) {
        toast({ title: 'Registration failed', description: error.message, variant: 'destructive' });
        return;
      }
      if (data.user) {
        toast({ title: `Welcome, ${nick}!` });
        router.push('/dashboard');
      }
    } else {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: fakeEmail,
        password,
      });
      setAuthBusy(false);
      if (error) {
        toast({ title: 'Login failed', description: error.message, variant: 'destructive' });
        return;
      }
      if (data.user) {
        toast({ title: `Welcome back, ${nick}!` });
        router.push('/dashboard');
      }
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setNickname('');
    setPassword('');
  };

  const handleGuestLogin = () => {
    const guestNick = randomGuestNickname();
    setGuestSession({ nickname: guestNick, quizIds: [] });
    setGuestUser({ nickname: guestNick });
    toast({ title: `Browsing as guest: ${guestNick}`, description: 'Your quizzes will be lost when you close this tab.' });
    router.push('/dashboard');
  };

  const handleCreateQuiz = () => {
    if (!currentUser && !guestUser) {
      handleGuestLogin();
    } else {
      router.push('/dashboard');
    }
  };

  const handleGoogleAuth = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/dashboard` },
    });
    if (error) {
      toast({ title: 'Google sign-in failed', description: error.message, variant: 'destructive' });
    }
  };

  const handleGuestLogout = () => {
    clearGuestSession();
    setGuestUser(null);
  };

  const isLoggedIn = !!currentUser || !!guestUser;

  return (
    <div className="min-h-screen bg-grid relative overflow-hidden">
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/30 rounded-full blur-3xl animate-float" />
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-accent/20 rounded-full blur-3xl animate-float" style={{ animationDelay: '2s' }} />

      <div className="relative z-10 max-w-6xl mx-auto px-6 py-8">
        <nav className="flex items-center justify-between mb-20">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary to-accent flex items-center justify-center">
              <Zap className="w-5 h-5 text-white" fill="white" />
            </div>
            <span className="text-xl font-bold">TrueMaQuiz</span>
          </div>
          <div className="flex items-center gap-4">
            <VolumeControl />
            <ThemeSwitcher />
            {(currentUser || guestUser) ? (
              <div className="flex items-center gap-2">
                <Link href="/dashboard" className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors hover:border-primary/50 ${guestUser ? 'bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20' : 'bg-primary/10 border-primary/20 hover:bg-primary/20'}`}>
                  {guestUser ? <UserX className="w-4 h-4 text-amber-500" /> : <User className="w-4 h-4 text-primary" />}
                  <span className="text-sm font-medium">{guestUser?.nickname ?? currentUser?.nickname}</span>
                  {guestUser && <span className="text-xs text-amber-500/80 hidden sm:inline">Guest</span>}
                </Link>
                <Button variant="ghost" size="icon" onClick={guestUser ? handleGuestLogout : handleLogout} title="Log out">
                  <LogOut className="w-4 h-4" />
                </Button>
              </div>
            ) : null}
          </div>
        </nav>

        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div className="animate-slide-up">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm mb-6">
              <Sparkles className="w-3.5 h-3.5" />
              Real-time multiplayer quizzes
            </div>
            <h1 className="text-5xl md:text-6xl font-extrabold leading-[1.05] tracking-tight mb-6">
              Run live quiz games<br />
              <span className="text-gradient">your friends will love</span>
            </h1>
            <p className="text-lg text-muted-foreground mb-8 max-w-md">
              Build quizzes with multiple-choice and true/false questions, share a room code,
              and watch the leaderboard update in real time as players race to answer.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link href="/library">
                <Button size="lg" variant="outline" className="gap-2 text-base h-12 px-6">
                  Browse quizzes
                </Button>
              </Link>
              <Button size="lg" className="gap-2 text-base h-12 px-6" onClick={handleCreateQuiz}>
                {isLoggedIn ? 'My quizzes' : 'Create a quiz'}
              </Button>
            </div>

            <div className="grid grid-cols-3 gap-4 mt-12 max-w-md">
              <Feature icon={<Pencil className="w-4 h-4" />} label="Build quizzes" />
              <Feature icon={<Users className="w-4 h-4" />} label="Host live" />
              <Feature icon={<Trophy className="w-4 h-4" />} label="Live rankings" />
            </div>
          </div>

          <div className="space-y-4">
            {!currentUser && !guestUser && (
              <Card className="bg-card/60 backdrop-blur border-primary/20 animate-slide-up">
                <CardContent className="p-6">
                  <div className="flex gap-2 mb-4 p-1 rounded-lg bg-muted/50">
                    <button
                      onClick={() => setAuthMode('login')}
                      className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${authMode === 'login' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}
                    >
                      Log in
                    </button>
                    <button
                      onClick={() => setAuthMode('register')}
                      className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${authMode === 'register' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground'}`}
                    >
                      Register
                    </button>
                    <button
                      onClick={() => setAuthMode('guest')}
                      className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors flex items-center justify-center gap-1.5 ${authMode === 'guest' ? 'bg-amber-500/20 shadow-sm text-amber-500' : 'text-muted-foreground'}`}
                    >
                      <UserX className="w-3.5 h-3.5" /> Guest
                    </button>
                  </div>

                  {authMode === 'guest' ? (
                    <div className="space-y-4 py-2">
                      <div className="text-center py-4">
                        <div className="w-14 h-14 rounded-2xl bg-amber-500/15 flex items-center justify-center mx-auto mb-3">
                          <UserX className="w-7 h-7 text-amber-500" />
                        </div>
                        <h3 className="font-semibold mb-1">Browse as guest</h3>
                        <p className="text-sm text-muted-foreground">
                          Create, try, and host quizzes without an account. Your quizzes are saved only for this tab session.
                        </p>
                      </div>
                      <Button
                        size="lg"
                        className="w-full h-11 gap-2 bg-amber-500 hover:bg-amber-600 text-white"
                        onClick={handleGuestLogin}
                      >
                        <UserX className="w-4 h-4" /> Continue as guest
                      </Button>
                      <p className="text-xs text-muted-foreground text-center">
                        Data is lost when you close this tab.{' '}
                        <button className="text-primary underline" onClick={() => setAuthMode('register')}>
                          Register
                        </button>{' '}
                        to save permanently.
                      </p>
                    </div>
                  ) : (
                    <form onSubmit={handleAuth} className="space-y-3">
                      <div>
                        <label className="text-sm font-medium mb-1.5 block">Nickname</label>
                        <Input
                          value={nickname}
                          onChange={(e) => setNickname(e.target.value)}
                          placeholder="4–20 characters"
                          maxLength={20}
                          autoComplete="username"
                        />
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-1.5 block">Password</label>
                        <Input
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="4–20 characters"
                          maxLength={20}
                          autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                        />
                      </div>
                      <Button type="submit" size="lg" className="w-full h-11 gap-2" disabled={authBusy}>
                        {authBusy ? 'Please wait...' : authMode === 'login' ? 'Log in' : 'Create account'}
                      </Button>
                      <div className="relative my-1">
                        <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
                        <div className="relative flex justify-center text-xs"><span className="bg-card/60 backdrop-blur px-2 text-muted-foreground">or</span></div>
                      </div>
                      <Button type="button" variant="outline" size="lg" className="w-full h-11 gap-2" onClick={handleGoogleAuth}>
                        <GoogleIcon className="w-5 h-5" /> Continue with Google
                      </Button>
                    </form>
                  )}
                </CardContent>
              </Card>
            )}

            <Card className="bg-card/60 backdrop-blur border-primary/20 animate-slide-up" style={{ animationDelay: '0.1s' }}>
              <CardContent className="p-8">
                <h2 className="text-2xl font-bold mb-2">Join a game</h2>
                <p className="text-muted-foreground text-sm mb-6">
                  Enter the 6-character room code your host shared with you.
                </p>
                <form onSubmit={join} className="space-y-4">
                  <Input
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="ABC123"
                    maxLength={6}
                    className="text-center text-3xl font-bold tracking-[0.5em] h-16 uppercase"
                  />
                  <Button type="submit" size="lg" className="w-full h-12 text-base gap-2" disabled={code.trim().length === 0}>
                    Join <ArrowRight className="w-4 h-4" />
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

function Feature({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center gap-2 p-3 rounded-xl bg-card/40 border border-border">
      <div className="w-8 h-8 rounded-lg bg-primary/15 text-primary flex items-center justify-center">{icon}</div>
      <span className="text-xs text-muted-foreground text-center">{label}</span>
    </div>
  );
}
