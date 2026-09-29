create or replace function public.create_dating_connection(
  p_user_a uuid,
  p_user_b uuid,
  p_kind text,
  p_shared_films text[] default '{}'::text[]
)
returns table(
  connection_id uuid,
  connection_kind text,
  connection_status text,
  created boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a uuid := least(p_user_a,p_user_b);
  v_b uuid := greatest(p_user_a,p_user_b);
  v_row public.social_connections%rowtype;
  v_lock_key bigint;
begin
  if p_user_a is null or p_user_b is null or p_user_a=p_user_b then
    raise exception 'invalid dating pair';
  end if;

  if p_kind not in ('friend','cinema','romantic') then
    raise exception 'invalid connection kind';
  end if;

  v_lock_key := hashtextextended(v_a::text||':'||v_b::text,0);
  perform pg_advisory_xact_lock(v_lock_key);

  if exists(
    select 1
    from public.user_blocks
    where (blocker_id=v_a and blocked_id=v_b)
       or (blocker_id=v_b and blocked_id=v_a)
  ) then
    raise exception 'dating pair blocked';
  end if;

  insert into public.social_connections(user_a,user_b,kind,status,metadata)
  values(
    v_a,
    v_b,
    p_kind,
    'active',
    jsonb_build_object('shared_films',coalesce(p_shared_films,'{}'::text[]))
  )
  on conflict do nothing
  returning * into v_row;

  if found then
    return query select v_row.id,v_row.kind,v_row.status,true;
    return;
  end if;

  select *
    into v_row
  from public.social_connections
  where least(user_a,user_b)=v_a
    and greatest(user_a,user_b)=v_b
  limit 1;

  if not found then
    raise exception 'connection race could not be resolved';
  end if;

  return query select v_row.id,v_row.kind,v_row.status,false;
end;
$$;

create or replace function public.block_dating_user(
  p_blocker_id uuid,
  p_blocked_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection_ids uuid[];
  v_a uuid := least(p_blocker_id,p_blocked_id);
  v_b uuid := greatest(p_blocker_id,p_blocked_id);
  v_lock_key bigint;
begin
  if p_blocker_id is null or p_blocked_id is null or p_blocker_id=p_blocked_id then
    raise exception 'invalid block pair';
  end if;

  v_lock_key := hashtextextended(v_a::text||':'||v_b::text,0);
  perform pg_advisory_xact_lock(v_lock_key);

  insert into public.user_blocks(blocker_id,blocked_id)
  values(p_blocker_id,p_blocked_id)
  on conflict(blocker_id,blocked_id) do nothing;

  select coalesce(array_agg(id),'{}'::uuid[])
    into v_connection_ids
  from public.social_connections
  where least(user_a,user_b)=v_a
    and greatest(user_a,user_b)=v_b;

  update public.social_connections
  set status='blocked'
  where id=any(v_connection_ids);

  if cardinality(v_connection_ids)>0 then
    update public.notification_queue
    set status='cancelled',
        error='dating block'
    where status='pending'
      and dedupe_key=any(
        select 'match:'||x::text
        from unnest(v_connection_ids) as x
      );
  end if;

  return true;
end;
$$;

revoke all on function public.create_dating_connection(uuid,uuid,text,text[]) from public, anon, authenticated;
revoke all on function public.block_dating_user(uuid,uuid) from public, anon, authenticated;
grant execute on function public.create_dating_connection(uuid,uuid,text,text[]) to service_role;
grant execute on function public.block_dating_user(uuid,uuid) to service_role;
