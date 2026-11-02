import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asRole, createDb } from './helpers/db';
import { computeOpenPoints, computePoints } from '@/lib/supabase';

type Json = Record<string, any>;

const ANON = {};
const ALICE = { sub: '11111111-1111-1111-1111-111111111111', nickname: 'alice' };
const BOB = { sub: '22222222-2222-2222-2222-222222222222', nickname: 'bob' };
const NIL = '00000000-0000-0000-0000-000000000000';

let db: PGlite;

const asAnon = <T,>(fn: () => Promise<T>) => asRole(db, 'anon', ANON, fn);
const asUser = <T,>(user: typeof ALICE, fn: () => Promise<T>) => asRole(db, 'authenticated', user, fn);
const call = async (fn: string, args: unknown[] = []): Promise<Json> => {
  const params = args.map((_, i) => `$${i + 1}`).join(',');
  const res = await db.query<{ r: Json }>(`select ${fn}(${params}) as r`, args as any[]);
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

const mcQuestion = (prompt: string, correct = 1) => ({
  type: 'mc', prompt, options: ['a', 'b', 'c'], correct_index: correct, time_limit_ms: 20000, points_value: 1000,
});
const gameQuestions = () => [
  mcQuestion('mc?'),
  { type: 'slider', prompt: 's?', options: [], slider_min: 0, slider_max: 100, slider_answer: 40, time_limit_ms: 20000, points_value: 1000 },
  { type: 'reorder', prompt: 'r?', options: ['x', 'y', 'z'], reorder_correct_order: [0, 1, 2], time_limit_ms: 20000, points_value: 1000 },
  { type: 'open', prompt: 'o?', options: [], open_answers: ['Roma'], time_limit_ms: 20000, points_value: 1000 },
  { type: 'info', prompt: 'i', options: [], time_limit_ms: 0, points_value: 0 },
];

beforeAll(async () => {
  db = await createDb();
  await db.query('insert into auth.users(id) values ($1), ($2)', [ALICE.sub, BOB.sub]);
}, 120000);

describe('scoring on the server matches the TypeScript used in practice mode', () => {
  const pairs: [string, string[]][] = [
    ['roma', ['Roma']], ['Rama', ['Roma']], ['Milano', ['Roma']], ['elefante', ['Elefante']],
    ['elefant', ['Elefante']], ['citta', ['città']], ['Parigi!', ['Parigi']], ['parigii', ['Parigi']],
    ['  Napoli ', ['napoli', 'Naples']], ['New York', ['new  york']], ['abcdef', ['abcdez']],
    ['abcdefgh', ['abcdefzz']], ['x', ['x']],
  ];
  it.each(pairs)('open answer %j against %j', async (user, accepted) => {
    const res = await db.query<{ ok: boolean }>(
      `select exists(select 1 from unnest($2::text[]) a
         where g_norm(a) <> ''
           and g_sim(g_norm($1), g_norm(a)) >= case when length(g_norm(a)) < 6 then 1 else 0.8 end) as ok`,
      [user, accepted]
    );
    expect(res.rows[0].ok).toBe(computeOpenPoints(user, accepted, 1000, 1000, 30000).isCorrect);
  });

  it.each([[0, 20000], [2999, 20000], [3000, 20000], [3001, 20000], [11500, 20000], [20000, 20000], [30000, 20000], [5000, 5000]])(
    'time factor for %i ms of %i ms',
    async (taken, limit) => {
      const res = await db.query<{ p: number }>(`select round(1000 * g_time_factor($1, $2, 3000))::int as p`, [taken, limit]);
      expect(Math.abs(res.rows[0].p - computePoints(true, taken, limit, 1000))).toBeLessThanOrEqual(1);
    }
  );
});

describe('guest quizzes', () => {
  let quizId: string;
  let token: string;

  it('a guest creates a quiz and gets a secret token', async () => {
    const res = await asAnon(() => call('create_quiz', ['Guest quiz', 'desc', 'Guest-42']));
    quizId = res.quiz.id;
    token = res.token;
    expect(res.quiz.is_guest).toBe(true);
    expect(res.quiz.created_by).toBe('Guest-42');
    expect(token).toBeTruthy();
  });

  it('the token is not readable by clients', async () => {
    const err = await asAnon(() => failure(db.query('select * from quiz_secrets')));
    expect(err).toContain('permission denied');
  });

  it('another guest cannot save or delete the quiz', async () => {
    const save = await asAnon(() => failure(call('save_quiz', [quizId, NIL, { title: 'Hacked' }, []])));
    const del = await asAnon(() => failure(call('delete_quiz', [quizId, NIL])));
    expect(save).toContain('not_allowed');
    expect(del).toContain('not_allowed');
  });

  it('direct writes are blocked', async () => {
    const upd = await asAnon(() => failure(db.query(`update quizzes set title='x' where id=$1`, [quizId])));
    const del = await asAnon(() => failure(db.query(`delete from quizzes where id=$1`, [quizId])));
    const ins = await asAnon(() => failure(db.query(`insert into quizzes(title,is_guest) values ('x', true)`)));
    expect(upd).toContain('permission denied');
    expect(del).toContain('permission denied');
    expect(ins).toContain('permission denied');
  });

  it('the creator can save with the token', async () => {
    const res = await asAnon(() => call('save_quiz', [quizId, token, { title: 'Renamed', description: 'd' }, gameQuestions()]));
    expect(res.count).toBe(5);
    const row = await db.query<{ title: string }>(`select title from quizzes where id=$1`, [quizId]);
    expect(row.rows[0].title).toBe('Renamed');
  });

  it('a failed save changes nothing', async () => {
    const before = await db.query<{ n: string }>(`select count(*)::text as n from questions where quiz_id=$1`, [quizId]);
    const bad = [mcQuestion('fine'), { type: 'not-a-real-type', prompt: 'boom', options: [] }];
    const err = await asAnon(() => failure(call('save_quiz', [quizId, token, { title: 'Broken' }, bad])));
    expect(err).not.toBe('no error');
    const after = await db.query<{ n: string }>(`select count(*)::text as n from questions where quiz_id=$1`, [quizId]);
    const title = await db.query<{ title: string }>(`select title from quizzes where id=$1`, [quizId]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
    expect(title.rows[0].title).toBe('Renamed');
  });

  it('saving keeps the ids of questions that stay, so past answers survive', async () => {
    const ids = await db.query<{ id: string; prompt: string }>(`select id, prompt from questions where quiz_id=$1 order by position`, [quizId]);
    const kept = ids.rows.slice(0, 2).map((q, i) => ({ ...gameQuestions()[i], id: q.id }));
    await asAnon(() => call('save_quiz', [quizId, token, { title: 'Renamed' }, [...kept, mcQuestion('new one')]]));
    const after = await db.query<{ id: string; prompt: string }>(`select id, prompt from questions where quiz_id=$1 order by position`, [quizId]);
    expect(after.rows).toHaveLength(3);
    expect(after.rows[0].id).toBe(ids.rows[0].id);
    expect(after.rows[1].id).toBe(ids.rows[1].id);
    expect(after.rows[2].prompt).toBe('new one');
  });

  it('too many questions are refused', async () => {
    const many = Array.from({ length: 101 }, (_, i) => mcQuestion(`q${i}`));
    const err = await asAnon(() => failure(call('save_quiz', [quizId, token, { title: 'Big' }, many])));
    expect(err).toContain('invalid_questions');
  });

  it('only the token holder can delete', async () => {
    await asAnon(() => call('delete_quiz', [quizId, token]));
    const left = await db.query(`select 1 from quizzes where id=$1`, [quizId]);
    expect(left.rows).toHaveLength(0);
  });
});

describe('quizzes owned by an account', () => {
  let quizId: string;

  it('the author name comes from the account, not from the client', async () => {
    const res = await asUser(ALICE, () => call('create_quiz', ['Alice quiz', null, 'someone-else']));
    quizId = res.quiz.id;
    expect(res.quiz.created_by).toBe('alice');
    expect(res.quiz.owner_id).toBe(ALICE.sub);
    expect(res.token).toBeNull();
  });

  it('another account cannot edit, delete or publish it', async () => {
    const save = await asUser(BOB, () => failure(call('save_quiz', [quizId, null, { title: 'x' }, []])));
    const del = await asUser(BOB, () => failure(call('delete_quiz', [quizId, null])));
    const pub = await asUser(BOB, () => failure(call('set_quiz_public', [quizId, true])));
    expect(save).toContain('not_allowed');
    expect(del).toContain('not_allowed');
    expect(pub).toContain('not_allowed');
  });

  it('a guest cannot publish', async () => {
    const err = await asAnon(() => failure(call('set_quiz_public', [quizId, true])));
    expect(err).toContain('permission denied');
  });

  it('the owner can save and publish; anyone can then read it', async () => {
    await asUser(ALICE, () => call('save_quiz', [quizId, null, { title: 'Alice quiz' }, [mcQuestion('hi')]]));
    await asUser(ALICE, () => call('set_quiz_public', [quizId, true]));
    const seen = await asAnon(() => db.query(`select id from quizzes where id=$1`, [quizId]));
    expect(seen.rows).toHaveLength(1);
  });

  it('a private quiz is hidden from others', async () => {
    const res = await asUser(ALICE, () => call('create_quiz', ['Private', null, null]));
    const seen = await asUser(BOB, () => db.query(`select id from quizzes where id=$1`, [res.quiz.id]));
    expect(seen.rows).toHaveLength(0);
  });
});

describe('a live game', () => {
  let quizId: string;
  let token: string;
  let sessionId: string;
  let hostToken: string;
  let code: string;
  let ann: Json;
  let bob: Json;

  const host = (status: string, index: number | null, flags: Json = {}) =>
    asAnon(() =>
      call('host_update_session', [sessionId, flags.token ?? hostToken, status, index, !!flags.timer, !!flags.started, !!flags.finished, !!flags.reset])
    );
  const answer = (player: Json, ...args: unknown[]) =>
    asAnon(() =>
      call('submit_answer', [sessionId, player.player.id, player.token, args[0] ?? null, args[1] ?? null, args[2] ?? null, args[3] ?? null])
    );

  beforeAll(async () => {
    const created = await asAnon(() => call('create_quiz', ['Game quiz', null, 'G']));
    quizId = created.quiz.id;
    token = created.token;
    await asAnon(() => call('save_quiz', [quizId, token, { title: 'Game quiz' }, gameQuestions()]));
    const s = await asAnon(() => call('create_session', [quizId, 'ABC234']));
    sessionId = s.session.id;
    hostToken = s.host_token;
    code = s.code;
    ann = await asAnon(() => call('join_session_by_code', [code, 'Ann']));
    bob = await asAnon(() => call('join_session_by_code', ['abc234', 'Bob']));
  });

  it('the lobby code is not stored in any table clients can read', async () => {
    const sessions = await asAnon(() => db.query<{ code: string | null }>(`select code from sessions where id=$1`, [sessionId]));
    expect(sessions.rows[0].code).toBeNull();
    const err = await asAnon(() => failure(db.query('select * from session_codes')));
    expect(err).toContain('permission denied');
  });

  it('a lobby is found by code, and joining needs the code', async () => {
    const found = await asAnon(() => call('get_session_by_code', ['abc234']));
    expect(found).toEqual({ id: sessionId, status: 'lobby' });
    expect(await asAnon(() => call('get_session_by_code', ['ZZZ999']))).toBeNull();
    const direct = await asAnon(() => failure(call('join_session', [sessionId, 'Eve'])));
    expect(direct).toContain('permission denied');
    expect(await asAnon(() => failure(call('join_session_by_code', ['ZZZ999', 'Eve'])))).toContain('session_not_found');
  });

  it('only the host can read the code back', async () => {
    expect(await asAnon(() => call('host_get_code', [sessionId, hostToken]))).toBe('ABC234');
    expect(await asAnon(() => failure(call('host_get_code', [sessionId, NIL])))).toContain('invalid_host');
  });

  it('nicknames are unique and trimmed', async () => {
    expect(await asAnon(() => failure(call('join_session_by_code', [code, 'Ann'])))).toContain('23505');
    expect(await asAnon(() => failure(call('join_session_by_code', [code, '   '])))).toContain('invalid_nickname');
  });

  it('a lobby holds at most 200 players', async () => {
    await db.query(
      `insert into players(session_id, nickname) select $1, 'bot' || g from generate_series(1, 198) g`,
      [sessionId]
    );
    expect(await asAnon(() => failure(call('join_session_by_code', [code, 'TooMany'])))).toContain('lobby_full');
    await db.query(`delete from players where nickname like 'bot%'`);
  });

  it('answers are refused before the game starts and with bad tokens', async () => {
    expect(await failure(answer(ann, 1))).toContain('not_accepting_answers');
    expect(await asAnon(() => failure(host('question', 0, { token: NIL, timer: true })))).toContain('invalid_host');
    await host('question', 0, { timer: true, started: true });
    const forged = await asAnon(() => failure(call('submit_answer', [sessionId, ann.player.id, NIL, 1, null, null, null])));
    expect(forged).toContain('invalid_player');
    const stolen = await asAnon(() => failure(call('submit_answer', [sessionId, bob.player.id, ann.token, 1, null, null, null])));
    expect(stolen).toContain('invalid_player');
  });

  it('scores each question type on the server', async () => {
    let r = await answer(ann, 1);
    expect(r.is_correct).toBe(true);
    expect(r.points).toBeGreaterThanOrEqual(990);
    expect(await failure(answer(ann, 1))).toContain('23505');
    await host('question', 1, { timer: true });
    r = await answer(ann, null, 40);
    expect(r).toMatchObject({ is_correct: true, points: 1000 });
    await host('question', 2, { timer: true });
    r = await answer(ann, null, null, [0, 2, 1]);
    expect(r).toMatchObject({ is_correct: false, points: 333 });
    await host('question', 3, { timer: true });
    r = await answer(ann, null, null, null, 'ROMA');
    expect(r.is_correct).toBe(true);
    r = await answer(bob, null, null, null, 'Milano');
    expect(r).toMatchObject({ is_correct: false, points: 0 });
    await host('question', 4, { timer: true });
    expect(await failure(answer(ann, 0))).toContain('not_accepting_answers');
  });

  it('answers after the time limit are refused', async () => {
    await db.query(`update sessions set status='question', current_question_index=0, question_started_at = now() - interval '60 seconds' where id=$1`, [sessionId]);
    expect(await failure(answer(bob, 0))).toContain('too_late');
  });

  it('clients cannot write scores, sessions or answers directly', async () => {
    const queries = [
      [`update players set score = 999999 where id = $1`, [ann.player.id]],
      [`delete from players where id = $1`, [ann.player.id]],
      [`update sessions set status = 'finished' where id = $1`, [sessionId]],
      [`insert into sessions(quiz_id) values ($1)`, [quizId]],
      [`delete from answers where session_id = $1`, [sessionId]],
    ] as const;
    for (const [sql, params] of queries) {
      expect(await asAnon(() => failure(db.query(sql, params as any)))).toContain('permission denied');
    }
  });

  it('answers of others are hidden while a question runs and shown afterwards', async () => {
    await db.query(`update sessions set status='question', question_started_at = now() where id=$1`, [sessionId]);
    expect((await asAnon(() => db.query(`select id from answers where session_id=$1`, [sessionId]))).rows).toHaveLength(0);
    await host('leaderboard', null);
    expect((await asAnon(() => db.query(`select id from answers where session_id=$1`, [sessionId]))).rows.length).toBeGreaterThan(0);
  });

  it('restart clears scores and answers, and a started game cannot be joined', async () => {
    await host('lobby', null, { reset: true });
    const scores = await db.query<{ s: string }>(`select coalesce(sum(score),0)::text as s from players where session_id=$1`, [sessionId]);
    expect(scores.rows[0].s).toBe('0');
    await host('question', 0, { timer: true, started: true });
    expect(await asAnon(() => failure(call('join_session_by_code', [code, 'Late'])))).toContain('game_started');
  });
});
