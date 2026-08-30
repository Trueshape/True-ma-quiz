/*
# Add 'info' and 'slider' question types

1. Purpose
- Add support for two new question types:
  - 'info': A non-playable page between questions (category divider, intro text, instructions). No scoring, no answers.
  - 'slider': A numeric guess question. The creator sets a range (min, max) and the correct answer. Players slide to guess; closest to the correct answer wins, scored by proximity.
- The existing 'mc' (multiple choice) and 'tf' (true/false) types remain unchanged.

2. Changes to `questions` table
- Add `slider_min` (int, nullable): minimum value of the slider range.
- Add `slider_max` (int, nullable): maximum value of the slider range.
- Add `slider_answer` (int, nullable): the correct numeric answer the creator sets.
- Update the `type` CHECK constraint to allow 'info' and 'slider' in addition to 'mc' and 'tf'.
- For 'info' type: `options` is '[]', `correct_index` is 0, `slider_*` are null. The `prompt` field holds the info/break text.
- For 'slider' type: `options` is '[]', `correct_index` is 0, `slider_min`/`slider_max`/`slider_answer` hold the range and answer.

3. Changes to `answers` table
- Add `slider_value` (int, nullable): the numeric value the player guessed (for slider questions).
- The existing `chosen_index` field is set to 0 for slider answers (not used for slider type).
- `is_correct` for slider: true if the player's guess is the closest among all players (computed at leaderboard time).
- `points` for slider: computed by proximity — closer guesses get more points.

4. Security
- No RLS policy changes needed — existing policies already allow anon CRUD on all tables.
- No new tables.

5. Notes
- The 'info' type is a display-only page. When the host reaches an 'info' question, it shows the prompt text and a "Continue" button. No timer, no answers, no leaderboard.
- The 'slider' type uses slider_min/slider_max/slider_answer instead of options/correct_index.
- Scoring for slider: 1000 points if exactly correct, scaled down by distance from the answer relative to the range size.
*/

-- Add new columns to questions
ALTER TABLE questions ADD COLUMN IF NOT EXISTS slider_min int;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS slider_max int;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS slider_answer int;

-- Update the type CHECK constraint to include 'info' and 'slider'
ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_type_check;
ALTER TABLE questions ADD CONSTRAINT questions_type_check CHECK (type IN ('mc','tf','info','slider'));

-- Add slider_value to answers
ALTER TABLE answers ADD COLUMN IF NOT EXISTS slider_value int;
