'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Check, X } from 'lucide-react';
import type { Question } from '@/lib/supabase';
import {
  blankHint, blankPrompt, blanksConfig, blockyConfig, computeBlanksPoints, dezoomConfig, dezoomLevel, isRevealType,
  parseBlanks, revealProgress, revealedTiles, tileOrder, type BlockyConfig, type DezoomConfig,
} from '@/lib/reveal';
import { computeOpenPoints } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/*
  Screens of the dezoom, blocky and blanks question types, shared by the host, the
  players and practice mode. Rules and scoring live in lib/reveal.ts.
*/

export type NewTypeAnswer = { openText: string } | { blankTexts: string[] };

// ─── images ──────────────────────────────────────────────────────────────────

export function DezoomImage({ src, config, progress, className }: { src: string; config: DezoomConfig; progress: number; className?: string }) {
  const zoom = dezoomLevel(config, progress);
  return (
    <div className={cn('relative overflow-hidden rounded-xl bg-black/40 mx-auto w-fit', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        draggable={false}
        className="block max-h-[inherit] max-w-full select-none"
        style={{
          transform: `scale(${zoom})`,
          transformOrigin: `${config.focus_x * 100}% ${config.focus_y * 100}%`,
          transition: 'transform 150ms linear',
        }}
      />
    </div>
  );
}

const MAX_CANVAS = 1200;

export function BlockyImage({
  src, config, seed, shown, className,
}: { src: string; config: BlockyConfig; seed: string; shown: number; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const order = useMemo(() => tileOrder(config.grid, config.order, seed), [config.grid, config.order, seed]);

  useEffect(() => {
    const image = new Image();
    image.onload = () => setImg(image);
    image.src = src;
    return () => {
      image.onload = null;
    };
  }, [src]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !img) return;
    const scale = Math.min(1, MAX_CANVAS / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    canvas.width = w;
    canvas.height = h;

    // Hidden squares: the image shrunk to one pixel per square, then stretched back, so
    // each square shows only its average colour. Sharp edges give the pixel style,
    // smoothing gives the blur style.
    const small = document.createElement('canvas');
    small.width = config.grid;
    small.height = config.grid;
    small.getContext('2d')?.drawImage(img, 0, 0, small.width, small.height);
    ctx.imageSmoothingEnabled = config.style === 'blur';
    ctx.drawImage(small, 0, 0, w, h);
    ctx.imageSmoothingEnabled = true;

    const tw = w / config.grid;
    const th = h / config.grid;
    const visible = new Set(order.slice(0, shown));
    for (let i = 0; i < config.grid * config.grid; i++) {
      const x = (i % config.grid) * tw;
      const y = Math.floor(i / config.grid) * th;
      if (visible.has(i)) {
        const sx = x / scale;
        const sy = y / scale;
        ctx.drawImage(img, sx, sy, tw / scale, th / scale, x, y, tw, th);
      } else {
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, tw - 1, th - 1);
      }
    }
  }, [img, shown, order, config.grid, config.style]);

  return <canvas ref={canvasRef} role="img" aria-label="Hidden picture" className={cn('block mx-auto rounded-xl max-w-full h-auto', className)} />;
}

/** The picture of a dezoom or blocky question at `elapsedMs`, or the whole picture when `done`. */
export function RevealImage({ question, elapsedMs, done = false, className }: { question: Question; elapsedMs: number; done?: boolean; className?: string }) {
  if (!question.image_url) return null;
  if (question.type === 'dezoom') {
    return <DezoomImage src={question.image_url} config={dezoomConfig(question)} progress={done ? 1 : revealProgress(question, elapsedMs)} className={className} />;
  }
  const c = blockyConfig(question);
  return <BlockyImage src={question.image_url} config={c} seed={question.id} shown={done ? c.grid * c.grid : revealedTiles(c, elapsedMs)} className={className} />;
}

// ─── blanks ──────────────────────────────────────────────────────────────────

export function BlanksInputs({
  question, values, onChange, disabled, onEnter,
}: { question: Pick<Question, 'prompt' | 'reveal_config'>; values: string[]; onChange: (v: string[]) => void; disabled?: boolean; onEnter?: () => void }) {
  const { parts, answers } = parseBlanks(question.prompt);
  const { hint } = blanksConfig(question);
  return (
    <p className="text-xl md:text-2xl font-semibold leading-[2.6] text-center">
      {parts.map((p, k) => {
        if (typeof p === 'string') return <span key={k} className="whitespace-pre-wrap">{p}</span>;
        const placeholder = blankHint(answers[p], hint);
        const width = Math.max(5, (answers[p][0] ?? '').length + 2, placeholder.length);
        return (
          <input
            key={k}
            aria-label={`Blank ${p + 1}`}
            value={values[p] ?? ''}
            disabled={disabled}
            placeholder={placeholder}
            onChange={(e) => {
              const next = [...values];
              while (next.length < answers.length) next.push('');
              next[p] = e.target.value;
              onChange(next);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onEnter?.();
            }}
            style={{ width: `${Math.min(18, width)}ch` }}
            className="mx-1 px-2 py-0.5 rounded-lg bg-card border-2 border-primary/50 text-center text-lg focus:outline-none focus:border-primary disabled:opacity-60 placeholder:text-muted-foreground/60 placeholder:tracking-widest"
            autoComplete="off"
          />
        );
      })}
    </p>
  );
}

/** The sentence with the right words; a player's own words are marked right or wrong. */
export function BlanksSolution({ question, values }: { question: Question; values?: string[] }) {
  const { parts, answers } = parseBlanks(question.prompt);
  return (
    <p className="text-lg font-medium text-center leading-loose">
      {parts.map((p, k) => {
        if (typeof p === 'string') return <span key={k} className="whitespace-pre-wrap">{p}</span>;
        const mine = values?.[p]?.trim();
        const right = mine ? computeOpenPoints(mine, answers[p]).isCorrect : false;
        return (
          <span key={k} className="inline-flex items-center gap-1 mx-1">
            <span className="px-2 rounded-md bg-emerald-500/15 text-emerald-300 font-bold">{answers[p].join(' / ')}</span>
            {values && (
              <span className={cn('text-sm', right ? 'text-emerald-400' : 'text-rose-400')}>
                {right ? <Check className="w-4 h-4 inline" /> : <><X className="w-4 h-4 inline" />{mine ? ` ${mine}` : ''}</>}
              </span>
            )}
          </span>
        );
      })}
    </p>
  );
}

// ─── whole screens ───────────────────────────────────────────────────────────

function TimerBar({ timeLeft, limit, label }: { timeLeft: number; limit: number; label: string }) {
  const pct = Math.round((timeLeft / Math.max(1, limit)) * 100);
  return (
    <div className="flex items-center justify-between mb-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <div className="w-32 h-2 rounded-full bg-card overflow-hidden border border-border">
          <div className={cn('h-full transition-all duration-100', pct > 50 ? 'bg-emerald-500' : pct > 20 ? 'bg-amber-500' : 'bg-rose-500')} style={{ width: `${pct}%` }} />
        </div>
        <span className="text-lg font-bold tabular-nums w-8 text-right">{Math.ceil(timeLeft / 1000)}</span>
      </div>
    </div>
  );
}

/** What a player sees and answers (live game and practice). */
export function NewTypeQuestionView({
  question, questionNumber, totalQuestions, timeLeft, hasAnswered, onSubmit,
}: {
  question: Question; questionNumber: number; totalQuestions: number; timeLeft: number; hasAnswered: boolean; onSubmit: (a: NewTypeAnswer) => void;
}) {
  const [text, setText] = useState('');
  const [blanks, setBlanks] = useState<string[]>([]);
  const elapsed = question.time_limit_ms - timeLeft;
  const isBlanks = question.type === 'blanks';
  const ready = isBlanks ? blanks.some((b) => b.trim()) : !!text.trim();
  const submit = () => {
    if (!ready || hasAnswered) return;
    onSubmit(isBlanks ? { blankTexts: parseBlanks(question.prompt).answers.map((_, i) => blanks[i] ?? '') } : { openText: text });
  };

  return (
    <div>
      <TimerBar timeLeft={timeLeft} limit={question.time_limit_ms} label={`Question ${questionNumber} of ${totalQuestions}`} />
      <Card className="mb-6 animate-pop">
        <CardContent className="p-6 space-y-6">
          {isBlanks ? (
            <BlanksInputs question={question} values={blanks} onChange={setBlanks} disabled={hasAnswered} onEnter={submit} />
          ) : (
            <>
              <RevealImage question={question} elapsedMs={elapsed} className="max-h-[50vh]" />
              <h2 className="text-xl md:text-2xl font-bold text-center">{question.prompt}</h2>
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit();
                }}
                disabled={hasAnswered}
                placeholder="What is it?"
                aria-label="Your answer"
                className="w-full p-4 rounded-xl bg-card border-2 border-border text-lg focus:outline-none focus:border-primary disabled:opacity-60"
                autoComplete="off"
                autoFocus
              />
              <p className="text-xs text-muted-foreground text-center">The sooner you guess, the more points. One try only.</p>
            </>
          )}
        </CardContent>
      </Card>
      {!hasAnswered ? (
        <div className="flex justify-center">
          <Button size="lg" className="gap-2 min-w-[200px]" onClick={submit} disabled={!ready}>
            <Check className="w-5 h-5" /> Submit answer
          </Button>
        </div>
      ) : (
        <div className="text-center text-muted-foreground text-sm">Answer submitted — waiting for results...</div>
      )}
    </div>
  );
}

