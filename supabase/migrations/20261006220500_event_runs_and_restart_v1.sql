-- isolate repeated show executions without touching persistent user/ticket data
create table if not exists public.event_runs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  run_key text not null,
  sequence_no integer not null check (sequence_no > 0),
  mode text not null check (mode in ('test','live')),
  status text not null default 'active' check (status in ('active','archived','finished')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  archived_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(event_id, run_key),
  unique(event_id, sequence_no)
);

create unique index if not exists event_runs_one_active_idx
  on public.event_runs(event_id)
  where status='active';

alter table public.event_runs enable row level security;
revoke all on public.event_runs from public, anon, authenticated;
grant select,insert,update,delete on public.event_runs to service_role;

alter table public.event_runtime add column if not exists run_id uuid references public.event_runs(id) on delete set null;
alter table public.event_rounds add column if not exists run_id uuid references public.event_runs(id) on delete restrict;
alter table public.event_votes add column if not exists run_id uuid references public.event_runs(id) on delete restrict;
alter table public.event_runtime_log add column if not exists run_id uuid references public.event_runs(id) on delete set null;
alter table public.event_projector_state add column if not exists run_id uuid references public.event_runs(id) on delete set null;
alter table public.event_final_votes add column if not exists run_id uuid references public.event_runs(id) on delete restrict;
alter table public.random_draws add column if not exists run_id uuid references public.event_runs(id) on delete restrict;
alter table public.event_screen_status add column if not exists run_id uuid references public.event_runs(id) on delete set null;

insert into public.event_runs(event_id,run_key,sequence_no,mode,status,started_at,metadata)
select e.id,
       case when coalesce((e.settings->>'test_room')::boolean,false) then 'test_001' else 'live_001' end,
       1,
       case when coalesce((e.settings->>'test_room')::boolean,false) then 'test' else 'live' end,
       'active',
       coalesce(er.started_at,e.created_at,now()),
       jsonb_build_object('backfilled',true)
from public.events e
left join public.event_runtime er on er.event_id=e.id
where not exists(select 1 from public.event_runs x where x.event_id=e.id)
on conflict do nothing;

update public.event_runtime er
set run_id=x.id
from public.event_runs x
where x.event_id=er.event_id and x.status='active' and er.run_id is null;

update public.event_rounds r
set run_id=er.run_id
from public.event_runtime er
where er.event_id=r.event_id and r.run_id is null;

update public.event_votes v
set run_id=r.run_id
from public.event_rounds r
where r.id=v.round_id and v.run_id is null;

update public.event_runtime_log l
set run_id=er.run_id
from public.event_runtime er
where er.event_id=l.event_id and l.run_id is null;

update public.event_projector_state p
set run_id=er.run_id
from public.event_runtime er
where er.event_id=p.event_id and p.run_id is null;

update public.event_final_votes v
set run_id=er.run_id
from public.event_runtime er
where er.event_id=v.event_id and v.run_id is null;

update public.random_draws d
set run_id=er.run_id
from public.event_runtime er
where er.event_id=d.event_id and d.run_id is null;

update public.event_screen_status s
set run_id=er.run_id
from public.event_runtime er
where er.event_id=s.event_id and s.run_id is null;

drop index if exists event_rounds_event_round_no_key;
alter table public.event_rounds drop constraint if exists event_rounds_event_id_round_no_key;
create unique index if not exists event_rounds_run_round_no_idx
  on public.event_rounds(run_id,round_no)
  where run_id is not null;

create index if not exists event_rounds_run_block_idx on public.event_rounds(run_id,block_id,round_no);
create index if not exists event_votes_run_idx on public.event_votes(run_id,round_id,question_key);
create index if not exists event_runtime_log_run_idx on public.event_runtime_log(run_id,created_at desc);
create index if not exists event_final_votes_run_idx on public.event_final_votes(run_id);
create index if not exists random_draws_run_idx on public.random_draws(run_id,created_at desc);

create or replace function public.restart_event_run(
  p_event_id uuid,
  p_mode text default null
)
returns table(run_id uuid, run_key text, sequence_no integer, mode text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text;
  v_seq integer;
  v_run_id uuid;
  v_run_key text;
  v_now timestamptz := now();
begin
  if p_mode is not null and p_mode not in ('test','live') then
    raise exception 'invalid run mode';
  end if;

  perform 1 from public.events where id=p_event_id for update;
  if not found then raise exception 'event not found'; end if;

  select coalesce(p_mode,
    case when coalesce((e.settings->>'test_room')::boolean,false) then 'test' else 'live' end)
    into v_mode
  from public.events e where e.id=p_event_id;

  update public.event_runs
     set status='archived',archived_at=v_now,ended_at=coalesce(ended_at,v_now)
   where event_id=p_event_id and status='active';

  select coalesce(max(r.sequence_no),0)+1 into v_seq
  from public.event_runs r where r.event_id=p_event_id;

  v_run_key := v_mode || '_' || lpad(v_seq::text,3,'0');

  insert into public.event_runs(event_id,run_key,sequence_no,mode,status,started_at)
  values(p_event_id,v_run_key,v_seq,v_mode,'active',v_now)
  returning id into v_run_id;

  update public.event_runtime
     set run_id=v_run_id,
         run_status='idle',
         current_block_id='arrival',
         current_block_index=0,
         current_round=0,
         current_round_id=null,
         current_movie_id=null,
         current_question=null,
         vote_state='closed',
         results_visible=false,
         video_state='{"status":"idle"}'::jsonb,
         started_at=null,
         block_started_at=null,
         paused_at=null,
         director_cue_index=0,
         audio_state='{"mode":"auto","status":"stopped","track_key":null,"playlist_index":0,"volume":0.32,"updated_at":null}'::jsonb,
         revision=revision+1,
         updated_at=v_now
   where event_id=p_event_id;

  update public.event_projector_state
     set run_id=v_run_id,
         state='arrival',
         round_id=null,
         film_package_id=null,
         payload='{}'::jsonb,
         revision=revision+1,
         updated_at=v_now
   where event_id=p_event_id;

  update public.event_screen_status
     set run_id=v_run_id
   where event_id=p_event_id;

  return query select v_run_id,v_run_key,v_seq,v_mode;
end;
$$;

revoke all on function public.restart_event_run(uuid,text) from public,anon,authenticated;
grant execute on function public.restart_event_run(uuid,text) to service_role;
