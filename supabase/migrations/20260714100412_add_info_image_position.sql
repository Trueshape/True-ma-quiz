/*
# Add info_image_position to questions

1. Modified Tables
- `questions`: add `info_image_position` text column (default 'top')
  - Controls where the image is displayed relative to the text on info pages.
  - Allowed values: 'top', 'bottom', 'left', 'right'.
2. Security
- No RLS changes — existing policies remain unchanged.
3. Notes
- Uses a CHECK constraint to enforce valid position values.
- Default is 'top' so existing info questions render unchanged (image above text).
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'questions' AND column_name = 'info_image_position'
  ) THEN
    ALTER TABLE questions ADD COLUMN info_image_position text NOT NULL DEFAULT 'top' CHECK (info_image_position IN ('top','bottom','left','right'));
  END IF;
END $$;
