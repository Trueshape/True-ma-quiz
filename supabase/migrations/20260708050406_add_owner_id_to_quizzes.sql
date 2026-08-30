/*
# Add owner_id to quizzes and tighten RLS for ownership

1. Modified Tables
- `quizzes`
  - Added `owner_id` column (uuid, nullable, references auth.users, ON DELETE SET NULL).
  - Defaults to `auth.uid()` so inserts by authenticated users auto-populate the owner.
2. Security
- RLS already enabled on `quizzes`.
- SELECT: kept open to `anon, authenticated` (anyone can browse/play quizzes).
- INSERT: now requires `TO authenticated` with `WITH CHECK (auth.uid() = owner_id)` — only logged-in users can create quizzes, and the owner must be themselves.
- UPDATE: now requires `TO authenticated` with `USING (auth.uid() = owner_id)` — only the owner can edit their quizzes.
- DELETE: now requires `TO authenticated` with `USING (auth.uid() = owner_id)` — only the owner can delete their quizzes.
3. Notes
- The `created_by` text column is kept for backward compatibility (stores the display nickname).
- `owner_id` is nullable so existing quizzes (created before auth) remain accessible.
- The anon role loses INSERT/UPDATE/DELETE on quizzes — this is intentional: creating, editing, and deleting quizzes now requires an authenticated session.
*/

ALTER TABLE quizzes
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE quizzes ALTER COLUMN owner_id SET DEFAULT auth.uid();

-- Drop old open policies for INSERT/UPDATE/DELETE
DROP POLICY IF EXISTS "anon_insert_quizzes" ON quizzes;
DROP POLICY IF EXISTS "anon_update_quizzes" ON quizzes;
DROP POLICY IF EXISTS "anon_delete_quizzes" ON quizzes;

-- SELECT stays open: anyone (including anon) can browse and play quizzes
DROP POLICY IF EXISTS "anon_select_quizzes" ON quizzes;
CREATE POLICY "anon_select_quizzes" ON quizzes FOR SELECT
  TO anon, authenticated USING (true);

-- INSERT: only authenticated users, owner must be themselves
CREATE POLICY "auth_insert_quizzes" ON quizzes FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = owner_id);

-- UPDATE: only the owner can edit
CREATE POLICY "auth_update_quizzes" ON quizzes FOR UPDATE
  TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);

-- DELETE: only the owner can delete
CREATE POLICY "auth_delete_quizzes" ON quizzes FOR DELETE
  TO authenticated USING (auth.uid() = owner_id);
