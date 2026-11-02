import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';

const migrationsDir = path.resolve(__dirname, '../../supabase/migrations');

export async function createDb(options: { upTo?: string } = {}): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE PUBLICATION supabase_realtime;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT coalesce(NULLIF(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    CREATE TABLE auth.users (id uuid primary key);
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
  `);
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (options.upTo && file > options.upTo) break;
    await db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  return db;
}

export async function asRole<T>(db: PGlite, role: 'anon' | 'authenticated', claims: { sub?: string; nickname?: string }, fn: () => Promise<T>): Promise<T> {
  await db.exec(`SET ROLE ${role}`);
  const jwt = claims.sub ? JSON.stringify({ sub: claims.sub, user_metadata: { nickname: claims.nickname } }) : '';
  await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [claims.sub ?? '', jwt]);
  try {
    return await fn();
  } finally {
    await db.exec(`RESET ROLE`);
  }
}
