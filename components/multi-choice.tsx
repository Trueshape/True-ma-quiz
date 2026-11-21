'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import type { Question } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const COLORS = [
  'border-rose-500 bg-rose-500/15 text-rose-50',
  'border-amber-500 bg-amber-500/15 text-amber-50',
  'border-sky-500 bg-sky-500/15 text-sky-50',
  'border-emerald-500 bg-emerald-500/15 text-emerald-50',
  'border-violet-500 bg-violet-500/15 text-violet-50',
  'border-pink-500 bg-pink-500/15 text-pink-50',
];

/** True when a multiple choice question has several right answers. */
export const hasManyRight = (q: Pick<Question, 'type' | 'correct_indices'>) => q.type === 'mc' && (q.correct_indices?.length ?? 0) > 0;

/**
 * Multiple choice with several right answers: tap options to pick them (tap again to drop
 * one), then lock in. Indexes are the shown positions.
 */
export function MultiChoiceAnswer({ question, disabled, onSubmit }: { question: Question; disabled: boolean; onSubmit: (shown: number[]) => void }) {
  const [picked, setPicked] = useState<number[]>([]);
  const toggle = (i: number) => setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i].sort((a, b) => a - b)));
  return (
    <div>
      <p className="text-sm text-muted-foreground text-center mb-3">Pick every right answer. Wrong picks cost points.</p>
      <div className="grid grid-cols-2 gap-3" role="group" aria-label="Answers">
        {question.options.map((opt, i) => {
          const on = picked.includes(i);
          return (
            <button
              key={i}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              onClick={() => toggle(i)}
              className={cn(
                'relative p-5 rounded-2xl border-2 text-left font-semibold transition-all min-h-[88px] flex items-center gap-3',
                COLORS[i % COLORS.length],
                on ? 'ring-2 ring-primary scale-[1.02]' : 'opacity-80',
                disabled && !on && 'opacity-40',
                !disabled && 'hover:scale-[1.02] active:scale-95 cursor-pointer'
              )}
            >
              <span className={cn('w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold shrink-0', on ? 'bg-primary text-primary-foreground' : 'bg-black/20')}>
                {on ? <Check className="w-4 h-4" /> : String.fromCharCode(65 + i)}
              </span>
              <span className="flex-1">{opt}</span>
            </button>
          );
        })}
      </div>
      {!disabled && (
        <div className="flex justify-center mt-6">
          <Button size="lg" className="gap-2 min-w-[200px]" disabled={picked.length === 0} onClick={() => onSubmit(picked)}>
            <Check className="w-5 h-5" /> Lock in {picked.length > 0 ? `(${picked.length})` : ''}
          </Button>
        </div>
      )}
    </div>
  );
}
