/*
# Add points_value column to questions

1. Purpose
- Allow the quiz creator to set a custom point value for each question.
- Currently all questions are worth a hardcoded 1000 points (for correct answers).
- With this migration, each question gets a `points_value` column (default 1000) that the creator can adjust.
- Slider questions use this value as the max achievable score, scaled by proximity to the correct answer (no time factor).

2. Changes to `questions` table
- Add `points_value` (int, NOT NULL, default 1000): the maximum points a player can earn for a correct answer on this question.
- For slider questions: the player's score is `points_value` scaled down by distance from the correct answer relative to the range. No time factor.
- For mc/tf questions: the player's score is `points_value` scaled down by elapsed time (same as before, but using the custom value instead of hardcoded 1000).
- For info questions: `points_value` is irrelevant (no scoring).

3. Security
- No RLS policy changes needed — existing policies already allow anon CRUD on all tables.
- No new tables.

4. Notes
- The default of 1000 preserves backward compatibility with existing questions.
- The frontend editor will expose a points input field for each question.
*/
ALTER TABLE questions ADD COLUMN IF NOT EXISTS points_value int NOT NULL DEFAULT 1000;
