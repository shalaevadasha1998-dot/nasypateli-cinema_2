create index if not exists registrations_waitlist_order_idx
  on public.registrations(event_id, queue_position, created_at)
  where status='waitlist';

create or replace function public.promote_event_waitlist(p_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capacity integer;
  v_status public.event_status;
  v_occupied integer;
  v_free integer;
  v_next_id uuid;
  v_next_user uuid;
  v_expires timestamptz;
  v_promoted integer := 0;
begin
  select e.capacity, e.status
    into v_capacity, v_status
  from public.events e
  where e.id = p_event_id
  for update;

  if v_capacity is null then
    raise exception 'event not found';
  end if;

  if v_status <> 'SALES_OPEN'::public.event_status then
    return 0;
  end if;

  select count(*)::integer
    into v_occupied
  from public.registrations r
  where r.event_id = p_event_id
    and (
      r.status in ('paid','attended')
      or (r.status='reserved' and r.reservation_expires_at > now())
    );

  v_free := greatest(0, v_capacity - v_occupied);

  while v_free > 0 loop
    select r.id, r.user_id
      into v_next_id, v_next_user
    from public.registrations r
    where r.event_id = p_event_id
      and r.status = 'waitlist'
    order by r.queue_position asc nulls last, r.created_at asc, r.id asc
    limit 1
    for update;

    exit when not found;

    v_expires := now() + interval '15 minutes';

    update public.registrations
    set status='reserved',
        queue_position=null,
        reservation_expires_at=v_expires
    where id=v_next_id;

    insert into public.notification_queue(
      user_id, kind, text, send_after, status, dedupe_key
    ) values (
      v_next_user,
      'tickets',
      'освободилось место. держим его за вами 15 минут. откройте мини-приложение и оплатите билет.',
      now(),
      'pending',
      'waitlist_promoted:' || p_event_id::text || ':' || v_next_user::text || ':' || extract(epoch from v_expires)::bigint::text
    )
    on conflict (user_id, dedupe_key) do nothing;

    v_promoted := v_promoted + 1;
    v_free := v_free - 1;
  end loop;

  with ranked as (
    select r.id,
           row_number() over (
             order by r.queue_position asc nulls last, r.created_at asc, r.id asc
           )::integer as new_position
    from public.registrations r
    where r.event_id = p_event_id
      and r.status = 'waitlist'
  )
  update public.registrations r
  set queue_position = ranked.new_position
  from ranked
  where r.id = ranked.id
    and r.queue_position is distinct from ranked.new_position;

  return v_promoted;
end;
$$;

revoke all on function public.promote_event_waitlist(uuid) from public, anon, authenticated;
grant execute on function public.promote_event_waitlist(uuid) to service_role;

create or replace function public.reserve_event_spot(
  p_event_id uuid,
  p_user_id uuid,
  p_amount_rub int,
  p_photo_video_consent boolean default false
)
returns table(
  reservation_status text,
  queue_position int,
  reservation_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capacity int;
  v_occupied int;
  v_queue int;
  v_expires timestamptz;
  v_existing_status text;
  v_existing_queue int;
  v_existing_expires timestamptz;
begin
  select e.capacity
    into v_capacity
  from public.events e
  where e.id = p_event_id
  for update;

  if v_capacity is null then
    raise exception 'event not found';
  end if;

  perform public.promote_event_waitlist(p_event_id);

  select r.status, r.queue_position, r.reservation_expires_at
    into v_existing_status, v_existing_queue, v_existing_expires
  from public.registrations r
  where r.event_id = p_event_id
    and r.user_id = p_user_id;

  if v_existing_status in ('paid','attended') then
    return query select v_existing_status, null::int, null::timestamptz;
    return;
  end if;

  if v_existing_status='reserved'
     and v_existing_expires is not null
     and v_existing_expires > now() then
    return query select 'reserved'::text, null::int, v_existing_expires;
    return;
  end if;

  if v_existing_status='waitlist' then
    return query select 'waitlist'::text, v_existing_queue, null::timestamptz;
    return;
  end if;

  select count(*)::int
    into v_occupied
  from public.registrations r
  where r.event_id = p_event_id
    and r.user_id <> p_user_id
    and (
      r.status in ('paid','attended')
      or (r.status='reserved' and r.reservation_expires_at > now())
    );

  if v_occupied >= v_capacity then
    select coalesce(max(r.queue_position),0) + 1
      into v_queue
    from public.registrations r
    where r.event_id = p_event_id
      and r.status='waitlist';

    insert into public.registrations(
      event_id,user_id,status,queue_position,amount_rub,photo_video_consent,reservation_expires_at
    ) values (
      p_event_id,p_user_id,'waitlist',v_queue,p_amount_rub,p_photo_video_consent,null
    )
    on conflict(event_id,user_id) do update set
      status='waitlist',
      queue_position=excluded.queue_position,
      amount_rub=excluded.amount_rub,
      photo_video_consent=excluded.photo_video_consent,
      reservation_expires_at=null;

    return query select 'waitlist'::text, v_queue, null::timestamptz;
    return;
  end if;

  v_expires := now() + interval '15 minutes';

  insert into public.registrations(
    event_id,user_id,status,queue_position,amount_rub,photo_video_consent,reservation_expires_at
  ) values (
    p_event_id,p_user_id,'reserved',null,p_amount_rub,p_photo_video_consent,v_expires
  )
  on conflict(event_id,user_id) do update set
    status='reserved',
    queue_position=null,
    amount_rub=excluded.amount_rub,
    photo_video_consent=excluded.photo_video_consent,
    reservation_expires_at=excluded.reservation_expires_at;

  return query select 'reserved'::text, null::int, v_expires;
end;
$$;

revoke all on function public.reserve_event_spot(uuid,uuid,int,boolean) from public, anon, authenticated;
grant execute on function public.reserve_event_spot(uuid,uuid,int,boolean) to service_role;
