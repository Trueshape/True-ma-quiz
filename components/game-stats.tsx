'use client';

import { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { getQuizStats, type PlayerQuestionStats, type QuestionStats, type QuizStats } from '@/lib/game-api';
import type { Question } from '@/lib/supabase';
import { blankPrompt } from '@/lib/reveal';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const pct = (s: QuestionStats) => (s.answered ? Math.round((s.correct / s.answered) * 100) : 0);

/** One question after it ends: share of right answers and the wrong answer chosen most. */
export function QuestionStatsLine({ stats }: { stats: QuestionStats | undefined }) {
  if (!stats) return null;
  const p = pct(stats);
  return (
    <div className="mt-4 rounded-lg border border-border bg-card/40 p-3 text-sm space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{p}% right</span>
        <span className="text-muted-foreground text-xs">
          {stats.correct} of {stats.answered} answers · {stats.players - stats.answered > 0 ? `${stats.players - stats.answered} did not answer` : 'everyone answered'}
        </span>
      </div>
      <div className="h-2 rounded-full bg-card border border-border overflow-hidden" aria-hidden>
        <div className={cn('h-full', p >= 50 ? 'bg-emerald-500' : 'bg-rose-500')} style={{ width: `${p}%` }} />
      </div>
      {stats.top_wrong && (
        <p className="text-xs text-muted-foreground">
          Most chosen wrong answer: <span className="font-semibold text-foreground">{stats.top_wrong}</span> ({stats.top_wrong_count})
        </p>
      )}
    </div>
  );
}

/** End of the game: every question with its share of right answers, hardest first marked. */
export function GameSummary({ stats, questions }: { stats: QuestionStats[]; questions: Question[] }) {
  if (stats.length === 0) return null;
  const hardest = stats.reduce((a, b) => (pct(b) < pct(a) ? b : a));
  return (
    <Card className="mt-6">
      <CardContent className="p-6">
        <h3 className="text-sm font-semibold text-muted-foreground mb-4 flex items-center gap-2">
          <BarChart3 className="w-4 h-4" /> QUESTIONS
        </h3>
        <div className="space-y-3">
          {stats.map((s) => {
            const q = questions[s.question_index];
            const p = pct(s);
            const text = q ? (q.type === 'blanks' ? blankPrompt(q.prompt) : q.prompt) : `Question ${s.question_index + 1}`;
            return (
              <div key={s.question_index} className="space-y-1">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate">
                    {text}
                    {s === hardest && stats.length > 1 && <span className="ml-2 text-xs text-rose-400">hardest</span>}
                  </span>
                  <span className="tabular-nums font-medium shrink-0">{p}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-card border border-border overflow-hidden" aria-hidden>
                  <div className={cn('h-full', p >= 50 ? 'bg-emerald-500' : 'bg-rose-500')} style={{ width: `${p}%` }} />
                </div>
                {s.top_wrong && <p className="text-xs text-muted-foreground">Most chosen wrong: {s.top_wrong} ({s.top_wrong_count})</p>}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

/** For the author, in the editor: how the quiz did in past games. Hidden until it was played. */
export function QuizStatsCard({ quizId }: { quizId: string }) {
  const [stats, setStats] = useState<QuizStats | null>(null);
  useEffect(() => {
    let alive = true;
    getQuizStats(quizId).then((s) => {
      if (alive) setStats(s);
    });
    return () => {
      alive = false;
    };
  }, [quizId]);
  if (!stats || stats.games === 0) return null;
  const h = stats.hardest;
  return (
    <Card>
      <CardContent className="p-5">
        <h3 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
          <BarChart3 className="w-4 h-4" /> How it went
        </h3>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="rounded-lg bg-card/50 border border-border p-3">
            <p className="text-2xl font-bold tabular-nums">{stats.games}</p>
            <p className="text-xs text-muted-foreground">{stats.games === 1 ? 'game' : 'games'}</p>
          </div>
          <div className="rounded-lg bg-card/50 border border-border p-3">
            <p className="text-2xl font-bold tabular-nums">{stats.players}</p>
            <p className="text-xs text-muted-foreground">players</p>
          </div>
          <div className="rounded-lg bg-card/50 border border-border p-3">
            <p className="text-2xl font-bold tabular-nums">{stats.average_score != null ? Number(stats.average_score).toLocaleString() : '—'}</p>
            <p className="text-xs text-muted-foreground">average score</p>
          </div>
        </div>
        {h && (
          <p className="text-sm mt-3">
            <span className="text-muted-foreground">Hardest question: </span>
            <span className="font-medium">Q{h.position + 1} {h.type === 'blanks' ? blankPrompt(h.prompt) : h.prompt}</span>
            <span className="text-rose-400"> · {Math.round((h.correct / Math.max(1, h.answered)) * 100)}% right</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Under a question, for players: how many in the room got it right. */
export function PlayerQuestionStatsLine({ stats }: { stats: PlayerQuestionStats | undefined }) {
  if (!stats || stats.answered === 0) return null;
  const p = Math.round((stats.correct / stats.answered) * 100);
  return (
    <div className="mt-3 text-sm text-center text-muted-foreground">
      <span className="font-semibold text-foreground">{stats.correct}</span> of <span className="font-semibold text-foreground">{stats.answered}</span> answered it right ({p}%)
    </div>
  );
}

/** End of the game, for players: how many questions they got right, and every question with its share. */
export function PlayerGameSummary({ stats, questions }: { stats: PlayerQuestionStats[]; questions: Question[] }) {
  if (stats.length === 0) return null;
  const mine = stats.filter((s) => s.mine === true).length;
  const total = stats.length;
  return (
    <Card className="mt-6">
      <CardContent className="p-6">
        <h3 className="text-sm font-semibold text-muted-foreground mb-1 flex items-center gap-2">
          <BarChart3 className="w-4 h-4" /> YOUR GAME
        </h3>
        <p className="text-sm mb-4">You got <span className="font-bold">{mine}</span> of {total} questions right.</p>
        <div className="space-y-3">
          {stats.map((s) => {
            const q = questions[s.question_index];
            const p = s.answered ? Math.round((s.correct / s.answered) * 100) : 0;
            const text = q ? (q.type === 'blanks' ? blankPrompt(q.prompt) : q.prompt) : `Question ${s.question_index + 1}`;
            return (
              <div key={s.question_index} className="space-y-1">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate flex items-center gap-2">
                    <span className={cn('text-xs font-bold', s.mine === true ? 'text-emerald-400' : s.mine === false ? 'text-rose-400' : 'text-muted-foreground')}>
                      {s.mine === true ? '✓' : s.mine === false ? '✗' : '–'}
                    </span>
                    {text}
                  </span>
                  <span className="tabular-nums shrink-0 text-muted-foreground">
                    {s.correct}/{s.answered} · <span className="font-medium text-foreground">{p}%</span>
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-card border border-border overflow-hidden" aria-hidden>
                  <div className={cn('h-full', p >= 50 ? 'bg-emerald-500' : 'bg-rose-500')} style={{ width: `${p}%` }} />
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground mt-3">Percentages are of the players who answered each question, shown with the number of players in the room.</p>
      </CardContent>
    </Card>
  );
}
