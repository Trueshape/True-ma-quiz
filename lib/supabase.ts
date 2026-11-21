import { createClient } from '@supabase/supabase-js';
import type { RevealConfig } from '@/lib/reveal';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// Database types
export type Quiz = {
  id: string;
  title: string;
  description: string | null;
  cover_image_url: string | null;
  created_by: string | null;
  created_at: string;
  is_public?: boolean;
  is_guest?: boolean;
  owner_id?: string | null;
  tags?: string[];
};

// Guest session stored in sessionStorage — cleared when tab closes
export type GuestSession = {
  nickname: string;
  quizIds: string[]; // IDs of guest quizzes inserted in Supabase for this session
  quizTokens: Record<string, string>; // secret edit token of each guest quiz
};

const GUEST_KEY = 'truemaquiz_guest';

export function getGuestSession(): GuestSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(GUEST_KEY);
    return raw ? (JSON.parse(raw) as GuestSession) : null;
  } catch {
    return null;
  }
}

export function setGuestSession(session: GuestSession): void {
  sessionStorage.setItem(GUEST_KEY, JSON.stringify(session));
}

export function clearGuestSession(): void {
  sessionStorage.removeItem(GUEST_KEY);
}

export function addGuestQuizId(quizId: string, token: string): void {
  const session = getGuestSession();
  if (!session) return;
  if (!session.quizIds.includes(quizId)) session.quizIds.push(quizId);
  session.quizTokens = { ...session.quizTokens, [quizId]: token };
  setGuestSession(session);
}

export function getGuestQuizToken(quizId: string): string | null {
  return getGuestSession()?.quizTokens?.[quizId] ?? null;
}

export function removeGuestQuizId(quizId: string): void {
  const session = getGuestSession();
  if (!session) return;
  session.quizIds = session.quizIds.filter((id) => id !== quizId);
  const { [quizId]: _removed, ...tokens } = session.quizTokens ?? {};
  session.quizTokens = tokens;
  setGuestSession(session);
}

export type QuestionType = 'mc' | 'tf' | 'info' | 'slider' | 'reorder' | 'open' | 'dezoom' | 'blocky' | 'blanks';

export type Question = {
  id: string;
  quiz_id: string;
  position: number;
  type: QuestionType;
  prompt: string;
  options: string[];
  correct_index: number;
  image_url: string | null;
  video_url: string | null;
  video_start_ms: number | null;
  video_hidden: boolean;
  video_volume: number;
  audio_url: string | null;
  audio_volume: number;
  audio_start_ms: number | null;
  audio_hidden: boolean;
  time_limit_ms: number;
  slider_min: number | null;
  slider_max: number | null;
  slider_answer: number | null;
  reorder_correct_order: number[] | null;
  reorder_item_images: string[] | null;
  open_answers: string[] | null;
  points_value: number;
  info_image_position: 'top' | 'bottom' | 'left' | 'right' | null;
  /** Settings of the dezoom, blocky and blanks types (see lib/reveal.ts). */
  reveal_config: RevealConfig | null;
  /** When points start going down (ms). null = the type's usual rule, see decayStartMs. */
  points_decay_start_ms: number | null;
  /** Multiple choice: show the options in a different order in each game. */
  shuffle_options: boolean;
  /** Optional picture shown with the solution. */
  solution_image_url: string | null;
  /** Set only on this device after shuffling: original index of each option shown. */
  option_order?: number[];
  created_at: string;
};

export type SessionStatus = 'lobby' | 'question' | 'leaderboard' | 'finished';

