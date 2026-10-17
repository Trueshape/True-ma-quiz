'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Users, Play, ArrowRight, Trophy, Check, X, RotateCcw, Share2, Info, Sliders, Home, Type } from 'lucide-react';
import { supabase, type Session, type Player, type Question, type Quiz } from '@/lib/supabase';
import { getHostToken, hostUpdate, type HostUpdate } from '@/lib/game-api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useAudio } from '@/components/audio-provider';
import { VolumeControl } from '@/components/volume-control';
import { ThemeSwitcher } from '@/components/theme-switcher';
import { QuestionMedia } from '@/components/question-media';
import { cn } from '@/lib/utils';

export default function HostPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { playTrackIfDifferent } = useAudio();
  const sessionId = params.id as string;

  const [session, setSession] = useState<Session | null>(null);
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeLeft, setTimeLeft] = useState(0);
  const [showCorrect, setShowCorrect] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const questionStartRef = useRef<number>(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(async () => {
    if (!getHostToken(sessionId)) {
      toast({ title: 'Not your game', description: 'This game can only be controlled from the device that created it.', variant: 'destructive' });
      router.push('/dashboard');
      return;
    }
    const { data: sess } = await supabase.from('sessions').select('*').eq('id', sessionId).maybeSingle();
    if (!sess) {
      toast({ title: 'Session not found', variant: 'destructive' });
      router.push('/dashboard');
      return;
    }
    const s = sess as Session;
    setSession(s);
    const [{ data: q }, { data: qs }, { data: pls }] = await Promise.all([
      supabase.from('quizzes').select('*').eq('id', s.quiz_id).maybeSingle(),
      supabase.from('questions').select('*').eq('quiz_id', s.quiz_id).order('position', { ascending: true }),
      supabase.from('players').select('*').eq('session_id', sessionId).order('score', { ascending: false }),
    ]);
    setQuiz(q as Quiz | null);
    setQuestions((qs || []) as Question[]);
    setPlayers((pls || []) as Player[]);
    setLoading(false);
  }, [sessionId, router, toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Start game music when game starts, menu music when in lobby/finished.
  // Mute music during questions that have a YouTube video so the video audio is audible.
  useEffect(() => {
    if (!session) return;
    if (session.status === 'question') {
      const currentQ = questions[session.current_question_index];
      if (currentQ?.video_url || currentQ?.audio_url) {
        playTrackIfDifferent('none');
      } else {
        playTrackIfDifferent('game');
      }
    } else if (session.status === 'leaderboard') {
      playTrackIfDifferent('game');
    } else if (session.status === 'lobby' || session.status === 'finished') {
      playTrackIfDifferent('menu');
    }
  }, [session?.status, session?.current_question_index, questions, playTrackIfDifferent]);

  // Play per-question audio when a question starts; stop when it ends.
  useEffect(() => {
    if (!session) return;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (session.status === 'question') {
      const currentQ = questions[session.current_question_index];
      if (currentQ?.audio_url) {
        const audio = new Audio(currentQ.audio_url);
        audio.volume = Math.min(1, Math.max(0, currentQ.audio_volume ?? 0.5));
        if (currentQ.audio_start_ms && currentQ.audio_start_ms > 0) {
          audio.currentTime = currentQ.audio_start_ms / 1000;
        }
        audio.play().catch(() => {});
        audioRef.current = audio;
      }
    }
    return () => {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    };
  }, [session?.status, session?.current_question_index, questions]);

  // Real-time subscriptions
  const sessionLoaded = session !== null;
  useEffect(() => {
    if (!sessionLoaded) return;
    const playerChannel = supabase
      .channel(`host-players-${sessionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `session_id=eq.${sessionId}` },
        async (payload) => {
          if (payload.eventType === 'INSERT') {
            setPlayers((p) => [...p, payload.new as Player].sort((a, b) => b.score - a.score));
          } else if (payload.eventType === 'UPDATE') {
            setPlayers((p) => p.map((x) => (x.id === (payload.new as Player).id ? (payload.new as Player) : x)).sort((a, b) => b.score - a.score));
          } else if (payload.eventType === 'DELETE') {
            setPlayers((p) => p.filter((x) => x.id !== (payload.old as Player).id));
          }
        }
      )
      .subscribe();

    const sessionChannel = supabase
      .channel(`host-session-${sessionId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` },
        (payload) => {
          setSession(payload.new as Session);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(playerChannel);
      supabase.removeChannel(sessionChannel);
    };
  }, [sessionId, sessionLoaded]);

  // Hide the correct answer when the question index changes
  useEffect(() => {
    setShowCorrect(false);
  }, [session?.current_question_index]);

  // Countdown timer for question phase (skip info pages)
  useEffect(() => {
    if (!session || session.status !== 'question') {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }
    const currentQ = questions[session.current_question_index];
    if (!currentQ || currentQ.type === 'info') return;
    questionStartRef.current = new Date(session.question_started_at || Date.now()).getTime();
    setTimeLeft(currentQ.time_limit_ms);

    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - questionStartRef.current;
      const remaining = Math.max(0, currentQ.time_limit_ms - elapsed);
      setTimeLeft(remaining);
      if (remaining <= 0) {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        toLeaderboard();
      }
    }, 100);

    return () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.status, session?.current_question_index, session?.question_started_at]);

  const update = async (u: HostUpdate): Promise<boolean> => {
    const { error } = await hostUpdate(sessionId, u);
    if (error) {
      toast({
        title: 'Action failed',
        description: error.message === 'invalid_host' ? 'This game can only be controlled from the device that created it.' : error.message,
        variant: 'destructive',
      });
      return false;
    }
    return true;
  };

  const nextPlayableIndex = (from: number) => {
    let idx = from;
    while (idx < questions.length && questions[idx].type === 'info') idx++;
    return idx;
  };

  const startGame = async () => {
    if (players.length === 0) {
      toast({ title: 'No players yet', description: 'Wait for at least one player to join.', variant: 'destructive' });
      return;
    }
    // Skip leading info pages
    const startIdx = nextPlayableIndex(0);
    if (startIdx >= questions.length) {
      toast({ title: 'No playable questions', variant: 'destructive' });
      return;
    }
    await update({ status: 'question', questionIndex: startIdx, startTimer: true, setStarted: true });
  };

  const toLeaderboard = async () => {
    if (!session) return;
    if (await update({ status: 'leaderboard' })) setShowCorrect(true);
  };

  // Skip info pages — they're handled by the info view with a Continue button
  const nextQuestion = async () => {
    if (!session) return;
    const nextIdx = nextPlayableIndex(session.current_question_index + 1);
    if (nextIdx >= questions.length) {
      await update({ status: 'finished', setFinished: true });
      return;
    }
    await update({ status: 'question', questionIndex: nextIdx, startTimer: true });
  };

  const showInfoPage = nextQuestion;

  const endGame = async () => {
    await update({ status: 'finished', setFinished: true });
  };

  const restart = async () => {
    await update({ status: 'lobby', reset: true });
  };

  if (loading || !session) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground animate-pulse">Loading...</div>;
  }

  const currentQ = questions[session.current_question_index];
  const answeredCount = session.status === 'question'
    ? players.filter((p) => p.last_answered_index === session.current_question_index).length
    : 0;
  const scorableTotal = questions.filter(q => q.type !== 'info').length;
  const scorableNumber = questions.slice(0, session.current_question_index + 1).filter(q => q.type !== 'info').length;

  return (
    <div className="min-h-screen bg-grid relative">
      <div className="absolute top-0 right-0 w-96 h-96 bg-primary/15 rounded-full blur-3xl" />
      <div className="relative z-10 max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => router.push('/dashboard')}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-xl font-bold">{quiz?.title || 'Host'}</h1>
              {quiz?.created_by && (
                <p className="text-xs text-primary font-medium">by {quiz.created_by}</p>
              )}
              <p className="text-xs text-muted-foreground">Host view</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <VolumeControl />
            <ThemeSwitcher />
            <Link href="/">
              <Button variant="ghost" size="icon" title="Home"><Home className="w-4 h-4" /></Button>
            </Link>
            <div className="px-3 py-1.5 rounded-lg bg-card border border-border font-mono font-bold text-sm tracking-wider">
              {session.code}
            </div>
            <Button variant="outline" size="icon" onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/join/${session.code}`); toast({ title: 'Join link copied' }); }}>
              <Share2 className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {session.status === 'lobby' && (
          <LobbyView session={session} players={players} onStart={startGame} />
        )}

        {session.status === 'question' && currentQ && currentQ.type === 'info' && (
          <HostInfoView
            question={currentQ}
            questionNumber={scorableNumber}
            totalQuestions={scorableTotal}
            onContinue={showInfoPage}
          />
        )}

        {session.status === 'question' && currentQ && currentQ.type !== 'info' && currentQ.type !== 'slider' && currentQ.type !== 'reorder' && currentQ.type !== 'open' && (
          <HostQuestionView
            question={currentQ}
            questionNumber={scorableNumber}
            totalQuestions={scorableTotal}
            timeLeft={timeLeft}
            answeredCount={answeredCount}
            totalPlayers={players.length}
            onSkip={toLeaderboard}
          />
        )}

        {session.status === 'question' && currentQ && currentQ.type === 'reorder' && (
          <HostReorderView
            question={currentQ}
            questionNumber={scorableNumber}
            totalQuestions={scorableTotal}
            timeLeft={timeLeft}
            answeredCount={answeredCount}
            totalPlayers={players.length}
            onSkip={toLeaderboard}
          />
        )}

        {session.status === 'question' && currentQ && currentQ.type === 'open' && (
          <HostOpenView
            question={currentQ}
            questionNumber={scorableNumber}
            totalQuestions={scorableTotal}
            timeLeft={timeLeft}
            answeredCount={answeredCount}
            totalPlayers={players.length}
            onSkip={toLeaderboard}
          />
        )}

        {session.status === 'question' && currentQ && currentQ.type === 'slider' && (
          <HostSliderView
            question={currentQ}
            questionNumber={scorableNumber}
            totalQuestions={scorableTotal}
            timeLeft={timeLeft}
            answeredCount={answeredCount}
            totalPlayers={players.length}
            onSkip={toLeaderboard}
          />
        )}

        {session.status === 'leaderboard' && currentQ && (
          <HostLeaderboardView
            question={currentQ}
            questionNumber={scorableNumber}
            totalQuestions={scorableTotal}
            players={players}
            isLast={session.current_question_index === questions.length - 1}
            onNext={nextQuestion}
            onEnd={endGame}
          />
        )}

        {session.status === 'finished' && (
          <FinishedView players={players} onRestart={restart} onExit={() => router.push('/dashboard')} />
        )}
      </div>
    </div>
  );
}

function LobbyView({ session, players, onStart }: { session: Session; players: Player[]; onStart: () => void }) {
  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <Card className="bg-card/60 backdrop-blur">
        <CardContent className="p-8 text-center">
          <p className="text-sm text-muted-foreground mb-2">Room code</p>
          <div className="text-6xl font-extrabold tracking-[0.3em] font-mono mb-6 text-gradient">{session.code}</div>
          <p className="text-sm text-muted-foreground mb-1">Players scan or visit</p>
          <p className="text-sm font-mono text-primary mb-6">/join/{session.code}</p>
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Users className="w-4 h-4" />
            <span className="text-2xl font-bold text-foreground">{players.length}</span>
            <span>player{players.length !== 1 ? 's' : ''} joined</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <h3 className="text-sm font-semibold text-muted-foreground mb-4">PLAYERS</h3>
          {players.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm">Waiting for players to join...</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {players.map((p, i) => (
                <div key={p.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-card/50 border border-border animate-pop">
                  <span className="w-7 h-7 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold">{i + 1}</span>
                  <span className="font-medium">{p.nickname}</span>
                </div>
              ))}
            </div>
          )}
          <Button onClick={onStart} className="w-full mt-6 h-12 gap-2" size="lg" disabled={players.length === 0}>
            <Play className="w-4 h-4" /> Start game
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function HostInfoView({
  question, questionNumber, totalQuestions, onContinue,
}: {
  question: Question; questionNumber: number; totalQuestions: number; onContinue: () => void;
}) {
  const pos = question.info_image_position ?? 'top';
  const isHorizontal = pos === 'left' || pos === 'right';
  const media = (
    <QuestionMedia imageUrl={question.image_url} videoUrl={question.video_url} audioUrl={question.audio_url} audioVolume={question.audio_volume} audioStartMs={question.audio_start_ms} videoStartMs={question.video_start_ms} videoHidden={question.video_hidden} videoVolume={question.video_volume} audioHidden={question.audio_hidden} autoplay className={isHorizontal ? 'mb-0' : 'mb-4'} imgClassName={isHorizontal ? 'max-h-40 max-w-40' : 'max-h-64'} />
  );
  const text = <p className="text-2xl font-bold whitespace-pre-wrap">{question.prompt}</p>;
  return (
    <div className="text-center py-8">
      <div className="w-14 h-14 rounded-2xl bg-sky-500/15 text-sky-400 flex items-center justify-center mx-auto mb-6">
        <Info className="w-7 h-7" />
      </div>
      <p className="text-sm text-muted-foreground mb-4">Section {questionNumber} of {totalQuestions}</p>
      <Card className="max-w-2xl mx-auto mb-8 animate-pop">
        <CardContent className="p-8">
          {pos === 'top' && <>{media}{text}</>}
          {pos === 'bottom' && <>{text}{media}</>}
          {pos === 'left' && <div className="flex items-center gap-6 text-left">{media}<div className="flex-1">{text}</div></div>}
          {pos === 'right' && <div className="flex items-center gap-6 text-left"><div className="flex-1">{text}</div>{media}</div>}
        </CardContent>
      </Card>
      <Button onClick={onContinue} size="lg" className="gap-2">
        Continue <ArrowRight className="w-4 h-4" />
      </Button>
    </div>
  );
}

