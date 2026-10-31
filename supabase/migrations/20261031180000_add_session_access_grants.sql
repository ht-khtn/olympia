create table if not exists olympia.session_access_grants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references olympia.live_sessions(id) on delete cascade,
  user_id uuid references public.users(id) on delete cascade,
  access_type text not null check (access_type in ('player', 'mc', 'guest')),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create index if not exists idx_olympia_session_access_grants_lookup
  on olympia.session_access_grants (session_id, access_type, expires_at)
  where revoked_at is null;
