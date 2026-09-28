create or replace function public.set_event_capacity(
  p_event_id uuid,
  p_capacity integer
)
returns table(
  capacity integer,
  promoted integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.event_status;
  v_occupied integer;
  v_promoted integer := 0;
begin
  if p_capacity < 1 or p_capacity > 500 then
    raise exception 'capacity must be between 1 and 500';
  end if;

  select e.status
    into v_status
  from public.events e
  where e.id = p_event_id
  for update;

  if not found then
    raise exception 'event not found';
  end if;

  select count(*)::integer
    into v_occupied
  from public.registrations r
  where r.event_id = p_event_id
    and (
      r.status in ('paid','attended')
      or (r.status='reserved' and r.reservation_expires_at > now())
    );

  if p_capacity < v_occupied then
    raise exception 'capacity below occupied seats: %', v_occupied;
  end if;

  update public.events
  set capacity = p_capacity
  where id = p_event_id;

  if v_status = 'SALES_OPEN'::public.event_status and p_capacity > v_occupied then
    v_promoted := public.promote_event_waitlist(p_event_id);
  end if;

  return query select p_capacity, v_promoted;
end;
$$;

revoke all on function public.set_event_capacity(uuid,integer) from public, anon, authenticated;
grant execute on function public.set_event_capacity(uuid,integer) to service_role;

create or replace function public.grant_test_ticket(
  p_event_id uuid,
  p_user_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capacity integer;
  v_existing_status text;
  v_existing_expires timestamptz;
  v_occupied integer;
  v_waitlisted integer;
begin
  select e.capacity
    into v_capacity
  from public.events e
  where e.id = p_event_id
  for update;

  if not found then
    raise exception 'event not found';
  end if;

  select r.status, r.reservation_expires_at
    into v_existing_status, v_existing_expires
  from public.registrations r
  where r.event_id = p_event_id
    and r.user_id = p_user_id
  for update;

  if v_existing_status in ('paid','attended') then
    return v_existing_status;
  end if;

  if v_existing_status='reserved'
     and v_existing_expires is not null
     and v_existing_expires > now() then
    update public.registrations
    set status='paid',
        queue_position=null,
        payment_provider='test',
        provider_payment_id=null,
        amount_rub=0,
        paid_at=now(),
        reservation_expires_at=null
    where event_id=p_event_id
      and user_id=p_user_id;
    return 'paid';
  end if;

  select count(*)::integer
    into v_waitlisted
  from public.registrations r
  where r.event_id = p_event_id
    and r.status='waitlist';

  if v_waitlisted > 0 then
    raise exception 'test ticket blocked by active waitlist';
  end if;

  select count(*)::integer
    into v_occupied
  from public.registrations r
  where r.event_id = p_event_id
    and (
      r.status in ('paid','attended')
      or (r.status='reserved' and r.reservation_expires_at > now())
    );

  if v_occupied >= v_capacity then
    raise exception 'event is full';
  end if;

  insert into public.registrations(
    event_id,user_id,status,queue_position,payment_provider,provider_payment_id,
    amount_rub,paid_at,reservation_expires_at
  ) values (
    p_event_id,p_user_id,'paid',null,'test',null,0,now(),null
  )
  on conflict(event_id,user_id) do update set
    status='paid',
    queue_position=null,
    payment_provider='test',
    provider_payment_id=null,
    amount_rub=0,
    paid_at=excluded.paid_at,
    reservation_expires_at=null;

  return 'paid';
end;
$$;

revoke all on function public.grant_test_ticket(uuid,uuid) from public, anon, authenticated;
grant execute on function public.grant_test_ticket(uuid,uuid) to service_role;
