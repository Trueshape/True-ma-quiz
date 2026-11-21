import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asRole, createDb } from './helpers/db';
import { blockyConfig, blockyTotal, computeBlanksPoints, computeRevealPoints, parseBlanks, revealFactor } from '@/lib/reveal';
import { decayStartMs, timeFactor, type Question } from '@/lib/supabase';

type Json = Record<string, any>;

let db: PGlite;

const asAnon = <T,>(fn: () => Promise<T>) => asRole(db, 'anon', {}, fn);
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

const dezoom = {
  type: 'dezoom', prompt: 'Chi è?', options: [], image_url: 'https://x.test/a.jpg', open_answers: ['Colosseo', 'Colosseum'],
  time_limit_ms: 20000, points_value: 1000, reveal_config: { start_zoom: 10, end_zoom: 1, focus_x: 0.3, focus_y: 0.6 },
};
const blocky = {
  type: 'blocky', prompt: 'Cosa è?', options: [], image_url: 'https://x.test/b.jpg', open_answers: ['Torre Eiffel'],
  time_limit_ms: 30000, points_value: 1000, reveal_config: { grid: 4, tiles_per_step: 2, step_ms: 3000, order: 'spiral', style: 'pixel' },
};
const blanks = {
  type: 'blanks', prompt: 'La capitale della {{Francia|France}} è {{Parigi}} e quella della {{Spagna}} è {{Madrid}}', options: [],
  time_limit_ms: 20000, points_value: 1000, reveal_config: { hint: 'first' },
};

