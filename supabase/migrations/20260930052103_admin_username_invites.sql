create table if not exists public.admin_invites (
  telegram_username text primary key,
  role text not null default 'organizer',
  claimed_by uuid references public.users(id) on delete set null,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  check (telegram_username = lower(telegram_username)),
  check (telegram_username !~ '^@')
);

alter table public.admin_invites enable row level security;

revoke all on public.admin_invites from public, anon, authenticated;
grant select,insert,update,delete on public.admin_invites to service_role;

create index if not exists admin_invites_claimed_by_idx
  on public.admin_invites(claimed_by)
  where claimed_by is not null;