function HostQuestionView({
  question, questionNumber, totalQuestions, timeLeft, answeredCount, totalPlayers, onSkip,
}: {
  question: Question; questionNumber: number; totalQuestions: number; timeLeft: number; answeredCount: number; totalPlayers: number; onSkip: () => void;
}) {
  const pct = Math.round((timeLeft / question.time_limit_ms) * 100);
  const seconds = Math.ceil(timeLeft / 1000);
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-muted-foreground">Question {questionNumber} of {totalQuestions}</span>
        <span className="text-sm text-muted-foreground">{answeredCount} / {totalPlayers} answered</span>
      </div>

      <Card className="mb-4">
        <CardContent className="p-8">
          <QuestionMedia imageUrl={question.image_url} videoUrl={question.video_url} audioUrl={question.audio_url} audioVolume={question.audio_volume} audioStartMs={question.audio_start_ms} videoStartMs={question.video_start_ms} videoHidden={question.video_hidden} videoVolume={question.video_volume} audioHidden={question.audio_hidden} autoplay className="mb-4" imgClassName="max-h-64" />
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-6">{question.prompt}</h2>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-3 rounded-full bg-card overflow-hidden border border-border">
              <div
                className={cn('h-full transition-all duration-100', pct > 50 ? 'bg-emerald-500' : pct > 20 ? 'bg-amber-500' : 'bg-rose-500')}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-2xl font-bold tabular-nums w-12 text-right">{seconds}s</span>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        {question.options.map((opt, i) => (
          <div key={i} className={cn(
            'p-4 rounded-xl border text-center font-medium',
            OPTION_BG[i % OPTION_BG.length]
          )}>
            <span className="text-xs font-bold mr-2 opacity-70">{String.fromCharCode(65 + i)}</span>
            {opt}
          </div>
        ))}
      </div>

      <div className="flex justify-center mt-6">
        <Button variant="outline" onClick={onSkip} className="gap-2">
          Skip to results <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

