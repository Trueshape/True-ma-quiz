/*
  # Quiz and lobby functions (phase A: additive, safe to run before the new frontend is deployed)

  - Quiz writes (create, save, delete, publish) become atomic SECURITY DEFINER functions.
    Guest quizzes get a secret token, so only the guest who created a quiz can change it.
  - Lobby codes move to a private table, so listing sessions no longer reveals them.
  - Lobbies are capped at 200 players and guest quizzes at 5000 in total.

  The lockdown that removes direct writes and old code access is in
  20261018090100_lockdown_quizzes_and_codes.sql and must only be applied after the
  new frontend is live.
*/

-- ─── private tables ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS quiz_secrets (
  quiz_id uuid PRIMARY KEY REFERENCES quizzes(id) ON DELETE CASCADE,
  token uuid NOT NULL DEFAULT gen_random_uuid()
);
ALTER TABLE quiz_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON quiz_secrets FROM anon, authenticated;

CREATE TABLE IF NOT EXISTS session_codes (
  session_id uuid PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE
);
ALTER TABLE session_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON session_codes FROM anon, authenticated;

INSERT INTO session_codes (session_id, code)
SELECT id, code::text FROM sessions WHERE code IS NOT NULL
ON CONFLICT DO NOTHING;

-- ─── sessions: keep writing the code to both places until the lockdown ─────────

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
  INSERT INTO session_codes (session_id, code) VALUES (v_session.id, p_code);
  INSERT INTO session_secrets (session_id) VALUES (v_session.id) RETURNING host_token INTO v_token;

  RETURN jsonb_build_object('session', to_jsonb(v_session), 'host_token', v_token, 'code', p_code);
END $$;

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
  IF (SELECT count(*) FROM players WHERE session_id = p_session_id) >= 200 THEN
    RAISE EXCEPTION 'lobby_full' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO players (session_id, nickname) VALUES (p_session_id, v_nick) RETURNING * INTO v_player;
  INSERT INTO player_secrets (player_id) VALUES (v_player.id) RETURNING token INTO v_token;

  RETURN jsonb_build_object('player', to_jsonb(v_player), 'token', v_token);
END $$;

