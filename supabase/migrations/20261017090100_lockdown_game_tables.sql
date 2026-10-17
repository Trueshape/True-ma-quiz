/*
  # Lock down game tables (phase B)

  Apply ONLY after the frontend that uses the RPCs from
  20261017090000_server_side_game_logic.sql is deployed. The old frontend writes to
  these tables directly and stops working once this runs.

  After this migration:
  - sessions, players and answers can no longer be inserted, updated or deleted directly
    by anon/authenticated. All writes go through SECURITY DEFINER functions.
  - answers are only readable once the question is over (leaderboard / finished), so a
    player cannot copy other players' answers while a question is running.
*/

DROP POLICY IF EXISTS "anon_insert_sessions" ON sessions;
DROP POLICY IF EXISTS "anon_update_sessions" ON sessions;
DROP POLICY IF EXISTS "anon_delete_sessions" ON sessions;

DROP POLICY IF EXISTS "anon_insert_players" ON players;
DROP POLICY IF EXISTS "anon_update_players" ON players;
DROP POLICY IF EXISTS "anon_delete_players" ON players;

DROP POLICY IF EXISTS "anon_insert_answers" ON answers;
DROP POLICY IF EXISTS "anon_update_answers" ON answers;
DROP POLICY IF EXISTS "anon_delete_answers" ON answers;
DROP POLICY IF EXISTS "anon_select_answers" ON answers;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON sessions, players, answers FROM anon, authenticated;

CREATE POLICY "select_answers_after_question" ON answers FOR SELECT
  TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM sessions s
      WHERE s.id = answers.session_id AND s.status IN ('leaderboard', 'finished')
    )
  );
