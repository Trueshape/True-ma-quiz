/*
  # Game statistics, several right answers, password recovery codes

  - host_game_stats: for each question of a game, how many answered, how many got it right
    and the wrong answer chosen most often. Only the host (host token) can read it.
  - quiz_stats: for the author of a quiz, how many games it had, how many players, the
    average final score and the hardest question.
  - questions.correct_indices: a multiple choice question can have several right answers.
    Each right pick earns its share of the points, each wrong pick takes one share away.
    answers.chosen_indices keeps what the player picked.
  - account_recovery: one recovery code per nickname-and-password account, stored hashed.
    reset_password_with_code sets a new password with nickname + code; after 5 wrong codes
    the account waits 15 minutes. The code works once.
  - nickname_uses_email: tells the sign-in form that an account now signs in with its own
    email address (the user added one for password resets).

  Additive and safe to run more than once.
*/

ALTER TABLE questions ADD COLUMN IF NOT EXISTS correct_indices int[];
ALTER TABLE answers ADD COLUMN IF NOT EXISTS chosen_indices int[];

-- ─── statistics ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION host_game_stats(p_session_id uuid, p_host_token uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_players int;
  v_out jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM session_secrets WHERE session_id = p_session_id AND host_token = p_host_token) THEN
    RAISE EXCEPTION 'invalid_host' USING ERRCODE = '42501';
  END IF;
  SELECT count(*) INTO v_players FROM players WHERE session_id = p_session_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'question_index', s.idx, 'question_id', s.qid, 'players', v_players,
           'answered', s.answered, 'correct', s.correct,
           'top_wrong', w.label, 'top_wrong_count', w.n) ORDER BY s.idx), '[]'::jsonb)
    INTO v_out
    FROM (
      SELECT a.question_index AS idx, a.question_id AS qid, count(*) AS answered, count(*) FILTER (WHERE a.is_correct) AS correct
      FROM answers a WHERE a.session_id = p_session_id
      GROUP BY a.question_index, a.question_id
    ) s
    JOIN questions q ON q.id = s.qid
    LEFT JOIN LATERAL (
      -- The wrong answer chosen most often: an option, a slider value or a typed text.
      SELECT x.label, count(*) AS n
      FROM (
        SELECT CASE
                 WHEN q.type IN ('mc', 'tf') AND b.chosen_indices IS NULL THEN q.options ->> b.chosen_index
                 WHEN q.type = 'slider' THEN b.slider_value::text
                 WHEN q.type IN ('open', 'dezoom', 'blocky') THEN lower(btrim(b.open_text))
               END AS label
        FROM answers b
        WHERE b.session_id = p_session_id AND b.question_index = s.idx AND NOT b.is_correct
      ) x
      WHERE x.label IS NOT NULL AND x.label <> ''
      GROUP BY x.label
      ORDER BY count(*) DESC, x.label
      LIMIT 1
    ) w ON true;
  RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION quiz_stats(p_quiz_id uuid, p_token uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_games int;
  v_players int;
  v_avg numeric;
  v_hardest jsonb;
BEGIN
  IF NOT quiz_can_edit(p_quiz_id, p_token) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  SELECT count(*) INTO v_games FROM sessions WHERE quiz_id = p_quiz_id AND started_at IS NOT NULL;
  SELECT count(*), round(avg(p.score) FILTER (WHERE s.finished_at IS NOT NULL))
    INTO v_players, v_avg
    FROM players p JOIN sessions s ON s.id = p.session_id
    WHERE s.quiz_id = p_quiz_id AND s.started_at IS NOT NULL;
  SELECT jsonb_build_object('question_id', q.id, 'position', q.position, 'type', q.type, 'prompt', q.prompt,
                            'answered', t.answered, 'correct', t.correct)
    INTO v_hardest
    FROM questions q
    JOIN LATERAL (
      SELECT count(*) AS answered, count(*) FILTER (WHERE a.is_correct) AS correct FROM answers a WHERE a.question_id = q.id
    ) t ON t.answered > 0
    WHERE q.quiz_id = p_quiz_id AND q.type <> 'info'
    ORDER BY t.correct::numeric / t.answered, t.answered DESC, q.position
    LIMIT 1;
  RETURN jsonb_build_object('games', v_games, 'players', v_players, 'average_score', v_avg, 'hardest', v_hardest);
END $$;

-- ─── password recovery codes ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS account_recovery (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  failed_attempts int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE account_recovery ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON account_recovery FROM anon, authenticated;

-- Letters and digits that cannot be mistaken for each other (no 0/O, 1/I).
CREATE OR REPLACE FUNCTION g_recovery_code()
RETURNS text LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_hex text := md5(gen_random_uuid()::text || clock_timestamp()::text) || md5(gen_random_uuid()::text);
  v_code text := '';
  i int;
BEGIN
  FOR i IN 1..12 LOOP
    v_code := v_code || substr(v_chars, (('x' || substr(v_hex, i * 2 - 1, 2))::bit(8)::int % 32) + 1, 1);
    IF i IN (4, 8) THEN v_code := v_code || '-'; END IF;
  END LOOP;
  RETURN v_code;
END $$;

CREATE OR REPLACE FUNCTION g_normalize_code(p_code text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

-- A new code for the signed-in account (the old one stops working). Shown once.
CREATE OR REPLACE FUNCTION create_recovery_code()
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_code text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_uid AND coalesce(encrypted_password, '') <> '') THEN
    RAISE EXCEPTION 'no_password' USING ERRCODE = 'P0001';
  END IF;
  v_code := g_recovery_code();
  INSERT INTO account_recovery (user_id, code_hash)
  VALUES (v_uid, crypt(g_normalize_code(v_code), gen_salt('bf')))
  ON CONFLICT (user_id) DO UPDATE
    SET code_hash = EXCLUDED.code_hash, failed_attempts = 0, locked_until = NULL, created_at = now();
  RETURN v_code;
END $$;

CREATE OR REPLACE FUNCTION has_recovery_code()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM account_recovery WHERE user_id = auth.uid())
$$;

-- New password with nickname + recovery code. Answers {ok} or {ok: false, error}; it does
-- not raise on a wrong code, so the count of wrong attempts is kept.
CREATE OR REPLACE FUNCTION reset_password_with_code(p_nickname text, p_code text, p_new_password text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_uid uuid;
  v_row account_recovery;
BEGIN
  IF char_length(coalesce(p_new_password, '')) < 8 OR char_length(p_new_password) > 72 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_password');
  END IF;
  SELECT user_id INTO v_uid FROM profiles WHERE lower(nickname) = lower(btrim(coalesce(p_nickname, '')));
  SELECT * INTO v_row FROM account_recovery WHERE user_id = v_uid FOR UPDATE;
  IF v_uid IS NULL OR NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_code');
  END IF;
  IF v_row.locked_until IS NOT NULL AND v_row.locked_until > now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'too_many_attempts');
  END IF;
  IF crypt(g_normalize_code(p_code), v_row.code_hash) <> v_row.code_hash THEN
    UPDATE account_recovery
       SET failed_attempts = CASE WHEN failed_attempts + 1 >= 5 THEN 0 ELSE failed_attempts + 1 END,
           locked_until = CASE WHEN failed_attempts + 1 >= 5 THEN now() + interval '15 minutes' ELSE NULL END
     WHERE user_id = v_uid;
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_code');
  END IF;
  UPDATE auth.users SET encrypted_password = crypt(p_new_password, gen_salt('bf')) WHERE id = v_uid;
  DELETE FROM account_recovery WHERE user_id = v_uid;
  RETURN jsonb_build_object('ok', true);
END $$;

-- True when the account with this nickname now signs in with its own email address.
CREATE OR REPLACE FUNCTION nickname_uses_email(p_nickname text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p JOIN auth.users u ON u.id = p.user_id
    WHERE lower(p.nickname) = lower(btrim(coalesce(p_nickname, '')))
      AND u.email IS NOT NULL AND u.email NOT LIKE '%@truemaquiz.local'
      AND coalesce(u.encrypted_password, '') <> ''
  )
$$;

-- ─── save_quiz: stores correct_indices ───────────────────────────────────────

CREATE OR REPLACE FUNCTION save_quiz(p_quiz_id uuid, p_token uuid, p_meta jsonb, p_questions jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_title text := btrim(coalesce(p_meta ->> 'title', ''));
  v_desc text := nullif(btrim(coalesce(p_meta ->> 'description', '')), '');
  v_cover text := nullif(btrim(coalesce(p_meta ->> 'cover_image_url', '')), '');
  v_tags text[];
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

  -- Tags: lower case, no leading #, spaces become hyphens, at most 30 characters each,
  -- duplicates dropped in order, at most 10 per quiz. A meta without "tags" leaves them as they are.
  IF p_meta ? 'tags' THEN
    IF jsonb_typeof(p_meta -> 'tags') IS DISTINCT FROM 'array' OR jsonb_array_length(p_meta -> 'tags') > 30 THEN
      RAISE EXCEPTION 'invalid_meta' USING ERRCODE = 'P0001';
    END IF;
    SELECT coalesce(array_agg(t ORDER BY first_pos), ARRAY[]::text[]) INTO v_tags
    FROM (
      SELECT t, min(pos) AS first_pos
      FROM (
        SELECT left(regexp_replace(regexp_replace(lower(btrim(e.value #>> '{}')), '^#+', ''), '\s+', '-', 'g'), 30) AS t, e.pos
        FROM jsonb_array_elements(p_meta -> 'tags') WITH ORDINALITY AS e(value, pos)
        WHERE jsonb_typeof(e.value) = 'string'
      ) s
      WHERE t <> ''
      GROUP BY t
      ORDER BY min(pos)
      LIMIT 10
    ) d;
  END IF;

  IF jsonb_typeof(p_questions) IS DISTINCT FROM 'array'
     OR jsonb_array_length(p_questions) > 100
     OR length(p_questions::text) > 1000000 THEN
    RAISE EXCEPTION 'invalid_questions' USING ERRCODE = 'P0001';
  END IF;

  -- A blanks sentence has 1 to 5 gaps, each with at least one accepted answer.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_questions) AS e(elem)
    WHERE e.elem ->> 'type' = 'blanks'
      AND ((SELECT count(*) FROM g_blank_answers(e.elem ->> 'prompt')) NOT BETWEEN 1 AND 5
           OR EXISTS (SELECT 1 FROM g_blank_answers(e.elem ->> 'prompt') b WHERE cardinality(b.accepted) = 0))
  ) THEN
    RAISE EXCEPTION 'invalid_questions' USING ERRCODE = 'P0001';
  END IF;

  UPDATE quizzes SET title = v_title, description = v_desc, cover_image_url = v_cover, tags = coalesce(v_tags, tags)
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
    points_value, info_image_position, reveal_config, points_decay_start_ms,
    shuffle_options, solution_image_url, correct_indices
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
    coalesce(r.points_value, 1000), coalesce(r.info_image_position, 'top'),
    CASE WHEN jsonb_typeof(r.reveal_config) = 'object' THEN r.reveal_config END,
    r.points_decay_start_ms,
    coalesce(r.shuffle_options, false), nullif(btrim(coalesce(r.solution_image_url, '')), ''),
    CASE WHEN r.type = 'mc' THEN nullif(ARRAY(
      SELECT DISTINCT i FROM unnest(r.correct_indices) AS i
      WHERE i >= 0 AND i < jsonb_array_length(coalesce(r.options, '[]'::jsonb)) ORDER BY i), '{}') END
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
    points_value = EXCLUDED.points_value, info_image_position = EXCLUDED.info_image_position,
    reveal_config = EXCLUDED.reveal_config, points_decay_start_ms = EXCLUDED.points_decay_start_ms,
    shuffle_options = EXCLUDED.shuffle_options, solution_image_url = EXCLUDED.solution_image_url,
    correct_indices = EXCLUDED.correct_indices;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('count', v_count);
END $$;

-- ─── submit_answer: several right answers ────────────────────────────────────

DROP FUNCTION IF EXISTS submit_answer(uuid, uuid, uuid, int, int, int[], text, text[]);

CREATE OR REPLACE FUNCTION submit_answer(
  p_session_id uuid,
  p_player_id uuid,
  p_token uuid,
  p_chosen_index int DEFAULT NULL,
  p_slider_value int DEFAULT NULL,
  p_reorder_order int[] DEFAULT NULL,
  p_open_text text DEFAULT NULL,
  p_blank_texts text[] DEFAULT NULL,
  p_chosen_indices int[] DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sess sessions;
  v_q questions;
  v_taken int;
  v_tf numeric;
  v_start int;
  v_correct boolean := false;
  v_points int := 0;
  v_score bigint;
  v_chosen int := 0;
  v_range numeric;
  v_prox numeric;
  v_matches int;
  v_len int;
  v_wrong int;
  v_multi int[];
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
  v_start := g_decay_start(v_q.type, v_q.points_decay_start_ms);
  v_tf := g_tf(v_taken, v_q.time_limit_ms, v_start);

  IF v_q.type = 'mc' AND coalesce(cardinality(v_q.correct_indices), 0) > 0 THEN
    -- Several right answers: each right pick earns its share, each wrong pick takes one away.
    v_multi := ARRAY(
      SELECT DISTINCT c FROM unnest(coalesce(p_chosen_indices, CASE WHEN p_chosen_index IS NOT NULL THEN ARRAY[p_chosen_index] END)) AS c
      WHERE c >= 0 AND c < 20 ORDER BY c);
    IF cardinality(v_multi) = 0 OR coalesce(cardinality(p_chosen_indices), 0) > 20 THEN
      RAISE EXCEPTION 'invalid_answer' USING ERRCODE = 'P0001';
    END IF;
    v_len := cardinality(v_q.correct_indices);
    SELECT count(*) FILTER (WHERE c = ANY (v_q.correct_indices)), count(*) FILTER (WHERE NOT c = ANY (v_q.correct_indices))
      INTO v_matches, v_wrong FROM unnest(v_multi) AS c;
    v_chosen := v_multi[1];
    v_correct := v_matches = v_len AND v_wrong = 0;
    v_points := round(v_q.points_value * GREATEST(0, v_matches - v_wrong)::numeric / v_len * v_tf)::int;

  ELSIF v_q.type IN ('mc', 'tf') THEN
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
    v_points := round(v_q.points_value * v_prox * v_tf)::int;

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
      v_points := round(v_q.points_value * v_matches::numeric / v_len * v_tf)::int;
    END IF;
    v_correct := v_len > 0 AND v_matches = v_len;

  ELSIF v_q.type = 'open' THEN
    IF p_open_text IS NULL OR btrim(p_open_text) = '' THEN
      RAISE EXCEPTION 'invalid_answer' USING ERRCODE = 'P0001';
    END IF;
    v_correct := g_text_ok(p_open_text, v_q.open_answers);
    v_points := CASE WHEN v_correct THEN round(v_q.points_value * v_tf)::int ELSE 0 END;

  ELSIF v_q.type IN ('dezoom', 'blocky') THEN
    IF p_open_text IS NULL OR btrim(p_open_text) = '' THEN
      RAISE EXCEPTION 'invalid_answer' USING ERRCODE = 'P0001';
    END IF;
    v_correct := g_text_ok(p_open_text, v_q.open_answers);
    v_points := CASE WHEN v_correct
      THEN round(v_q.points_value * g_reveal_factor(v_q.type, v_q.reveal_config, v_q.time_limit_ms, v_taken, v_start))::int
      ELSE 0 END;

  ELSIF v_q.type = 'blanks' THEN
    IF p_blank_texts IS NULL OR coalesce(array_length(p_blank_texts, 1), 0) > 5 THEN
      RAISE EXCEPTION 'invalid_answer' USING ERRCODE = 'P0001';
    END IF;
    SELECT count(*), count(*) FILTER (WHERE g_text_ok(left(p_blank_texts[b.idx], 200), b.accepted))
      INTO v_len, v_matches
      FROM g_blank_answers(v_q.prompt) b WHERE b.idx <= 5;
    v_correct := v_len > 0 AND v_matches = v_len;
    v_points := CASE WHEN v_len = 0 THEN 0 ELSE round(v_q.points_value * v_matches::numeric / v_len * v_tf)::int END;

  ELSE
    RAISE EXCEPTION 'invalid_answer' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO answers (
    session_id, player_id, question_id, question_index, chosen_index,
    slider_value, reorder_order, open_text, blank_texts, chosen_indices, is_correct, time_taken_ms, points
  ) VALUES (
    p_session_id, p_player_id, v_q.id, v_sess.current_question_index, v_chosen,
    CASE WHEN v_q.type = 'slider' THEN p_slider_value END,
    CASE WHEN v_q.type = 'reorder' THEN p_reorder_order END,
    CASE WHEN v_q.type IN ('open', 'dezoom', 'blocky') THEN left(p_open_text, 500) END,
    CASE WHEN v_q.type = 'blanks' THEN ARRAY(SELECT left(t, 200) FROM unnest(p_blank_texts) AS t) END,
    v_multi,
    v_correct, LEAST(v_taken, v_q.time_limit_ms), v_points
  );

  UPDATE players
     SET score = score + v_points, last_answered_index = v_sess.current_question_index
   WHERE id = p_player_id
   RETURNING score INTO v_score;

  RETURN jsonb_build_object('points', v_points, 'is_correct', v_correct, 'score', v_score);
END $$;

REVOKE ALL ON FUNCTION submit_answer(uuid, uuid, uuid, int, int, int[], text, text[], int[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submit_answer(uuid, uuid, uuid, int, int, int[], text, text[], int[]) TO anon, authenticated;

REVOKE ALL ON FUNCTION host_game_stats(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION quiz_stats(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_recovery_code() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION has_recovery_code() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION reset_password_with_code(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION nickname_uses_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION g_recovery_code() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION g_normalize_code(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION host_game_stats(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION quiz_stats(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION create_recovery_code() TO authenticated;
GRANT EXECUTE ON FUNCTION has_recovery_code() TO authenticated;
GRANT EXECUTE ON FUNCTION reset_password_with_code(text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION nickname_uses_email(text) TO anon, authenticated;