CREATE OR REPLACE FUNCTION get_session_by_code(p_code text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('id', s.id, 'status', s.status)
  FROM session_codes c JOIN sessions s ON s.id = c.session_id
  WHERE c.code = upper(btrim(p_code))
$$;

CREATE OR REPLACE FUNCTION join_session_by_code(p_code text, p_nickname text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT session_id INTO v_id FROM session_codes WHERE code = upper(btrim(p_code));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0002';
  END IF;
  RETURN join_session(v_id, p_nickname) || jsonb_build_object('session_id', v_id);
END $$;

CREATE OR REPLACE FUNCTION host_get_code(p_session_id uuid, p_host_token uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM session_secrets WHERE session_id = p_session_id AND host_token = p_host_token
  ) THEN
    RAISE EXCEPTION 'invalid_host' USING ERRCODE = '42501';
  END IF;
  SELECT code INTO v_code FROM session_codes WHERE session_id = p_session_id;
  RETURN v_code;
END $$;

-- ─── quizzes ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION quiz_can_edit(p_quiz_id uuid, p_token uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM quizzes q
    WHERE q.id = p_quiz_id
      AND (
        (auth.uid() IS NOT NULL AND q.owner_id = auth.uid())
        OR (q.is_guest AND p_token IS NOT NULL
            AND EXISTS (SELECT 1 FROM quiz_secrets s WHERE s.quiz_id = q.id AND s.token = p_token))
      )
  )
$$;

CREATE OR REPLACE FUNCTION create_quiz(p_title text, p_description text DEFAULT NULL, p_created_by text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title text := btrim(coalesce(p_title, ''));
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_uid uuid := auth.uid();
  v_by text;
  v_quiz quizzes;
  v_token uuid;
BEGIN
  IF length(v_title) < 1 OR length(v_title) > 120 THEN
    RAISE EXCEPTION 'invalid_title' USING ERRCODE = 'P0001';
  END IF;
  IF v_desc IS NOT NULL AND length(v_desc) > 1000 THEN
    RAISE EXCEPTION 'invalid_description' USING ERRCODE = 'P0001';
  END IF;

  IF v_uid IS NOT NULL THEN
    v_by := nullif(btrim(coalesce(auth.jwt() -> 'user_metadata' ->> 'nickname', '')), '');
    INSERT INTO quizzes (title, description, created_by, owner_id)
      VALUES (v_title, v_desc, v_by, v_uid) RETURNING * INTO v_quiz;
    RETURN jsonb_build_object('quiz', to_jsonb(v_quiz), 'token', NULL);
  END IF;

  IF (SELECT count(*) FROM quizzes WHERE is_guest) >= 5000 THEN
    RAISE EXCEPTION 'guest_limit' USING ERRCODE = 'P0001';
  END IF;
  v_by := coalesce(nullif(left(btrim(coalesce(p_created_by, '')), 40), ''), 'Guest');
  INSERT INTO quizzes (title, description, created_by, is_guest, owner_id)
    VALUES (v_title, v_desc, v_by, true, NULL) RETURNING * INTO v_quiz;
  INSERT INTO quiz_secrets (quiz_id) VALUES (v_quiz.id) RETURNING token INTO v_token;
  RETURN jsonb_build_object('quiz', to_jsonb(v_quiz), 'token', v_token);
END $$;

CREATE OR REPLACE FUNCTION save_quiz(p_quiz_id uuid, p_token uuid, p_meta jsonb, p_questions jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title text := btrim(coalesce(p_meta ->> 'title', ''));
  v_desc text := nullif(btrim(coalesce(p_meta ->> 'description', '')), '');
  v_cover text := nullif(btrim(coalesce(p_meta ->> 'cover_image_url', '')), '');
  v_count int;
BEGIN
  IF NOT quiz_can_edit(p_quiz_id, p_token) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF length(v_title) < 1 OR length(v_title) > 120
     OR (v_desc IS NOT NULL AND length(v_desc) > 1000)
     OR (v_cover IS NOT NULL AND length(v_cover) > 2000) THEN
    RAISE EXCEPTION 'invalid_meta' USING ERRCODE = 'P0001';
  END IF;
  IF jsonb_typeof(p_questions) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_questions) > 100
     OR length(p_questions::text) > 1000000 THEN
    RAISE EXCEPTION 'invalid_questions' USING ERRCODE = 'P0001';
  END IF;

  UPDATE quizzes SET title = v_title, description = v_desc, cover_image_url = v_cover
    WHERE id = p_quiz_id;

  -- Questions that are no longer in the list are removed. The others keep their id, so
  -- answers from past games are not deleted by a save.
  DELETE FROM questions
    WHERE quiz_id = p_quiz_id
      AND id NOT IN (
        SELECT nullif(e.elem ->> 'id', '')::uuid
        FROM jsonb_array_elements(p_questions) AS e(elem)
        WHERE nullif(e.elem ->> 'id', '') IS NOT NULL
      );

  INSERT INTO questions (
    id, quiz_id, position, type, prompt, options, correct_index, image_url,
    video_url, video_start_ms, video_hidden, video_volume,
    audio_url, audio_volume, audio_start_ms, audio_hidden,
    time_limit_ms, slider_min, slider_max, slider_answer,
    reorder_correct_order, reorder_item_images, open_answers,
    points_value, info_image_position
  )
  SELECT
    CASE WHEN EXISTS (
           SELECT 1 FROM questions q
           WHERE q.id = nullif(e.elem ->> 'id', '')::uuid AND q.quiz_id = p_quiz_id)
         THEN nullif(e.elem ->> 'id', '')::uuid ELSE gen_random_uuid() END,
    p_quiz_id, (e.ord - 1)::int, r.type, r.prompt, coalesce(r.options, '[]'::jsonb), coalesce(r.correct_index, 0), r.image_url,
    r.video_url, coalesce(r.video_start_ms, 0), coalesce(r.video_hidden, false), coalesce(r.video_volume, 1.0),
    r.audio_url, coalesce(r.audio_volume, 0.5), coalesce(r.audio_start_ms, 0), coalesce(r.audio_hidden, false),
    coalesce(r.time_limit_ms, 20000), r.slider_min, r.slider_max, r.slider_answer,
    r.reorder_correct_order, r.reorder_item_images, r.open_answers,
    coalesce(r.points_value, 1000), coalesce(r.info_image_position, 'top')
  FROM jsonb_array_elements(p_questions) WITH ORDINALITY AS e(elem, ord)
  CROSS JOIN LATERAL jsonb_populate_record(NULL::questions, e.elem) AS r
  ON CONFLICT (id) DO UPDATE SET
    position = EXCLUDED.position, type = EXCLUDED.type, prompt = EXCLUDED.prompt,
    options = EXCLUDED.options, correct_index = EXCLUDED.correct_index, image_url = EXCLUDED.image_url,
    video_url = EXCLUDED.video_url, video_start_ms = EXCLUDED.video_start_ms,
    video_hidden = EXCLUDED.video_hidden, video_volume = EXCLUDED.video_volume,
    audio_url = EXCLUDED.audio_url, audio_volume = EXCLUDED.audio_volume,
    audio_start_ms = EXCLUDED.audio_start_ms, audio_hidden = EXCLUDED.audio_hidden,
    time_limit_ms = EXCLUDED.time_limit_ms, slider_min = EXCLUDED.slider_min,
    slider_max = EXCLUDED.slider_max, slider_answer = EXCLUDED.slider_answer,
    reorder_correct_order = EXCLUDED.reorder_correct_order,
    reorder_item_images = EXCLUDED.reorder_item_images, open_answers = EXCLUDED.open_answers,
    points_value = EXCLUDED.points_value, info_image_position = EXCLUDED.info_image_position;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('count', v_count);
END $$;

CREATE OR REPLACE FUNCTION delete_quiz(p_quiz_id uuid, p_token uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT quiz_can_edit(p_quiz_id, p_token) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  DELETE FROM quizzes WHERE id = p_quiz_id;
END $$;

CREATE OR REPLACE FUNCTION set_quiz_public(p_quiz_id uuid, p_public boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  UPDATE quizzes SET is_public = p_public WHERE id = p_quiz_id AND owner_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
END $$;

-- ─── permissions ──────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION quiz_can_edit(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_quiz(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION save_quiz(uuid, uuid, jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION delete_quiz(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION set_quiz_public(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_session_by_code(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION join_session_by_code(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION host_get_code(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_session(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION join_session(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_quiz(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION save_quiz(uuid, uuid, jsonb, jsonb) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION delete_quiz(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION set_quiz_public(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION get_session_by_code(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION join_session_by_code(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION host_get_code(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION create_session(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION join_session(uuid, text) TO anon, authenticated;
