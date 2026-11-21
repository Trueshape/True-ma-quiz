'use client';

import { useEffect, useRef, useState } from 'react';
import { Crosshair, Image as ImageIcon, Loader2, Pause, Play, Plus, Upload, X } from 'lucide-react';
import type { Question, QuestionType } from '@/lib/supabase';
import { decayStartMs, getGuestSession, timeFactor } from '@/lib/supabase';
import {
  MAX_BLANKS, MAX_TILES, MIN_TILES, blankHint, blanksConfig, blockyConfig, blockyTotal, dezoomConfig, parseBlanks,
  revealFactor, squareGrid, type RevealConfig,
} from '@/lib/reveal';
import { QUESTION_IMAGE_ACCEPT, QUESTION_IMAGE_MAX_MB, uploadQuestionImage } from '@/lib/image-upload';
import { BlanksInputs, RevealImage } from '@/components/reveal-question';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/*
  Editor settings of the dezoom, blocky and blanks question types: the picture (URL or
  upload, resized before upload), the reveal settings, an animated preview, the accepted
  answers, and for blanks the gaps, the hint and the letters given over time.
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
  points_decay_start_ms: number | null;
};

type Props = { question: RevealDraft; onChange: (patch: Partial<RevealDraft>) => void };

const label = 'text-xs font-medium text-muted-foreground mb-1.5 flex items-center justify-between';
const secs = (ms: number) => `${Math.round(ms / 100) / 10}s`;

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
            <input ref={fileRef} type="file" accept={QUESTION_IMAGE_ACCEPT} className="hidden" onChange={pick} aria-label="Upload a picture" />
            <Button type="button" variant="outline" className="gap-2 shrink-0" onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />} Upload
            </Button>
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        {canUpload
          ? `JPG, PNG, WebP, GIF, AVIF or BMP from your device, ${QUESTION_IMAGE_MAX_MB} MB at most. Resized to 1600 px so it loads fast on phones.`
          : 'Guests can paste an image URL. Sign in to upload pictures from your device.'}
      </p>
      {error && <p role="alert" className="text-xs text-destructive mt-1">{error}</p>}
    </div>
  );
}

/** Drag the circle (or click, or use the arrow keys) to choose where the zoom starts. */
function FocusPicker({ src, x, y, onPick }: { src: string; x: number; y: number; onPick: (x: number, y: number) => void }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const round = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
  const pickAt = (clientX: number, clientY: number) => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return;
    onPick(round((clientX - r.left) / r.width), round((clientY - r.top) / r.height));
  };

  return (
    <div>
      <span className={label}>
        <span className="flex items-center gap-1.5"><Crosshair className="w-3.5 h-3.5" /> Zoom point — drag the circle</span>
        <span className="tabular-nums">{Math.round(x * 100)}%, {Math.round(y * 100)}%</span>
      </span>
      <div
        ref={boxRef}
        role="slider"
        tabIndex={0}
        aria-label="Zoom point"
        aria-valuetext={`${Math.round(x * 100)}% from the left, ${Math.round(y * 100)}% from the top`}
        className="relative w-fit mx-auto rounded-lg overflow-hidden border border-border cursor-crosshair touch-none select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          pickAt(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (dragging.current) pickAt(e.clientX, e.clientY);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 0.02;
          const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
          const m = moves[e.key];
          if (!m) return;
          e.preventDefault();
          onPick(round(x + m[0]), round(y + m[1]));
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" className="block max-h-56 max-w-full pointer-events-none" draggable={false} />
        <span
          className="absolute w-7 h-7 -ml-3.5 -mt-3.5 rounded-full border-2 border-white bg-white/20 shadow-[0_0_0_2px_rgba(0,0,0,0.6)] pointer-events-none"
          style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
        />
      </div>
    </div>
  );
}

