import { computeOpenPoints, timeFactor, type Question } from '@/lib/supabase';

/*
  Shared rules of the three "reveal" style question types. The SQL in
  supabase/migrations/20261123090000_reveal_and_blank_questions.sql mirrors the scoring.

  - dezoom: an image starts zoomed in on a point and zooms out during the question
  - blocky: an image split into grid x grid squares, hidden squares are pixelated or
            blurred, `tiles_per_step` squares appear every `step_ms`
  - blanks: a sentence with up to 5 gaps written as {{answer|other accepted answer}}

  Dezoom and blocky answers are typed and matched like open answers. Their points
  depend on how much of the image was visible when the player answered.
*/

export type DezoomConfig = { start_zoom: number; end_zoom: number; focus_x: number; focus_y: number };
export type BlockyOrder = 'random' | 'spiral' | 'edges';
export type BlockyStyle = 'pixel' | 'blur';
export type BlockyConfig = { grid: number; tiles_per_step: number; step_ms: number; order: BlockyOrder; style: BlockyStyle };
export type BlanksHint = 'none' | 'length' | 'first';
export type BlanksConfig = { hint: BlanksHint };
export type RevealConfig = Partial<DezoomConfig & BlockyConfig & BlanksConfig>;

export const MAX_BLANKS = 5;
export const MIN_REVEAL_FACTOR = 0.1;

type WithConfig = Pick<Question, 'reveal_config'>;

const num = (v: unknown, def: number, min: number, max: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : def;
  return Math.min(max, Math.max(min, n));
};

export function dezoomConfig(q: WithConfig): DezoomConfig {
  const c = q.reveal_config ?? {};
  const start_zoom = num(c.start_zoom, 8, 1, 20);
  return {
    start_zoom,
    end_zoom: num(c.end_zoom, 1, 1, start_zoom),
    focus_x: num(c.focus_x, 0.5, 0, 1),
    focus_y: num(c.focus_y, 0.5, 0, 1),
  };
}

export function blockyConfig(q: WithConfig): BlockyConfig {
  const c = q.reveal_config ?? {};
  const grid = Math.round(num(c.grid, 6, 2, 12));
  return {
    grid,
    tiles_per_step: Math.round(num(c.tiles_per_step, 3, 1, grid * grid)),
    step_ms: Math.round(num(c.step_ms, 2000, 500, 30000)),
    order: c.order === 'spiral' || c.order === 'edges' ? c.order : 'random',
    style: c.style === 'blur' ? 'blur' : 'pixel',
  };
}

export function blanksConfig(q: WithConfig): BlanksConfig {
  const h = q.reveal_config?.hint;
  return { hint: h === 'length' || h === 'first' ? h : 'none' };
}

/** Settings a new question of this type starts with. */
export function defaultRevealConfig(type: string): RevealConfig {
  if (type === 'dezoom') return dezoomConfig({ reveal_config: null });
  if (type === 'blocky') return blockyConfig({ reveal_config: null });
  if (type === 'blanks') return blanksConfig({ reveal_config: null });
  return {};
}

/** How many squares of a blocky image are visible after `elapsedMs`. */
export function revealedTiles(c: BlockyConfig, elapsedMs: number): number {
  return Math.min(c.grid * c.grid, c.tiles_per_step * Math.floor(Math.max(0, elapsedMs) / c.step_ms));
}

/** 0 = nothing revealed yet, 1 = the whole image is visible. */
export function revealProgress(q: WithConfig & Pick<Question, 'type' | 'time_limit_ms'>, elapsedMs: number): number {
  if (q.type === 'dezoom') return Math.min(1, Math.max(0, elapsedMs) / Math.max(1, q.time_limit_ms));
  if (q.type === 'blocky') {
    const c = blockyConfig(q);
    return revealedTiles(c, elapsedMs) / (c.grid * c.grid);
  }
  return 0;
}

/** Zoom level of a dezoom image: geometric, so the zoom out looks steady. */
export function dezoomLevel(c: DezoomConfig, progress: number): number {
  return c.start_zoom * Math.pow(c.end_zoom / c.start_zoom, Math.min(1, Math.max(0, progress)));
}

