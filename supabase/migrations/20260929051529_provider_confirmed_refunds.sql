alter table public.registrations
  add column if not exists telegram_payment_charge_id text;

create table if not exists public.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  payment_provider text not null,
  provider_payment_id text not null,
  amount_rub integer not null check (amount_rub >= 0),
  status text not null default 'pending' check (status in ('pending','confirmed','cancelled','failed')),
  provider_reference text,
  requested_at timestamptz not null default now(),
  confirmed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(event_id,user_id,provider_payment_id)
);

create index if not exists payment_refunds_event_status_idx
  on public.payment_refunds(event_id,status,requested_at);

alter table public.payment_refunds enable row level security;

create or replace function public.request_ticket_refund(
  p_event_id uuid,
  p_user_id uuid
)
returns table(
  refund_id uuid,
  refund_status text,
  provider_charge_id text,
  amount_rub integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reg public.registrations%rowtype;
  v_ref public.payment_refunds%rowtype;
begin
  select *
    into v_reg
  from public.registrations
  where event_id=p_event_id
    and user_id=p_user_id
  for update;

  if not found then
    raise exception 'registration not found';
  end if;

  if v_reg.status <> 'paid' then
    raise exception 'only paid tickets can be refunded';
  end if;

  if coalesce(v_reg.payment_provider,'') <> 'telegram'
     or coalesce(v_reg.provider_payment_id,'') = '' then
    raise exception 'provider payment id missing';
  end if;

  insert into public.payment_refunds(
    event_id,user_id,payment_provider,provider_payment_id,amount_rub,status,updated_at
  ) values (
    p_event_id,p_user_id,v_reg.payment_provider,v_reg.provider_payment_id,coalesce(v_reg.amount_rub,0),'pending',now()
  )
  on conflict(event_id,user_id,provider_payment_id) do update set
    updated_at=now()
  returning * into v_ref;

  return query
    select v_ref.id,v_ref.status,v_ref.provider_payment_id,v_ref.amount_rub;
end;
$$;

revoke all on function public.request_ticket_refund(uuid,uuid) from public, anon, authenticated;
grant execute on function public.request_ticket_refund(uuid,uuid) to service_role;

create or replace function public.confirm_ticket_refund(
  p_refund_id uuid,
  p_provider_reference text
)
returns table(
  refund_id uuid,
  refund_status text,
  registration_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref public.payment_refunds%rowtype;
  v_reg_status text;
  v_reference text := btrim(coalesce(p_provider_reference,''));
begin
  if length(v_reference) < 3 then
    raise exception 'provider reference required';
  end if;

  select *
    into v_ref
  from public.payment_refunds
  where id=p_refund_id
  for update;

  if not found then
    raise exception 'refund not found';
  end if;

  if v_ref.status='confirmed' then
    select status into v_reg_status
    from public.registrations
    where event_id=v_ref.event_id and user_id=v_ref.user_id;

    return query select v_ref.id,v_ref.status,coalesce(v_reg_status,'refunded');
    return;
  end if;

  if v_ref.status <> 'pending' then
    raise exception 'refund is not pending';
  end if;

  select status
    into v_reg_status
  from public.registrations
  where event_id=v_ref.event_id
    and user_id=v_ref.user_id
  for update;

  if not found then
    raise exception 'registration not found';
  end if;

  if v_reg_status not in ('paid','attended','refunded') then
    raise exception 'ticket status cannot be refunded: %', v_reg_status;
  end if;

  update public.payment_refunds
  set status='confirmed',
      provider_reference=v_reference,
      confirmed_at=now(),
      updated_at=now()
  where id=v_ref.id;

  if v_reg_status <> 'refunded' then
    update public.registrations
    set status='refunded',
        reservation_expires_at=null
    where event_id=v_ref.event_id
      and user_id=v_ref.user_id;
    v_reg_status := 'refunded';
  end if;

  return query select v_ref.id,'confirmed'::text,v_reg_status;
end;
$$;

revoke all on function public.confirm_ticket_refund(uuid,text) from public, anon, authenticated;
grant execute on function public.confirm_ticket_refund(uuid,text) to service_role;
