CREATE TABLE IF NOT EXISTS olympia.session_password_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES olympia.live_sessions(id) ON DELETE CASCADE,
  access_type text NOT NULL CHECK (access_type IN ('player', 'mc')),
  attempt_key_hash text NOT NULL,
  succeeded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS session_password_attempts_lookup_idx
  ON olympia.session_password_attempts (session_id, access_type, attempt_key_hash, created_at DESC)
  WHERE succeeded = false;
