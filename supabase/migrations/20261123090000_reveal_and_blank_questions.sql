/*
  # New question types: dezoom, blocky, blanks

  - dezoom: an image starts zoomed in on a chosen point and zooms out during the question
  - blocky: an image made of grid x grid squares that appear a few at a time
  - blanks: a sentence with 1 to 5 gaps written as {{answer|other accepted answer}}

  Dezoom and blocky answers are typed and matched like open answers (accepted answers in
  open_answers). Their points depend on how much of the image was visible: full points
  before anything is revealed, at least 10% at the end. Blanks give points for each right
  gap, with the usual time factor. The rules mirror lib/reveal.ts.

  - questions.reveal_config: settings of the three types (zoom, grid, timing, hints)
  - answers.blank_texts: what a player wrote in each gap
  - submit_answer gets p_blank_texts (the old signature is replaced)
  - question-images bucket: pictures uploaded from the editor (already resized there)

  Additive: safe to run before the new pages are live, and needed before they are.
*/

ALTER TABLE questions ADD COLUMN IF NOT EXISTS reveal_config jsonb;
ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_reveal_config_check;
ALTER TABLE questions ADD CONSTRAINT questions_reveal_config_check
  CHECK (reveal_config IS NULL OR (jsonb_typeof(reveal_config) = 'object' AND length(reveal_config::text) <= 1000));

ALTER TABLE answers ADD COLUMN IF NOT EXISTS blank_texts text[];

ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_type_check;
ALTER TABLE questions ADD CONSTRAINT questions_type_check
  CHECK (type = ANY (ARRAY['mc', 'tf', 'info', 'slider', 'reorder', 'open', 'dezoom', 'blocky', 'blanks']));

-- ─── helpers ─────────────────────────────────────────────────────────────────

-- A typed answer is right when it is close enough to one of the accepted answers
-- (same rule as open questions: exact for short answers, 80% similar otherwise).
CREATE OR REPLACE FUNCTION g_text_ok(p_text text, p_accepted text[])
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_user text := g_norm(left(coalesce(p_text, ''), 500));
  v_ans text;
  v_norm text;
  v_need numeric;
BEGIN
  IF btrim(coalesce(p_text, '')) = '' THEN RETURN false; END IF;
  FOREACH v_ans IN ARRAY coalesce(p_accepted, ARRAY[]::text[]) LOOP
    v_norm := g_norm(v_ans);
    CONTINUE WHEN v_norm = '';
    v_need := CASE WHEN length(v_norm) < 6 THEN 1 ELSE 0.8 END;
    IF g_sim(v_user, v_norm) >= v_need THEN
      RETURN true;
    END IF;
  END LOOP;
  RETURN false;
END $$;