describe('scoring of dezoom, blocky and blanks on the server', () => {
  let quizId: string;
  let token: string;
  let sessionId: string;
  let hostToken: string;
  const players: Json[] = [];

  const host = (status: string, index: number | null, timer = false) =>
    asAnon(() => call('host_update_session', [sessionId, hostToken, status, index, timer, false, false, false]));
  // Pretends the question started `ms` milliseconds ago.
  const startedAgo = (ms: number) =>
    db.query(`update sessions set question_started_at = clock_timestamp() - make_interval(secs => $2::numeric / 1000) where id = $1`, [sessionId, ms]);
  const answer = (p: Json, text: string | null, blankTexts: string[] | null = null) =>
    asAnon(() => call('submit_answer', [sessionId, p.player.id, p.token, null, null, null, text, blankTexts]));

  beforeAll(async () => {
    db = await createDb();
    const created = await asAnon(() => call('create_quiz', ['Nuovi tipi', null, 'G']));
    quizId = created.quiz.id;
    token = created.token;
    await asAnon(() => call('save_quiz', [quizId, token, { title: 'Nuovi tipi' }, [dezoom, blocky, blanks]]));
    const s = await asAnon(() => call('create_session', [quizId, 'REV234']));
    sessionId = s.session.id;
    hostToken = s.host_token;
    for (const name of ['Ann', 'Bob', 'Cy', 'Dee', 'Eve']) players.push(await asAnon(() => call('join_session_by_code', ['REV234', name])));
  }, 120000);

  it('saves the settings of each type', async () => {
    const res = await db.query<{ type: string; reveal_config: Json }>(`select type, reveal_config from questions where quiz_id = $1 order by position`, [quizId]);
    expect(res.rows.map((r) => r.type)).toEqual(['dezoom', 'blocky', 'blanks']);
    expect(res.rows[1].reveal_config).toEqual(blocky.reveal_config);
  });

  it('dezoom: earlier right answers get more points, wrong ones none', async () => {
    await host('question', 0, true);
    const cases: [Json, string, number][] = [[players[0], 'colosseo', 1000], [players[1], 'Colloseum', 10000], [players[2], 'Pantheon', 4000]];
    for (const [p, text, ago] of cases) {
      await startedAgo(ago);
      const r = await answer(p, text);
      const expected = computeRevealPoints({ ...dezoom, reveal_config: dezoom.reveal_config } as unknown as Question, text, ago);
      expect(r.is_correct).toBe(expected.isCorrect);
      expect(Math.abs(r.points - expected.points)).toBeLessThanOrEqual(15);
    }
    const pts = await db.query<{ points: number }>(`select points from answers where session_id = $1 and question_index = 0 order by points desc`, [sessionId]);
    expect(pts.rows[0].points).toBeGreaterThan(pts.rows[1].points);
    expect(pts.rows[2].points).toBe(0);
  });

  it('dezoom: a right answer at the very end still gets 10%', async () => {
    await startedAgo(20000);
    const r = await answer(players[3], 'Colosseo');
    expect(r.points).toBe(100);
  });

  it('dezoom: an empty answer is refused', async () => {
    expect(await failure(answer(players[4], '   '))).toContain('invalid_answer');
  });

  it('blocky: points follow the number of squares already shown', async () => {
    await host('question', 1, true);
    // 16 squares, 2 every 3 s: at 0 s none, at 7 s four (25%), at 30 s twenty (all 16)
    for (const [p, ago, expected] of [[players[0], 500, 1000], [players[1], 7000, 750], [players[2], 29000, 100]] as [Json, number, number][]) {
      await startedAgo(ago);
      const r = await answer(p, 'torre eifel');
      expect(r.points).toBe(expected);
      expect(computeRevealPoints(blocky as unknown as Question, 'torre eifel', ago).points).toBe(expected);
    }
  });

  it('blanks: each right gap is worth its share, with the time factor', async () => {
    await host('question', 2, true);
    const cases: [Json, string[], number][] = [
      [players[0], ['france', 'Parigi', 'spagna', 'madrid'], 1000],
      [players[1], ['Francia', 'Lione', 'Spagna', ''], 2000],
      [players[2], ['Francia', 'Parigi', 'Spagna', 'Madrid'], 11500],
    ];
    for (const [p, texts, ago] of cases) {
      await startedAgo(ago);
      const r = await answer(p, null, texts);
      const expected = computeBlanksPoints(blanks as unknown as Question, texts, ago);
      expect(r.is_correct).toBe(expected.isCorrect);
      expect(Math.abs(r.points - expected.points)).toBeLessThanOrEqual(1);
    }
    const stored = await db.query<{ blank_texts: string[]; points: number }>(
      `select blank_texts, points from answers where session_id = $1 and question_index = 2 order by answered_at`, [sessionId]
    );
    expect(stored.rows[0]).toEqual({ blank_texts: ['france', 'Parigi', 'spagna', 'madrid'], points: 1000 });
    expect(stored.rows[1].points).toBe(500);
  });

  it('blanks: more than 5 texts or none are refused', async () => {
    expect(await failure(answer(players[3], null, ['a', 'b', 'c', 'd', 'e', 'f']))).toContain('invalid_answer');
    expect(await failure(answer(players[3], null, null))).toContain('invalid_answer');
  });

  it('old clients that send seven arguments still work', async () => {
    await host('question', 0, true);
    const r = await asAnon(() => call('submit_answer', [sessionId, players[4].player.id, players[4].token, null, null, null, 'Colosseo']));
    expect(r.is_correct).toBe(true);
  });
});

describe('saving blanks questions', () => {
  let quizId: string;
  let token: string;
  beforeAll(async () => {
    db = await createDb();
    const created = await asAnon(() => call('create_quiz', ['Blanks', null, 'G']));
    quizId = created.quiz.id;
    token = created.token;
  }, 120000);

  const save = (prompt: string) =>
    asAnon(() => call('save_quiz', [quizId, token, { title: 'Blanks' }, [{ ...blanks, prompt }]]));

  it('accepts 1 to 5 gaps', async () => {
    expect((await save('Uno {{a}}')).count).toBe(1);
    expect((await save('{{a}} {{b}} {{c}} {{d}} {{e|E}}')).count).toBe(1);
  });

  it('refuses a sentence without gaps, with more than 5, or with an empty gap', async () => {
    expect(await failure(save('Nessun buco'))).toContain('invalid_questions');
    expect(await failure(save('{{a}} {{b}} {{c}} {{d}} {{e}} {{f}}'))).toContain('invalid_questions');
    expect(await failure(save('Vuoto {{ | }}'))).toContain('invalid_questions');
  });

  it('reads the gaps the same way as the editor', async () => {
    const prompt = 'A {{ uno | one }} b {{due}}{{tre|3}} fine';
    const res = await db.query<{ accepted: string[] }>(`select accepted from g_blank_answers($1) order by idx`, [prompt]);
    expect(res.rows.map((r) => r.accepted)).toEqual(parseBlanks(prompt).answers);
  });
});