export type Session = {
  id: string;
  quiz_id: string;
  code: string;
  status: SessionStatus;
  current_question_index: number;
  question_started_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

export type Player = {
  id: string;
  session_id: string;
  nickname: string;
  score: number;
  last_answered_index: number | null;
  joined_at: string;
};

export type Answer = {
  id: string;
  session_id: string;
  player_id: string;
  question_id: string;
  question_index: number;
  chosen_index: number;
  slider_value: number | null;
  reorder_order: number[] | null;
  open_text: string | null;
  blank_texts: string[] | null;
  is_correct: boolean;
  time_taken_ms: number;
  points: number;
  answered_at: string;
};

// Time factor: returns 1.0 for the first `gracePeriodMs`, then decays linearly to 0 at `timeLimitMs`.
// A grace period as long as the time limit (or longer) means points never go down.
export function timeFactor(timeTakenMs: number, timeLimitMs: number, gracePeriodMs: number): number {
  if (timeTakenMs <= gracePeriodMs || gracePeriodMs >= timeLimitMs) return 1.0;
  const afterGrace = Math.min(timeTakenMs, timeLimitMs) - gracePeriodMs;
  const window = Math.max(1, timeLimitMs - gracePeriodMs);
  return Math.max(0, 1.0 - (afterGrace / window));
}

/**
 * When points start going down, in ms from the start of the question. The creator can set it
 * for each question; otherwise each type keeps its usual rule: 3 s of full points, from the
 * start for de-zoom and blocky, and never for slider and reorder. null = never.
 */
export function decayStartMs(q: Pick<Question, 'type' | 'points_decay_start_ms'>): number | null {
  if (q.points_decay_start_ms != null) return q.points_decay_start_ms;
  if (q.type === 'slider' || q.type === 'reorder') return null;
  if (q.type === 'dezoom' || q.type === 'blocky') return 0;
  return 3000;
}

// MC / TF scoring: 0 for wrong; maxPoints × timeFactor for correct.
// Full points if answered within the first `decayStart` ms, then decays linearly to 0 at time limit.
export function computePoints(isCorrect: boolean, timeTakenMs: number, timeLimitMs: number, maxPoints: number = 1000, decayStart: number = 3000): number {
  if (!isCorrect) return 0;
  return Math.round(maxPoints * timeFactor(timeTakenMs, timeLimitMs, decayStart));
}

// Slider scoring: proximityFraction = 1 − (|guess − answer| / range), so exact = 1.0, worst edge = 0.
// Time only counts when the creator set when points start going down (decayStart not null).
export function computeSliderPoints(guess: number, answer: number, min: number, max: number, maxPoints: number = 1000, timeTakenMs: number = 0, timeLimitMs: number = 30000, decayStart: number | null = null): number {
  const range = max - min;
  const proximityFraction = range <= 0
    ? (guess === answer ? 1 : 0)
    : Math.max(0, 1 - Math.abs(guess - answer) / range);
  const tf = decayStart == null ? 1 : timeFactor(timeTakenMs, timeLimitMs, decayStart);
  return Math.round(maxPoints * proximityFraction * tf);
}

// Reorder scoring: the fraction of items in the correct position.
// Time only counts when the creator set when points start going down (decayStart not null).
export function computeReorderPoints(userOrder: number[], correctOrder: number[], maxPoints: number = 1000, timeTakenMs: number = 0, timeLimitMs: number = 30000, decayStart: number | null = null): number {
  if (userOrder.length === 0 || correctOrder.length === 0) return 0;
  const correctCount = userOrder.filter((val, i) => val === correctOrder[i]).length;
  const correctFraction = correctCount / correctOrder.length;
  const tf = decayStart == null ? 1 : timeFactor(timeTakenMs, timeLimitMs, decayStart);
  return Math.round(maxPoints * correctFraction * tf);
}

// Normalize a string for fuzzy comparison: lowercase, trim, remove accents, collapse spaces.
function normalizeString(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ');
}

// Levenshtein distance between two strings.
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

// Similarity ratio (0 to 1) between two strings using Levenshtein distance.
function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// Open answer scoring: similarity × timeFactor × maxPoints.
// Similarity ≥ 0.8 counts as correct. Full points if similarity = 1 and answered within 3s.
export function computeOpenPoints(
  userAnswer: string,
  acceptedAnswers: string[],
  maxPoints: number = 1000,
  timeTakenMs: number = 0,
  timeLimitMs: number = 30000,
  decayStart: number = 3000
): { points: number; isCorrect: boolean; similarity: number } {
  if (!userAnswer.trim() || acceptedAnswers.length === 0) {
    return { points: 0, isCorrect: false, similarity: 0 };
  }
  const normalizedUser = normalizeString(userAnswer);
  let bestSim = 0;
  let isCorrect = false;
  for (const ans of acceptedAnswers) {
    const normalizedAns = normalizeString(ans);
    if (!normalizedAns) continue;
    const sim = similarity(normalizedUser, normalizedAns);
    if (sim > bestSim) bestSim = sim;
    const threshold = normalizedAns.length < 6 ? 1 : 0.8;
    if (sim >= threshold) isCorrect = true;
  }
  const tf = timeFactor(timeTakenMs, timeLimitMs, decayStart);
  const points = isCorrect ? Math.round(maxPoints * tf) : 0;
  return { points, isCorrect, similarity: bestSim };
}

export function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}
