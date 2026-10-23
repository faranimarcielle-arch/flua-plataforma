-- Google connection made with the "Conectar Google Agenda" button in the teacher panel.
-- No policies: only the server function (service role) can read or write these tables.
create table if not exists public.google_credentials (
  id int primary key default 1 check (id = 1),
  refresh_token text not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.google_oauth_state (
  state text primary key,
  created_at timestamptz not null default now()
);
alter table public.google_credentials enable row level security;
alter table public.google_oauth_state enable row level security;
revoke all on public.google_credentials, public.google_oauth_state from public, anon, authenticated;
