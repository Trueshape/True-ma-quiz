/*
# Add created_by column to quizzes

1. Modified Tables
- `quizzes`
  - Added `created_by` (text, nullable) — stores the creator's display name/username.
    Shown on quiz cards between the title and description.
2. Security
- No RLS policy changes needed — the new column is covered by existing quiz policies.
3. Notes
- The column is nullable so existing quizzes are unaffected.
*/

ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS created_by text;
