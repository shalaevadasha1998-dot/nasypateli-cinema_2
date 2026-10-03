create table if not exists public.event_screen_status (
  event_id uuid primary key references public.events(id) on delete cascade,
  audio_unlocked boolean not null default false,
  last_seen_at timestamptz,
  test_nonce text,
  test_asset_key text,
  updated_at timestamptz not null default now()
);

alter table public.event_screen_status enable row level security;

revoke all on public.event_screen_status from anon, authenticated, public;
grant select,insert,update,delete on public.event_screen_status to service_role;

create index if not exists event_screen_status_seen_idx
  on public.event_screen_status(last_seen_at desc);