// Small seeded random generator, so the host and every player see the same order.
function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Order in which the squares appear: indexes 0..grid²-1, row by row. */
export function tileOrder(grid: number, order: BlockyOrder, seed: string): number[] {
  const rand = seeded(seed);
  const tiles = Array.from({ length: grid * grid }, (_, i) => ({ i, r: rand() }));
  const mid = (grid - 1) / 2;
  const dist = (i: number) => Math.max(Math.abs((i % grid) - mid), Math.abs(Math.floor(i / grid) - mid));
  if (order === 'random') tiles.sort((a, b) => a.r - b.r);
  else if (order === 'spiral') tiles.sort((a, b) => dist(a.i) - dist(b.i) || a.r - b.r);
  else tiles.sort((a, b) => dist(b.i) - dist(a.i) || a.r - b.r);
  return tiles.map((t) => t.i);
}

/** Points for a dezoom or blocky answer: full points before anything is revealed, at least 10% at the end. */
export function computeRevealPoints(
  q: WithConfig & Pick<Question, 'type' | 'time_limit_ms' | 'points_value' | 'open_answers'>,
  text: string,
  elapsedMs: number
): { points: number; isCorrect: boolean } {
  const { isCorrect } = computeOpenPoints(text, q.open_answers ?? []);
  if (!isCorrect) return { points: 0, isCorrect };
  const factor = Math.max(MIN_REVEAL_FACTOR, 1 - revealProgress(q, elapsedMs));
  return { points: Math.round(q.points_value * factor), isCorrect };
}

export type BlankSentence = { parts: (string | number)[]; answers: string[][] };

/** Splits "Rome is in {{Italy|Italia}}" into text parts and numbered gaps. */
export function parseBlanks(prompt: string): BlankSentence {
  const parts: (string | number)[] = [];
  const answers: string[][] = [];
  let last = 0;
  const re = /\{\{([^{}]*)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt))) {
    if (m.index > last) parts.push(prompt.slice(last, m.index));
    parts.push(answers.length);
    answers.push(m[1].split('|').map((a) => a.trim()).filter(Boolean));
    last = m.index + m[0].length;
  }
  if (last < prompt.length) parts.push(prompt.slice(last));
  return { parts, answers };
}

/** The sentence as players see it, with gaps shown as ____. */
export function blankPrompt(prompt: string): string {
  return parseBlanks(prompt).parts.map((p) => (typeof p === 'number' ? '____' : p)).join('');
}

/** Hint shown inside a gap: nothing, the length (_ _ _) or the first letter (R _ _ _). */
export function blankHint(answers: string[], hint: BlanksHint): string {
  const word = answers[0] ?? '';
  if (hint === 'none' || !word) return '';
  const chars = Array.from(word).map((ch, i) => (ch === ' ' ? ' ' : hint === 'first' && i === 0 ? ch : '_'));
  return chars.join(' ');
}

/** Each gap is matched like an open answer. Points: share of right gaps, faster is better. */
export function computeBlanksPoints(
  q: Pick<Question, 'prompt' | 'points_value' | 'time_limit_ms'>,
  texts: string[],
  elapsedMs: number
): { points: number; isCorrect: boolean; right: boolean[] } {
  const { answers } = parseBlanks(q.prompt);
  const gaps = answers.slice(0, MAX_BLANKS);
  if (gaps.length === 0) return { points: 0, isCorrect: false, right: [] };
  const right = gaps.map((accepted, i) => computeOpenPoints(texts[i] ?? '', accepted).isCorrect);
  const share = right.filter(Boolean).length / gaps.length;
  // Same time factor as the other types: full points for 3 seconds, then down to 0.
  return { points: Math.round(q.points_value * share * timeFactor(elapsedMs, q.time_limit_ms, 3000)), isCorrect: right.every(Boolean), right };
}
export const isRevealType = (t: string) => t === 'dezoom' || t === 'blocky';
export const isNewType = (t: string) => t === 'dezoom' || t === 'blocky' || t === 'blanks';
