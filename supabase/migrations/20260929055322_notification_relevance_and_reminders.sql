alter table public.notification_queue
  add column if not exists event_id uuid references public.events(id) on delete cascade,
  add column if not exists expires_at timestamptz;

create index if not exists notification_queue_event_pending_idx
  on public.notification_queue(event_id,status,send_after)
  where status='pending';

create or replace function public.schedule_event_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  with targets as (
    select
      e.id as event_id,
      e.title,
      e.starts_at,
      e.venue_name,
      r.user_id,
      x.code,
      e.starts_at - x.before_start as send_after
    from public.events e
    join public.registrations r
      on r.event_id=e.id
     and r.status in ('paid','attended')
    cross join (
      values
        ('24h'::text, interval '24 hours'),
        ('2h'::text, interval '2 hours')
    ) as x(code,before_start)
    where e.status not in ('DRAFT','CLOSED')
      and e.starts_at > now()
      and e.starts_at - x.before_start > now()
  ),
  upserted as (
    insert into public.notification_queue(
      user_id,kind,text,send_after,status,dedupe_key,event_id,expires_at
    )
    select
      t.user_id,
      'reminders',
      case t.code
        when '24h' then
          'напоминание: НАСЫПАТЕЛИ В КИНО · ' ||
          to_char(t.starts_at at time zone 'Europe/Moscow','DD.MM в HH24:MI') ||
          case when coalesce(t.venue_name,'')<>'' then ' · '||t.venue_name else '' end
        else
          'вечер уже скоро: НАСЫПАТЕЛИ В КИНО · ' ||
          to_char(t.starts_at at time zone 'Europe/Moscow','DD.MM в HH24:MI') ||
          case when coalesce(t.venue_name,'')<>'' then ' · '||t.venue_name else '' end
      end,
      t.send_after,
      'pending',
      'event_reminder:'||t.event_id::text||':'||t.code,
      t.event_id,
      t.starts_at
    from targets t
    on conflict(user_id,dedupe_key) do update set
      text=excluded.text,
      send_after=excluded.send_after,
      event_id=excluded.event_id,
      expires_at=excluded.expires_at,
      error=null
    where public.notification_queue.status='pending'
    returning 1
  )
  select count(*)::integer into v_count from upserted;

  return v_count;
end;
$$;

revoke all on function public.schedule_event_reminders() from public, anon, authenticated;
grant execute on function public.schedule_event_reminders() to service_role;
