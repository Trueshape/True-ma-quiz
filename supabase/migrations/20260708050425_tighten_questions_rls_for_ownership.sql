/*
# Tighten questions RLS to check quiz ownership

1. Security
- `questions` table: RLS already enabled.
- SELECT: kept open to `anon, authenticated` (anyone can read questions for playing/practice).
- INSERT/UPDATE/DELETE: now check that the parent quiz's `owner_id` matches `auth.uid()`,
  so only the quiz owner can modify questions.
- Previous policies used a bare `EXISTS (SELECT 1 FROM quizzes WHERE ...)` which allowed
  anyone to modify questions on any quiz. Now scoped to authenticated owners.
2. Notes
- The subquery joins `questions.quiz_id` to `quizzes.id` and checks `quizzes.owner_id = auth.uid()`.
- Existing quizzes with NULL owner_id will not be editable until the owner re-saves them
  (acceptable: going forward all new quizzes have owner_id set automatically).
*/

DROP POLICY IF EXISTS "anon_insert_questions" ON questions;
DROP POLICY IF EXISTS "anon_update_questions" ON questions;
DROP POLICY IF EXISTS "anon_delete_questions" ON questions;

CREATE POLICY "auth_insert_questions" ON questions FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM quizzes WHERE quizzes.id = questions.quiz_id AND quizzes.owner_id = auth.uid())
  );

CREATE POLICY "auth_update_questions" ON questions FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM quizzes WHERE quizzes.id = questions.quiz_id AND quizzes.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM quizzes WHERE quizzes.id = questions.quiz_id AND quizzes.owner_id = auth.uid()));

CREATE POLICY "auth_delete_questions" ON questions FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM quizzes WHERE quizzes.id = questions.quiz_id AND quizzes.owner_id = auth.uid())
  );
