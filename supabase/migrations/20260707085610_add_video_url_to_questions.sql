/*
# Add video_url column to questions

1. Modified Tables
- `questions`
  - Added `video_url` (text, nullable) — stores a YouTube video URL or video ID.
    When present, the question display will show a YouTube embed instead of the image.
2. Security
- No RLS policy changes needed — the new column is covered by existing question policies.
3. Notes
- The column is nullable so existing questions are unaffected.
- The frontend will parse YouTube URLs/IDs and render an iframe embed.
*/

ALTER TABLE questions ADD COLUMN IF NOT EXISTS video_url text;
