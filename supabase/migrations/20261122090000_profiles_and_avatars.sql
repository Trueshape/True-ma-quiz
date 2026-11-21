/*
  # Profiles: unique usernames and profile pictures

  Every account has a profile with a public username (4 to 20 characters, unique without
  regard to case) and an optional picture. Accounts made with a nickname and a password
  get their profile automatically; people who sign in with Google choose theirs on the
  profile page through set_profile.

  - profiles: readable by everyone, written only by the functions below
  - nickname_available: tells whether a username is free (the signup form uses it)
  - set_profile: creates or updates the signed-in user's profile
  - create_quiz: the quiz author name now comes from the profile
  - avatars bucket: public, jpg and png only, 1 MB at most, each user writes only inside
    the folder named after their own id

  Additive: safe to run before the new pages are live.
*/

CREATE TABLE IF NOT EXISTS profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nickname text NOT NULL CHECK (char_length(nickname) BETWEEN 4 AND 20),
  avatar_url text CHECK (avatar_url IS NULL OR char_length(avatar_url) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS profiles_nickname_key ON profiles (lower(nickname));
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "profiles_select" ON profiles;
CREATE POLICY "profiles_select" ON profiles FOR SELECT TO anon, authenticated USING (true);
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON profiles FROM anon, authenticated;

-- Existing accounts keep the nickname they registered with.
INSERT INTO profiles (user_id, nickname)
SELECT id, btrim(raw_user_meta_data ->> 'nickname')
FROM auth.users
WHERE char_length(btrim(coalesce(raw_user_meta_data ->> 'nickname', ''))) BETWEEN 4 AND 20
ON CONFLICT DO NOTHING;

-- New nickname-and-password accounts claim their username when they are created. A name
-- that is already taken stops the signup (the form checks nickname_available first).
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_nick text := btrim(coalesce(NEW.raw_user_meta_data ->> 'nickname', ''));
BEGIN
  IF char_length(v_nick) BETWEEN 4 AND 20 THEN
    INSERT INTO profiles (user_id, nickname) VALUES (NEW.id, v_nick);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;
CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

CREATE OR REPLACE FUNCTION nickname_available(p_nickname text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT char_length(btrim(coalesce(p_nickname, ''))) BETWEEN 4 AND 20
    AND NOT EXISTS (
      SELECT 1 FROM profiles p
      WHERE lower(p.nickname) = lower(btrim(p_nickname)) AND p.user_id IS DISTINCT FROM auth.uid()
    )
$$;

-- p_avatar_url: NULL keeps the current picture, '' removes it, otherwise it must be a
-- public URL of the user's own file in the avatars bucket.
CREATE OR REPLACE FUNCTION set_profile(p_nickname text, p_avatar_url text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_nick text := btrim(coalesce(p_nickname, ''));
  v_profile profiles;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;
  IF char_length(v_nick) < 4 OR char_length(v_nick) > 20 THEN
    RAISE EXCEPTION 'invalid_nickname' USING ERRCODE = 'P0001';
  END IF;
  IF p_avatar_url IS NOT NULL AND p_avatar_url <> ''
     AND (char_length(p_avatar_url) > 500
          OR left(p_avatar_url, 8) <> 'https://'
          OR position('/storage/v1/object/public/avatars/' || v_uid::text || '/avatar' IN p_avatar_url) = 0) THEN
    RAISE EXCEPTION 'invalid_avatar' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    INSERT INTO profiles (user_id, nickname, avatar_url)
    VALUES (v_uid, v_nick, nullif(p_avatar_url, ''))
    ON CONFLICT (user_id) DO UPDATE
      SET nickname = EXCLUDED.nickname,
          avatar_url = CASE WHEN p_avatar_url IS NULL THEN profiles.avatar_url ELSE nullif(p_avatar_url, '') END,
          updated_at = now()
    RETURNING * INTO v_profile;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'nickname_taken' USING ERRCODE = 'P0001';
  END;

  RETURN to_jsonb(v_profile);
END $$;

REVOKE ALL ON FUNCTION nickname_available(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION set_profile(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION nickname_available(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION set_profile(text, text) TO authenticated;

-- The author name of a new quiz comes from the profile (the sign-in token is the fallback).
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
    SELECT nickname INTO v_by FROM profiles WHERE user_id = v_uid;
    IF v_by IS NULL THEN
      v_by := nullif(btrim(coalesce(auth.jwt() -> 'user_metadata' ->> 'nickname', '')), '');
    END IF;
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

-- Profile pictures: public bucket, jpg and png only, 1 MB at most.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 1048576, ARRAY['image/jpeg', 'image/png'])
ON CONFLICT (id) DO UPDATE
  SET public = true, file_size_limit = 1048576, allowed_mime_types = ARRAY['image/jpeg', 'image/png'];

DROP POLICY IF EXISTS "avatars_select_own" ON storage.objects;
DROP POLICY IF EXISTS "avatars_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "avatars_update_own" ON storage.objects;
DROP POLICY IF EXISTS "avatars_delete_own" ON storage.objects;

-- Needed so a user can replace or remove their own file (public reads do not use it).
CREATE POLICY "avatars_select_own" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "avatars_insert_own" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "avatars_update_own" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "avatars_delete_own" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