/** Plays the question as players see it, with what a right answer is worth at each moment. */
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

  // Same id as in the game, so the tiles appear in the same order.
  const q = { ...question, id: question.id ?? 'preview' } as unknown as Question;
  const factor = question.type === 'blanks' ? timeFactor(ms, limit, decayStartMs(q) ?? limit) : revealFactor(q, ms);
  return (
    <div className="space-y-3 p-3 rounded-lg border border-border bg-card/40">
      <div className="flex flex-wrap items-center justify-between gap-x-3 text-xs text-muted-foreground">
        <span className="font-medium">Preview — what players see</span>
        <span>
          at {secs(ms)} a right answer is worth <span className="font-bold text-foreground">{Math.round(question.points_value * factor)}</span> points
        </span>
      </div>
      {question.type === 'blanks' ? (
        <BlanksInputs question={q} values={[]} onChange={() => {}} disabled elapsedMs={ms} />
      ) : (
        <RevealImage question={q} elapsedMs={ms} className="max-h-64" />
      )}
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

/** Natural size of a picture, once it has loaded. */
function useImageSize(src: string) {
  const [size, setSize] = useState<{ src: string; w: number; h: number } | null>(null);
  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.onload = () => setSize({ src, w: img.naturalWidth, h: img.naturalHeight });
    img.src = src;
    return () => {
      img.onload = null;
    };
  }, [src]);
  return size && size.src === src ? size : null;
}

