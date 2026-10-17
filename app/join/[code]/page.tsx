'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Users, Zap, Home } from 'lucide-react';
import { supabase, type Session } from '@/lib/supabase';
import { joinSession } from '@/lib/game-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { VolumeControl } from '@/components/volume-control';
import { ThemeSwitcher } from '@/components/theme-switcher';

export default function JoinPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const code = (params.code as string).toUpperCase();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [nickname, setNickname] = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data } = await supabase
        .from('sessions')
        .select('*')
        .eq('code', code)
        .maybeSingle();
      if (!mounted) return;
      setSession(data as Session | null);
      setLoading(false);
    })();
    return () => { mounted = false; };
  }, [code]);

  const join = async () => {
    if (!nickname.trim()) return;
    if (!session) return;
    if (session.status !== 'lobby') {
      toast({ title: 'Game already started', description: 'You can no longer join this game.', variant: 'destructive' });
      return;
    }
    setJoining(true);
    const { player, error } = await joinSession(session.id, nickname.trim());
    if (error || !player) {
      if (error?.code === '23505') {
        toast({ title: 'Nickname taken', description: 'Choose a different nickname.', variant: 'destructive' });
      } else if (error?.message === 'game_started') {
        toast({ title: 'Game already started', description: 'You can no longer join this game.', variant: 'destructive' });
      } else if (error?.message === 'invalid_nickname') {
        toast({ title: 'Invalid nickname', description: 'Use 1 to 30 characters.', variant: 'destructive' });
      } else {
        toast({ title: 'Failed to join', description: error?.message, variant: 'destructive' });
      }
      setJoining(false);
      return;
    }
    // Store player id locally so the play page can use it.
    sessionStorage.setItem(`player:${session.id}`, player.id);
    router.push(`/play/${session.id}`);
  };

  return (
    <div className="min-h-screen bg-grid relative flex items-center justify-center px-6">
      <div className="absolute top-1/3 left-1/4 w-72 h-72 bg-primary/20 rounded-full blur-3xl animate-float" />
      <div className="relative z-10 w-full max-w-md">
        <div className="flex items-center justify-between mb-4">
          <Button variant="ghost" size="sm" onClick={() => router.push('/')} className="gap-1.5">
            <ArrowLeft className="w-4 h-4" /> Back home
          </Button>
          <VolumeControl />
          <ThemeSwitcher />
        </div>
        <Card className="bg-card/60 backdrop-blur">
          <CardContent className="p-8">
            {loading ? (
              <div className="text-center text-muted-foreground py-8 animate-pulse">Finding game...</div>
            ) : !session ? (
              <div className="text-center py-6">
                <div className="w-14 h-14 rounded-2xl bg-destructive/15 text-destructive flex items-center justify-center mx-auto mb-4">
                  <Zap className="w-7 h-7" />
                </div>
                <h2 className="text-xl font-bold mb-1">Game not found</h2>
                <p className="text-muted-foreground text-sm mb-4">
                  No active game with code <span className="font-mono font-bold">{code}</span>.
                </p>
                <Button onClick={() => router.push('/')} className="gap-2">
                  Back home <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            ) : (
              <>
                <div className="text-center mb-6">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary text-sm mb-3">
                    <Users className="w-3.5 h-3.5" /> Room {code}
                  </div>
                  <h2 className="text-2xl font-bold">Join the game</h2>
                  <p className="text-muted-foreground text-sm mt-1">Enter your nickname to play.</p>
                </div>
                <div className="space-y-4">
                  <Input
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                    placeholder="Your nickname"
                    maxLength={20}
                    className="text-center text-lg h-14"
                    autoFocus
                    onKeyDown={(e) => e.key === 'Enter' && join()}
                  />
                  <Button onClick={join} disabled={!nickname.trim() || joining} size="lg" className="w-full h-12 gap-2">
                    {joining ? 'Joining...' : <>Join game <ArrowRight className="w-4 h-4" /></>}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
