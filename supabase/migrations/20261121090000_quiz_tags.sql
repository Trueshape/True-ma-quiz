/*
  # Quiz tags

  Quizzes get up to 10 tags. They are written by save_quiz (the editor sends them in the
  meta object) and read like any other quiz column, so public tags can be searched in the
  library. Additive: safe to run before the new frontend is deployed, but run it before,
  because the new pages select the tags column.
*/

ALTER TABLE quizzes ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS quizzes_tags_idx ON quizzes USING gin (tags);

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
