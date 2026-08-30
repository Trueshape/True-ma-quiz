/*
# Add video_hidden and video_volume to questions

1. New Columns
- `video_hidden` (boolean, NOT NULL, default false) — when true, the YouTube video is hidden from players during gameplay; only audio plays.
- `video_volume` (float, NOT NULL, default 1.0) — base volume (0.0–1.0) for the YouTube video during gameplay.

2. Modified Tables
- `questions` — two new columns added.

3. Security
- No RLS policy changes. Existing policies remain intact.

4. Important Notes
- Both columns have safe defaults so existing rows are unaffected.
- `video_hidden` defaults to false (video visible) for backward compatibility.
- `video_volume` defaults to 1.0 (full volume) matching previous behavior.
*/

ALTER TABLE questions ADD COLUMN IF NOT EXISTS video_hidden boolean NOT NULL DEFAULT false;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS video_volume float NOT NULL DEFAULT 1.0;