-- harden Telegram payment confirmation against duplicate callbacks and race conditions

create unique index if not exists registrations_provider_payment_id_uidx
  on public.registrations(provider_payment_id)
  where provider_payment_id is not null;

create unique index if not exists registrations_telegram_charge_id_uidx
  on public.registrations(telegram_payment_charge_id)
  where telegram_payment_charge_id is not null;

create or replace function public.authorize_telegram_checkout(
  p_event_id uuid,
  p_user_id uuid,
  p_amount_rub integer
)
returns table(ok boolean, reason text, reservation_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.event_status;
  v_reg public.registrations%rowtype;
  v_exp timestamptz;
begin
  select e.status into v_status
  from public.events e
  where e.id=p_event_id
  for update;

  if not found then
    return query select false,'event_not_found'::text,null::timestamptz;
    return;
  end if;

  if v_status <> 'SALES_OPEN'::public.event_status then
    return query select false,'sales_closed'::text,null::timestamptz;
    return;
  end if;

  select * into v_reg
  from public.registrations
  where event_id=p_event_id and user_id=p_user_id
  for update;

  if not found then
    return query select false,'reservation_not_found'::text,null::timestamptz;
    return;
  end if;

  if v_reg.status='paid' then
    return query select false,'already_paid'::text,null::timestamptz;
    return;
  end if;

  if v_reg.status<>'reserved' then
    return query select false,'reservation_not_active'::text,null::timestamptz;
    return;
  end if;

  if v_reg.amount_rub is distinct from p_amount_rub then
    return query select false,'amount_mismatch'::text,v_reg.reservation_expires_at;
    return;
  end if;

  if v_reg.reservation_expires_at is null or v_reg.reservation_expires_at<=now() then
    return query select false,'reservation_expired'::text,v_reg.reservation_expires_at;
    return;
  end if;

  v_exp:=greatest(v_reg.reservation_expires_at,now()+interval '3 minutes');
  update public.registrations
  set reservation_expires_at=v_exp
  where id=v_reg.id;

  return query select true,null::text,v_exp;
end;
$$;

revoke all on function public.authorize_telegram_checkout(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.authorize_telegram_checkout(uuid,uuid,integer) to service_role;

create or replace function public.confirm_telegram_payment(
  p_event_id uuid,
  p_user_id uuid,
  p_amount_rub integer,
  p_provider_payment_id text,
  p_telegram_charge_id text
)
returns table(
  registration_id uuid,
  status text,
  already_confirmed boolean,
  seats_left integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capacity integer;
  v_reg public.registrations%rowtype;
  v_paid integer;
begin
  select e.capacity into v_capacity
  from public.events e
  where e.id=p_event_id
  for update;

  if not found then raise exception 'event not found'; end if;

  select * into v_reg
  from public.registrations
  where event_id=p_event_id and user_id=p_user_id
  for update;

  if not found then raise exception 'registration not found'; end if;
  if v_reg.amount_rub is distinct from p_amount_rub then raise exception 'payment amount mismatch'; end if;

  if v_reg.status='paid' then
    if (v_reg.telegram_payment_charge_id is not null and v_reg.telegram_payment_charge_id is distinct from p_telegram_charge_id)
       or (v_reg.provider_payment_id is not null and v_reg.provider_payment_id is distinct from p_provider_payment_id) then
      raise exception 'registration already paid with another charge';
    end if;
    select count(*)::integer into v_paid
      from public.registrations
      where event_id=p_event_id and status in ('paid','attended');
    return query select v_reg.id,'paid'::text,true,greatest(0,v_capacity-v_paid);
    return;
  end if;

  if v_reg.status<>'reserved' then raise exception 'registration is not payable'; end if;
  if v_reg.reservation_expires_at is null or v_reg.reservation_expires_at<=now() then
    raise exception 'reservation expired before payment confirmation';
  end if;

  if exists(
    select 1 from public.registrations r
    where r.id<>v_reg.id
      and (
        (p_telegram_charge_id is not null and r.telegram_payment_charge_id=p_telegram_charge_id)
        or (p_provider_payment_id is not null and r.provider_payment_id=p_provider_payment_id)
      )
  ) then
    raise exception 'duplicate payment charge';
  end if;

  update public.registrations
  set status='paid',
      paid_at=now(),
      reservation_expires_at=null,
      provider_payment_id=p_provider_payment_id,
      telegram_payment_charge_id=p_telegram_charge_id,
      payment_provider='telegram'
  where id=v_reg.id;

  select count(*)::integer into v_paid
    from public.registrations
    where event_id=p_event_id and status in ('paid','attended');

  return query select v_reg.id,'paid'::text,false,greatest(0,v_capacity-v_paid);
end;
$$;

revoke all on function public.confirm_telegram_payment(uuid,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.confirm_telegram_payment(uuid,uuid,integer,text,text) to service_role;
