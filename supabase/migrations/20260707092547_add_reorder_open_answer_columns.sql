/*
# Add columns for reorder and open answers

1. Modified Tables
- `answers`
  - Added `reorder_order` (int[], nullable) — for 'reorder' type: the player's chosen order of option indices.
  - Added `open_text` (text, nullable) — for 'open' type: the player's free-text answer.
2. Security
- No RLS policy changes needed — new columns are covered by existing answer policies.
3. Notes
- All columns are nullable so existing answers are unaffected.
*/

ALTER TABLE answers ADD COLUMN IF NOT EXISTS reorder_order int[];
ALTER TABLE answers ADD COLUMN IF NOT EXISTS open_text text;