function HostSliderView({
  question, questionNumber, totalQuestions, timeLeft, answeredCount, totalPlayers, onSkip,
}: {
  question: Question; questionNumber: number; totalQuestions: number; timeLeft: number; answeredCount: number; totalPlayers: number; onSkip: () => void;
}) {
  const pct = Math.round((timeLeft / question.time_limit_ms) * 100);
  const seconds = Math.ceil(timeLeft / 1000);
  const min = question.slider_min ?? 0;
  const max = question.slider_max ?? 100;
  const answer = question.slider_answer ?? 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-muted-foreground">Question {questionNumber} of {totalQuestions}</span>
        <span className="text-sm text-muted-foreground">{answeredCount} / {totalPlayers} answered</span>
      </div>

      <Card className="mb-4">
        <CardContent className="p-8">
          <QuestionMedia imageUrl={question.image_url} videoUrl={question.video_url} audioUrl={question.audio_url} audioVolume={question.audio_volume} audioStartMs={question.audio_start_ms} videoStartMs={question.video_start_ms} videoHidden={question.video_hidden} videoVolume={question.video_volume} audioHidden={question.audio_hidden} autoplay className="mb-4" imgClassName="max-h-64" />
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-6">{question.prompt}</h2>
          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 h-3 rounded-full bg-card overflow-hidden border border-border">
              <div
                className={cn('h-full transition-all duration-100', pct > 50 ? 'bg-emerald-500' : pct > 20 ? 'bg-amber-500' : 'bg-rose-500')}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-2xl font-bold tabular-nums w-12 text-right">{seconds}s</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Sliders className="w-5 h-5" />
            <span>Slider question — range: <span className="font-bold text-foreground">{min}</span> to <span className="font-bold text-foreground">{max}</span></span>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-center mt-6">
        <Button variant="outline" onClick={onSkip} className="gap-2">
          Skip to results <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

function HostReorderView({
  question, questionNumber, totalQuestions, timeLeft, answeredCount, totalPlayers, onSkip,
}: {
  question: Question; questionNumber: number; totalQuestions: number; timeLeft: number; answeredCount: number; totalPlayers: number; onSkip: () => void;
}) {
  const pct = Math.round((timeLeft / question.time_limit_ms) * 100);
  const seconds = Math.ceil(timeLeft / 1000);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-muted-foreground">Question {questionNumber} of {totalQuestions}</span>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-3 rounded-full bg-card overflow-hidden border border-border">
            <div className={cn('h-full transition-all duration-100', pct > 50 ? 'bg-emerald-500' : pct > 20 ? 'bg-amber-500' : 'bg-rose-500')} style={{ width: `${pct}%` }} />
          </div>
          <span className="text-2xl font-bold tabular-nums w-12 text-right">{seconds}s</span>
        </div>
      </div>

      <Card className="mb-4">
        <CardContent className="p-8">
          <QuestionMedia imageUrl={question.image_url} videoUrl={question.video_url} audioUrl={question.audio_url} audioVolume={question.audio_volume} audioStartMs={question.audio_start_ms} videoStartMs={question.video_start_ms} videoHidden={question.video_hidden} videoVolume={question.video_volume} audioHidden={question.audio_hidden} autoplay className="mb-4" imgClassName="max-h-64" />
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-6">{question.prompt}</h2>
          <div className="flex items-center gap-3 text-sm text-muted-foreground mb-4">
            <Type className="w-5 h-5" />
            <span>Reorder question — players drag items into the correct order</span>
          </div>
          <div className="space-y-2">
            {(question.reorder_correct_order ?? []).map((optIdx, pos) => (
              <div key={pos} className="flex items-center gap-3 p-3 rounded-xl border border-violet-500/30 bg-violet-500/10">
                <span className="w-7 h-7 rounded-lg bg-violet-500/20 text-violet-400 flex items-center justify-center text-xs font-bold shrink-0">{pos + 1}</span>
                {question.reorder_item_images?.[optIdx] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={question.reorder_item_images[optIdx]} alt="" className="max-h-24 max-w-24 rounded object-contain shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                )}
                <span className="font-medium">{question.options[optIdx]}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{answeredCount}/{totalPlayers} answered</span>
        <Button variant="outline" onClick={onSkip} className="gap-2">
          Skip to results <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

function HostOpenView({
  question, questionNumber, totalQuestions, timeLeft, answeredCount, totalPlayers, onSkip,
}: {
  question: Question; questionNumber: number; totalQuestions: number; timeLeft: number; answeredCount: number; totalPlayers: number; onSkip: () => void;
}) {
  const pct = Math.round((timeLeft / question.time_limit_ms) * 100);
  const seconds = Math.ceil(timeLeft / 1000);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-muted-foreground">Question {questionNumber} of {totalQuestions}</span>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-3 rounded-full bg-card overflow-hidden border border-border">
            <div className={cn('h-full transition-all duration-100', pct > 50 ? 'bg-emerald-500' : pct > 20 ? 'bg-amber-500' : 'bg-rose-500')} style={{ width: `${pct}%` }} />
          </div>
          <span className="text-2xl font-bold tabular-nums w-12 text-right">{seconds}s</span>
        </div>
      </div>

      <Card className="mb-4">
        <CardContent className="p-8">
          <QuestionMedia imageUrl={question.image_url} videoUrl={question.video_url} audioUrl={question.audio_url} audioVolume={question.audio_volume} audioStartMs={question.audio_start_ms} videoStartMs={question.video_start_ms} videoHidden={question.video_hidden} videoVolume={question.video_volume} audioHidden={question.audio_hidden} autoplay className="mb-4" imgClassName="max-h-64" />
          <h2 className="text-2xl md:text-3xl font-bold text-center mb-6">{question.prompt}</h2>
          <div className="flex items-center gap-3 text-sm text-muted-foreground mb-4">
            <Type className="w-5 h-5" />
            <span>Open answer — players type a free-text response</span>
          </div>
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Accepted answers:</p>
            {(question.open_answers ?? []).map((ans, i) => (
              <p key={i} className="text-lg font-bold text-emerald-400">{ans}</p>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{answeredCount}/{totalPlayers} answered</span>
        <Button variant="outline" onClick={onSkip} className="gap-2">
          Skip to results <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

function HostLeaderboardView({
  question, questionNumber, totalQuestions, players, isLast, onNext, onEnd,
}: {
  question: Question; questionNumber: number; totalQuestions: number; players: Player[]; isLast: boolean; onNext: () => void; onEnd: () => void;
}) {
  const isSlider = question.type === 'slider';
  const isReorder = question.type === 'reorder';
  const isOpen = question.type === 'open';

  return (
    <div>
      <div className="text-center mb-6">
        <span className="text-sm text-muted-foreground">Question {questionNumber} of {totalQuestions}</span>
        <h2 className="text-2xl font-bold mt-1">{isSlider ? 'Correct answer' : 'Correct answer'}</h2>
      </div>

      <Card className="mb-6">
        <CardContent className="p-6">
          <p className="text-lg font-medium text-center mb-4">{question.prompt}</p>
          {isSlider ? (
            <div className="text-center">
              <p className="text-sm text-muted-foreground mb-1">The correct answer is</p>
              <p className="text-4xl font-bold text-emerald-400">{question.slider_answer}</p>
              <p className="text-xs text-muted-foreground mt-2">Range: {question.slider_min} — {question.slider_max}</p>
            </div>
          ) : isReorder ? (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground text-center mb-2">Correct order</p>
              {(question.reorder_correct_order ?? []).map((optIdx, pos) => (
                <div key={pos} className="flex items-center gap-3 p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10">
                  <span className="w-7 h-7 rounded-lg bg-violet-500/20 text-violet-400 flex items-center justify-center text-xs font-bold shrink-0">{pos + 1}</span>
                  {question.reorder_item_images?.[optIdx] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={question.reorder_item_images[optIdx]} alt="" className="max-h-24 max-w-24 rounded object-contain shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  )}
                  <span className="font-medium">{question.options[optIdx]}</span>
                </div>
              ))}
            </div>
          ) : isOpen ? (
            <div className="text-center space-y-2">
              <p className="text-sm text-muted-foreground">Accepted answers</p>
              {(question.open_answers ?? []).map((ans, i) => (
                <p key={i} className="text-xl font-bold text-emerald-400">{ans}</p>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {question.options.map((opt, i) => (
                <div key={i} className={cn(
                  'p-3 rounded-lg border text-center flex items-center justify-center gap-2',
                  i === question.correct_index ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300' : 'border-border bg-card/40 text-muted-foreground opacity-60'
                )}>
                  {i === question.correct_index ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
                  <span className="font-medium">{opt}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-6">
          <h3 className="text-sm font-semibold text-muted-foreground mb-4 flex items-center gap-2">
            <Trophy className="w-4 h-4" /> LEADERBOARD
          </h3>
          {players.length === 0 ? (
            <p className="text-center text-muted-foreground py-6 text-sm">No players.</p>
          ) : (
            <div className="space-y-2">
              {players.map((p, i) => (
                <div key={p.id} className={cn(
                  'flex items-center gap-3 p-3 rounded-lg border animate-pop',
                  i === 0 ? 'border-amber-500/40 bg-amber-500/10' : 'border-border bg-card/40'
                )}>
                  <span className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0',
                    i === 0 ? 'bg-amber-500 text-black' : i === 1 ? 'bg-slate-300 text-black' : i === 2 ? 'bg-orange-700 text-white' : 'bg-primary/15 text-primary'
                  )}>{i + 1}</span>
                  <span className="font-medium flex-1 truncate">{p.nickname}</span>
                  <span className="font-bold tabular-nums">{p.score.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-center mt-6 gap-2">
        <Button variant="outline" onClick={onEnd} className="gap-2">
          End game
        </Button>
        <Button onClick={onNext} size="lg" className="gap-2">
          {isLast ? <>Show final results <Trophy className="w-4 h-4" /></> : <>Next question <ArrowRight className="w-4 h-4" /></>}
        </Button>
      </div>
    </div>
  );
}

function FinishedView({ players, onRestart, onExit }: { players: Player[]; onRestart: () => void; onExit: () => void }) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const winner = sorted[0];
  return (
    <div className="max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center mx-auto mb-4 animate-float">
          <Trophy className="w-10 h-10 text-white" />
        </div>
        <h1 className="text-3xl font-extrabold mb-1">Game over!</h1>
        {winner && <p className="text-lg text-muted-foreground"><span className="font-bold text-foreground">{winner.nickname}</span> wins with {winner.score.toLocaleString()} points</p>}
      </div>

      <Card>
        <CardContent className="p-6">
          <h3 className="text-sm font-semibold text-muted-foreground mb-4">FINAL STANDINGS</h3>
          <div className="space-y-2">
            {sorted.map((p, i) => (
              <div key={p.id} className={cn(
                'flex items-center gap-3 p-3 rounded-lg border animate-pop',
                i === 0 ? 'border-amber-500/40 bg-amber-500/10' : 'border-border bg-card/40'
              )}>
                <span className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0',
                  i === 0 ? 'bg-amber-500 text-black' : i === 1 ? 'bg-slate-300 text-black' : i === 2 ? 'bg-orange-700 text-white' : 'bg-primary/15 text-primary'
                )}>{i + 1}</span>
                <span className="font-medium flex-1 truncate">{p.nickname}</span>
                <span className="font-bold tabular-nums">{p.score.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-center gap-2 mt-6">
        <Button variant="outline" onClick={onExit} className="gap-2">
          <ArrowLeft className="w-4 h-4" /> Dashboard
        </Button>
        <Button onClick={onRestart} className="gap-2">
          <RotateCcw className="w-4 h-4" /> Play again
        </Button>
      </div>
    </div>
  );
}

const OPTION_BG = [
  'border-rose-500/40 bg-rose-500/10',
  'border-amber-500/40 bg-amber-500/10',
  'border-sky-500/40 bg-sky-500/10',
  'border-emerald-500/40 bg-emerald-500/10',
  'border-violet-500/40 bg-violet-500/10',
  'border-pink-500/40 bg-pink-500/10',
];
