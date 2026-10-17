/*
  # Server-side game logic (phase A: additive, safe to run before the new frontend is deployed)

  Moves scoring, session creation, joining and host controls into SECURITY DEFINER
  functions so clients no longer write scores or session state directly.

  New objects:
  - players.last_answered_index: lets the host see who has answered without reading answers
  - session_secrets / player_secrets: secret tokens, never readable by anon/authenticated
  - g_* helper functions (scoring maths, mirrors lib/supabase.ts)
  - create_session, join_session, submit_answer, host_update_session RPCs

  The lockdown that removes direct writes is in 20261017090100_lockdown_game_tables.sql
  and must only be applied after the new frontend is live.
*/

ALTER TABLE players ADD COLUMN IF NOT EXISTS last_answered_index int;

CREATE TABLE IF NOT EXISTS session_secrets (
  session_id uuid PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  host_token uuid NOT NULL DEFAULT gen_random_uuid()
);
ALTER TABLE session_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON session_secrets FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS player_secrets (
  player_id uuid PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  token uuid NOT NULL DEFAULT gen_random_uuid()
);
ALTER TABLE player_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON player_secrets FROM anon, authenticated;

-- ─── scoring helpers ──────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION g_time_factor(taken_ms int, limit_ms int, grace_ms int)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF taken_ms <= grace_ms THEN RETURN 1; END IF;
  RETURN GREATEST(0, 1 - (LEAST(taken_ms, limit_ms) - grace_ms)::numeric / GREATEST(1, limit_ms - grace_ms));
END $$;

