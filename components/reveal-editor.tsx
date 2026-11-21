'use client';

import { useEffect, useRef, useState } from 'react';
import { Crosshair, Image as ImageIcon, Loader2, Pause, Play, Plus, Upload, X } from 'lucide-react';
import type { Question, QuestionType } from '@/lib/supabase';
import { getGuestSession } from '@/lib/supabase';
import {
  MAX_BLANKS, MIN_REVEAL_FACTOR, blankHint, blanksConfig, blockyConfig, dezoomConfig, parseBlanks, revealProgress,
  type RevealConfig,
} from '@/lib/reveal';
import { uploadQuestionImage } from '@/lib/image-upload';
import { BlanksInputs, RevealImage } from '@/components/reveal-question';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/*
  Editor settings of the dezoom, blocky and blanks question types: the picture (URL or
  upload, resized before upload), the reveal settings, an animated preview, the accepted
  answers, and for blanks the gaps and the hint.
*/

export type RevealDraft = {
  id?: string;
  type: QuestionType;
  prompt: string;
  image_url: string;
  open_answers: string[];
  reveal_config: RevealConfig;
  time_limit_ms: number;
  points_value: number;
};

type Props = { question: RevealDraft; onChange: (patch: Partial<RevealDraft>) => void };

const label = 'text-xs font-medium text-muted-foreground mb-1.5 flex items-center justify-between';

function Range({ name, value, min, max, step, shown, onChange }: { name: string; value: number; min: number; max: number; step: number; shown: string; onChange: (v: number) => void }) {
  return (
    <div>
      <label className={label}>
        <span>{name}</span>
        <span className="font-bold text-foreground tabular-nums">{shown}</span>
      </label>
      <input
        type="range"
        aria-label={name}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-primary"
      />
    </div>
  );
}

