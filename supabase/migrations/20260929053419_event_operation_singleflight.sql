create table if not exists public.event_operation_locks (
  event_id uuid not null references public.events(id) on delete cascade,
  operation text not null,
  lease_token uuid not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key(event_id,operation)
);

alter table public.event_operation_locks enable row level security;

create or replace function public.acquire_event_operation(
  p_event_id uuid,
  p_operation text,
  p_ttl_seconds integer default 180
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token uuid := gen_random_uuid();
  v_ttl integer := greatest(15,least(coalesce(p_ttl_seconds,180),900));
begin
  insert into public.event_operation_locks(event_id,operation,lease_token,expires_at,updated_at)
  values(p_event_id,p_operation,v_token,now()+make_interval(secs=>v_ttl),now())
  on conflict(event_id,operation) do update
    set lease_token=excluded.lease_token,
        expires_at=excluded.expires_at,
        updated_at=now()
    where public.event_operation_locks.expires_at<=now();

  if exists(
    select 1 from public.event_operation_locks
    where event_id=p_event_id
      and operation=p_operation
      and lease_token=v_token
  ) then
    return v_token;
  end if;

  return null;
end;
$$;

create or replace function public.release_event_operation(
  p_event_id uuid,
  p_operation text,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.event_operation_locks
  where event_id=p_event_id
    and operation=p_operation
    and lease_token=p_lease_token;
  return found;
end;
$$;

revoke all on function public.acquire_event_operation(uuid,text,integer) from public, anon, authenticated;
revoke all on function public.release_event_operation(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.acquire_event_operation(uuid,text,integer) to service_role;
grant execute on function public.release_event_operation(uuid,text,uuid) to service_role;
