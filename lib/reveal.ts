import { computeOpenPoints, decayStartMs, timeFactor, type Question } from '@/lib/supabase';
import { seededRandom } from '@/lib/seeded';

/*
  Shared rules of the three "reveal" style question types. The SQL in
  supabase/migrations/20261124090000_points_decay_and_square_tiles.sql mirrors the scoring.

  - dezoom: an image starts zoomed in on a point and zooms out during the question
  - blocky: an image split into square tiles (cols x rows, about `tiles` in total), hidden
            tiles are pixelated or blurred, `tiles_per_step` tiles appear every `step_ms`
  - blanks: a sentence with up to 5 gaps written as {{answer|other accepted answer}}, with
            an optional hint and one more letter every `letter_every_ms`

  Dezoom and blocky answers are typed and matched like open answers. Their points
  depend on how much of the image was visible when the player answered.
*/

export type DezoomConfig = { start_zoom: number; end_zoom: number; focus_x: number; focus_y: number };
export type BlockyOrder = 'random' | 'spiral' | 'edges';
export type BlockyStyle = 'pixel' | 'blur' | 'solid' | 'shuffle' | 'cards' | 'noise';
export const BLOCKY_STYLES: BlockyStyle[] = ['pixel', 'blur', 'solid', 'shuffle', 'cards', 'noise'];
export type BlockyConfig = {
  /** Tiles the creator asked for. */
  tiles: number;
  /** Columns and rows chosen for the picture so the tiles are square (null until the picture is known). */
  cols: number | null;
  rows: number | null;
  tiles_per_step: number;
  step_ms: number;
  order: BlockyOrder;
  style: BlockyStyle;
  /** Blur strength, 1 (light) to 5 (strong). */
  blur: number;
};
export type BlanksHint = 'none' | 'length' | 'first';
export type BlanksConfig = { hint: BlanksHint; letter_every_ms: number };
export type RevealConfig = Partial<DezoomConfig & Omit<BlockyConfig, 'cols' | 'rows'> & BlanksConfig> & {
  cols?: number;
  rows?: number;
  /** Older blocky questions: squares per side. */
  grid?: number;
};

export const MAX_BLANKS = 5;
export const MIN_REVEAL_FACTOR = 0.1;
export const MIN_TILES = 4;
export const MAX_TILES = 144;

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
  const legacy = Math.round(num(c.grid, 6, 2, 12));
  const tiles = Math.round(num(c.tiles, legacy * legacy, MIN_TILES, MAX_TILES));
  const known = typeof c.cols === 'number' && typeof c.rows === 'number';
  const cols = known ? Math.round(num(c.cols, 1, 1, 24)) : c.grid != null ? legacy : null;
  const rows = known ? Math.round(num(c.rows, 1, 1, 24)) : c.grid != null ? legacy : null;
  const total = cols != null && rows != null ? cols * rows : tiles;
  return {
    tiles,
    cols,
    rows,
    tiles_per_step: Math.round(num(c.tiles_per_step, 3, 1, total)),
    step_ms: Math.round(num(c.step_ms, 2000, 500, 30000)),
    order: c.order === 'spiral' || c.order === 'edges' ? c.order : 'random',
    style: BLOCKY_STYLES.includes(c.style as BlockyStyle) ? (c.style as BlockyStyle) : 'pixel',
    blur: Math.round(num(c.blur, 3, 1, 5)),
  };
}

/** Tiles used for the points: the real grid once known, otherwise the number asked for. */
export function blockyTotal(c: BlockyConfig): number {
  return c.cols != null && c.rows != null ? c.cols * c.rows : c.tiles;
}

/** Columns and rows that cut a w x h picture into about `tiles` square tiles. */
export function squareGrid(tiles: number, w: number, h: number): { cols: number; rows: number } {
  const cols = Math.min(24, Math.max(1, Math.round(Math.sqrt((tiles * w) / Math.max(1, h)))));
  const rows = Math.min(24, Math.max(1, Math.round(tiles / cols)));
  return { cols, rows };
}

export function blanksConfig(q: WithConfig): BlanksConfig {
  const c = q.reveal_config ?? {};
  const h = c.hint;
  const every = num(c.letter_every_ms, 0, 0, 60000);
  return { hint: h === 'length' || h === 'first' ? h : 'none', letter_every_ms: every < 1000 ? 0 : Math.round(every) };
}

/** Settings a new question of this type starts with. */
export function defaultRevealConfig(type: string): RevealConfig {
  if (type === 'dezoom') return dezoomConfig({ reveal_config: null });
  if (type === 'blocky') {
    const { cols: _c, rows: _r, ...rest } = blockyConfig({ reveal_config: null });
    return rest;
  }
  if (type === 'blanks') return blanksConfig({ reveal_config: null });
  return {};
}

/** How many tiles of a blocky image are visible after `elapsedMs`, out of `total`. */
export function revealedTiles(c: BlockyConfig, elapsedMs: number, total = blockyTotal(c)): number {
  return Math.min(total, c.tiles_per_step * Math.floor(Math.max(0, elapsedMs) / c.step_ms));
}

