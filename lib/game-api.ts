import { supabase, generateRoomCode, type Session, type Player } from '@/lib/supabase';

export type ApiError = { message: string; code?: string };

const hostKey = (sessionId: string) => `truemaquiz_host_${sessionId}`;
const playerKey = (sessionId: string) => `truemaquiz_ptoken_${sessionId}`;

function read(store: 'local' | 'session', key: string): string | null {
  try {
    return (store === 'local' ? localStorage : sessionStorage).getItem(key);
  } catch {
    return null;
  }
}

function write(store: 'local' | 'session', key: string, value: string): void {
  try {
    (store === 'local' ? localStorage : sessionStorage).setItem(key, value);
  } catch {
    // storage unavailable (private mode): the game still works for this tab
  }
}

export const getHostToken = (sessionId: string) => read('local', hostKey(sessionId));
export const getPlayerToken = (sessionId: string) => read('session', playerKey(sessionId));

export async function createSession(quizId: string): Promise<{ session: Session | null; error: ApiError | null }> {
  let lastError: ApiError | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await supabase.rpc('create_session', { p_quiz_id: quizId, p_code: generateRoomCode() });
    if (!error && data) {
      const result = data as { session: Session; host_token: string };
      write('local', hostKey(result.session.id), result.host_token);
      return { session: result.session, error: null };
    }
    lastError = error;
    if (error?.code !== '23505') break;
  }
  return { session: null, error: lastError };
}

export async function joinSession(
  sessionId: string,
  nickname: string
): Promise<{ player: Player | null; error: ApiError | null }> {
  const { data, error } = await supabase.rpc('join_session', { p_session_id: sessionId, p_nickname: nickname });
  if (error || !data) return { player: null, error };
  const result = data as { player: Player; token: string };
  write('session', playerKey(sessionId), result.token);
  return { player: result.player, error: null };
}

export type AnswerPayload = {
  chosenIndex?: number;
  sliderValue?: number;
  reorderOrder?: number[];
  openText?: string;
};

export type AnswerResult = { points: number; is_correct: boolean; score: number };

export async function submitAnswer(
  sessionId: string,
  playerId: string,
  answer: AnswerPayload
): Promise<{ result: AnswerResult | null; error: ApiError | null }> {
  const token = getPlayerToken(sessionId);
  if (!token) return { result: null, error: { message: 'invalid_player', code: '42501' } };
  const { data, error } = await supabase.rpc('submit_answer', {
    p_session_id: sessionId,
    p_player_id: playerId,
    p_token: token,
    p_chosen_index: answer.chosenIndex ?? null,
    p_slider_value: answer.sliderValue ?? null,
    p_reorder_order: answer.reorderOrder ?? null,
    p_open_text: answer.openText ?? null,
  });
  if (error || !data) return { result: null, error };
  return { result: data as AnswerResult, error: null };
}

export type HostUpdate = {
  status: Session['status'];
  questionIndex?: number;
  startTimer?: boolean;
  setStarted?: boolean;
  setFinished?: boolean;
  reset?: boolean;
};

export async function hostUpdate(sessionId: string, update: HostUpdate): Promise<{ error: ApiError | null }> {
  const token = getHostToken(sessionId);
  if (!token) return { error: { message: 'invalid_host', code: '42501' } };
  const { error } = await supabase.rpc('host_update_session', {
    p_session_id: sessionId,
    p_host_token: token,
    p_status: update.status,
    p_question_index: update.questionIndex ?? null,
    p_start_timer: update.startTimer ?? false,
    p_set_started: update.setStarted ?? false,
    p_set_finished: update.setFinished ?? false,
    p_reset: update.reset ?? false,
  });
  return { error };
}