CREATE OR REPLACE FUNCTION g_norm(s text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(
    regexp_replace(
      translate(
        lower(translate(btrim(coalesce(s, ''), E' \t\n\r'),
          'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿ',
          'AAAAAACEEEEIIIINOOOOOUUUUYaaaaaaceeeeiiiinooooouuuuyy')),
        'āăąćĉċčďēĕėęěĝğġģĥĩīĭįĵķĺļľńņňōŏőŕŗřśŝşšţťũūŭůűųŵŷźżž',
        'aaaccccdeeeeegggghiiiijklllnnnooorrrssssttuuuuuuwyzzz'),
      '[^a-z0-9\s]', '', 'g'),
    '\s+', ' ', 'g')
$$;

CREATE OR REPLACE FUNCTION g_lev(a text, b text)
RETURNS int LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  m int := length(a);
  n int := length(b);
  prev int[];
  curr int[];
  i int;
  j int;
  cost int;
BEGIN
  IF m = 0 THEN RETURN n; END IF;
  IF n = 0 THEN RETURN m; END IF;
  prev := ARRAY(SELECT generate_series(0, n));
  FOR i IN 1..m LOOP
    curr := ARRAY[i];
    FOR j IN 1..n LOOP
      cost := CASE WHEN substr(a, i, 1) = substr(b, j, 1) THEN 0 ELSE 1 END;
      curr[j + 1] := LEAST(prev[j + 1] + 1, curr[j] + 1, prev[j] + cost);
    END LOOP;
    prev := curr;
  END LOOP;
  RETURN prev[n + 1];
END $$;

CREATE OR REPLACE FUNCTION g_sim(a text, b text)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  x text := left(a, 200);
  y text := left(b, 200);
  max_len int := GREATEST(length(x), length(y));
BEGIN
  IF max_len = 0 THEN RETURN 1; END IF;
  RETURN 1 - g_lev(x, y)::numeric / max_len;
END $$;

-- ─── create_session ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION create_session(p_quiz_id uuid, p_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_session sessions;
  v_token uuid;
BEGIN
  IF p_code !~ '^[A-Z0-9]{6}$' THEN
    RAISE EXCEPTION 'invalid_code' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM quizzes q
    WHERE q.id = p_quiz_id
      AND (q.is_public OR q.is_guest OR (auth.uid() IS NOT NULL AND q.owner_id = auth.uid()))
  ) THEN
    RAISE EXCEPTION 'quiz_not_available' USING ERRCODE = '42501';
  END IF;

  INSERT INTO sessions (quiz_id, code, status) VALUES (p_quiz_id, p_code, 'lobby')
    RETURNING * INTO v_session;
  INSERT INTO session_secrets (session_id) VALUES (v_session.id) RETURNING host_token INTO v_token;

  RETURN jsonb_build_object('session', to_jsonb(v_session), 'host_token', v_token);
END $$;

-- ─── join_session ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION join_session(p_session_id uuid, p_nickname text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status text;
  v_nick text := btrim(coalesce(p_nickname, ''));
  v_player players;
  v_token uuid;
BEGIN
  IF length(v_nick) < 1 OR length(v_nick) > 30 THEN
    RAISE EXCEPTION 'invalid_nickname' USING ERRCODE = 'P0001';
  END IF;
  SELECT status INTO v_status FROM sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'lobby' THEN
    RAISE EXCEPTION 'game_started' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO players (session_id, nickname) VALUES (p_session_id, v_nick) RETURNING * INTO v_player;
  INSERT INTO player_secrets (player_id) VALUES (v_player.id) RETURNING token INTO v_token;

  RETURN jsonb_build_object('player', to_jsonb(v_player), 'token', v_token);
END $$;

-- ─── submit_answer ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION submit_answer(
  p_session_id uuid,
  p_player_id uuid,
  p_token uuid,
  p_chosen_index int DEFAULT NULL,
  p_slider_value int DEFAULT NULL,
  p_reorder_order int[] DEFAULT NULL,
  p_open_text text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sess sessions;
  v_q questions;
  v_taken int;
  v_tf numeric;
  v_correct boolean := false;
  v_points int := 0;
  v_score bigint;
  v_chosen int := 0;
  v_range numeric;
  v_prox numeric;
  v_matches int;
  v_len int;
  v_best numeric;
  v_sim numeric;
  v_threshold numeric;
  v_norm_user text;
  v_norm_ans text;
  v_ans text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM player_secrets ps JOIN players p ON p.id = ps.player_id
    WHERE ps.player_id = p_player_id AND ps.token = p_token AND p.session_id = p_session_id
  ) THEN
    RAISE EXCEPTION 'invalid_player' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_sess FROM sessions WHERE id = p_session_id;
  IF NOT FOUND OR v_sess.status <> 'question' OR v_sess.question_started_at IS NULL THEN
    RAISE EXCEPTION 'not_accepting_answers' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_q FROM questions WHERE quiz_id = v_sess.quiz_id
    ORDER BY position, created_at, id OFFSET v_sess.current_question_index LIMIT 1;
  IF NOT FOUND OR v_q.type = 'info' THEN
    RAISE EXCEPTION 'not_accepting_answers' USING ERRCODE = 'P0001';
  END IF;

  v_taken := GREATEST(0, floor(extract(epoch FROM (clock_timestamp() - v_sess.question_started_at)) * 1000))::int;
  IF v_taken > v_q.time_limit_ms + 2500 THEN
    RAISE EXCEPTION 'too_late' USING ERRCODE = 'P0001';
  END IF;
  v_tf := g_time_factor(v_taken, v_q.time_limit_ms, 3000);

  IF v_q.type IN ('mc', 'tf') THEN
    IF p_chosen_index IS NULL OR p_chosen_index < 0 OR p_chosen_index >= 20 THEN
      RAISE EXCEPTION 'invalid_answer' USING ERRCODE = 'P0001';
    END IF;
    v_chosen := p_chosen_index;
    v_correct := p_chosen_index = v_q.correct_index;
    v_points := CASE WHEN v_correct THEN round(v_q.points_value * v_tf)::int ELSE 0 END;

  ELSIF v_q.type = 'slider' THEN
    IF p_slider_value IS NULL THEN
      RAISE EXCEPTION 'invalid_answer' USING ERRCODE = 'P0001';
    END IF;
    v_range := coalesce(v_q.slider_max, 100) - coalesce(v_q.slider_min, 0);
    IF v_range <= 0 THEN
      v_prox := CASE WHEN p_slider_value = coalesce(v_q.slider_answer, 0) THEN 1 ELSE 0 END;
    ELSE
      v_prox := GREATEST(0, 1 - abs(p_slider_value - coalesce(v_q.slider_answer, 0))::numeric / v_range);
    END IF;
    v_correct := p_slider_value = coalesce(v_q.slider_answer, 0);
    v_points := round(v_q.points_value * v_prox)::int;

  ELSIF v_q.type = 'reorder' THEN
    IF p_reorder_order IS NULL OR coalesce(array_length(p_reorder_order, 1), 0) > 50 THEN
      RAISE EXCEPTION 'invalid_answer' USING ERRCODE = 'P0001';
    END IF;
    v_len := coalesce(array_length(v_q.reorder_correct_order, 1), 0);
    IF v_len = 0 OR coalesce(array_length(p_reorder_order, 1), 0) = 0 THEN
      v_points := 0;
    ELSE
      SELECT count(*) INTO v_matches
      FROM generate_subscripts(p_reorder_order, 1) AS i
      WHERE i <= v_len AND p_reorder_order[i] = v_q.reorder_correct_order[i];
      v_points := round(v_q.points_value * v_matches::numeric / v_len)::int;
    END IF;
    v_correct := v_points >= v_q.points_value;

  ELSIF v_q.type = 'open' THEN
    IF p_open_text IS NULL OR btrim(p_open_text) = '' THEN
      RAISE EXCEPTION 'invalid_answer' USING ERRCODE = 'P0001';
    END IF;
    v_norm_user := g_norm(left(p_open_text, 500));
    v_best := 0;
    FOREACH v_ans IN ARRAY coalesce(v_q.open_answers, ARRAY[]::text[]) LOOP
      v_norm_ans := g_norm(v_ans);
      CONTINUE WHEN v_norm_ans = '';
      v_sim := g_sim(v_norm_user, v_norm_ans);
      IF v_sim > v_best THEN v_best := v_sim; END IF;
      v_threshold := CASE WHEN length(v_norm_ans) < 6 THEN 1 ELSE 0.8 END;
      IF v_sim >= v_threshold THEN v_correct := true; END IF;
    END LOOP;
    v_points := CASE WHEN v_correct THEN round(v_q.points_value * v_tf)::int ELSE 0 END;

  ELSE
    RAISE EXCEPTION 'invalid_answer' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO answers (
    session_id, player_id, question_id, question_index, chosen_index,
    slider_value, reorder_order, open_text, is_correct, time_taken_ms, points
  ) VALUES (
    p_session_id, p_player_id, v_q.id, v_sess.current_question_index, v_chosen,
    CASE WHEN v_q.type = 'slider' THEN p_slider_value END,
    CASE WHEN v_q.type = 'reorder' THEN p_reorder_order END,
    CASE WHEN v_q.type = 'open' THEN left(p_open_text, 500) END,
    v_correct, LEAST(v_taken, v_q.time_limit_ms), v_points
  );

  UPDATE players
     SET score = score + v_points, last_answered_index = v_sess.current_question_index
   WHERE id = p_player_id
   RETURNING score INTO v_score;

  RETURN jsonb_build_object('points', v_points, 'is_correct', v_correct, 'score', v_score);
END $$;

-- ─── host_update_session ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION host_update_session(
  p_session_id uuid,
  p_host_token uuid,
  p_status text,
  p_question_index int DEFAULT NULL,
  p_start_timer boolean DEFAULT false,
  p_set_started boolean DEFAULT false,
  p_set_finished boolean DEFAULT false,
  p_reset boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_session sessions;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM session_secrets WHERE session_id = p_session_id AND host_token = p_host_token
  ) THEN
    RAISE EXCEPTION 'invalid_host' USING ERRCODE = '42501';
  END IF;

  IF p_reset THEN
    DELETE FROM answers WHERE session_id = p_session_id;
    UPDATE players SET score = 0, last_answered_index = NULL WHERE session_id = p_session_id;
  END IF;

  UPDATE sessions SET
    status = p_status,
    current_question_index = CASE WHEN p_reset THEN 0 ELSE coalesce(p_question_index, current_question_index) END,
    question_started_at = CASE
      WHEN p_start_timer THEN now()
      WHEN p_status IN ('lobby', 'leaderboard') THEN NULL
      ELSE question_started_at END,
    started_at = CASE WHEN p_reset THEN NULL WHEN p_set_started THEN now() ELSE started_at END,
    finished_at = CASE WHEN p_reset THEN NULL WHEN p_set_finished THEN now() ELSE finished_at END
  WHERE id = p_session_id
  RETURNING * INTO v_session;

  RETURN to_jsonb(v_session);
END $$;

REVOKE ALL ON FUNCTION create_session(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION join_session(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION submit_answer(uuid, uuid, uuid, int, int, int[], text) FROM PUBLIC;
REVOKE ALL ON FUNCTION host_update_session(uuid, uuid, text, int, boolean, boolean, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_session(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION join_session(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION submit_answer(uuid, uuid, uuid, int, int, int[], text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION host_update_session(uuid, uuid, text, int, boolean, boolean, boolean, boolean) TO anon, authenticated;
