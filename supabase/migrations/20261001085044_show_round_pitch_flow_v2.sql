create table if not exists public.invented_films (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  round_id uuid not null references public.event_rounds(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  animal_name_snapshot text not null,
  title text not null check (char_length(title) between 1 and 120),
  description text not null check (char_length(description) between 1 and 800),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  locked_at timestamptz,
  unique(round_id,user_id)
);

create index if not exists invented_films_round_created_idx
  on public.invented_films(round_id,created_at);
create index if not exists invented_films_event_idx
  on public.invented_films(event_id,round_id);

alter table public.invented_films enable row level security;
revoke all on public.invented_films from anon, authenticated, public;
grant select,insert,update,delete on public.invented_films to service_role;

alter table public.event_rounds
  add column if not exists flow_status text not null default 'draft',
  add column if not exists selected_submission_id uuid references public.invented_films(id) on delete set null,
  add column if not exists question_position integer not null default 0,
  add column if not exists question_target integer not null default 3;

alter table public.event_rounds
  drop constraint if exists event_rounds_flow_status_check;
alter table public.event_rounds
  add constraint event_rounds_flow_status_check check (flow_status in (
    'draft','collecting_films','films_locked','randomizing_submission','submission_selected',
    'searching_movie','movie_found','playing_clip','generating_question','question_open',
    'question_results','question_reveal','next_question','assignment_randomizing',
    'assignment_selected','round_finished'
  ));

alter table public.event_rounds
  drop constraint if exists event_rounds_question_target_check;
alter table public.event_rounds
  add constraint event_rounds_question_target_check check (question_target between 1 and 5);

alter table public.film_packages
  add column if not exists origin_submission_id uuid references public.invented_films(id) on delete set null,
  add column if not exists match_data jsonb not null default '{}'::jsonb;

alter table public.film_questions
  add column if not exists real_outcome text not null default '',
  add column if not exists verification_data jsonb not null default '{}'::jsonb;

alter table public.events
  add column if not exists review_due_at timestamptz;

update public.events
set review_due_at='2026-10-10T16:00:00Z'
where slug='2026-10-03' and review_due_at is null;

alter table public.event_projector_state
  drop constraint if exists event_projector_state_state_check;
alter table public.event_projector_state
  add constraint event_projector_state_state_check check (state in (
    'idle','arrival',
    'pitch_collecting','pitch_locked','pitch_randomizing','pitch_selected',
    'movie_searching','movie_found','playing_clip',
    'film_intro','one_word_collecting','one_word_results',
    'question_open','question_results','question_reveal',
    'assignment_randomizing','assignment_winner','past_review_card'
  ));

create or replace function public.assign_film_mission(
  p_event_id uuid,
  p_round_id uuid,
  p_film_package_id uuid
)
returns table(
  assignment_id uuid,
  user_id uuid,
  animal_name text,
  due_at timestamptz,
  before_word text,
  correct_count integer,
  total_questions integer
)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_existing public.film_assignments%rowtype;
  v_user_id uuid;
  v_animal_name text;
  v_question_count integer;
  v_correct integer;
  v_assignment public.film_assignments%rowtype;
  v_due_at timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_round_id::text,0));

  select * into v_existing
  from public.film_assignments
  where round_id=p_round_id;

  if found then
    return query
    select v_existing.id,v_existing.user_id,v_existing.animal_name_snapshot,v_existing.due_at,
           v_existing.before_word,v_existing.correct_count,v_existing.total_questions;
    return;
  end if;

  select count(*)::integer into v_question_count
  from public.film_questions
  where film_package_id=p_film_package_id;

  if v_question_count < 1 or v_question_count > 5 then
    raise exception 'film package requires between 1 and 5 questions';
  end if;

  select r.user_id,c.name
  into v_user_id,v_animal_name
  from public.registrations r
  join public.creatures c on c.user_id=r.user_id
  where r.event_id=p_event_id
    and r.status='attended'
    and exists(
      select 1
      from public.film_predictions fp
      where fp.user_id=r.user_id
        and fp.event_id=p_event_id
        and fp.round_id=p_round_id
        and fp.film_package_id=p_film_package_id
    )
  order by
    case when exists(
      select 1 from public.film_assignments old
      where old.event_id=p_event_id and old.user_id=r.user_id
    ) then 1 else 0 end,
    pg_catalog.random()
  limit 1;

  if v_user_id is null then
    select r.user_id,c.name
    into v_user_id,v_animal_name
    from public.registrations r
    join public.creatures c on c.user_id=r.user_id
    where r.event_id=p_event_id and r.status='attended'
    order by
      case when exists(
        select 1 from public.film_assignments old
        where old.event_id=p_event_id and old.user_id=r.user_id
      ) then 1 else 0 end,
      pg_catalog.random()
    limit 1;
  end if;

  if v_user_id is null then
    raise exception 'no eligible animal for assignment';
  end if;

  select count(*) filter(where is_correct)::integer
  into v_correct
  from public.film_predictions
  where user_id=v_user_id
    and event_id=p_event_id
    and round_id=p_round_id
    and film_package_id=p_film_package_id;

  select coalesce(
    e.review_due_at,
    (
      date_trunc('week', e.starts_at at time zone 'Europe/Moscow')
      + interval '12 days 19 hours'
    ) at time zone 'Europe/Moscow'
  )
  into v_due_at
  from public.events e
  where e.id=p_event_id;

  insert into public.film_assignments(
    event_id,round_id,film_package_id,user_id,animal_name_snapshot,
    assigned_at,due_at,status,before_word,correct_count,total_questions
  ) values (
    p_event_id,p_round_id,p_film_package_id,v_user_id,v_animal_name,
    now(),v_due_at,'assigned','',coalesce(v_correct,0),v_question_count
  )
  returning * into v_assignment;

  insert into public.notification_queue(user_id,kind,text,send_after,status,dedupe_key,event_id)
  values
    (v_user_id,'reminders',v_animal_name||', этот фильм твой. потом жду рецензию.',now(),'pending','film_assignment:'||v_assignment.id||':assigned',p_event_id),
    (v_user_id,'reminders',v_animal_name||', жду твою рецензию.',v_assignment.due_at,'pending','film_assignment:'||v_assignment.id||':due',p_event_id),
    (v_user_id,'reminders',v_animal_name||', жду твою рецензию.',v_assignment.due_at+interval '1 minute','pending','film_assignment:'||v_assignment.id||':overdue',p_event_id)
  on conflict(user_id,dedupe_key) do nothing;

  return query
  select v_assignment.id,v_assignment.user_id,v_assignment.animal_name_snapshot,v_assignment.due_at,
         v_assignment.before_word,v_assignment.correct_count,v_assignment.total_questions;
end
$$;

revoke all on function public.assign_film_mission(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.assign_film_mission(uuid,uuid,uuid) to service_role;
