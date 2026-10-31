-- Harden public Olympia reads. Server actions/endpoints must use the authenticated
-- server context or the service-role client for private answer/control data.

ALTER TABLE IF EXISTS olympia.live_sessions
  ADD COLUMN IF NOT EXISTS player_password_hash text,
  ADD COLUMN IF NOT EXISTS mc_password_hash text,
  ADD COLUMN IF NOT EXISTS player_password_ciphertext text,
  ADD COLUMN IF NOT EXISTS mc_password_ciphertext text;

-- These tables are intentionally readable only through their explicitly granted
-- public columns. Answer keys, notes, correctness, score audit and credentials
-- are not exposed to browser roles.
REVOKE SELECT ON TABLE
  olympia.round_questions,
  olympia.answers,
  olympia.live_sessions,
  olympia.buzzer_events,
  olympia.match_scores,
  olympia.score_changes,
  olympia.session_access_grants,
  olympia.session_password_attempts
FROM anon, authenticated;

GRANT SELECT (
  id,
  match_round_id,
  order_index,
  target_player_id,
  question_text,
  image_path,
  audio_path,
  image_external_url,
  audio_external_url,
  media_path,
  letter_count,
  meta
) ON TABLE olympia.round_questions TO anon, authenticated;

GRANT SELECT (
  id,
  match_id,
  join_code,
  status,
  current_round_id,
  current_round_type,
  current_round_question_id,
  question_state,
  timer_deadline,
  requires_player_password,
  buzzer_enabled,
  show_scoreboard_overlay,
  show_answers_overlay,
  guest_media_control,
  created_at,
  updated_at
) ON TABLE olympia.live_sessions TO anon, authenticated;

GRANT SELECT (
  id,
  match_id,
  round_question_id,
  player_id,
  submitted_at,
  response_time_ms,
  created_at
) ON TABLE olympia.answers TO anon, authenticated;

GRANT SELECT (
  id,
  match_id,
  round_question_id,
  player_id,
  event_type,
  occurred_at
) ON TABLE olympia.buzzer_events TO anon, authenticated;

GRANT SELECT (
  id,
  match_id,
  player_id,
  round_type,
  points
) ON TABLE olympia.match_scores TO anon, authenticated;

-- No browser role needs direct access to private grants, password attempts or
-- audit history. Realtime events remain public only after their trigger payload
-- has been sanitized by the companion migration below.

ALTER TABLE IF EXISTS olympia.session_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS olympia.session_password_attempts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION olympia.record_buzzer(
  p_session_id uuid,
  p_round_question_id uuid,
  p_player_id uuid,
  p_event_type text
)
RETURNS TABLE (event_id uuid, result text, occurred_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = olympia, public
AS $$
DECLARE
  v_match_id uuid;
  v_reset_at timestamptz;
  v_has_winner boolean;
BEGIN
  IF p_event_type NOT IN ('buzz', 'steal') THEN
    RAISE EXCEPTION 'Invalid buzzer event type';
  END IF;

  SELECT ls.match_id INTO v_match_id
    FROM olympia.live_sessions AS ls
   WHERE ls.id = p_session_id
     AND ls.current_round_question_id = p_round_question_id
     AND ls.status = 'running'
     AND ls.buzzer_enabled = true;
  IF v_match_id IS NULL THEN RAISE EXCEPTION 'Buzzer is not available'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM olympia.match_players AS mp
     WHERE mp.id = p_player_id
       AND mp.match_id = v_match_id
       AND mp.participant_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Player is not part of this match';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_round_question_id::text, 0));

  SELECT be.occurred_at INTO v_reset_at
    FROM olympia.buzzer_events AS be
   WHERE be.round_question_id = p_round_question_id
     AND be.event_type = 'reset'
   ORDER BY be.occurred_at DESC, be.created_at DESC
   LIMIT 1;

  SELECT EXISTS (
    SELECT 1 FROM olympia.buzzer_events AS be
     WHERE be.round_question_id = p_round_question_id
       AND be.event_type = p_event_type
       AND be.result = 'win'
       AND (v_reset_at IS NULL OR be.occurred_at >= v_reset_at)
  ) INTO v_has_winner;

  INSERT INTO olympia.buzzer_events (
    match_id, round_question_id, player_id, event_type, result, occurred_at
  )
  VALUES (
    v_match_id, p_round_question_id, p_player_id, p_event_type,
    CASE WHEN v_has_winner THEN 'lose' ELSE 'win' END, clock_timestamp()
  )
  RETURNING id, buzzer_events.result, buzzer_events.occurred_at
    INTO event_id, result, occurred_at;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION olympia.record_buzzer(uuid, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION olympia.record_buzzer(uuid, uuid, uuid, text) TO authenticated;
