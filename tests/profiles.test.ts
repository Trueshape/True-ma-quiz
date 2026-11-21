import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { asRole, createDb } from './helpers/db';

type Json = Record<string, any>;

const ANN = '11111111-aaaa-4aaa-8aaa-111111111111';
const BEA = '22222222-bbbb-4bbb-8bbb-222222222222';
const GIO = '33333333-cccc-4ccc-8ccc-333333333333';
const HOST = 'https://example.supabase.co/storage/v1/object/public/avatars';

let db: PGlite;

const asAnon = <T,>(fn: () => Promise<T>) => asRole(db, 'anon', {}, fn);
const asUser = <T,>(id: string, fn: () => Promise<T>, nickname?: string) => asRole(db, 'authenticated', { sub: id, nickname }, fn);
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
const addUser = (id: string, meta: Json = {}) =>
  db.query(`insert into auth.users(id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)`, [id, `${id}@x.test`, JSON.stringify(meta)]);

describe('profiles and usernames', () => {
  beforeAll(async () => {
    db = await createDb();
    await addUser(ANN, { nickname: 'AnnaRossi' });
    await addUser(GIO, { full_name: 'Gio Google' });
    await addUser(BEA, {});
  });

  it('a nickname-and-password signup gets its profile automatically', async () => {
    const res = await db.query<{ nickname: string }>(`select nickname from profiles where user_id = $1`, [ANN]);
    expect(res.rows[0].nickname).toBe('AnnaRossi');
  });

  it('a signup without a nickname (Google) has no profile yet', async () => {
    const res = await db.query(`select 1 from profiles where user_id = $1`, [GIO]);
    expect(res.rows).toHaveLength(0);
  });

  it('a second signup with the same nickname, in any case, is refused', async () => {
    const err = await failure(addUser('44444444-dddd-4ddd-8ddd-444444444444', { nickname: 'annarossi' }));
    expect(err).toContain('duplicate key');
  });

  it('usernames are free or taken regardless of case, and must be 4 to 20 characters', async () => {
    expect(await asAnon(() => call('nickname_available', ['annarossi']))).toBe(false);
    expect(await asAnon(() => call('nickname_available', ['  ANNAROSSI  ']))).toBe(false);
    expect(await asAnon(() => call('nickname_available', ['Gio_Libero']))).toBe(true);
    expect(await asAnon(() => call('nickname_available', ['abc']))).toBe(false);
    expect(await asAnon(() => call('nickname_available', ['x'.repeat(21)]))).toBe(false);
  });

  it('the owner of a username still sees it as available for themselves', async () => {
    expect(await asUser(ANN, () => call('nickname_available', ['AnnaRossi']))).toBe(true);
    expect(await asUser(GIO, () => call('nickname_available', ['AnnaRossi']))).toBe(false);
  });

  it('only a signed-in user can set a profile', async () => {
    const err = await asAnon(() => failure(call('set_profile', ['Anonimo123'])));
    expect(err).toContain('permission denied');
  });

  it('a Google user chooses a username', async () => {
    const profile = await asUser(GIO, () => call('set_profile', ['GioMusic']));
    expect(profile).toMatchObject({ user_id: GIO, nickname: 'GioMusic', avatar_url: null });
  });

  it('refuses names that are too short, too long or already taken', async () => {
    expect(await asUser(GIO, () => failure(call('set_profile', ['abc'])))).toContain('invalid_nickname');
    expect(await asUser(GIO, () => failure(call('set_profile', ['x'.repeat(21)])))).toContain('invalid_nickname');
    expect(await asUser(GIO, () => failure(call('set_profile', ['ANNAROSSI'])))).toContain('nickname_taken');
    const kept = await db.query<{ nickname: string }>(`select nickname from profiles where user_id = $1`, [GIO]);
    expect(kept.rows[0].nickname).toBe('GioMusic');
  });

  it('a profile picture must be a public https URL of the user\'s own avatar file', async () => {
    const own = `${HOST}/${GIO}/avatar?v=1`;
    expect((await asUser(GIO, () => call('set_profile', ['GioMusic', own]))).avatar_url).toBe(own);
    expect(await asUser(GIO, () => failure(call('set_profile', ['GioMusic', `${HOST}/${ANN}/avatar`])))).toContain('invalid_avatar');
    expect(await asUser(GIO, () => failure(call('set_profile', ['GioMusic', `http://example.test/storage/v1/object/public/avatars/${GIO}/avatar`])))).toContain('invalid_avatar');
    expect(await asUser(GIO, () => failure(call('set_profile', ['GioMusic', 'https://evil.test/a.png'])))).toContain('invalid_avatar');
  });

  it('a null picture keeps the current one and an empty one removes it', async () => {
    const own = `${HOST}/${GIO}/avatar?v=2`;
    await asUser(GIO, () => call('set_profile', ['GioMusic', own]));
    expect((await asUser(GIO, () => call('set_profile', ['GioMusic2', null]))).avatar_url).toBe(own);
    expect((await asUser(GIO, () => call('set_profile', ['GioMusic', '']))).avatar_url).toBeNull();
  });

  it('profiles are public to read but cannot be written directly', async () => {
    const seen = await asAnon(() => db.query<{ nickname: string }>(`select nickname from profiles order by nickname`));
    expect(seen.rows.map((r) => r.nickname)).toEqual(['AnnaRossi', 'GioMusic']);
    const upd = await asUser(GIO, () => failure(db.query(`update profiles set nickname = 'Hacked1' where user_id = $1`, [GIO])));
    const del = await asUser(GIO, () => failure(db.query(`delete from profiles where user_id = $1`, [GIO])));
    const ins = await asUser(BEA, () => failure(db.query(`insert into profiles(user_id, nickname) values ($1, 'Sneaky12')`, [BEA])));
    expect([upd, del, ins].every((e) => e.includes('permission denied'))).toBe(true);
  });

  it('the author of a new quiz is the profile username, not a name in the token', async () => {
    const created = await asUser(GIO, () => call('create_quiz', ['Mio quiz', null, 'altro']), 'NomeFalso');
    expect(created.quiz.created_by).toBe('GioMusic');
  });

  it('an account without a profile falls back to the name in the token', async () => {
    const created = await asUser(BEA, () => call('create_quiz', ['Quiz di Bea', null, null]), 'Beatrice');
    expect(created.quiz.created_by).toBe('Beatrice');
  });
});

