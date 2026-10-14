-- A private, admin-only rehearsal is a first-class sibling of each real event.
-- It has independent registrations, rounds, votes, projection and runtime.
-- No user tickets or data from the source event are copied.
create or replace function public.ensure_event_rehearsal(p_event_id uuid)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  original public.events%rowtype;
  rehearsal_id uuid;
  rehearsal_slug text;
  program_json jsonb;
  first_block text;
  current_run uuid;
begin
  select * into original from public.events where id=p_event_id;
  if not found then return null; end if;
  if original.slug like 'test-%' or original.slug like 'private-%'
     or coalesce((original.settings->>'test_room')::boolean,false)
     or coalesce((original.settings->>'private_rehearsal')::boolean,false) then
    return null;
  end if;

  rehearsal_slug:='test-'||original.slug;
  insert into public.events(
    slug,title,starts_at,capacity,ticket_price_rub,max_movie_runtime_min,status,
    venue_name,venue_address,settings
  ) values (
    rehearsal_slug,'репетиция · '||original.title,original.starts_at,
    greatest(12,least(original.capacity,50)),0,original.max_movie_runtime_min,
    'CHECKIN',original.venue_name,original.venue_address,
    jsonb_build_object('test_room',true,'admin_only',true,
      'source_event_slug',original.slug,'source_event_id',original.id,
      'round_manual_mode',true,'hide_from_public',true)
  ) on conflict(slug) do nothing;

  select id into rehearsal_id from public.events where slug=rehearsal_slug;
  if rehearsal_id is null then return null; end if;

  select config into program_json from public.event_programs where event_id=original.id;
  program_json:=coalesce(program_json,'{"version":1,"blocks":[]}'::jsonb);
  insert into public.event_programs(event_id,config)
    values(rehearsal_id,program_json)
    on conflict(event_id) do nothing;

  select elem->>'id' into first_block
    from jsonb_array_elements(coalesce(program_json->'blocks','[]'::jsonb)) elem
    where coalesce((elem->>'enabled')::boolean,true) limit 1;
  first_block:=coalesce(first_block,'arrival');

  insert into public.event_runs(event_id,run_key,sequence_no,mode,status,metadata)
    values(rehearsal_id,'test_001',1,'test','active','{"admin_only":true}'::jsonb)
    on conflict do nothing;
  select id into current_run from public.event_runs
    where event_id=rehearsal_id and status='active'
    order by sequence_no desc limit 1;

  insert into public.event_runtime(event_id,run_id,current_block_id)
    values(rehearsal_id,current_run,first_block)
    on conflict(event_id) do nothing;
  insert into public.event_projector_state(event_id,run_id,state)
    values(rehearsal_id,current_run,'arrival')
    on conflict(event_id) do nothing;
  return rehearsal_id;
end;
$$;

create or replace function public.event_rehearsal_after_insert()
returns trigger language plpgsql security definer
set search_path=public,pg_temp as $$
begin
  perform public.ensure_event_rehearsal(new.id);
  return new;
end;
$$;
drop trigger if exists ensure_admin_rehearsal_after_event_insert on public.events;
create trigger ensure_admin_rehearsal_after_event_insert
  after insert on public.events for each row
  execute function public.event_rehearsal_after_insert();

create or replace function public.event_rehearsal_program_sync()
returns trigger language plpgsql security definer
set search_path=public,pg_temp as $$
declare
  test_id uuid;
  test_status text;
  first_block text;
begin
  select id into test_id from public.events
  where slug='test-'||(select slug from public.events where id=new.event_id)
    and (settings->>'admin_only')::boolean is true
  limit 1;
  if test_id is null then return new; end if;
  select run_status into test_status from public.event_runtime where event_id=test_id;
  if test_status is distinct from 'idle' then return new; end if;
  insert into public.event_programs(event_id,config)
    values(test_id,new.config)
    on conflict(event_id) do update
      set config=excluded.config,updated_at=now();
  select elem->>'id' into first_block
    from jsonb_array_elements(coalesce(new.config->'blocks','[]'::jsonb)) elem
    where coalesce((elem->>'enabled')::boolean,true) limit 1;
  if first_block is not null then
    update public.event_runtime set current_block_id=first_block,current_block_index=0
    where event_id=test_id and run_status='idle';
  end if;
  return new;
end;
$$;
drop trigger if exists sync_admin_rehearsal_program on public.event_programs;
create trigger sync_admin_rehearsal_program
  after insert or update of config on public.event_programs
  for each row execute function public.event_rehearsal_program_sync();

-- Backfill older published events without altering their attendee records.
select public.ensure_event_rehearsal(id)
from public.events
where slug not like 'test-%' and slug not like 'private-%'
  and coalesce((settings->>'test_room')::boolean,false)=false
  and coalesce((settings->>'private_rehearsal')::boolean,false)=false;
