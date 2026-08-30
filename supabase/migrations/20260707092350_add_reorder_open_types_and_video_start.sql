/*
# Add reorder and open question types + video start time

1. Modified Tables
- `questions`
  - Added `video_start_ms` (int, nullable, default 0) — start time in milliseconds for YouTube videos.
  - Added `reorder_correct_order` (int[], nullable) — for 'reorder' type: the correct order of option indices.
  - Added `open_answers` (text[], nullable) — for 'open' type: list of acceptable correct answers.
2. Security
- No RLS policy changes needed — new columns are covered by existing question policies.
3. Notes
- All columns are nullable so existing questions are unaffected.
- The `type` column is a text column (not an enum), so new types 'reorder' and 'open' work without ALTER.
*/

ALTER TABLE questions ADD COLUMN IF NOT EXISTS video_start_ms integer DEFAULT 0;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS reorder_correct_order int[];
ALTER TABLE questions ADD COLUMN IF NOT EXISTS open_answers text[];