describe('profile pictures storage', () => {
  beforeAll(async () => {
    db = await createDb();
  });

  it('the avatars bucket is public, jpg and png only, 1 MB at most', async () => {
    const res = await db.query<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(
      `select public, file_size_limit::text, allowed_mime_types from storage.buckets where id = 'avatars'`
    );
    expect(res.rows[0]).toEqual({ public: true, file_size_limit: '1048576', allowed_mime_types: ['image/jpeg', 'image/png'] });
  });

  it('a user can add, replace and remove files only in their own folder', async () => {
    const add = (name: string) => db.query(`insert into storage.objects(bucket_id, name) values ('avatars', $1)`, [name]);
    await asUser(ANN, () => add(`${ANN}/avatar`));
    expect(await asUser(ANN, () => failure(add(`${BEA}/avatar`)))).toContain('row-level security');
    expect(await asUser(ANN, () => failure(add('avatar')))).toContain('row-level security');
    const upd = await asUser(BEA, () => db.query(`update storage.objects set name = $1 where name = $2`, [`${BEA}/avatar`, `${ANN}/avatar`]));
    expect(upd.affectedRows).toBe(0);
    const del = await asUser(BEA, () => db.query(`delete from storage.objects where name = $1`, [`${ANN}/avatar`]));
    expect(del.affectedRows).toBe(0);
    const own = await asUser(ANN, () => db.query(`delete from storage.objects where name = $1`, [`${ANN}/avatar`]));
    expect(own.affectedRows).toBe(1);
  });

  it('nobody signed out can add files', async () => {
    const err = await asAnon(() => failure(db.query(`insert into storage.objects(bucket_id, name) values ('avatars', $1)`, [`${ANN}/avatar`])));
    expect(err).toMatch(/row-level security|permission denied/);
  });

  it('other buckets are not touched by these rules', async () => {
    const err = await asUser(ANN, () => failure(db.query(`insert into storage.objects(bucket_id, name) values ('documents', $1)`, [`${ANN}/file`])));
    expect(err).toContain('row-level security');
  });
});

describe('accounts that exist before the migration', () => {
  it('keep their nickname, with duplicates and too short names skipped', async () => {
    const dir = path.resolve(__dirname, '../supabase/migrations');
    const profilesFile = fs.readdirSync(dir).find((f) => f.includes('profiles_and_avatars'))!;
    const before = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().filter((f) => f < profilesFile).pop()!;
    db = await createDb({ upTo: before });
    await addUser('aaaaaaaa-0000-4000-8000-000000000001', { nickname: 'Marco_V' });
    await addUser('aaaaaaaa-0000-4000-8000-000000000002', { nickname: 'marco_v' });
    await addUser('aaaaaaaa-0000-4000-8000-000000000003', { nickname: 'ab' });
    await addUser('aaaaaaaa-0000-4000-8000-000000000004', { full_name: 'Google' });
    await db.exec(fs.readFileSync(path.join(dir, profilesFile), 'utf8'));
    const res = await db.query<{ nickname: string }>(`select nickname from profiles order by nickname`);
    expect(res.rows).toEqual([{ nickname: 'Marco_V' }]);
  });
});
