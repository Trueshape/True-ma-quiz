/*
# Add audio_hidden column to questions

1. Changes
- Add `audio_hidden` boolean column to `questions` table, default false.
  When true, the Spotify embed iframe is hidden from view but still autoplays
  audio in the background (off-screen), so the player hears the track without
  seeing the player frame. The creator controls this per-question, similar to
  the existing `video_hidden` flag for YouTube.
2. Security
- No RLS policy changes. Existing policies remain unchanged.
*/

ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS audio_hidden boolean NOT NULL DEFAULT false;
