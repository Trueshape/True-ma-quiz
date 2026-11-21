import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asRole, createDb } from './helpers/db';
import { computeMultiPoints } from '@/lib/supabase';

type Json = Record<string, any>;

let db: PGlite;
const asAnon = <T,>(fn: () => Promise<T>) => asRole(db, 'anon', {}, fn);
const asUser = <T,>(id: string, fn: () => Promise<T>) => asRole(db, 'authenticated', { sub: id }, fn);
const call = async (fn: string, args: unknown[] = []): Promise<any> => {
  const params = args.map((_, i) => `$${i + 1}`).join(',');
  const res = await db.query<{ r: any }>(`select ${fn}(${params}) as r`, args as any[]);
  return res.rows[0].r;
};
const failure = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e: any) {
    return `${e.code ?? ''} ${e.message}`;
  }
  return 'no error';
};

const OWNER = '11111111-0000-4000-8000-000000000001';
const NIL = '00000000-0000-0000-0000-000000000000';

describe('a game with statistics and several right answers', () => {
  let quizId: string;
  let sessionId: string;
  let hostToken: string;
  const players: Json[] = [];

  const host = (status: string, index: number | null, timer = false, finished = false) =>
    asAnon(() => call('host_update_session', [sessionId, hostToken, status, index, timer, !timer ? false : true, finished, false]));
  const answer = (p: Json, chosen: number | null, open: string | null = null, chosenMany: number[] | null = null) =>
    asAnon(() => call('submit_answer', [sessionId, p.player.id, p.token, chosen, null, null, open, null, chosenMany]));

  beforeAll(async () => {
    db = await createDb();
    await db.query(`insert into auth.users(id, email, raw_user_meta_data) values ($1, 'o@x.test', '{"nickname":"Owner1"}')`, [OWNER]);
    const created = await asUser(OWNER, () => call('create_quiz', ['Stats', null, null]));
    quizId = created.quiz.id;
    await asUser(OWNER, () =>
      call('save_quiz', [quizId, null, { title: 'Stats' }, [
        { type: 'mc', prompt: 'Capitale?', options: ['Roma', 'Parigi', 'Berlino'], correct_index: 0, time_limit_ms: 20000, points_value: 1000 },
        { type: 'open', prompt: 'Fiume?', options: [], open_answers: ['Tevere'], time_limit_ms: 20000, points_value: 1000 },
        { type: 'mc', prompt: 'Pari?', options: ['2', '3', '4', '5'], correct_index: 0, correct_indices: [2, 0, 9, 0], time_limit_ms: 20000, points_value: 1000 },
      ]])
    );
    const s = await asUser(OWNER, () => call('create_session', [quizId, 'STA234']));
    sessionId = s.session.id;
    hostToken = s.host_token;
    for (const n of ['Ann', 'Bob', 'Cy', 'Dee']) players.push(await asAnon(() => call('join_session_by_code', ['STA234', n])));
  }, 120000);

  it('keeps only valid, unique right answers, sorted', async () => {
    const res = await db.query<{ correct_indices: number[] | null }>(`select correct_indices from questions where quiz_id = $1 order by position`, [quizId]);
    expect(res.rows.map((r) => r.correct_indices)).toEqual([null, null, [0, 2]]);
  });

  it('several right answers: shares for right picks, minus wrong picks, same as the TypeScript', async () => {
    await host('question', 0, true);
    await answer(players[0], 0);
    await answer(players[1], 2);
    await answer(players[2], 2);
    await answer(players[3], 1);
    await host('question', 1, true);
    await answer(players[0], null, 'tevere');
    await answer(players[1], null, 'Arno');
    await answer(players[2], null, ' arno ');
    await host('question', 2, true);
    const cases: [Json, number[]][] = [[players[0], [0, 2]], [players[1], [0]], [players[2], [0, 1]], [players[3], [1, 3]]];
    for (const [p, picks] of cases) {
      const r = await answer(p, null, null, picks);
      const expected = computeMultiPoints(picks, [0, 2], 1000, 0, 20000);
      expect(r.is_correct).toBe(expected.isCorrect);
      expect(Math.abs(r.points - expected.points)).toBeLessThanOrEqual(1);
    }
    const stored = await db.query<{ chosen_indices: number[]; points: number }>(
      `select chosen_indices, points from answers where session_id = $1 and question_index = 2 order by answered_at`, [sessionId]
    );
    expect(stored.rows.map((r) => r.points)).toEqual([1000, 500, 0, 0]);
    expect(stored.rows[0].chosen_indices).toEqual([0, 2]);
  });

  it('several right answers: an empty pick is refused', async () => {
    const extra = await db.query<{ id: string }>(`insert into players(session_id, nickname) values ($1, 'Eve') returning id`, [sessionId]);
    await db.query(`insert into player_secrets(player_id, token) values ($1, $2)`, [extra.rows[0].id, NIL]);
    const err = await failure(asAnon(() => call('submit_answer', [sessionId, extra.rows[0].id, NIL, null, null, null, null, null, []])));
    expect(err).toContain('invalid_answer');
  });

  it('the host sees, for each question, how many got it right and the most chosen wrong answer', async () => {
    const stats = await asAnon(() => call('host_game_stats', [sessionId, hostToken]));
    expect(stats.map((s: Json) => [s.question_index, s.answered, s.correct, s.players, s.top_wrong, s.top_wrong_count])).toEqual([
      [0, 4, 1, 5, 'Berlino', 2],
      [1, 3, 1, 5, 'arno', 2],
      [2, 4, 1, 5, null, null],
    ]);
  });

  it('only the host can read the game statistics', async () => {
    expect(await failure(asAnon(() => call('host_game_stats', [sessionId, NIL])))).toContain('invalid_host');
  });

  it('the author sees games, players, average score and the hardest question', async () => {
    await host('finished', null, false, true);
    const stats = await asUser(OWNER, () => call('quiz_stats', [quizId, null]));
    expect(stats).toMatchObject({ games: 1, players: 5 });
    expect(stats.average_score).toBeGreaterThan(0);
    expect(stats.hardest).toMatchObject({ prompt: 'Capitale?', answered: 4, correct: 1 });
  });

  it('nobody else can read the author statistics', async () => {
    expect(await failure(asAnon(() => call('quiz_stats', [quizId, null])))).toContain('not_allowed');
    expect(await failure(asUser('22222222-0000-4000-8000-000000000002', () => call('quiz_stats', [quizId, null])))).toContain('not_allowed');
  });
});

