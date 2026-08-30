/*
# Add public quiz library and guest quiz support

1. Modified Tables
- `quizzes`
  - Added `is_public` (boolean, default false): when true, the quiz appears in the public library visible to all users.
  - Added `is_guest` (boolean, default false): marks a quiz created by a guest user (no Supabase account). Guest quizzes have owner_id = null.

2. Security (quizzes)
- SELECT: registered users see their own quizzes OR any public quiz. Guest quizzes are readable by all (needed for game sessions).
- INSERT: authenticated users can insert their own quizzes (owner_id = auth.uid()). Anon users can insert guest quizzes ONLY when is_guest = true AND owner_id IS NULL.
- UPDATE: authenticated users can update their own quizzes. Anon users can update guest quizzes (is_guest = true, owner_id IS NULL).
- DELETE: authenticated users can delete their own quizzes. Anon users can delete guest quizzes (is_guest = true, owner_id IS NULL) for cleanup on page unload.

3. Security (questions)
- INSERT: authenticated owners can insert. Anon users can insert questions for guest quizzes (parent quiz has is_guest = true, owner_id IS NULL).
- UPDATE: authenticated owners can update. Anon users can update questions of guest quizzes.
- DELETE: authenticated owners can delete. Anon users can delete questions of guest quizzes.

4. Notes
- Guest quiz cleanup: the frontend calls DELETE on guest quizzes when the user navigates away (beforeunload). Orphaned guest quizzes may remain if cleanup fails, but is_guest = true flags them.
- is_public only makes sense for authenticated-user quizzes. Setting is_public = true on a guest quiz is a no-op in the UI.
*/

ALTER TABLE quizzes
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_guest boolean NOT NULL DEFAULT false;

-- ─── quizzes SELECT ────────────────────────────────────────────────────────────
-- Authenticated: own quizzes + all public quizzes + guest quizzes (needed for sessions)
-- Anon: public quizzes + guest quizzes
DROP POLICY IF EXISTS "anon_select_quizzes" ON quizzes;
DROP POLICY IF EXISTS "select_quizzes" ON quizzes;

CREATE POLICY "select_quizzes" ON quizzes FOR SELECT
  TO anon, authenticated
  USING (
    is_public = true
    OR is_guest = true
    OR (auth.uid() IS NOT NULL AND auth.uid() = owner_id)
  );

-- ─── quizzes INSERT ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_insert_quizzes" ON quizzes;
DROP POLICY IF EXISTS "insert_quizzes" ON quizzes;

-- Authenticated users insert their own quiz
CREATE POLICY "auth_insert_quizzes" ON quizzes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = owner_id);

-- Anon guests insert guest quizzes only (is_guest must be true, owner_id must be null)
CREATE POLICY "anon_insert_guest_quizzes" ON quizzes FOR INSERT
  TO anon
  WITH CHECK (is_guest = true AND owner_id IS NULL);

-- ─── quizzes UPDATE ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_update_quizzes" ON quizzes;
DROP POLICY IF EXISTS "update_quizzes" ON quizzes;

CREATE POLICY "auth_update_quizzes" ON quizzes FOR UPDATE
  TO authenticated
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "anon_update_guest_quizzes" ON quizzes FOR UPDATE
  TO anon
  USING (is_guest = true AND owner_id IS NULL)
  WITH CHECK (is_guest = true AND owner_id IS NULL);

-- ─── quizzes DELETE ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "auth_delete_quizzes" ON quizzes;
DROP POLICY IF EXISTS "delete_quizzes" ON quizzes;

CREATE POLICY "auth_delete_quizzes" ON quizzes FOR DELETE
  TO authenticated
  USING (auth.uid() = owner_id);

CREATE POLICY "anon_delete_guest_quizzes" ON quizzes FOR DELETE
  TO anon
  USING (is_guest = true AND owner_id IS NULL);

-- ─── questions INSERT/UPDATE/DELETE for guest quizzes ─────────────────────────
DROP POLICY IF EXISTS "auth_insert_questions" ON questions;
DROP POLICY IF EXISTS "auth_update_questions" ON questions;
DROP POLICY IF EXISTS "auth_delete_questions" ON questions;

CREATE POLICY "auth_insert_questions" ON questions FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM quizzes WHERE quizzes.id = questions.quiz_id AND quizzes.owner_id = auth.uid())
  );

CREATE POLICY "anon_insert_guest_questions" ON questions FOR INSERT
  TO anon
  WITH CHECK (
    EXISTS (SELECT 1 FROM quizzes WHERE quizzes.id = questions.quiz_id AND quizzes.is_guest = true AND quizzes.owner_id IS NULL)
  );

CREATE POLICY "auth_update_questions" ON questions FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM quizzes WHERE quizzes.id = questions.quiz_id AND quizzes.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM quizzes WHERE quizzes.id = questions.quiz_id AND quizzes.owner_id = auth.uid()));

CREATE POLICY "anon_update_guest_questions" ON questions FOR UPDATE
  TO anon
  USING (EXISTS (SELECT 1 FROM quizzes WHERE quizzes.id = questions.quiz_id AND quizzes.is_guest = true AND quizzes.owner_id IS NULL))
  WITH CHECK (EXISTS (SELECT 1 FROM quizzes WHERE quizzes.id = questions.quiz_id AND quizzes.is_guest = true AND quizzes.owner_id IS NULL));

CREATE POLICY "auth_delete_questions" ON questions FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM quizzes WHERE quizzes.id = questions.quiz_id AND quizzes.owner_id = auth.uid())
  );

CREATE POLICY "anon_delete_guest_questions" ON questions FOR DELETE
  TO anon
  USING (
    EXISTS (SELECT 1 FROM quizzes WHERE quizzes.id = questions.quiz_id AND quizzes.is_guest = true AND quizzes.owner_id IS NULL)
  );
