/*
# Expand questions type check constraint for reorder and open

1. Modified Tables
- `questions`
  - Dropped the existing `questions_type_check` constraint.
  - Added a new `questions_type_check` constraint that also allows 'reorder' and 'open'.
2. Security
- No RLS changes.
3. Notes
- This is required because the original constraint only allowed ('mc', 'tf', 'info', 'slider').
  The new reorder and open question types were rejected on insert.
*/

ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_type_check;
ALTER TABLE questions ADD CONSTRAINT questions_type_check CHECK (type = ANY (ARRAY['mc'::text, 'tf'::text, 'info'::text, 'slider'::text, 'reorder'::text, 'open'::text]));
