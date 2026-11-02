import {
  supabase,
  generateRoomCode,
  addGuestQuizId,
  getGuestQuizToken,
  getGuestSession,
  type Quiz,
  type Session,
  type Player,
} from '@/lib/supabase';

export type ApiError = { message: string; code?: string };

const hostKey = (sessionId: string) => `truemaquiz_host_${sessionId}`;
const hostCodeKey = (sessionId: string) => `truemaquiz_hostcode_${sessionId}`;
const playerKey = (sessionId: string) => `truemaquiz_ptoken_${sessionId}`;
const playerCodeKey = (sessionId: string) => `truemaquiz_pcode_${sessionId}`;

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
export const getPlayerLobbyCode = (sessionId: string) => read('session', playerCodeKey(sessionId));

export async function getHostCode(sessionId: string): Promise<string | null> {
  const saved = read('local', hostCodeKey(sessionId));
  if (saved) return saved;
  const token = getHostToken(sessionId);
  if (!token) return null;
  const { data } = await supabase.rpc('host_get_code', { p_session_id: sessionId, p_host_token: token });
  if (typeof data === 'string') {
    write('local', hostCodeKey(sessionId), data);
    return data;
  }
  return null;
}

// ─── sessions ─────────────────────────────────────────────────────────────────

export async function createSession(quizId: string): Promise<{ session: Session | null; error: ApiError | null }> {
  let lastError: ApiError | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await supabase.rpc('create_session', { p_quiz_id: quizId, p_code: generateRoomCode() });
    if (!error && data) {
      const result = data as { session: Session; host_token: string; code: string };
      write('local', hostKey(result.session.id), result.host_token);
      write('local', hostCodeKey(result.session.id), result.code);
      return { session: result.session, error: null };
    }
    lastError = error;
    if (error?.code !== '23505') break;
  }
  return { session: null, error: lastError };
}

export async function getSessionByCode(code: string): Promise<{ id: string; status: Session['status'] } | null> {
  const { data } = await supabase.rpc('get_session_by_code', { p_code: code });
  return (data as { id: string; status: Session['status'] } | null) ?? null;
}

export async function joinSession(
  code: string,
  nickname: string
): Promise<{ player: Player | null; sessionId: string | null; error: ApiError | null }> {
  const { data, error } = await supabase.rpc('join_session_by_code', { p_code: code, p_nickname: nickname });
  if (error || !data) return { player: null, sessionId: null, error };
  const result = data as { player: Player; token: string; session_id: string };
  write('session', playerKey(result.session_id), result.token);
  write('session', playerCodeKey(result.session_id), code.toUpperCase());
  return { player: result.player, sessionId: result.session_id, error: null };
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

// ─── quizzes ──────────────────────────────────────────────────────────────────

export async function createQuiz(
  title: string,
  description: string | null
): Promise<{ quiz: Quiz | null; error: ApiError | null }> {
  const guest = getGuestSession();
  const { data, error } = await supabase.rpc('create_quiz', {
    p_title: title,
    p_description: description,
    p_created_by: guest?.nickname ?? null,
  });
  if (error || !data) return { quiz: null, error };
  const result = data as { quiz: Quiz; token: string | null };
  if (guest && result.token) addGuestQuizId(result.quiz.id, result.token);
  return { quiz: result.quiz, error: null };
}

export type QuizMeta = { title: string; description: string; cover_image_url: string };

export async function saveQuiz(
  quizId: string,
  meta: QuizMeta,
  questions: Record<string, unknown>[]
): Promise<{ error: ApiError | null }> {
  const { error } = await supabase.rpc('save_quiz', {
    p_quiz_id: quizId,
    p_token: getGuestQuizToken(quizId),
    p_meta: meta,
    p_questions: questions,
  });
  return { error };
}

export async function deleteQuiz(quizId: string, token: string | null = getGuestQuizToken(quizId)): Promise<{ error: ApiError | null }> {
  const { error } = await supabase.rpc('delete_quiz', { p_quiz_id: quizId, p_token: token });
  return { error };
}

export async function setQuizPublic(quizId: string, isPublic: boolean): Promise<{ error: ApiError | null }> {
  const { error } = await supabase.rpc('set_quiz_public', { p_quiz_id: quizId, p_public: isPublic });
  return { error };
}
