
-- Atomic reservation to avoid overselling when several people buy at once.
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
set search_path = public
as $$
declare
  v_capacity int;
  v_occupied int;
  v_queue int;
  v_expires timestamptz;
  v_existing_status text;
begin
  select e.capacity into v_capacity
  from public.events e
  where e.id = p_event_id
  for update;

  if v_capacity is null then
    raise exception 'event not found';
  end if;

  select r.status into v_existing_status
  from public.registrations r
  where r.event_id = p_event_id and r.user_id = p_user_id;

  if v_existing_status in ('paid','attended') then
    return query select v_existing_status, null::int, null::timestamptz;
    return;
  end if;

  select count(*)::int into v_occupied
  from public.registrations r
  where r.event_id = p_event_id
    and r.user_id <> p_user_id
    and (
      r.status in ('paid','attended')
      or (r.status = 'reserved' and r.reservation_expires_at > now())
    );

  if v_occupied >= v_capacity then
    select coalesce(max(r.queue_position),0) + 1 into v_queue
    from public.registrations r
    where r.event_id = p_event_id and r.status = 'waitlist';

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

alter table public.events add column if not exists winner_user_id uuid references public.users(id) on delete set null;