function BlockySettings({ question, set }: { question: RevealDraft; set: (patch: RevealConfig) => void }) {
  const c = blockyConfig(question as unknown as Question);
  const size = useImageSize(question.image_url);
  const fit = size ? squareGrid(c.tiles, size.w, size.h) : null;

  // Keep the saved columns and rows in step with the picture and the number of tiles,
  // so the tiles are square and the server counts the same tiles as the players see.
  useEffect(() => {
    if (fit && (fit.cols !== c.cols || fit.rows !== c.rows)) {
      set({ cols: fit.cols, rows: fit.rows, grid: undefined, tiles: c.tiles, tiles_per_step: Math.min(c.tiles_per_step, fit.cols * fit.rows) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit?.cols, fit?.rows]);

  const total = blockyTotal(c);
  const fullAt = Math.ceil(total / c.tiles_per_step) * c.step_ms;
  return (
    <>
      <div className="grid sm:grid-cols-3 gap-4">
        <Range name="Tiles in total" value={c.tiles} min={MIN_TILES} max={MAX_TILES} step={1} shown={String(c.tiles)}
          onChange={(v) => set({ tiles: v })} />
        <Range name="Tiles shown each time" value={c.tiles_per_step} min={1} max={Math.min(total, 20)} step={1} shown={String(c.tiles_per_step)}
          onChange={(v) => set({ tiles_per_step: v })} />
        <Range name="Every" value={c.step_ms} min={500} max={10000} step={500} shown={secs(c.step_ms)}
          onChange={(v) => set({ step_ms: v })} />
      </div>
      <p className={cn('text-xs', fullAt > question.time_limit_ms ? 'text-amber-400' : 'text-muted-foreground')}>
        {c.cols != null && c.rows != null ? `${c.cols} × ${c.rows} = ${total} square tiles. ` : 'Add a picture to fit the tiles to it. '}
        The whole picture is visible after {Math.round(fullAt / 1000)}s
        {fullAt > question.time_limit_ms ? ` — longer than the ${Math.round(question.time_limit_ms / 1000)}s time limit, so part of it stays hidden.` : '.'}
      </p>
      <div className="grid sm:grid-cols-2 gap-4">
        <Choice name="Order" value={c.order} onChange={(v) => set({ order: v })}
          options={[{ value: 'random', label: 'Random' }, { value: 'spiral', label: 'Centre outwards' }, { value: 'edges', label: 'Edges inwards' }]} />
        <Choice name="Hidden tiles" value={c.style} onChange={(v) => set({ style: v })}
          options={[{ value: 'pixel', label: 'Pixelated' }, { value: 'blur', label: 'Blurred' }]} />
      </div>
      {c.style === 'blur' && (
        <Range name="Blur strength" value={c.blur} min={1} max={5} step={1} shown={['', 'Light', 'Soft', 'Medium', 'Strong', 'Very strong'][c.blur]}
          onChange={(v) => set({ blur: v })} />
      )}
    </>
  );
}

export function RevealSettings({ question, onChange }: Props) {
  const cfg = question.reveal_config ?? {};
  const set = (patch: RevealConfig) => onChange({ reveal_config: { ...cfg, ...patch } });

  if (question.type === 'blanks') {
    const { answers } = parseBlanks(question.prompt);
    const c = blanksConfig(question);
    const empty = answers.findIndex((a) => a.length === 0);
    const valid = answers.length > 0 && answers.length <= MAX_BLANKS && empty < 0;
    return (
      <div className="space-y-4">
        <div className="p-3 rounded-lg bg-card/50 border border-border text-xs text-muted-foreground space-y-1">
          <p>Write the sentence above and put each missing word in double braces, with other accepted answers after a |</p>
          <p className="font-mono text-foreground">La capitale della {'{{'}Francia{'}}'} è {'{{'}Parigi|Paris{'}}'}</p>
        </div>
        <p className={cn('text-xs font-medium', valid ? 'text-emerald-400' : 'text-destructive')}>
          {answers.length === 0
            ? 'No blanks yet.'
            : answers.length > MAX_BLANKS
              ? `${answers.length} blanks: at most ${MAX_BLANKS}.`
              : empty >= 0
                ? `Blank ${empty + 1} has no answer.`
                : `${answers.length} blank${answers.length > 1 ? 's' : ''}: ${answers.map((a) => a.join(' / ')).join(' · ')}`}
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <Choice
            name="Hint at the start"
            value={c.hint}
            options={[
              { value: 'none', label: 'None' },
              { value: 'length', label: `Length (${blankHint(['Parigi'], 'length')})` },
              { value: 'first', label: `First letter (${blankHint(['Parigi'], 'first')})` },
            ]}
            onChange={(v) => set({ hint: v })}
          />
          <Range name="One more letter every" value={c.letter_every_ms} min={0} max={15000} step={1000}
            shown={c.letter_every_ms ? secs(c.letter_every_ms) : 'Off'} onChange={(v) => set({ letter_every_ms: v })} />
        </div>
        {valid && <Preview question={question} />}
        <p className="text-xs text-muted-foreground">Each right blank gives its share of the points. The last letter of a word is never given away.</p>
      </div>
    );
  }

  const q = question as unknown as Question;
  const d = dezoomConfig(q);
  return (
    <div className="space-y-4">
      <ImageField value={question.image_url} onChange={(url) => onChange({ image_url: url })} />

      {question.type === 'dezoom' ? (
        <>
          {question.image_url && <FocusPicker src={question.image_url} x={d.focus_x} y={d.focus_y} onPick={(focus_x, focus_y) => set({ focus_x, focus_y })} />}
          <div className="grid sm:grid-cols-2 gap-4">
            <Range name="Zoom at the start" value={d.start_zoom} min={1.5} max={20} step={0.5} shown={`${d.start_zoom}×`}
              onChange={(v) => set({ start_zoom: v, end_zoom: Math.min(d.end_zoom, v) })} />
            <Range name="Zoom at the end" value={d.end_zoom} min={1} max={d.start_zoom} step={0.5} shown={`${d.end_zoom}×`}
              onChange={(v) => set({ end_zoom: v })} />
          </div>
        </>
      ) : (
        <BlockySettings question={question} set={set} />
      )}

      {question.image_url && <Preview question={question} />}

      <AcceptedAnswers answers={question.open_answers} onChange={(open_answers) => onChange({ open_answers })} />
    </div>
  );
}