describe('points going down and square tiles: the server matches the TypeScript', () => {
  beforeAll(async () => {
    db = await createDb();
  }, 120000);

  const configs: Record<string, unknown>[] = [
    {},
    { grid: 5, tiles_per_step: 2, step_ms: 1500 },
    { tiles: 40 },
    { tiles: 36, cols: 4, rows: 9, tiles_per_step: 5, step_ms: 3000 },
    { tiles: 999, cols: 30, rows: 2, tiles_per_step: 0, step_ms: 99999 },
  ];

  it.each(configs.map((c) => [JSON.stringify(c), c]))('tiles counted for %s', async (_name, c) => {
    const res = await db.query<{ n: number }>(`select g_blocky_total($1::jsonb) as n`, [JSON.stringify(c)]);
    expect(res.rows[0].n).toBe(blockyTotal(blockyConfig({ reveal_config: c as never })));
  });

  const cases: [string, Record<string, unknown>, number | null, number][] = [];
  for (const type of ['dezoom', 'blocky']) {
    for (const c of configs) {
      for (const start of [null, 0, 4000, 10000, 20000, 30000]) {
        for (const taken of [0, 3000, 4500, 9000, 15000, 19999, 22000]) cases.push([type, c, start, taken]);
      }
    }
  }

  it(`reveal points in ${cases.length} cases`, async () => {
    for (const [type, c, start, taken] of cases) {
      const question = { type, reveal_config: c, time_limit_ms: 20000, points_decay_start_ms: start } as unknown as Question;
      const res = await db.query<{ f: string }>(
        `select g_reveal_factor($1, $2::jsonb, 20000, $3, g_decay_start($1, $4)) as f`,
        [type, JSON.stringify(c), taken, start]
      );
      expect(Number(res.rows[0].f), `${type} ${JSON.stringify(c)} start=${start} taken=${taken}`).toBeCloseTo(revealFactor(question, taken), 6);
    }
  });

  it.each([
    ['mc', null, 2000], ['mc', null, 11500], ['open', 10000, 15000], ['blanks', 20000, 19000], ['mc', 25000, 22000],
    ['slider', null, 15000], ['slider', 10000, 15000], ['reorder', 0, 5000],
  ] as [string, number | null, number][])('time factor for %s with start %s at %i ms', async (type, start, taken) => {
    const res = await db.query<{ f: string }>(`select g_tf($1, 20000, g_decay_start($2, $3)) as f`, [taken, type, start]);
    const s = decayStartMs({ type, points_decay_start_ms: start } as Question);
    expect(Number(res.rows[0].f)).toBeCloseTo(s == null ? 1 : timeFactor(taken, 20000, s), 6);
  });
});

describe('shuffled answers and solution pictures are saved', () => {
  it('stores both settings, and old clients that do not send them get the defaults', async () => {
    db = await createDb();
    const created = await asAnon(() => call('create_quiz', ['Shuffle', null, 'G']));
    const mcq = { type: 'mc', prompt: '?', options: ['a', 'b', 'c'], correct_index: 2, time_limit_ms: 20000, points_value: 1000 };
    await asAnon(() =>
      call('save_quiz', [created.quiz.id, created.token, { title: 'Shuffle' }, [
        { ...mcq, shuffle_options: true, solution_image_url: ' https://x.test/s.jpg ' },
        mcq,
      ]])
    );
    const res = await db.query<{ shuffle_options: boolean; solution_image_url: string | null }>(
      `select shuffle_options, solution_image_url from questions where quiz_id = $1 order by position`, [created.quiz.id]
    );
    expect(res.rows).toEqual([
      { shuffle_options: true, solution_image_url: 'https://x.test/s.jpg' },
      { shuffle_options: false, solution_image_url: null },
    ]);
  });
});
