/*
  # Lock down quizzes and lobby codes (phase B)

  Apply ONLY after the frontend that uses the functions from
  20261018090000_quiz_and_lobby_functions.sql is deployed. The previous frontend writes
  quizzes and questions directly and reads session codes from the sessions table; it
  stops working once this runs.

  After this migration:
  - quizzes and questions can only be written through create_quiz / save_quiz /
    delete_quiz / set_quiz_public, so a guest quiz can only be changed by its creator.
  - sessions no longer contain the lobby code. Codes live in session_codes, which no
    client can read, so listing sessions does not reveal how to join them.
*/

DROP POLICY IF EXISTS "auth_insert_quizzes" ON quizzes;
DROP POLICY IF EXISTS "anon_insert_guest_quizzes" ON quizzes;
DROP POLICY IF EXISTS "auth_update_quizzes" ON quizzes;
DROP POLICY IF EXISTS "anon_update_guest_quizzes" ON quizzes;
DROP POLICY IF EXISTS "auth_delete_quizzes" ON quizzes;
DROP POLICY IF EXISTS "anon_delete_guest_quizzes" ON quizzes;

DROP POLICY IF EXISTS "auth_insert_questions" ON questions;
DROP POLICY IF EXISTS "anon_insert_guest_questions" ON questions;
DROP POLICY IF EXISTS "auth_update_questions" ON questions;
DROP POLICY IF EXISTS "anon_update_guest_questions" ON questions;
DROP POLICY IF EXISTS "auth_delete_questions" ON questions;
DROP POLICY IF EXISTS "anon_delete_guest_questions" ON questions;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON quizzes, questions FROM anon, authenticated;

ALTER TABLE sessions ALTER COLUMN code DROP NOT NULL;
UPDATE sessions SET code = NULL;

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

  INSERT INTO sessions (quiz_id, status) VALUES (p_quiz_id, 'lobby') RETURNING * INTO v_session;
  INSERT INTO session_codes (session_id, code) VALUES (v_session.id, p_code);
  INSERT INTO session_secrets (session_id) VALUES (v_session.id) RETURNING host_token INTO v_token;

  RETURN jsonb_build_object('session', to_jsonb(v_session), 'host_token', v_token, 'code', p_code);
END $$;

REVOKE EXECUTE ON FUNCTION join_session(uuid, text) FROM anon, authenticated;
