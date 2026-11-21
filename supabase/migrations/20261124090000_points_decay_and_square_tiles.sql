/*
  # When points start going down, square blocky tiles

  - questions.points_decay_start_ms: for every question the creator can choose when points
    start going down (full points before, then down to 0 at the time limit). Empty keeps
    each type's usual rule: 3 s for most types, from the start for de-zoom and blocky,
    never for slider and reorder. A value at or past the time limit means never.
  - Blocky: the creator chooses the total number of tiles; the editor stores the columns
    and rows that make square tiles for the picture (reveal_config.cols / rows). Older
    questions with "grid" keep working.
  - Reorder now counts as correct only when every item is in place (was: when it got full
    points, which a time limit could prevent).

  The rules mirror lib/supabase.ts and lib/reveal.ts. Safe to run more than once.
*/

ALTER TABLE questions ADD COLUMN IF NOT EXISTS points_decay_start_ms int;
ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_points_decay_start_ms_check;
ALTER TABLE questions ADD CONSTRAINT questions_points_decay_start_ms_check
  CHECK (points_decay_start_ms IS NULL OR points_decay_start_ms BETWEEN 0 AND 600000);

-- ─── helpers ─────────────────────────────────────────────────────────────────

-- When points start going down for a question, in ms. NULL = never.
CREATE OR REPLACE FUNCTION g_decay_start(p_type text, p_start int)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_start IS NOT NULL THEN p_start
    WHEN p_type IN ('slider', 'reorder') THEN NULL
    WHEN p_type IN ('dezoom', 'blocky') THEN 0
    ELSE 3000 END
$$;

-- 1 until p_start, then down to 0 at the time limit. NULL or a start past the limit: always 1.
CREATE OR REPLACE FUNCTION g_tf(p_taken int, p_limit int, p_start int)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_start IS NULL OR p_taken <= p_start OR p_start >= p_limit THEN RETURN 1; END IF;
  RETURN GREATEST(0, 1 - (LEAST(p_taken, p_limit) - p_start)::numeric / GREATEST(1, p_limit - p_start));
END $$;

-- Tiles of a blocky picture used for the points.
CREATE OR REPLACE FUNCTION g_blocky_total(p_cfg jsonb)
RETURNS int LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_cfg jsonb := coalesce(p_cfg, '{}'::jsonb);
  v_legacy int := round(g_cfg_num(v_cfg -> 'grid', 6, 2, 12));
BEGIN
  IF jsonb_typeof(v_cfg -> 'cols') = 'number' AND jsonb_typeof(v_cfg -> 'rows') = 'number' THEN
    RETURN round(g_cfg_num(v_cfg -> 'cols', 1, 1, 24)) * round(g_cfg_num(v_cfg -> 'rows', 1, 1, 24));
  END IF;
  IF v_cfg ? 'grid' AND jsonb_typeof(v_cfg -> 'grid') <> 'null' THEN
    RETURN v_legacy * v_legacy;
  END IF;
  RETURN round(g_cfg_num(v_cfg -> 'tiles', v_legacy * v_legacy, 4, 144));
END $$;

-- 0 = nothing of the picture shown yet, 1 = all of it.
CREATE OR REPLACE FUNCTION g_reveal_progress(p_type text, p_cfg jsonb, p_limit int, p_taken int)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_cfg jsonb := coalesce(p_cfg, '{}'::jsonb);
  v_total int;
  v_step int;
  v_tiles int;
BEGIN
  IF p_type = 'dezoom' THEN
    RETURN LEAST(1, GREATEST(0, p_taken)::numeric / GREATEST(1, p_limit));
  ELSIF p_type = 'blocky' THEN
    v_total := g_blocky_total(v_cfg);
    v_tiles := round(g_cfg_num(v_cfg -> 'tiles_per_step', 3, 1, v_total));
    v_step := round(g_cfg_num(v_cfg -> 'step_ms', 2000, 500, 30000));
    RETURN LEAST(v_total, v_tiles * floor(GREATEST(0, p_taken)::numeric / v_step))::numeric / v_total;
  END IF;
  RETURN 0;
END $$;

-- Share of the points a right de-zoom or blocky answer still earns: full points until
-- p_start, then less as more of the picture shows, at least 10%.
DROP FUNCTION IF EXISTS g_reveal_factor(text, jsonb, int, int);
CREATE OR REPLACE FUNCTION g_reveal_factor(p_type text, p_cfg jsonb, p_limit int, p_taken int, p_start int)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_start int := coalesce(p_start, p_limit);
  v_at_start numeric;
BEGIN
  IF p_taken <= v_start OR v_start >= p_limit THEN RETURN 1; END IF;
  v_at_start := g_reveal_progress(p_type, p_cfg, p_limit, v_start);
  IF v_at_start >= 1 THEN RETURN 1; END IF;
  RETURN GREATEST(0.1, (1 - g_reveal_progress(p_type, p_cfg, p_limit, p_taken)) / (1 - v_at_start));
END $$;

-- ─── save_quiz: stores points_decay_start_ms ─────────────────────────────────

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
    points_value, info_image_position, reveal_config, points_decay_start_ms
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
    r.points_decay_start_ms
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
    reveal_config = EXCLUDED.reveal_config, points_decay_start_ms = EXCLUDED.points_decay_start_ms;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object('count', v_count);
END $$;

-- ─── submit_answer: uses points_decay_start_ms for every type ────────────────

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
  v_start int;
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
  v_start := g_decay_start(v_q.type, v_q.points_decay_start_ms);
  v_tf := g_tf(v_taken, v_q.time_limit_ms, v_start);

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
REVOKE EXECUTE ON FUNCTION g_decay_start(text, int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION g_tf(int, int, int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION g_blocky_total(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION g_reveal_progress(text, jsonb, int, int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION g_reveal_factor(text, jsonb, int, int, int) FROM PUBLIC, anon, authenticated;
