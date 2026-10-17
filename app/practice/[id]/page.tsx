'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Check, X, Trophy, Zap, Loader2, RotateCcw, Home, Info, Sliders, ArrowUp, ArrowDown, Type, GripVertical } from 'lucide-react';
import { supabase, type Quiz, type Question, computePoints, computeSliderPoints, computeReorderPoints, computeOpenPoints, getGuestSession } from '@/lib/supabase';
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

type Phase = 'question' | 'reveal' | 'leaderboard' | 'finished';

type RoundResult = {
  questionIndex: number;
  correct: boolean;
  points: number;
  chosenIndex: number | null;
  sliderValue: number | null;
};

export default function PracticePage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const { playTrackIfDifferent } = useAudio();
  const quizId = params.id as string;

  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('question');
  const [chosenIndex, setChosenIndex] = useState<number | null>(null);
  const [sliderValue, setSliderValue] = useState<number | null>(null);
  const [reorderOrder, setReorderOrder] = useState<number[]>([]);
  const [openText, setOpenText] = useState('');
  const [score, setScore] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [lastPoints, setLastPoints] = useState(0);
  const [results, setResults] = useState<RoundResult[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const questionStartRef = useRef<number>(0);
  const answeredRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(async () => {
    const [{ data: q }, { data: qs }] = await Promise.all([
      supabase.from('quizzes').select('*').eq('id', quizId).maybeSingle(),
      supabase.from('questions').select('*').eq('quiz_id', quizId).order('position', { ascending: true }),
    ]);
    if (!q) {
      toast({ title: 'Quiz not found', variant: 'destructive' });
      router.push('/dashboard');
      return;
    }
    if (!qs || qs.length === 0) {
      toast({ title: 'No questions yet', description: 'Add questions before practicing.', variant: 'destructive' });
      router.push(`/dashboard/${quizId}`);
      return;
    }
    setQuiz(q as Quiz);
    setQuestions(qs as Question[]);
    // If first question is an info page, we still show it
    setTimeLeft((qs as Question[])[0].time_limit_ms);
    setLoading(false);
  }, [quizId, router, toast]);

  useEffect(() => {
    load();
  }, [load]);

  // Start game music, but mute during questions that have a YouTube video
  useEffect(() => {
    if (loading) return;
    if (phase === 'question') {
      const currentQ = questions[currentIndex];
      if (currentQ?.video_url || currentQ?.audio_url) {
        playTrackIfDifferent('none');
      } else {
        playTrackIfDifferent('game');
      }
    } else {
      playTrackIfDifferent('game');
    }
  }, [loading, phase, currentIndex, questions, playTrackIfDifferent]);

  // Play per-question audio when a question starts; stop when it ends.
  useEffect(() => {
    if (loading || phase !== 'question') {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      return;
    }
    const currentQ = questions[currentIndex];
    if (currentQ?.audio_url) {
      const audio = new Audio(currentQ.audio_url);
      audio.volume = Math.min(1, Math.max(0, currentQ.audio_volume ?? 1));
      audio.play().catch(() => {});
      audioRef.current = audio;
    }
    return () => {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    };
  }, [loading, phase, currentIndex, questions]);

  // Countdown timer (skip info pages)
  useEffect(() => {
    if (phase !== 'question' || loading) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }
    const currentQ = questions[currentIndex];
    if (!currentQ || currentQ.type === 'info') return;
    questionStartRef.current = Date.now();
    setTimeLeft(currentQ.time_limit_ms);

    timerRef.current = setInterval(() => {
      const elapsed = Date.now() - questionStartRef.current;
      const remaining = Math.max(0, currentQ.time_limit_ms - elapsed);
      setTimeLeft(remaining);
      if (remaining <= 0 && !answeredRef.current) {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        answeredRef.current = true;
        setChosenIndex(null);
        setPhase('reveal');
      }
    }, 100);

    return () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentIndex, loading]);

  const handleAnswer = (optionIndex: number) => {
    if (phase !== 'question' || answeredRef.current) return;
    const currentQ = questions[currentIndex];
    if (!currentQ) return;

    answeredRef.current = true;
    setChosenIndex(optionIndex);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

    const timeTaken = Date.now() - questionStartRef.current;
    const isCorrect = optionIndex === currentQ.correct_index;
    const points = computePoints(isCorrect, timeTaken, currentQ.time_limit_ms, currentQ.points_value);

    setLastPoints(points);
    if (isCorrect) {
      setScore((s) => s + points);
      setCorrectCount((c) => c + 1);
    }
    setResults((r) => [...r, { questionIndex: currentIndex, correct: isCorrect, points, chosenIndex: optionIndex, sliderValue: null }]);
    setPhase('reveal');
  };

  const handleSliderAnswer = (value: number) => {
    if (phase !== 'question' || answeredRef.current) return;
    const currentQ = questions[currentIndex];
    if (!currentQ || currentQ.type !== 'slider') return;

    answeredRef.current = true;
    setSliderValue(value);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

    const timeTaken = Date.now() - questionStartRef.current;
    const answer = currentQ.slider_answer ?? 0;
    const min = currentQ.slider_min ?? 0;
    const max = currentQ.slider_max ?? 100;
    const points = computeSliderPoints(value, answer, min, max, currentQ.points_value, timeTaken, currentQ.time_limit_ms);
    const isCorrect = value === answer;

    setLastPoints(points);
    setScore((s) => s + points);
    if (isCorrect) setCorrectCount((c) => c + 1);
    setResults((r) => [...r, { questionIndex: currentIndex, correct: isCorrect, points, chosenIndex: null, sliderValue: value }]);
    setPhase('reveal');
  };

  const handleReorderAnswer = (order: number[]) => {
    if (phase !== 'question' || answeredRef.current) return;
    const currentQ = questions[currentIndex];
    if (!currentQ || currentQ.type !== 'reorder') return;

    answeredRef.current = true;
    setReorderOrder(order);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

    const timeTaken = Date.now() - questionStartRef.current;
    const correctOrder = currentQ.reorder_correct_order ?? [];
    const points = computeReorderPoints(order, correctOrder, currentQ.points_value, timeTaken, currentQ.time_limit_ms);
    const isCorrect = points >= currentQ.points_value;

    setLastPoints(points);
    setScore((s) => s + points);
    if (isCorrect) setCorrectCount((c) => c + 1);
    setResults((r) => [...r, { questionIndex: currentIndex, correct: isCorrect, points, chosenIndex: null, sliderValue: null }]);
    setPhase('reveal');
  };

  const handleOpenAnswer = (text: string) => {
    if (phase !== 'question' || answeredRef.current) return;
    const currentQ = questions[currentIndex];
    if (!currentQ || currentQ.type !== 'open') return;

    answeredRef.current = true;
    setOpenText(text);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

    const timeTaken = Date.now() - questionStartRef.current;
    const accepted = currentQ.open_answers ?? [];
    const { points, isCorrect } = computeOpenPoints(text, accepted, currentQ.points_value, timeTaken, currentQ.time_limit_ms);

    setLastPoints(points);
    setScore((s) => s + points);
    if (isCorrect) setCorrectCount((c) => c + 1);
    setResults((r) => [...r, { questionIndex: currentIndex, correct: isCorrect, points, chosenIndex: null, sliderValue: null }]);
    setPhase('reveal');
  };

  const showLeaderboard = () => {
    setPhase('leaderboard');
  };

  const nextQuestion = () => {
    const next = currentIndex + 1;
    if (next >= questions.length) {
      setPhase('finished');
      return;
    }
    setCurrentIndex(next);
    setChosenIndex(null);
    setSliderValue(null);
    setReorderOrder([]);
    setOpenText('');
    setLastPoints(0);
    answeredRef.current = false;
    setPhase('question');
  };

  const restart = () => {
    setCurrentIndex(0);
    setChosenIndex(null);
    setSliderValue(null);
    setReorderOrder([]);
    setOpenText('');
    setScore(0);
    setCorrectCount(0);
    setLastPoints(0);
    setResults([]);
    setPhase('question');
    answeredRef.current = false;
  };

  if (loading || !quiz) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  }

  const currentQ = questions[currentIndex];
  const scorableTotal = questions.filter(q => q.type !== 'info').length;
  const scorableNumber = questions.slice(0, currentIndex + 1).filter(q => q.type !== 'info').length;

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
            <div>
              <span className="font-bold block leading-tight">Practice Mode</span>
              <span className="text-xs text-muted-foreground">{quiz.title}</span>
              {quiz.created_by && (
                <span className="text-xs text-primary font-medium">by {quiz.created_by}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <VolumeControl />
            <ThemeSwitcher />
            <Link href="/">
              <Button variant="ghost" size="icon" title="Home"><Home className="w-4 h-4" /></Button>
            </Link>
            <div className="px-3 py-1.5 rounded-lg bg-card border border-border text-sm">
              <span className="text-muted-foreground">Score:</span> <span className="font-bold tabular-nums">{score.toLocaleString()}</span>
            </div>
          </div>
        </div>

        {phase === 'question' && currentQ && currentQ.type === 'info' && (
          <PracticeInfoView
            question={currentQ}
            questionNumber={scorableNumber}
            totalQuestions={scorableTotal}
            onContinue={nextQuestion}
          />
        )}

        {phase === 'question' && currentQ && currentQ.type !== 'info' && currentQ.type !== 'slider' && currentQ.type !== 'reorder' && currentQ.type !== 'open' && (
          <PracticeQuestionView
            question={currentQ}
            questionNumber={scorableNumber}
            totalQuestions={scorableTotal}
            timeLeft={timeLeft}
            onAnswer={handleAnswer}
          />
        )}

        {phase === 'question' && currentQ && currentQ.type === 'reorder' && (
          <PracticeReorderView
            question={currentQ}
            questionNumber={scorableNumber}
            totalQuestions={scorableTotal}
            timeLeft={timeLeft}
            onAnswer={handleReorderAnswer}
          />
        )}

        {phase === 'question' && currentQ && currentQ.type === 'open' && (
          <PracticeOpenView
            question={currentQ}
            questionNumber={scorableNumber}
            totalQuestions={scorableTotal}
            timeLeft={timeLeft}
            onAnswer={handleOpenAnswer}
          />
        )}

        {phase === 'question' && currentQ && currentQ.type === 'slider' && (
          <PracticeSliderView
            question={currentQ}
            questionNumber={scorableNumber}
            totalQuestions={scorableTotal}
            timeLeft={timeLeft}
            onAnswer={handleSliderAnswer}
          />
        )}

        {phase === 'reveal' && currentQ && (
          <PracticeRevealView
            question={currentQ}
            questionNumber={scorableNumber}
            totalQuestions={scorableTotal}
            chosenIndex={chosenIndex}
            sliderValue={sliderValue}
            reorderOrder={reorderOrder}
            openText={openText}
            lastPoints={lastPoints}
            isLast={currentIndex + 1 >= questions.length}
            onNext={showLeaderboard}
          />
        )}

        {phase === 'leaderboard' && (
          <PracticeLeaderboardView
            questionNumber={scorableNumber}
            totalQuestions={scorableTotal}
            score={score}
            correctCount={correctCount}
            results={results}
            questions={questions}
            isLast={currentIndex + 1 >= questions.length}
            onNext={nextQuestion}
          />
        )}

        {phase === 'finished' && (
          <PracticeFinishedView
            score={score}
            correctCount={correctCount}
            totalQuestions={scorableTotal}
            onRestart={restart}
            onHome={() => router.push(getGuestSession() ? '/' : '/dashboard')}
            isGuest={!!getGuestSession()}
          />
        )}
      </div>
    </div>
  );
}