/** What the host screen shows while players answer. */
export function HostNewTypeView({
  question, questionNumber, totalQuestions, timeLeft, answeredCount, totalPlayers, onSkip,
}: {
  question: Question; questionNumber: number; totalQuestions: number; timeLeft: number; answeredCount: number; totalPlayers: number; onSkip: () => void;
}) {
  const elapsed = question.time_limit_ms - timeLeft;
  return (
    <div>
      <TimerBar timeLeft={timeLeft} limit={question.time_limit_ms} label={`Question ${questionNumber} of ${totalQuestions}`} />
      <Card className="mb-4">
        <CardContent className="p-8 space-y-6">
          {question.type === 'blanks' ? (
            <h2 className="text-2xl md:text-3xl font-bold text-center leading-relaxed">{blankPrompt(question.prompt)}</h2>
          ) : (
            <>
              <RevealImage question={question} elapsedMs={elapsed} className="max-h-[60vh]" />
              <h2 className="text-2xl md:text-3xl font-bold text-center">{question.prompt}</h2>
            </>
          )}
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

/** The solution, after the question: whole picture and accepted answers, or the full sentence. */
export function NewTypeResult({ question, openText, blankTexts }: { question: Question; openText?: string; blankTexts?: string[] }) {
  if (question.type === 'blanks') return <BlanksSolution question={question} values={blankTexts} />;
  return (
    <div className="text-center space-y-2">
      <RevealImage question={question} elapsedMs={0} done className="max-h-64 mb-3" />
      <p className="text-sm text-muted-foreground">Accepted answers</p>
      <p className="text-lg font-bold text-emerald-400">{(question.open_answers ?? []).join(' / ')}</p>
      {openText && (
        <p className="text-sm text-muted-foreground">
          Your answer: <span className="font-bold text-foreground">{openText}</span>
        </p>
      )}
    </div>
  );
}

/** Whether a practice answer was right, for the result banner. */
export function newTypeAnswerRight(question: Question, openText: string, blankTexts: string[]): boolean {
  if (question.type === 'blanks') return computeBlanksPoints(question, blankTexts, 0).isCorrect;
  return isRevealType(question.type) && computeOpenPoints(openText, question.open_answers ?? []).isCorrect;
}