/** 0 = nothing revealed yet, 1 = the whole image is visible. */
export function revealProgress(q: WithConfig & Pick<Question, 'type' | 'time_limit_ms'>, elapsedMs: number): number {
  if (q.type === 'dezoom') return Math.min(1, Math.max(0, elapsedMs) / Math.max(1, q.time_limit_ms));
  if (q.type === 'blocky') {
    const c = blockyConfig(q);
    return revealedTiles(c, elapsedMs) / blockyTotal(c);
  }
  return 0;
}

/** Zoom level of a dezoom image: geometric, so the zoom out looks steady. */
export function dezoomLevel(c: DezoomConfig, progress: number): number {
  return c.start_zoom * Math.pow(c.end_zoom / c.start_zoom, Math.min(1, Math.max(0, progress)));
}

/** Order in which the tiles appear: indexes 0..cols*rows-1, row by row. Same seed, same order everywhere. */
export function tileOrder(cols: number, rows: number, order: BlockyOrder, seed: string): number[] {
  const rand = seededRandom(seed);
  const tiles = Array.from({ length: cols * rows }, (_, i) => ({ i, r: rand() }));
  const midC = (cols - 1) / 2;
  const midR = (rows - 1) / 2;
  const dist = (i: number) => Math.max(Math.abs((i % cols) - midC), Math.abs(Math.floor(i / cols) - midR));
  if (order === 'random') tiles.sort((a, b) => a.r - b.r);
  else if (order === 'spiral') tiles.sort((a, b) => dist(a.i) - dist(b.i) || a.r - b.r);
  else tiles.sort((a, b) => dist(b.i) - dist(a.i) || a.r - b.r);
  return tiles.map((t) => t.i);
}

/**
 * Share of the points a right dezoom or blocky answer still earns: full points until the
 * points start going down, then less as more of the picture shows, at least 10%.
 */
export function revealFactor(q: WithConfig & Pick<Question, 'type' | 'time_limit_ms' | 'points_decay_start_ms'>, elapsedMs: number): number {
  const start = decayStartMs(q) ?? q.time_limit_ms;
  if (elapsedMs <= start || start >= q.time_limit_ms) return 1;
  const atStart = revealProgress(q, start);
  if (atStart >= 1) return 1;
  return Math.max(MIN_REVEAL_FACTOR, (1 - revealProgress(q, elapsedMs)) / (1 - atStart));
}

/** Points for a dezoom or blocky answer. */
export function computeRevealPoints(
  q: WithConfig & Pick<Question, 'type' | 'time_limit_ms' | 'points_value' | 'open_answers' | 'points_decay_start_ms'>,
  text: string,
  elapsedMs: number
): { points: number; isCorrect: boolean } {
  const { isCorrect } = computeOpenPoints(text, q.open_answers ?? []);
  if (!isCorrect) return { points: 0, isCorrect };
  return { points: Math.round(q.points_value * revealFactor(q, elapsedMs)), isCorrect };
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

/**
 * Hint shown inside a gap: nothing, the length (_ _ _) or the first letter (R _ _ _), plus
 * `extraLetters` more letters from the left. The last letter is never given away.
 */
export function blankHint(answers: string[], hint: BlanksHint, extraLetters = 0): string {
  const chars = Array.from(answers[0] ?? '');
  const letters = chars.filter((ch) => ch !== ' ').length;
  const shown = Math.min(Math.max(0, letters - 1), (hint === 'first' ? 1 : 0) + extraLetters);
  if (!chars.length || (hint === 'none' && shown === 0)) return '';
  let seen = 0;
  return chars.map((ch) => (ch === ' ' ? ' ' : seen++ < shown ? ch : '_')).join(' ');
}

/** Extra letters given in each gap after `elapsedMs`. */
export function extraLetters(c: BlanksConfig, elapsedMs: number): number {
  return c.letter_every_ms > 0 ? Math.floor(Math.max(0, elapsedMs) / c.letter_every_ms) : 0;
}

/** Each gap is matched like an open answer. Points: share of right gaps, faster is better. */
export function computeBlanksPoints(
  q: Pick<Question, 'type' | 'prompt' | 'points_value' | 'time_limit_ms' | 'points_decay_start_ms'>,
  texts: string[],
  elapsedMs: number
): { points: number; isCorrect: boolean; right: boolean[] } {
  const { answers } = parseBlanks(q.prompt);
  const gaps = answers.slice(0, MAX_BLANKS);
  if (gaps.length === 0) return { points: 0, isCorrect: false, right: [] };
  const right = gaps.map((accepted, i) => computeOpenPoints(texts[i] ?? '', accepted).isCorrect);
  const share = right.filter(Boolean).length / gaps.length;
  const tf = timeFactor(elapsedMs, q.time_limit_ms, decayStartMs(q) ?? q.time_limit_ms);
  return { points: Math.round(q.points_value * share * tf), isCorrect: right.every(Boolean), right };
}

export const isRevealType = (t: string) => t === 'dezoom' || t === 'blocky';
export const isNewType = (t: string) => t === 'dezoom' || t === 'blocky' || t === 'blanks';
