create or replace function public.admin_fix_event_registration(
  p_event_id uuid,
  p_registration_id uuid,
  p_action text
)
returns table(
  registration_id uuid,
  user_id uuid,
  status text,
  promoted integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_status public.event_status;
  v_user_id uuid;
  v_status text;
  v_promoted integer := 0;
begin
  select e.status
    into v_event_status
  from public.events e
  where e.id = p_event_id
  for update;

  if not found then
    raise exception 'event not found';
  end if;

  select r.user_id, r.status
    into v_user_id, v_status
  from public.registrations r
  where r.id = p_registration_id
    and r.event_id = p_event_id
  for update;

  if not found then
    raise exception 'registration not found';
  end if;

  if p_action = 'mark_attended' then
    if v_status not in ('paid','no_show') then
      raise exception 'mark_attended requires paid or no_show';
    end if;

    update public.registrations
    set status='attended',
        queue_position=null,
        reservation_expires_at=null
    where id=p_registration_id;

  elsif p_action = 'undo_attended' then
    if v_status <> 'attended' then
      raise exception 'undo_attended requires attended';
    end if;

    update public.registrations
    set status=case when v_event_status='CLOSED'::public.event_status then 'no_show' else 'paid' end
    where id=p_registration_id;

  elsif p_action = 'release_hold' then
    if v_status <> 'reserved' then
      raise exception 'release_hold requires reserved';
    end if;

    update public.registrations
    set status='cancelled',
        queue_position=null,
        reservation_expires_at=null
    where id=p_registration_id;

    update public.notification_queue
    set status='cancelled',
        error='reservation released by admin'
    where event_id=p_event_id
      and user_id=v_user_id
      and kind='tickets'
      and status='pending'
      and dedupe_key like 'waitlist_promoted:%';

    if v_event_status='SALES_OPEN'::public.event_status then
      v_promoted := public.promote_event_waitlist(p_event_id);
    end if;

  else
    raise exception 'unsupported registration action';
  end if;

  return query
  select
    p_registration_id,
    v_user_id,
    r.status,
    v_promoted
  from public.registrations r
  where r.id=p_registration_id;
end;
$$;

revoke all on function public.admin_fix_event_registration(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.admin_fix_event_registration(uuid,uuid,text) to service_role;