function PracticeInfoView({
  question, questionNumber, totalQuestions, onContinue,
}: {
  question: Question; questionNumber: number; totalQuestions: number; onContinue: () => void;
}) {
  const pos = question.info_image_position ?? 'top';
  const isHorizontal = pos === 'left' || pos === 'right';
  const media = (
    <QuestionMedia imageUrl={question.image_url} videoUrl={question.video_url} audioUrl={question.audio_url} audioVolume={question.audio_volume} audioStartMs={question.audio_start_ms} videoStartMs={question.video_start_ms} videoHidden={question.video_hidden} videoVolume={question.video_volume} audioHidden={question.audio_hidden} autoplay muted className={isHorizontal ? 'mb-0' : 'mb-4'} imgClassName={isHorizontal ? 'max-h-32 max-w-32' : 'max-h-48'} />
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
      <Button onClick={onContinue} size="lg" className="gap-2 mt-6">
        Continue <ArrowLeft className="w-4 h-4 rotate-180" />
      </Button>
    </div>
  );
}

function PracticeQuestionView({
  question, questionNumber, totalQuestions, timeLeft, onAnswer,
}: {
  question: Question; questionNumber: number; totalQuestions: number; timeLeft: number; onAnswer: (i: number) => void;
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
          <QuestionMedia imageUrl={question.image_url} videoUrl={question.video_url} audioUrl={question.audio_url} audioVolume={question.audio_volume} audioStartMs={question.audio_start_ms} videoStartMs={question.video_start_ms} videoHidden={question.video_hidden} videoVolume={question.video_volume} audioHidden={question.audio_hidden} autoplay muted className="mb-4" imgClassName="max-h-56" />
          <h2 className="text-xl md:text-2xl font-bold text-center">{question.prompt}</h2>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        {question.options.map((opt, i) => (
          <button
            key={i}
            onClick={() => onAnswer(i)}
            className={cn(
              'relative p-5 rounded-2xl border-2 text-left font-semibold transition-all min-h-[88px] flex items-center gap-3',
              OPTION_COLORS[i % OPTION_COLORS.length],
              'hover:scale-[1.02] active:scale-95 cursor-pointer'
            )}
          >
            <span className="w-8 h-8 rounded-lg bg-black/20 flex items-center justify-center text-sm font-bold shrink-0">
              {String.fromCharCode(65 + i)}
            </span>
            <span className="flex-1">{opt}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function PracticeSliderView({
  question, questionNumber, totalQuestions, timeLeft, onAnswer,
}: {
  question: Question; questionNumber: number; totalQuestions: number; timeLeft: number; onAnswer: (v: number) => void;
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
          <QuestionMedia imageUrl={question.image_url} videoUrl={question.video_url} audioUrl={question.audio_url} audioVolume={question.audio_volume} audioStartMs={question.audio_start_ms} videoStartMs={question.video_start_ms} videoHidden={question.video_hidden} videoVolume={question.video_volume} audioHidden={question.audio_hidden} autoplay muted className="mb-4" imgClassName="max-h-56" />
          <h2 className="text-xl md:text-2xl font-bold text-center mb-8">{question.prompt}</h2>

          <div className="text-center mb-6">
            <div className="text-5xl font-bold tabular-nums text-gradient mb-2">{localValue}</div>
            <p className="text-xs text-muted-foreground">Range: {min} — {max}</p>
          </div>

          <input
            type="range"
            min={min}
            max={max}
            value={localValue}
            onChange={(e) => setLocalValue(parseInt(e.target.value))}
            className="w-full h-3 rounded-full appearance-none cursor-pointer bg-card border border-border accent-primary [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-lg [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-0"
          />
        </CardContent>
      </Card>

      <div className="flex justify-center">
        <Button size="lg" className="gap-2 min-w-[200px]" onClick={() => onAnswer(localValue)}>
          <Check className="w-5 h-5" /> Lock in answer
        </Button>
      </div>
    </div>
  );
}

function PracticeReorderView({
  question, questionNumber, totalQuestions, timeLeft, onAnswer,
}: {
  question: Question; questionNumber: number; totalQuestions: number; timeLeft: number; onAnswer: (order: number[]) => void;
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
    if (to < 0 || to >= order.length) return;
    const newOrder = [...order];
    const [item] = newOrder.splice(from, 1);
    newOrder.splice(to, 0, item);
    setOrder(newOrder);
  };

  const handleDragStart = (pos: number) => setDragIndex(pos);

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
          <QuestionMedia imageUrl={question.image_url} videoUrl={question.video_url} audioUrl={question.audio_url} audioVolume={question.audio_volume} audioStartMs={question.audio_start_ms} videoStartMs={question.video_start_ms} videoHidden={question.video_hidden} videoVolume={question.video_volume} audioHidden={question.audio_hidden} autoplay muted className="mb-4" imgClassName="max-h-56" />
          <h2 className="text-xl md:text-2xl font-bold text-center mb-2">{question.prompt}</h2>
          <p className="text-sm text-muted-foreground text-center mb-6">Trascina per riordinare dall&apos;alto verso il basso</p>
          <div className="space-y-2">
            {order.map((optIdx, pos) => (
              <div
                key={optIdx}
                draggable
                onDragStart={() => handleDragStart(pos)}
                onDragOver={(e) => handleDragOver(e, pos)}
                onDrop={(e) => handleDrop(e, pos)}
                onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); }}
                className={cn(
                  'flex items-center gap-3 p-3 rounded-xl border-2 transition-all select-none cursor-grab active:cursor-grabbing',
                  'border-violet-500/40 bg-violet-500/10',
                  dragIndex === pos && 'opacity-40 scale-95',
                  dragOverIndex === pos && dragIndex !== pos && 'border-violet-400 bg-violet-500/25 scale-[1.02]',
                )}
              >
                <GripVertical className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="w-7 h-7 rounded-lg bg-violet-500/20 text-violet-400 flex items-center justify-center text-xs font-bold shrink-0">{pos + 1}</span>
                {question.reorder_item_images?.[optIdx] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={question.reorder_item_images[optIdx]} alt="" className="max-h-24 max-w-24 rounded object-contain shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                )}
                <span className="flex-1 font-medium">{question.options[optIdx]}</span>
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button onClick={() => move(pos, pos - 1)} disabled={pos === 0} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowUp className="w-4 h-4" /></button>
                  <button onClick={() => move(pos, pos + 1)} disabled={pos === order.length - 1} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><ArrowDown className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-center">
        <Button size="lg" className="gap-2 min-w-[200px]" onClick={() => onAnswer(order)}>
          <Check className="w-5 h-5" /> Lock in order
        </Button>
      </div>
    </div>
  );
}

function PracticeOpenView({
  question, questionNumber, totalQuestions, timeLeft, onAnswer,
}: {
  question: Question; questionNumber: number; totalQuestions: number; timeLeft: number; onAnswer: (text: string) => void;
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
          <QuestionMedia imageUrl={question.image_url} videoUrl={question.video_url} audioUrl={question.audio_url} audioVolume={question.audio_volume} audioStartMs={question.audio_start_ms} videoStartMs={question.video_start_ms} videoHidden={question.video_hidden} videoVolume={question.video_volume} audioHidden={question.audio_hidden} autoplay muted className="mb-4" imgClassName="max-h-56" />
          <h2 className="text-xl md:text-2xl font-bold text-center mb-8">{question.prompt}</h2>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type your answer..."
            rows={3}
            className="w-full p-4 rounded-xl bg-card border-2 border-border text-lg resize-none focus:outline-none focus:border-primary"
            autoFocus
          />
        </CardContent>
      </Card>

      <div className="flex justify-center">
        <Button size="lg" className="gap-2 min-w-[200px]" onClick={() => onAnswer(text)} disabled={!text.trim()}>
          <Check className="w-5 h-5" /> Submit answer
        </Button>
      </div>
    </div>
  );
}

function PracticeRevealView({
  question, questionNumber, totalQuestions, chosenIndex, sliderValue, reorderOrder, openText, lastPoints, isLast, onNext,
}: {
  question: Question; questionNumber: number; totalQuestions: number; chosenIndex: number | null; sliderValue: number | null; reorderOrder: number[]; openText: string; lastPoints: number; isLast: boolean; onNext: () => void;
}) {
  const isSlider = question.type === 'slider';
  const isReorder = question.type === 'reorder';
  const isOpen = question.type === 'open';
  const wasCorrect = isSlider
    ? sliderValue !== null && sliderValue === question.slider_answer
    : isReorder
    ? (question.reorder_correct_order ?? []).every((v, i) => reorderOrder[i] === v)
    : isOpen
    ? (question.open_answers ?? []).some((a) => a.toLowerCase().trim() === openText.toLowerCase().trim())
    : chosenIndex !== null && chosenIndex === question.correct_index;
  const timedOut = !isSlider && !isReorder && !isOpen && chosenIndex === null;

  return (
    <div>
      <div className="text-center mb-4">
        <span className="text-sm text-muted-foreground">Question {questionNumber} of {totalQuestions}</span>
      </div>

      <Card className="mb-4">
        <CardContent className="p-5">
          <QuestionMedia imageUrl={question.image_url} videoUrl={question.video_url} audioUrl={question.audio_url} audioVolume={question.audio_volume} audioStartMs={question.audio_start_ms} className="mb-4" imgClassName="max-h-48" />
          <p className="text-base font-medium text-center mb-3">{question.prompt}</p>
          {isSlider ? (
            <div className="text-center space-y-2">
              <div>
                <p className="text-sm text-muted-foreground">Correct answer</p>
                <p className="text-3xl font-bold text-emerald-400">{question.slider_answer}</p>
              </div>
              {sliderValue !== null && (
                <p className="text-sm text-muted-foreground">
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

      <div className={cn(
        'text-center mb-6 p-4 rounded-xl border animate-pop',
        wasCorrect ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-rose-500/40 bg-rose-500/10'
      )}>
        {wasCorrect ? (
          <p className="font-bold text-emerald-300">Correct! +{lastPoints.toLocaleString()} points</p>
        ) : timedOut ? (
          <p className="font-bold text-rose-300">Time&apos;s up — no points</p>
        ) : (
          <p className="font-bold text-rose-300">{lastPoints > 0 ? `+${lastPoints.toLocaleString()} points` : 'Incorrect — 0 points'}</p>
        )}
      </div>

      <div className="flex justify-center">
        <Button onClick={onNext} className="gap-2 min-w-[160px]">
          {isLast ? <>See results <Trophy className="w-4 h-4" /></> : <>Next <ArrowRight className="w-4 h-4" /></>}
        </Button>
      </div>
    </div>
  );
}

function PracticeLeaderboardView({
  questionNumber, totalQuestions, score, correctCount, results, questions, isLast, onNext,
}: {
  questionNumber: number; totalQuestions: number; score: number; correctCount: number; results: RoundResult[]; questions: Question[]; isLast: boolean; onNext: () => void;
}) {
  return (
    <div>
      <div className="text-center mb-6">
        <div className="w-12 h-12 rounded-2xl bg-primary/15 text-primary flex items-center justify-center mx-auto mb-3">
          <Trophy className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-bold">Scoreboard</h2>
        <p className="text-sm text-muted-foreground">After question {questionNumber} of {totalQuestions}</p>
      </div>

      <Card className="mb-4">
        <CardContent className="p-6">
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="text-center p-3 rounded-lg bg-card/50 border border-border">
              <p className="text-2xl font-bold tabular-nums">{score.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground mt-1">Total score</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-card/50 border border-border">
              <p className="text-2xl font-bold tabular-nums">{correctCount}/{results.length}</p>
              <p className="text-xs text-muted-foreground mt-1">Correct so far</p>
            </div>
          </div>

          <h3 className="text-sm font-semibold text-muted-foreground mb-3">QUESTION HISTORY</h3>
          <div className="space-y-2">
            {results.map((r, i) => {
              const q = questions[r.questionIndex];
              if (!q) return null;
              return (
                <div key={i} className={cn(
                  'flex items-center gap-3 p-2.5 rounded-lg border animate-pop',
                  r.correct ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-rose-500/30 bg-rose-500/5'
                )}>
                  <span className={cn(
                    'w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0',
                    r.correct ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                  )}>
                    {r.correct ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
                  </span>
                  <span className="text-sm flex-1 truncate">{q.prompt}</span>
                  <span className="text-xs font-bold tabular-nums">{r.points > 0 ? `+${r.points.toLocaleString()}` : '0'}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-center">
        <Button onClick={onNext} size="lg" className="gap-2 min-w-[160px]">
          {isLast ? <>See final results <Trophy className="w-4 h-4" /></> : <>Next question <ArrowLeft className="w-4 h-4 rotate-180" /></>}
        </Button>
      </div>
    </div>
  );
}

function PracticeFinishedView({
  score, correctCount, totalQuestions, onRestart, onHome, isGuest,
}: {
  score: number; correctCount: number; totalQuestions: number; onRestart: () => void; onHome: () => void; isGuest: boolean;
}) {
  const pct = Math.round((correctCount / totalQuestions) * 100);
  return (
    <div className="text-center py-8">
      <div className="w-16 h-16 rounded-3xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center mx-auto mb-4 animate-float">
        <Trophy className="w-8 h-8 text-white" />
      </div>
      <h1 className="text-2xl font-bold mb-1">Practice complete!</h1>
      <p className="text-muted-foreground mb-6">Here&apos;s how you did</p>

      <div className="grid grid-cols-3 gap-3 max-w-md mx-auto mb-8">
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-bold tabular-nums">{score.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">Total score</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-bold tabular-nums">{correctCount}/{totalQuestions}</p>
            <p className="text-xs text-muted-foreground mt-1">Correct</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-2xl font-bold tabular-nums">{pct}%</p>
            <p className="text-xs text-muted-foreground mt-1">Accuracy</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex justify-center gap-3">
        <Button variant="outline" onClick={onHome} className="gap-2">
          <Home className="w-4 h-4" /> {isGuest ? 'Home' : 'Dashboard'}
        </Button>
        <Button onClick={onRestart} className="gap-2">
          <RotateCcw className="w-4 h-4" /> Try again
        </Button>
      </div>
    </div>
  );
}
