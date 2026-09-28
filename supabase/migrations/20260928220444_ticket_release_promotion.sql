create or replace function public.promote_waitlist_after_registration_release()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('paid','attended','reserved')
     and new.status not in ('paid','attended','reserved') then
    perform public.promote_event_waitlist(new.event_id);
  end if;
  return new;
end;
$$;

revoke all on function public.promote_waitlist_after_registration_release() from public, anon, authenticated;

drop trigger if exists registrations_promote_waitlist_after_release on public.registrations;
create trigger registrations_promote_waitlist_after_release
after update of status on public.registrations
for each row
when (old.status is distinct from new.status)
execute function public.promote_waitlist_after_registration_release();