describe('password recovery codes', () => {
  const ANN = 'aaaaaaaa-0000-4000-8000-00000000000a';
  const GOO = 'bbbbbbbb-0000-4000-8000-00000000000b';
  const password = () => db.query<{ p: string }>(`select encrypted_password as p from auth.users where id = $1`, [ANN]).then((r) => r.rows[0].p);

  beforeAll(async () => {
    db = await createDb();
    await db.query(
      `insert into auth.users(id, email, encrypted_password, raw_user_meta_data) values
         ($1, 'annarossi@truemaquiz.local', 'old-hash', '{"nickname":"AnnaRossi"}'),
         ($2, 'gio@gmail.test', '', '{}')`,
      [ANN, GOO]
    );
    await asUser(GOO, () => call('set_profile', ['GioGoogle']));
  }, 120000);

  it('a password account gets a readable code; a Google account cannot', async () => {
    const code = await asUser(ANN, () => call('create_recovery_code'));
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(await asUser(ANN, () => call('has_recovery_code'))).toBe(true);
    expect(await asUser(GOO, () => failure(call('create_recovery_code')))).toContain('no_password');
    expect(await asAnon(() => failure(call('create_recovery_code')))).toContain('permission denied');
  });

  it('the code is stored hashed and nobody can read the table', async () => {
    const raw = await db.query<{ code_hash: string }>(`select code_hash from account_recovery where user_id = $1`, [ANN]);
    expect(raw.rows[0].code_hash).not.toMatch(/^[A-Z0-9-]{14}$/);
    expect(await asAnon(() => failure(db.query('select * from account_recovery')))).toContain('permission denied');
    expect(await asUser(ANN, () => failure(db.query('select * from account_recovery')))).toContain('permission denied');
  });

  it('nickname + code set a new password once; spaces, dashes and case do not matter', async () => {
    const code: string = await asUser(ANN, () => call('create_recovery_code'));
    const loose = ' ' + code.toLowerCase().replace(/-/g, ' ') + ' ';
    expect(await asAnon(() => call('reset_password_with_code', ['annarossi', loose, 'short']))).toEqual({ ok: false, error: 'invalid_password' });
    expect(await asAnon(() => call('reset_password_with_code', ['annarossi', loose, 'nuova-password-1']))).toEqual({ ok: true });
    expect(await password()).not.toBe('old-hash');
    expect(await asAnon(() => call('reset_password_with_code', ['annarossi', loose, 'altra-password-2']))).toEqual({ ok: false, error: 'invalid_code' });
  });

  it('a wrong code or an unknown nickname say the same thing; 5 wrong codes lock it for a while', async () => {
    const code: string = await asUser(ANN, () => call('create_recovery_code'));
    expect(await asAnon(() => call('reset_password_with_code', ['nessuno', code, 'password-123']))).toEqual({ ok: false, error: 'invalid_code' });
    for (let i = 0; i < 5; i++) {
      expect(await asAnon(() => call('reset_password_with_code', ['AnnaRossi', 'AAAA-AAAA-AAAA', 'password-123']))).toEqual({ ok: false, error: 'invalid_code' });
    }
    expect(await asAnon(() => call('reset_password_with_code', ['AnnaRossi', code, 'password-123']))).toEqual({ ok: false, error: 'too_many_attempts' });
    await db.query(`update account_recovery set locked_until = now() - interval '1 minute'`);
    expect(await asAnon(() => call('reset_password_with_code', ['AnnaRossi', code, 'password-123']))).toEqual({ ok: true });
  });

  it('tells the sign-in form when an account now signs in with its own email', async () => {
    expect(await asAnon(() => call('nickname_uses_email', ['AnnaRossi']))).toBe(false);
    await db.query(`update auth.users set email = 'anna@mail.test' where id = $1`, [ANN]);
    expect(await asAnon(() => call('nickname_uses_email', ['annarossi']))).toBe(true);
    expect(await asAnon(() => call('nickname_uses_email', ['GioGoogle']))).toBe(false);
  });
});
