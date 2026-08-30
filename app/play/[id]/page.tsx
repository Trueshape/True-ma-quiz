'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Check, X, Trophy, Zap, Users, Loader2, Info, ArrowRight, Home, ArrowUp, ArrowDown, Type, GripVertical } from 'lucide-react';
import { supabase, type Session, type Player, type Question, computePoints, computeSliderPoints, computeReorderPoints, computeOpenPoints } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { useAudio } from '@/components/audio-provider';
import { VolumeControl } from '@/components/volume-control';
import { ThemeSwitcher } from '@/components/theme-switcher';
import { QuestionMedia } from '@/components/question-media';
import { cn } from '@/lib/utils';

const OPTION_COLORS = [
  'border-rose-500 bg-rose-500/15 hover:bg-rose-500/25 text-rose-50',
  'border-amber-500 bg-amber-500/15 hover:bg-amber-500/25 text-amber-50',
  'border-sky-500 bg-sky-500/15 hover:bg-sky-500/25 text-sky-50',
  'border-emerald-500 bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-50',
  'border-violet-500 bg-violet-500/15 hover:bg-violet-500/25 text-violet-50',
  'border-pink-500 bg-pink-500/15 hover:bg-pink-500/25 text-pink-50',
];

export default function PlayPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { playTrackIfDifferent, volume, isMuted } = useAudio();
  const sessionId = params.id as string;

  const [session, setSession] = useState<Session | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [chosenIndex, setChosenIndex] = useState<number | null>(null);
  const [sliderValue, setSliderValue] = useState<number | null>(null);
  const [reorderOrder, setReorderOrder] = useState<number[]>([]);
  const [openText, setOpenText] = useState('');
  const [hasAnswered, setHasAnswered] = useState(false);
  const [timeLeft, setTimeLeft] = useState(0);
  const [lastPoints, setLastPoints] = useState<number | null>(null);
  const [lastCorrect, setLastCorrect] = useState<boolean | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const questionStartRef = useRef<number>(0);
  const answeredRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(async () => {
    const playerId = sessionStorage.getItem(`player:${sessionId}`);
    if (!playerId) {
      router.push('/');
      return;
    }
    const { data: sess } = await supabase.from('sessions').select('*').eq('id', sessionId).maybeSingle();
    const session = sess as Session | null;
    if (!session) {
      toast({ title: 'Game not found', variant: 'destructive' });
      router.push('/');
      return;
    }
    const [{ data: pl }, { data: qs }, { data: pls }] = await Promise.all([
      supabase.from('players').select('*').eq('id', playerId).maybeSingle(),
      supabase.from('questions').select('*').eq('quiz_id', session.quiz_id).order('position', { ascending: true }),
      supabase.from('players').select('*').eq('session_id', sessionId).order('score', { ascending: false }),
    ]);
    if (!pl) {
      toast({ title: 'Player not found', variant: 'destructive' });
      router.push('/');
      return;
    }
    setSession(session);
    setPlayer(pl as Player);
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

  // Play per-question audio when a question starts; stop it when the question ends.
  useEffect(() => {
    if (!session) return;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (session.status === 'question') {
      const currentQ = questions[session.current_question_index];
      if (currentQ?.audio_url) {
        const audio = new Audio(currentQ.audio_url);
        audio.volume = isMuted ? 0 : Math.min(1, Math.max(0, volume));
        if (currentQ.audio_start_ms && currentQ.audio_start_ms > 0) {
          audio.currentTime = currentQ.audio_start_ms / 1000;
        }
        audio.play().catch(() => {});
        audioRef.current = audio;
      }
    }
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, [session?.status, session?.current_question_index, questions]);

  // Sync VolumeControl changes to the per-question audio element in real time.
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : Math.min(1, Math.max(0, volume));
    }
  }, [volume, isMuted]);

  // Real-time subscriptions
  useEffect(() => {
    if (!session) return;
    const sessionChannel = supabase
      .channel(`play-session-${sessionId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` },
        (payload) => {
          const newSess = payload.new as Session;
          if (newSess.current_question_index !== session.current_question_index || newSess.status !== session.status) {
            setChosenIndex(null);
            setSliderValue(null);
            setReorderOrder([]);
            setOpenText('');
            setHasAnswered(false);
            answeredRef.current = false;
            setLastPoints(null);
            setLastCorrect(null);
          }
          setSession(newSess);
        }
      )
      .subscribe();

    const playersChannel = supabase
      .channel(`play-players-${sessionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players', filter: `session_id=eq.${sessionId}` },
        (payload) => {
          if (payload.eventType === 'UPDATE') {
            const updated = payload.new as Player;
            setPlayers((p) => p.map((x) => (x.id === updated.id ? updated : x)).sort((a, b) => b.score - a.score));
            if (player && updated.id === player.id) setPlayer(updated);
          } else if (payload.eventType === 'INSERT') {
            setPlayers((p) => [...p, payload.new as Player].sort((a, b) => b.score - a.score));
          } else if (payload.eventType === 'DELETE') {
            setPlayers((p) => p.filter((x) => x.id !== (payload.old as Player).id));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(sessionChannel);
      supabase.removeChannel(playersChannel);
    };
  }, [sessionId, session?.current_question_index, session?.status, player?.id]);

  // Countdown timer
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
      if (remaining <= 0 && !answeredRef.current) {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        setHasAnswered(true);
      }
    }, 100);

    return () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.status, session?.current_question_index, session?.question_started_at]);

  const submitAnswer = async (optionIndex: number) => {
    if (!session || !player || hasAnswered) return;
    const currentQ = questions[session.current_question_index];
    if (!currentQ) return;

    answeredRef.current = true;
    setChosenIndex(optionIndex);
    setHasAnswered(true);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

    const timeTaken = Date.now() - questionStartRef.current;
    const isCorrect = optionIndex === currentQ.correct_index;
    const points = computePoints(isCorrect, timeTaken, currentQ.time_limit_ms, currentQ.points_value);

    const { error } = await supabase.from('answers').insert({
      session_id: sessionId,
      player_id: player.id,
      question_id: currentQ.id,
      question_index: session.current_question_index,
      chosen_index: optionIndex,
      is_correct: isCorrect,
      time_taken_ms: Math.min(timeTaken, currentQ.time_limit_ms),
      points,
    });

    if (error) {
      if (error.code === '23505') return;
      toast({ title: 'Failed to submit answer', description: error.message, variant: 'destructive' });
      return;
    }

    const newScore = player.score + points;
    setPlayer({ ...player, score: newScore });
    setLastPoints(points);
    setLastCorrect(isCorrect);
    await supabase.from('players').update({ score: newScore }).eq('id', player.id);
  };

  const submitSliderAnswer = async (value: number) => {
    if (!session || !player || hasAnswered) return;
    const currentQ = questions[session.current_question_index];
    if (!currentQ || currentQ.type !== 'slider') return;

    answeredRef.current = true;
    setSliderValue(value);
    setHasAnswered(true);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

    const timeTaken = Date.now() - questionStartRef.current;
    const answer = currentQ.slider_answer ?? 0;
    const min = currentQ.slider_min ?? 0;
    const max = currentQ.slider_max ?? 100;
    const points = computeSliderPoints(value, answer, min, max, currentQ.points_value, timeTaken, currentQ.time_limit_ms);
    const isCorrect = value === answer;

    const { error } = await supabase.from('answers').insert({
      session_id: sessionId,
      player_id: player.id,
      question_id: currentQ.id,
      question_index: session.current_question_index,
      chosen_index: 0,
      slider_value: value,
      is_correct: isCorrect,
      time_taken_ms: Math.min(timeTaken, currentQ.time_limit_ms),
      points,
    });

    if (error) {
      if (error.code === '23505') return;
      toast({ title: 'Failed to submit answer', description: error.message, variant: 'destructive' });
      return;
    }

    const newScore = player.score + points;
    setPlayer({ ...player, score: newScore });
    setLastPoints(points);
    setLastCorrect(isCorrect);
    await supabase.from('players').update({ score: newScore }).eq('id', player.id);
  };

  const submitReorderAnswer = async (order: number[]) => {
    if (!session || !player || hasAnswered) return;
    const currentQ = questions[session.current_question_index];
    if (!currentQ || currentQ.type !== 'reorder') return;

    answeredRef.current = true;
    setReorderOrder(order);
    setHasAnswered(true);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

    const timeTaken = Date.now() - questionStartRef.current;
    const correctOrder = currentQ.reorder_correct_order ?? [];
    const points = computeReorderPoints(order, correctOrder, currentQ.points_value, timeTaken, currentQ.time_limit_ms);
    const isCorrect = points >= currentQ.points_value;

    const { error } = await supabase.from('answers').insert({
      session_id: sessionId,
      player_id: player.id,
      question_id: currentQ.id,
      question_index: session.current_question_index,
      chosen_index: 0,
      reorder_order: order,
      is_correct: isCorrect,
      time_taken_ms: Math.min(timeTaken, currentQ.time_limit_ms),
      points,
    });

    if (error) {
      if (error.code === '23505') return;
      toast({ title: 'Failed to submit answer', description: error.message, variant: 'destructive' });
      return;
    }

    const newScore = player.score + points;
    setPlayer({ ...player, score: newScore });
    setLastPoints(points);
    setLastCorrect(isCorrect);
    await supabase.from('players').update({ score: newScore }).eq('id', player.id);
  };

  const submitOpenAnswer = async (text: string) => {
    if (!session || !player || hasAnswered) return;
    const currentQ = questions[session.current_question_index];
    if (!currentQ || currentQ.type !== 'open') return;

    answeredRef.current = true;
    setOpenText(text);
    setHasAnswered(true);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

    const timeTaken = Date.now() - questionStartRef.current;
    const accepted = currentQ.open_answers ?? [];
    const { points, isCorrect } = computeOpenPoints(text, accepted, currentQ.points_value, timeTaken, currentQ.time_limit_ms);

    const { error } = await supabase.from('answers').insert({
      session_id: sessionId,
      player_id: player.id,
      question_id: currentQ.id,
      question_index: session.current_question_index,
      chosen_index: 0,
      open_text: text,
      is_correct: isCorrect,
      time_taken_ms: Math.min(timeTaken, currentQ.time_limit_ms),
      points,
    });

    if (error) {
      if (error.code === '23505') return;
      toast({ title: 'Failed to submit answer', description: error.message, variant: 'destructive' });
      return;
    }

    const newScore = player.score + points;
    setPlayer({ ...player, score: newScore });
    setLastPoints(points);
    setLastCorrect(isCorrect);
    await supabase.from('players').update({ score: newScore }).eq('id', player.id);
  };

  if (loading || !session || !player) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }

  const currentQ = questions[session.current_question_index];
  const scorableTotal = questions.filter(q => q.type !== 'info').length;
  const scorableNumber = questions.slice(0, session.current_question_index + 1).filter(q => q.type !== 'info').length;

  return (
    <div className="min-h-screen bg-grid relative">
      <div className="absolute top-0 right-0 w-96 h-96 bg-primary/15 rounded-full blur-3xl" />
      <div className="relative z-10 max-w-3xl mx-auto px-4 py-6">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" fill="white" />
            </div>
            <span className="font-bold">TrueMaQuiz</span>
          </div>
          <div className="flex items-center gap-3">
            <VolumeControl />
            <ThemeSwitcher />
            <Link href="/">
              <Button variant="ghost" size="icon" title="Home"><Home className="w-4 h-4" /></Button>
            </Link>
            <div className="px-3 py-1.5 rounded-lg bg-card border border-border text-sm">
              <span className="text-muted-foreground">Score:</span> <span className="font-bold tabular-nums">{player.score.toLocaleString()}</span>
            </div>
            <div className="px-3 py-1.5 rounded-lg bg-card border border-border text-sm flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-muted-foreground" /> {players.length}
            </div>
          </div>
        </div>

        {session.status === 'lobby' && (
          <LobbyWaitingView code={session.code} nickname={player.nickname} players={players} />
        )}

        {session.status === 'question' && currentQ && currentQ.type === 'info' && (
          <PlayerInfoView question={currentQ} questionNumber={scorableNumber} totalQuestions={scorableTotal} />
        )}

        {session.status === 'question' && currentQ && currentQ.type !== 'info' && currentQ.type !== 'slider' && currentQ.type !== 'reorder' && currentQ.type !== 'open' && (
          <PlayerQuestionView
            question={currentQ}
            questionNumber={scorableNumber}
            totalQuestions={scorableTotal}
            timeLeft={timeLeft}
            chosenIndex={chosenIndex}
            hasAnswered={hasAnswered}
            onAnswer={submitAnswer}
          />
        )}

        {session.status === 'question' && currentQ && currentQ.type === 'reorder' && (
          <PlayerReorderView
            question={currentQ}
            questionNumber={scorableNumber}
            totalQuestions={scorableTotal}
            timeLeft={timeLeft}
            hasAnswered={hasAnswered}
            onSubmit={submitReorderAnswer}
          />
        )}

        {session.status === 'question' && currentQ && currentQ.type === 'open' && (
          <PlayerOpenView
            question={currentQ}
            questionNumber={scorableNumber}
            totalQuestions={scorableTotal}
            timeLeft={timeLeft}
            hasAnswered={hasAnswered}
            onSubmit={submitOpenAnswer}
          />
        )}

        {session.status === 'question' && currentQ && currentQ.type === 'slider' && (
          <PlayerSliderView
            question={currentQ}
            questionNumber={scorableNumber}
            totalQuestions={scorableTotal}
            timeLeft={timeLeft}
            sliderValue={sliderValue}
            hasAnswered={hasAnswered}
            onSubmit={submitSliderAnswer}
          />
        )}

        {(session.status === 'leaderboard' || session.status === 'finished') && currentQ && (
          <PlayerLeaderboardView
            question={currentQ}
            questionNumber={scorableNumber}
            totalQuestions={scorableTotal}
            players={players}
            currentPlayerId={player.id}
            lastPoints={lastPoints}
            lastCorrect={lastCorrect}
            chosenIndex={chosenIndex}
            sliderValue={sliderValue}
            reorderOrder={reorderOrder}
            openText={openText}
            isFinished={session.status === 'finished'}
          />
        )}
      </div>
    </div>
  );
}

function LobbyWaitingView({ code, nickname, players }: { code: string; nickname: string; players: Player[] }) {
  return (
    <div className="text-center py-16">
      <div className="w-16 h-16 rounded-2xl bg-primary/15 text-primary flex items-center justify-center mx-auto mb-6 animate-pulse-ring">
        <Loader2 className="w-8 h-8 animate-spin" />
      </div>
      <h1 className="text-2xl font-bold mb-2">Hi, {nickname}!</h1>
      <p className="text-muted-foreground mb-8">Waiting for the host to start the game...</p>
      <Card className="inline-block">
        <CardContent className="p-6">
          <p className="text-xs text-muted-foreground mb-1">ROOM CODE</p>
          <p className="text-3xl font-mono font-bold tracking-widest mb-4">{code}</p>
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Users className="w-4 h-4" />
            <span><span className="font-bold text-foreground">{players.length}</span> in the room</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PlayerInfoView({ question, questionNumber, totalQuestions }: { question: Question; questionNumber: number; totalQuestions: number }) {
  const pos = question.info_image_position ?? 'top';
  const isHorizontal = pos === 'left' || pos === 'right';
  const media = (
    <QuestionMedia imageUrl={question.image_url} videoUrl={question.video_url} audioUrl={question.audio_url} audioVolume={question.audio_volume} audioStartMs={question.audio_start_ms} videoStartMs={question.video_start_ms} videoHidden={question.video_hidden} videoVolume={question.video_volume} audioHidden={question.audio_hidden} autoplay hideAudioControls className={isHorizontal ? 'mb-0' : 'mb-4'} imgClassName={isHorizontal ? 'max-h-32 max-w-32' : 'max-h-48'} />
  );
  const text = <p className="text-xl font-medium whitespace-pre-wrap">{question.prompt}</p>;
  return (
    <div className="text-center py-12">
      <div className="w-14 h-14 rounded-2xl bg-sky-500/15 text-sky-400 flex items-center justify-center mx-auto mb-6 animate-pulse-ring">
        <Info className="w-7 h-7" />
      </div>
      <p className="text-sm text-muted-foreground mb-4">Section {questionNumber} of {totalQuestions}</p>
      <Card className="max-w-lg mx-auto animate-pop">
        <CardContent className="p-8">
          {pos === 'top' && <>{media}{text}</>}
          {pos === 'bottom' && <>{text}{media}</>}
          {pos === 'left' && <div className="flex items-center gap-6 text-left">{media}<div className="flex-1">{text}</div></div>}
          {pos === 'right' && <div className="flex items-center gap-6 text-left"><div className="flex-1">{text}</div>{media}</div>}
        </CardContent>
      </Card>
      <p className="text-sm text-muted-foreground mt-6 flex items-center justify-center gap-1.5">
        <Loader2 className="w-4 h-4 animate-spin" /> Waiting for host to continue...
      </p>
    </div>
  );
}

function PlayerQuestionView({
  question, questionNumber, totalQuestions, timeLeft, chosenIndex, hasAnswered, onAnswer,
}: {
  question: Question; questionNumber: number; totalQuestions: number; timeLeft: number; chosenIndex: number | null; hasAnswered: boolean; onAnswer: (i: number) => void;
}) {
  const pct = Math.round((timeLeft / question.time_limit_ms) * 100);
  const seconds = Math.ceil(timeLeft / 1000);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-muted-foreground">Question {questionNumber} of {totalQuestions}</span>
        <div className="flex items-center gap-2">
          <div className="w-32 h-2 rounded-full bg-card overflow-hidden border border-border">
            <div
              className={cn('h-full transition-all duration-100', pct > 50 ? 'bg-emerald-500' : pct > 20 ? 'bg-amber-500' : 'bg-rose-500')}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-lg font-bold tabular-nums w-8 text-right">{seconds}</span>
        </div>
      </div>

      <Card className="mb-6 animate-pop">
        <CardContent className="p-6">
          <QuestionMedia imageUrl={question.image_url} videoUrl={question.video_url} audioUrl={question.audio_url} audioVolume={question.audio_volume} audioStartMs={question.audio_start_ms} videoStartMs={question.video_start_ms} videoHidden={question.video_hidden} videoVolume={question.video_volume} audioHidden={question.audio_hidden} autoplay hideAudioControls className="mb-4" imgClassName="max-h-56" />
          <h2 className="text-xl md:text-2xl font-bold text-center">{question.prompt}</h2>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        {question.options.map((opt, i) => {
          const isChosen = chosenIndex === i;
          return (
            <button
              key={i}
              disabled={hasAnswered}
              onClick={() => onAnswer(i)}
              className={cn(
                'relative p-5 rounded-2xl border-2 text-left font-semibold transition-all min-h-[88px] flex items-center gap-3',
                OPTION_COLORS[i % OPTION_COLORS.length],
                hasAnswered && !isChosen && 'opacity-40',
                hasAnswered && isChosen && 'ring-2 ring-primary scale-[1.02]',
                !hasAnswered && 'hover:scale-[1.02] active:scale-95 cursor-pointer'
              )}
            >
              <span className="w-8 h-8 rounded-lg bg-black/20 flex items-center justify-center text-sm font-bold shrink-0">
                {String.fromCharCode(65 + i)}
              </span>
              <span className="flex-1">{opt}</span>
              {isChosen && hasAnswered && (
                <div className="absolute inset-0 rounded-2xl flex items-center justify-center bg-black/30">
                  <Loader2 className="w-6 h-6 animate-spin text-white" />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {hasAnswered && (
        <div className="text-center mt-6 animate-pop">
          <p className="text-muted-foreground">Answer locked in. Waiting for others...</p>
        </div>
      )}
    </div>
  );
}

function PlayerSliderView({
  question, questionNumber, totalQuestions, timeLeft, sliderValue, hasAnswered, onSubmit,
}: {
  question: Question; questionNumber: number; totalQuestions: number; timeLeft: number; sliderValue: number | null; hasAnswered: boolean; onSubmit: (v: number) => void;
}) {
  const [localValue, setLocalValue] = useState(question.slider_min ?? 0);
  const pct = Math.round((timeLeft / question.time_limit_ms) * 100);
  const seconds = Math.ceil(timeLeft / 1000);
  const min = question.slider_min ?? 0;
  const max = question.slider_max ?? 100;

  useEffect(() => {
    setLocalValue(min);
  }, [min]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-muted-foreground">Question {questionNumber} of {totalQuestions}</span>
        <div className="flex items-center gap-2">
          <div className="w-32 h-2 rounded-full bg-card overflow-hidden border border-border">
            <div
              className={cn('h-full transition-all duration-100', pct > 50 ? 'bg-emerald-500' : pct > 20 ? 'bg-amber-500' : 'bg-rose-500')}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-lg font-bold tabular-nums w-8 text-right">{seconds}</span>
        </div>
      </div>

      <Card className="mb-6 animate-pop">
        <CardContent className="p-6">
          <QuestionMedia imageUrl={question.image_url} videoUrl={question.video_url} audioUrl={question.audio_url} audioVolume={question.audio_volume} audioStartMs={question.audio_start_ms} videoStartMs={question.video_start_ms} videoHidden={question.video_hidden} videoVolume={question.video_volume} audioHidden={question.audio_hidden} autoplay hideAudioControls className="mb-4" imgClassName="max-h-56" />
          <h2 className="text-xl md:text-2xl font-bold text-center mb-8">{question.prompt}</h2>

          <div className="text-center mb-6">
            <div className="text-5xl font-bold tabular-nums text-gradient mb-2">
              {hasAnswered ? (sliderValue ?? localValue) : localValue}
            </div>
            <p className="text-xs text-muted-foreground">Range: {min} — {max}</p>
          </div>

          <input
            type="range"
            min={min}
            max={max}
            value={hasAnswered ? (sliderValue ?? localValue) : localValue}
            disabled={hasAnswered}
            onChange={(e) => setLocalValue(parseInt(e.target.value))}
            className="w-full h-3 rounded-full appearance-none cursor-pointer bg-card border border-border accent-primary [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-lg [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-0"
          />
        </CardContent>
      </Card>

      {!hasAnswered && (
        <div className="flex justify-center">
          <Button size="lg" className="gap-2 min-w-[200px]" onClick={() => onSubmit(localValue)}>
            <Check className="w-5 h-5" /> Lock in answer
          </Button>
        </div>
      )}

      {hasAnswered && (
        <div className="text-center mt-6 animate-pop">
          <p className="text-muted-foreground">Answer locked in: <span className="font-bold text-foreground">{sliderValue}</span>. Waiting for others...</p>
        </div>
      )}
    </div>
  );
}

function PlayerReorderView({
  question, questionNumber, totalQuestions, timeLeft, hasAnswered, onSubmit,
}: {
  question: Question; questionNumber: number; totalQuestions: number; timeLeft: number; hasAnswered: boolean; onSubmit: (order: number[]) => void;
}) {
  const [order, setOrder] = useState<number[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const pct = Math.round((timeLeft / question.time_limit_ms) * 100);
  const seconds = Math.ceil(timeLeft / 1000);

  useEffect(() => {
    const indices = question.options.map((_, i) => i);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }
    setOrder(indices);
  }, [question.id]);

  const move = (from: number, to: number) => {
    if (hasAnswered) return;
    if (to < 0 || to >= order.length) return;
    const newOrder = [...order];
    const [item] = newOrder.splice(from, 1);
    newOrder.splice(to, 0, item);
    setOrder(newOrder);
  };

  const handleDragStart = (pos: number) => {
    if (hasAnswered) return;
    setDragIndex(pos);
  };

  const handleDragOver = (e: React.DragEvent, pos: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === pos) return;
    setDragOverIndex(pos);
  };

  const handleDrop = (e: React.DragEvent, pos: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === pos) { setDragIndex(null); setDragOverIndex(null); return; }
    const newOrder = [...order];
    const [item] = newOrder.splice(dragIndex, 1);
    newOrder.splice(pos, 0, item);
    setOrder(newOrder);
    setDragIndex(null);
    setDragOverIndex(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-muted-foreground">Question {questionNumber} of {totalQuestions}</span>
        <div className="flex items-center gap-2">
          <div className="w-32 h-2 rounded-full bg-card overflow-hidden border border-border">
            <div className={cn('h-full transition-all duration-100', pct > 50 ? 'bg-emerald-500' : pct > 20 ? 'bg-amber-500' : 'bg-rose-500')} style={{ width: `${pct}%` }} />
          </div>
          <span className="text-lg font-bold tabular-nums w-8 text-right">{seconds}</span>
        </div>
      </div>

      <Card className="mb-6 animate-pop">
        <CardContent className="p-6">
          <QuestionMedia imageUrl={question.image_url} videoUrl={question.video_url} audioUrl={question.audio_url} audioVolume={question.audio_volume} audioStartMs={question.audio_start_ms} videoStartMs={question.video_start_ms} videoHidden={question.video_hidden} videoVolume={question.video_volume} audioHidden={question.audio_hidden} hideAudioControls className="mb-4" imgClassName="max-h-56" />
          <h2 className="text-xl md:text-2xl font-bold text-center mb-2">{question.prompt}</h2>
          <p className="text-sm text-muted-foreground text-center mb-6">Trascina per riordinare dall&apos;alto verso il basso</p>
          <div className="space-y-2">
            {order.map((optIdx, pos) => (
              <div
                key={optIdx}
                draggable={!hasAnswered}
                onDragStart={() => handleDragStart(pos)}
                onDragOver={(e) => handleDragOver(e, pos)}
                onDrop={(e) => handleDrop(e, pos)}
                onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
                className={cn(
                  'flex items-center gap-3 p-3 rounded-xl border-2 transition-all select-none',
                  hasAnswered ? 'border-border bg-card/40' : 'border-violet-500/40 bg-violet-500/10',
                  !hasAnswered && dragIndex === pos && 'opacity-40 scale-95',
                  !hasAnswered && dragOverIndex === pos && dragIndex !== pos && 'border-violet-400 bg-violet-500/25 scale-[1.02]',
                  !hasAnswered && 'cursor-grab active:cursor-grabbing'
                )}
              >
                {!hasAnswered && <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" />}
                <span className="w-7 h-7 rounded-lg bg-violet-500/20 text-violet-400 flex items-center justify-center text-xs font-bold shrink-0">{pos + 1}</span>
                {question.reorder_item_images?.[optIdx] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={question.reorder_item_images[optIdx]} alt="" className="max-h-24 max-w-24 rounded object-contain shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                )}
                <span className="flex-1 font-medium">{question.options[optIdx]}</span>
                {!hasAnswered && (
                  <div className="flex flex-col gap-0.5 shrink-0">
                    <button onClick={() => move(pos, pos - 1)} disabled={pos === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowUp className="w-4 h-4" /></button>
                    <button onClick={() => move(pos, pos + 1)} disabled={pos === order.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowDown className="w-4 h-4" /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {!hasAnswered && (
        <div className="flex justify-center">
          <Button size="lg" className="gap-2 min-w-[200px]" onClick={() => onSubmit(order)}>
            <Check className="w-5 h-5" /> Lock in order
          </Button>
        </div>
      )}
      {hasAnswered && (
        <div className="text-center text-muted-foreground text-sm">Answer locked in — waiting for results...</div>
      )}
    </div>
  );
}

function PlayerOpenView({
  question, questionNumber, totalQuestions, timeLeft, hasAnswered, onSubmit,
}: {
  question: Question; questionNumber: number; totalQuestions: number; timeLeft: number; hasAnswered: boolean; onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState('');
  const pct = Math.round((timeLeft / question.time_limit_ms) * 100);
  const seconds = Math.ceil(timeLeft / 1000);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-muted-foreground">Question {questionNumber} of {totalQuestions}</span>
        <div className="flex items-center gap-2">
          <div className="w-32 h-2 rounded-full bg-card overflow-hidden border border-border">
            <div className={cn('h-full transition-all duration-100', pct > 50 ? 'bg-emerald-500' : pct > 20 ? 'bg-amber-500' : 'bg-rose-500')} style={{ width: `${pct}%` }} />
          </div>
          <span className="text-lg font-bold tabular-nums w-8 text-right">{seconds}</span>
        </div>
      </div>

      <Card className="mb-6 animate-pop">
        <CardContent className="p-6">
          <QuestionMedia imageUrl={question.image_url} videoUrl={question.video_url} audioUrl={question.audio_url} audioVolume={question.audio_volume} audioStartMs={question.audio_start_ms} videoStartMs={question.video_start_ms} videoHidden={question.video_hidden} videoVolume={question.video_volume} audioHidden={question.audio_hidden} hideAudioControls className="mb-4" imgClassName="max-h-56" />
          <h2 className="text-xl md:text-2xl font-bold text-center mb-8">{question.prompt}</h2>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={hasAnswered}
            placeholder="Type your answer..."
            rows={3}
            className="w-full p-4 rounded-xl bg-card border-2 border-border text-lg resize-none focus:outline-none focus:border-primary disabled:opacity-60"
            autoFocus
          />
        </CardContent>
      </Card>

      {!hasAnswered && (
        <div className="flex justify-center">
          <Button size="lg" className="gap-2 min-w-[200px]" onClick={() => onSubmit(text)} disabled={!text.trim()}>
            <Check className="w-5 h-5" /> Submit answer
          </Button>
        </div>
      )}
      {hasAnswered && (
        <div className="text-center text-muted-foreground text-sm">Answer submitted — waiting for results...</div>
      )}
    </div>
  );
}

function PlayerLeaderboardView({
  question, questionNumber, totalQuestions, players, currentPlayerId, lastPoints, lastCorrect, chosenIndex, sliderValue, reorderOrder, openText, isFinished,
}: {
  question: Question; questionNumber: number; totalQuestions: number; players: Player[]; currentPlayerId: string; lastPoints: number | null; lastCorrect: boolean | null; chosenIndex: number | null; sliderValue: number | null; reorderOrder: number[]; openText: string; isFinished: boolean;
}) {
  const myRank = players.findIndex((p) => p.id === currentPlayerId) + 1;
  const isInfo = question.type === 'info';
  const isSlider = question.type === 'slider';
  const isReorder = question.type === 'reorder';
  const isOpen = question.type === 'open';

  return (
    <div>
      {!isFinished && !isInfo && (
        <>
          <div className="text-center mb-4">
            <span className="text-sm text-muted-foreground">Question {questionNumber} of {totalQuestions}</span>
          </div>

          <Card className="mb-4">
            <CardContent className="p-5">
              <p className="text-base font-medium text-center mb-3">{question.prompt}</p>
              {isSlider ? (
                <div className="text-center">
                  <p className="text-sm text-muted-foreground mb-1">Correct answer</p>
                  <p className="text-3xl font-bold text-emerald-400">{question.slider_answer}</p>
                  {sliderValue !== null && (
                    <p className="text-sm text-muted-foreground mt-2">
                      Your guess: <span className={cn('font-bold', sliderValue === question.slider_answer ? 'text-emerald-400' : 'text-amber-400')}>{sliderValue}</span>
                    </p>
                  )}
                </div>
              ) : isReorder ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground text-center mb-2">Correct order</p>
                  {(question.reorder_correct_order ?? []).map((optIdx, pos) => (
                    <div key={pos} className={cn(
                      'flex items-center gap-3 p-2.5 rounded-lg border text-sm',
                      reorderOrder[pos] === optIdx ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-border bg-card/40'
                    )}>
                      <span className="w-6 h-6 rounded bg-violet-500/20 text-violet-400 flex items-center justify-center text-xs font-bold shrink-0">{pos + 1}</span>
                      {question.reorder_item_images?.[optIdx] && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={question.reorder_item_images[optIdx]} alt="" className="max-h-20 max-w-20 rounded object-contain shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      )}
                      <span className="font-medium flex-1">{question.options[optIdx]}</span>
                      {reorderOrder[pos] === optIdx ? <Check className="w-4 h-4 text-emerald-400" /> : <X className="w-4 h-4 text-rose-400" />}
                    </div>
                  ))}
                </div>
              ) : isOpen ? (
                <div className="text-center space-y-2">
                  <p className="text-sm text-muted-foreground">Accepted answers</p>
                  {(question.open_answers ?? []).map((ans, i) => (
                    <p key={i} className="text-lg font-bold text-emerald-400">{ans}</p>
                  ))}
                  {openText && (
                    <p className="text-sm text-muted-foreground mt-2">
                      Your answer: <span className="font-bold text-foreground">{openText}</span>
                    </p>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {question.options.map((opt, i) => {
                    const isCorrect = i === question.correct_index;
                    const isChosen = chosenIndex === i;
                    return (
                      <div key={i} className={cn(
                        'p-3 rounded-lg border text-center flex items-center justify-center gap-2 text-sm',
                        isCorrect ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300' : isChosen ? 'border-rose-500 bg-rose-500/15 text-rose-300' : 'border-border bg-card/40 text-muted-foreground opacity-60'
                      )}>
                        {isCorrect ? <Check className="w-4 h-4" /> : isChosen ? <X className="w-4 h-4" /> : null}
                        <span className="font-medium">{opt}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {lastCorrect !== null && (
            <div className={cn(
              'text-center mb-4 p-4 rounded-xl border animate-pop',
              lastCorrect ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-rose-500/40 bg-rose-500/10'
            )}>
              {lastCorrect ? (
                <p className="font-bold text-emerald-300">Correct! +{lastPoints?.toLocaleString()} points</p>
              ) : (
                <p className="font-bold text-rose-300">{lastPoints && lastPoints > 0 ? `+${lastPoints.toLocaleString()} points` : 'No points'}</p>
              )}
            </div>
          )}
        </>
      )}

      {isFinished && (
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center mx-auto mb-4 animate-float">
            <Trophy className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold">Game over!</h1>
          <p className="text-muted-foreground">You finished #{myRank} of {players.length}</p>
        </div>
      )}

      <Card>
        <CardContent className="p-5">
          <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
            <Trophy className="w-4 h-4" /> {isFinished ? 'FINAL STANDINGS' : 'LEADERBOARD'}
          </h3>
          <div className="space-y-2">
            {players.map((p, i) => {
              const isMe = p.id === currentPlayerId;
              return (
                <div key={p.id} className={cn(
                  'flex items-center gap-3 p-2.5 rounded-lg border animate-pop',
                  isMe ? 'border-primary bg-primary/10' : 'border-border bg-card/40',
                  i === 0 && !isMe && 'border-amber-500/40 bg-amber-500/10'
                )}>
                  <span className={cn(
                    'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0',
                    i === 0 ? 'bg-amber-500 text-black' : i === 1 ? 'bg-slate-300 text-black' : i === 2 ? 'bg-orange-700 text-white' : 'bg-primary/15 text-primary'
                  )}>{i + 1}</span>
                  <span className="font-medium flex-1 truncate">{p.nickname}{isMe && <span className="text-primary text-xs ml-2">(you)</span>}</span>
                  <span className="font-bold tabular-nums">{p.score.toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {isFinished && (
        <div className="text-center mt-6">
          <Button variant="outline" onClick={() => { sessionStorage.removeItem(`player:${players[0]?.session_id || ''}`); window.location.href = '/'; }} className="gap-2">
            <ArrowLeft className="w-4 h-4" /> Back home
          </Button>
        </div>
      )}
    </div>
  );
}