function Choice<T extends string>({ name, value, options, onChange }: { name: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div>
      <span className={label}>{name}</span>
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={name}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              'px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors',
              value === o.value ? 'border-primary bg-primary/15 text-primary' : 'border-border bg-card/40 text-muted-foreground hover:text-foreground'
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ImageField({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canUpload = !getGuestSession();

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setError(null);
    const res = await uploadQuestionImage(file);
    setBusy(false);
    if (res.url) onChange(res.url);
    else setError(res.error ?? 'Upload failed.');
  };

  return (
    <div>
      <label className={label}>
        <span className="flex items-center gap-1.5"><ImageIcon className="w-3.5 h-3.5" /> Picture to guess</span>
      </label>
      <div className="flex gap-2">
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://… image URL" className="flex-1" aria-label="Picture URL" />
        {canUpload && (
          <>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={pick} aria-label="Upload a picture" />
            <Button type="button" variant="outline" className="gap-2 shrink-0" onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Upload
            </Button>
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        {canUpload ? 'Uploads are resized to 1600 px and compressed, so they load fast on phones.' : 'Guests can paste an image URL. Sign in to upload pictures.'}
      </p>
      {error && <p role="alert" className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  );
}

function FocusPicker({ src, x, y, onPick }: { src: string; x: number; y: number; onPick: (x: number, y: number) => void }) {
  return (
    <div>
      <span className={label}>
        <span className="flex items-center gap-1.5"><Crosshair className="w-3.5 h-3.5" /> Zoom point — click on the picture</span>
      </span>
      <button
        type="button"
        aria-label="Choose the zoom point"
        className="relative block mx-auto rounded-lg overflow-hidden border border-border cursor-crosshair"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const round = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
          onPick(round((e.clientX - r.left) / r.width), round((e.clientY - r.top) / r.height));
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" className="block max-h-56 max-w-full" draggable={false} />
        <span
          className="absolute w-6 h-6 -ml-3 -mt-3 rounded-full border-2 border-white shadow-[0_0_0_2px_rgba(0,0,0,0.6)] pointer-events-none"
          style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
        />
      </button>
    </div>
  );
}

function Preview({ question }: { question: RevealDraft }) {
  const [ms, setMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const limit = question.time_limit_ms;

  useEffect(() => {
    if (!playing) return;
    const start = Date.now() - ms;
    const id = setInterval(() => {
      const t = Date.now() - start;
      if (t >= limit) {
        setMs(limit);
        setPlaying(false);
      } else setMs(t);
    }, 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, limit]);

  // Same id as in the game, so the squares appear in the same order.
  const q = { ...question, id: question.id ?? 'preview' } as unknown as Question;
  const factor = Math.max(MIN_REVEAL_FACTOR, 1 - revealProgress(q, ms));
  return (
    <div className="space-y-3 p-3 rounded-lg border border-border bg-card/40">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-medium">Preview — what players see</span>
        <span>
          at {Math.round(ms / 1000)}s a right answer is worth <span className="font-bold text-foreground">{Math.round(question.points_value * factor)}</span> points
        </span>
      </div>
      <RevealImage question={q} elapsedMs={ms} className="max-h-64" />
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label={playing ? 'Pause preview' : 'Play preview'}
          onClick={() => {
            if (!playing && ms >= limit) setMs(0);
            setPlaying(!playing);
          }}
        >
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </Button>
        <input
          type="range"
          aria-label="Preview time"
          min={0}
          max={limit}
          step={100}
          value={ms}
          onChange={(e) => {
            setPlaying(false);
            setMs(Number(e.target.value));
          }}
          className="flex-1 accent-primary"
        />
      </div>
    </div>
  );
}

function AcceptedAnswers({ answers, onChange }: { answers: string[]; onChange: (a: string[]) => void }) {
  const list = answers.length ? answers : [''];
  return (
    <div className="space-y-2">
      <span className={label}>Accepted answers — synonyms and other languages too</span>
      {list.map((a, i) => (
        <div key={i} className="flex gap-2">
          <Input
            value={a}
            aria-label={`Accepted answer ${i + 1}`}
            placeholder={i === 0 ? 'e.g. Eiffel Tower' : 'e.g. Torre Eiffel'}
            onChange={(e) => onChange(list.map((x, j) => (j === i ? e.target.value : x)))}
          />
          {list.length > 1 && (
            <Button type="button" variant="ghost" size="icon" aria-label={`Remove answer ${i + 1}`} onClick={() => onChange(list.filter((_, j) => j !== i))}>
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="gap-1 h-8 text-xs" onClick={() => onChange([...list, ''])}>
        <Plus className="w-3 h-3" /> Add another accepted answer
      </Button>
      <p className="text-xs text-muted-foreground">Capitals, accents and small typos are ignored. Each player has one try.</p>
    </div>
  );
}

export function RevealSettings({ question, onChange }: Props) {
  const cfg = question.reveal_config ?? {};
  const set = (patch: RevealConfig) => onChange({ reveal_config: { ...cfg, ...patch } });

  if (question.type === 'blanks') {
    const { answers } = parseBlanks(question.prompt);
    const { hint } = blanksConfig(question);
    const empty = answers.findIndex((a) => a.length === 0);
    return (
      <div className="space-y-4">
        <div className="p-3 rounded-lg bg-card/50 border border-border text-xs text-muted-foreground space-y-1">
          <p>Write the sentence above and put each missing word in double braces, with other accepted answers after a |</p>
          <p className="font-mono text-foreground">La capitale della {'{{'}Francia{'}}'} è {'{{'}Parigi|Paris{'}}'}</p>
        </div>
        <p className={cn('text-xs font-medium', answers.length === 0 || answers.length > MAX_BLANKS || empty >= 0 ? 'text-destructive' : 'text-emerald-400')}>
          {answers.length === 0
            ? 'No blanks yet.'
            : answers.length > MAX_BLANKS
              ? `${answers.length} blanks: at most ${MAX_BLANKS}.`
              : empty >= 0
                ? `Blank ${empty + 1} has no answer.`
                : `${answers.length} blank${answers.length > 1 ? 's' : ''}: ${answers.map((a) => a.join(' / ')).join(' · ')}`}
        </p>
        <Choice
          name="Hint inside each blank"
          value={hint}
          options={[
            { value: 'none', label: 'None' },
            { value: 'length', label: `Length (${blankHint(['Parigi'], 'length')})` },
            { value: 'first', label: `First letter (${blankHint(['Parigi'], 'first')})` },
          ]}
          onChange={(v) => set({ hint: v })}
        />
        {answers.length > 0 && answers.length <= MAX_BLANKS && (
          <div className="p-3 rounded-lg border border-border bg-card/40">
            <p className="text-xs font-medium text-muted-foreground mb-2">Preview — what players see</p>
            <BlanksInputs question={{ prompt: question.prompt, reveal_config: question.reveal_config }} values={[]} onChange={() => {}} disabled />
          </div>
        )}
        <p className="text-xs text-muted-foreground">Each right blank gives its share of the points; answering sooner gives more.</p>
      </div>
    );
  }

  const q = question as unknown as Question;
  return (
    <div className="space-y-4">
      <ImageField value={question.image_url} onChange={(url) => onChange({ image_url: url })} />

      {question.type === 'dezoom' ? (
        <>
          {question.image_url && (
            <FocusPicker src={question.image_url} x={dezoomConfig(q).focus_x} y={dezoomConfig(q).focus_y} onPick={(focus_x, focus_y) => set({ focus_x, focus_y })} />
          )}
          <div className="grid sm:grid-cols-2 gap-4">
            <Range name="Zoom at the start" value={dezoomConfig(q).start_zoom} min={1.5} max={20} step={0.5} shown={`${dezoomConfig(q).start_zoom}×`}
              onChange={(v) => set({ start_zoom: v, end_zoom: Math.min(dezoomConfig(q).end_zoom, v) })} />
            <Range name="Zoom at the end" value={dezoomConfig(q).end_zoom} min={1} max={dezoomConfig(q).start_zoom} step={0.5} shown={`${dezoomConfig(q).end_zoom}×`}
              onChange={(v) => set({ end_zoom: v })} />
          </div>
        </>
      ) : (
        (() => {
          const c = blockyConfig(q);
          const total = c.grid * c.grid;
          const fullAt = Math.ceil(total / c.tiles_per_step) * c.step_ms;
          return (
            <>
              <div className="grid sm:grid-cols-3 gap-4">
                <Range name="Squares per side" value={c.grid} min={2} max={12} step={1} shown={`${c.grid}×${c.grid}`}
                  onChange={(v) => set({ grid: v, tiles_per_step: Math.min(c.tiles_per_step, v * v) })} />
                <Range name="Squares shown each time" value={c.tiles_per_step} min={1} max={Math.min(total, 20)} step={1} shown={String(c.tiles_per_step)}
                  onChange={(v) => set({ tiles_per_step: v })} />
                <Range name="Every" value={c.step_ms} min={500} max={10000} step={500} shown={`${c.step_ms / 1000}s`}
                  onChange={(v) => set({ step_ms: v })} />
              </div>
              <p className={cn('text-xs', fullAt > question.time_limit_ms ? 'text-amber-400' : 'text-muted-foreground')}>
                The whole picture is visible after {Math.round(fullAt / 1000)}s
                {fullAt > question.time_limit_ms ? ` — longer than the ${Math.round(question.time_limit_ms / 1000)}s time limit, so part of it stays hidden.` : '.'}
              </p>
              <div className="grid sm:grid-cols-2 gap-4">
                <Choice name="Order" value={c.order} onChange={(v) => set({ order: v })}
                  options={[{ value: 'random', label: 'Random' }, { value: 'spiral', label: 'Centre outwards' }, { value: 'edges', label: 'Edges inwards' }]} />
                <Choice name="Hidden squares" value={c.style} onChange={(v) => set({ style: v })}
                  options={[{ value: 'pixel', label: 'Pixelated' }, { value: 'blur', label: 'Blurred' }]} />
              </div>
            </>
          );
        })()
      )}

      {question.image_url && <Preview question={question} />}

      <AcceptedAnswers answers={question.open_answers} onChange={(open_answers) => onChange({ open_answers })} />
    </div>
  );
}