-- A number from the settings, or the default, kept between min and max.
CREATE OR REPLACE FUNCTION g_cfg_num(p_value jsonb, p_default numeric, p_min numeric, p_max numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT LEAST(p_max, GREATEST(p_min,
    CASE WHEN jsonb_typeof(p_value) = 'number' THEN p_value::text::numeric ELSE p_default END))
$$;

-- Share of the points a right dezoom or blocky answer still earns after p_taken ms.
CREATE OR REPLACE FUNCTION g_reveal_factor(p_type text, p_cfg jsonb, p_limit int, p_taken int)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_cfg jsonb := coalesce(p_cfg, '{}'::jsonb);
  v_progress numeric := 0;
  v_grid int;
  v_step int;
  v_tiles int;
BEGIN
  IF p_type = 'dezoom' THEN
    v_progress := LEAST(1, GREATEST(0, p_taken)::numeric / GREATEST(1, p_limit));
  ELSIF p_type = 'blocky' THEN
    v_grid := round(g_cfg_num(v_cfg -> 'grid', 6, 2, 12));
    v_tiles := round(g_cfg_num(v_cfg -> 'tiles_per_step', 3, 1, v_grid * v_grid));
    v_step := round(g_cfg_num(v_cfg -> 'step_ms', 2000, 500, 30000));
    v_progress := LEAST(v_grid * v_grid, v_tiles * floor(GREATEST(0, p_taken)::numeric / v_step))::numeric / (v_grid * v_grid);
  END IF;
  RETURN GREATEST(0.1, 1 - v_progress);
END $$;

-- The gaps of a blanks sentence, in order, each with its accepted answers.
CREATE OR REPLACE FUNCTION g_blank_answers(p_prompt text)
RETURNS TABLE (idx int, accepted text[]) LANGUAGE sql IMMUTABLE AS $$
  SELECT t.ord::int,
         ARRAY(SELECT btrim(a) FROM unnest(string_to_array(t.m[1], '|')) AS a WHERE btrim(a) <> '')
  FROM regexp_matches(coalesce(p_prompt, ''), '\{\{([^{}]*)\}\}', 'g') WITH ORDINALITY AS t(m, ord)
$$;

-- ─── save_quiz: stores reveal_config, checks the gaps of blanks questions ─────

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
    points_value, info_image_position, reveal_config
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
    CASE WHEN jsonb_typeof(r.reveal_config) = 'object' THEN r.reveal_config END
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
    reveal_config = EXCLUDED.reveal_config;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('count', v_count);
END $$;

-- ─── submit_answer: scores the new types ─────────────────────────────────────

DROP FUNCTION IF EXISTS submit_answer(uuid, uuid, uuid, int, int, int[], text);

CREATE OR REPLACE FUNCTION submit_answer(
  p_session_id uuid,
  p_player_id uuid,
  p_token uuid,
  p_chosen_index int DEFAULT NULL,
  p_slider_value int DEFAULT NULL,
  p_reorder_order int[] DEFAULT NULL,
  p_open_text text DEFAULT NULL,
  p_blank_texts text[] DEFAULT NULL
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
    v_correct := g_text_ok(p_open_text, v_q.open_answers);
    v_points := CASE WHEN v_correct THEN round(v_q.points_value * v_tf)::int ELSE 0 END;

  ELSIF v_q.type IN ('dezoom', 'blocky') THEN
    IF p_open_text IS NULL OR btrim(p_open_text) = '' THEN
      RAISE EXCEPTION 'invalid_answer' USING ERRCODE = 'P0001';
    END IF;
    v_correct := g_text_ok(p_open_text, v_q.open_answers);
    v_points := CASE WHEN v_correct
      THEN round(v_q.points_value * g_reveal_factor(v_q.type, v_q.reveal_config, v_q.time_limit_ms, v_taken))::int
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
    slider_value, reorder_order, open_text, blank_texts, is_correct, time_taken_ms, points
  ) VALUES (
    p_session_id, p_player_id, v_q.id, v_sess.current_question_index, v_chosen,
    CASE WHEN v_q.type = 'slider' THEN p_slider_value END,
    CASE WHEN v_q.type = 'reorder' THEN p_reorder_order END,
    CASE WHEN v_q.type IN ('open', 'dezoom', 'blocky') THEN left(p_open_text, 500) END,
    CASE WHEN v_q.type = 'blanks' THEN ARRAY(SELECT left(t, 200) FROM unnest(p_blank_texts) AS t) END,
    v_correct, LEAST(v_taken, v_q.time_limit_ms), v_points
  );

  UPDATE players
     SET score = score + v_points, last_answered_index = v_sess.current_question_index
   WHERE id = p_player_id
   RETURNING score INTO v_score;

  RETURN jsonb_build_object('points', v_points, 'is_correct', v_correct, 'score', v_score);
END $$;

REVOKE ALL ON FUNCTION submit_answer(uuid, uuid, uuid, int, int, int[], text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION submit_answer(uuid, uuid, uuid, int, int, int[], text, text[]) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION g_text_ok(text, text[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION g_cfg_num(jsonb, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION g_reveal_factor(text, jsonb, int, int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION g_blank_answers(text) FROM PUBLIC, anon, authenticated;

-- ─── question-images bucket ──────────────────────────────────────────────────
-- Pictures uploaded from the editor. The editor resizes them (longest side 1600 px) and
-- saves them as JPEG, so 2 MB is plenty. Each account writes only in its own folder.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('question-images', 'question-images', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = true, file_size_limit = 2097152, allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS "question_images_insert_own" ON storage.objects;
CREATE POLICY "question_images_insert_own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'question-images' AND (storage.foldername(name))[1] = auth.uid()::text);
