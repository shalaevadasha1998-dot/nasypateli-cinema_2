-- standalone PWA sessions bootstrapped from a one-time Telegram handoff

create table if not exists public.pwa_handoffs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists pwa_handoffs_user_created_idx
  on public.pwa_handoffs(user_id, created_at desc);

create table if not exists public.pwa_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists pwa_sessions_user_active_idx
  on public.pwa_sessions(user_id, expires_at desc)
  where revoked_at is null;

alter table public.pwa_handoffs enable row level security;
alter table public.pwa_sessions enable row level security;

revoke all on public.pwa_handoffs from public, anon, authenticated;
revoke all on public.pwa_sessions from public, anon, authenticated;
grant select,insert,update,delete on public.pwa_handoffs to service_role;
grant select,insert,update,delete on public.pwa_sessions to service_role;

create or replace function public.consume_pwa_handoff(p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_user_id uuid;
begin
  select h.id,h.user_id
    into v_id,v_user_id
  from public.pwa_handoffs h
  where h.token_hash=p_token_hash
    and h.consumed_at is null
    and h.expires_at>now()
  for update
  limit 1;

  if v_id is null then
    return null;
  end if;

  update public.pwa_handoffs
     set consumed_at=now()
   where id=v_id;

  return v_user_id;
end;
$$;

revoke all on function public.consume_pwa_handoff(text) from public,anon,authenticated;
grant execute on function public.consume_pwa_handoff(text) to service_role;
