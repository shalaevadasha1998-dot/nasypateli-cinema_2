create table if not exists public.film_packages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  movie_candidate_id uuid not null references public.movie_candidates(id) on delete cascade,
  title_snapshot text not null,
  fragments jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft','ready','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id,movie_candidate_id),
  check (jsonb_typeof(fragments)='array')
);

create table if not exists public.film_questions (
  id uuid primary key default gen_random_uuid(),
  film_package_id uuid not null references public.film_packages(id) on delete cascade,
  position integer not null check (position between 1 and 5),
  prompt text not null,
  options jsonb not null default '[]'::jsonb,
  correct_answer jsonb not null,
  reveal_text text not null default '',
  reveal_fragment jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(film_package_id,position),
  check (jsonb_typeof(options)='array'),
  check (jsonb_typeof(reveal_fragment)='object')
);

create table if not exists public.film_impressions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  round_id uuid not null references public.event_rounds(id) on delete cascade,
  film_package_id uuid not null references public.film_packages(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  animal_name_snapshot text not null,
  word text not null check (char_length(word) between 1 and 80),
  normalized_word text not null check (char_length(normalized_word) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(round_id,user_id)
);

create table if not exists public.film_predictions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  round_id uuid not null references public.event_rounds(id) on delete cascade,
  film_package_id uuid not null references public.film_packages(id) on delete cascade,
  question_id uuid not null references public.film_questions(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  animal_name_snapshot text not null,
  answer jsonb not null,
  is_correct boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(question_id,user_id)
);

create table if not exists public.film_assignments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  round_id uuid not null references public.event_rounds(id) on delete cascade,
  film_package_id uuid not null references public.film_packages(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete cascade,
  animal_name_snapshot text not null,
  assigned_at timestamptz not null default now(),
  due_at timestamptz not null,
  status text not null default 'assigned' check (status in (
    'assigned','watching','watched','review_in_progress','review_ready','submitted',
    'approved','changes_requested','published','overdue'
  )),
  before_word text not null,
  after_word text,
  correct_count integer not null default 0 check (correct_count >= 0),
  total_questions integer not null default 5 check (total_questions between 1 and 5),
  watched_at timestamptz,
  submitted_at timestamptz,
  approved_at timestamptz,
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  unique(round_id),
  unique(event_id,film_package_id)
);

create table if not exists public.review_sessions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null unique references public.film_assignments(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','draft_ready','submitted','changes_requested','closed')),
  step integer not null default 0 check (step >= 0 and step <= 12),
  answers jsonb not null default '{}'::jsonb,
  messages jsonb not null default '[]'::jsonb,
  draft jsonb,
  admin_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check (jsonb_typeof(answers)='object'),
  check (jsonb_typeof(messages)='array')
);

create table if not exists public.submitted_reviews (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.film_assignments(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  version integer not null check (version > 0),
  snapshot jsonb not null,
  status text not null default 'submitted' check (status in ('submitted','approved','changes_requested','published')),
  admin_comment text,
  submitted_at timestamptz not null default now(),
  approved_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique(assignment_id,version),
  check (jsonb_typeof(snapshot)='object')
);

create table if not exists public.event_projector_state (
  event_id uuid primary key references public.events(id) on delete cascade,
  state text not null default 'idle' check (state in (
    'idle','arrival','film_intro','one_word_collecting','one_word_results',
    'question_open','question_results','question_reveal',
    'assignment_randomizing','assignment_winner','past_review_card'
  )),
  film_package_id uuid references public.film_packages(id) on delete set null,
  round_id uuid references public.event_rounds(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(payload)='object')
);

create index if not exists film_packages_event_idx on public.film_packages(event_id,status);
create index if not exists film_questions_package_idx on public.film_questions(film_package_id,position);
create index if not exists film_impressions_event_round_idx on public.film_impressions(event_id,round_id);
create index if not exists film_impressions_package_word_idx on public.film_impressions(film_package_id,normalized_word);
create index if not exists film_impressions_user_idx on public.film_impressions(user_id);
create index if not exists film_predictions_event_round_idx on public.film_predictions(event_id,round_id);
create index if not exists film_predictions_package_user_idx on public.film_predictions(film_package_id,user_id);
create index if not exists film_predictions_question_idx on public.film_predictions(question_id);
create index if not exists film_assignments_user_status_idx on public.film_assignments(user_id,status,due_at);
create index if not exists film_assignments_event_status_idx on public.film_assignments(event_id,status);
create index if not exists film_assignments_package_idx on public.film_assignments(film_package_id);
create index if not exists review_sessions_user_idx on public.review_sessions(user_id,status);
create index if not exists submitted_reviews_assignment_status_idx on public.submitted_reviews(assignment_id,status);
create index if not exists submitted_reviews_user_idx on public.submitted_reviews(user_id);
create index if not exists event_projector_state_package_idx on public.event_projector_state(film_package_id);

alter table public.film_packages enable row level security;
alter table public.film_questions enable row level security;
alter table public.film_impressions enable row level security;
alter table public.film_predictions enable row level security;
alter table public.film_assignments enable row level security;
alter table public.review_sessions enable row level security;
alter table public.submitted_reviews enable row level security;
alter table public.event_projector_state enable row level security;

revoke all on public.film_packages from anon, authenticated;
revoke all on public.film_questions from anon, authenticated;
revoke all on public.film_impressions from anon, authenticated;
revoke all on public.film_predictions from anon, authenticated;
revoke all on public.film_assignments from anon, authenticated;
revoke all on public.review_sessions from anon, authenticated;
revoke all on public.submitted_reviews from anon, authenticated;
revoke all on public.event_projector_state from anon, authenticated;

grant all on public.film_packages to service_role;
grant all on public.film_questions to service_role;
grant all on public.film_impressions to service_role;
grant all on public.film_predictions to service_role;
grant all on public.film_assignments to service_role;
grant all on public.review_sessions to service_role;
grant all on public.submitted_reviews to service_role;
grant all on public.event_projector_state to service_role;

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
  v_before_word text;
  v_question_count integer;
  v_correct integer;
  v_assignment public.film_assignments%rowtype;
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

  if v_question_count <> 5 then
    raise exception 'film package requires exactly 5 questions';
  end if;

  select r.user_id,c.name,i.word
  into v_user_id,v_animal_name,v_before_word
  from public.registrations r
  join public.creatures c on c.user_id=r.user_id
  join public.film_impressions i
    on i.user_id=r.user_id
   and i.event_id=p_event_id
   and i.round_id=p_round_id
   and i.film_package_id=p_film_package_id
  where r.event_id=p_event_id
    and r.status='attended'
    and (
      select count(*)
      from public.film_predictions fp
      where fp.user_id=r.user_id
        and fp.event_id=p_event_id
        and fp.round_id=p_round_id
        and fp.film_package_id=p_film_package_id
    )=v_question_count
  order by
    case when exists(
      select 1 from public.film_assignments old
      where old.event_id=p_event_id and old.user_id=r.user_id
    ) then 1 else 0 end,
    pg_catalog.random()
  limit 1;

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

  insert into public.film_assignments(
    event_id,round_id,film_package_id,user_id,animal_name_snapshot,
    assigned_at,due_at,status,before_word,correct_count,total_questions
  ) values (
    p_event_id,p_round_id,p_film_package_id,v_user_id,v_animal_name,
    now(),now()+interval '7 days','assigned',v_before_word,coalesce(v_correct,0),v_question_count
  )
  returning * into v_assignment;

  insert into public.notification_queue(user_id,kind,text,send_after,status,dedupe_key,event_id)
  values
    (v_user_id,'reminders',v_animal_name||', этот фильм твой. у тебя 7 дней.',now(),'pending','film_assignment:'||v_assignment.id||':assigned',p_event_id),
    (v_user_id,'reminders','прошло три дня. я всё помню.',v_assignment.assigned_at+interval '3 days','pending','film_assignment:'||v_assignment.id||':3d',p_event_id),
    (v_user_id,'reminders','у тебя сутки.',v_assignment.due_at-interval '1 day','pending','film_assignment:'||v_assignment.id||':24h',p_event_id),
    (v_user_id,'reminders','я дождусь. но это уже просрочка.',v_assignment.due_at+interval '1 minute','pending','film_assignment:'||v_assignment.id||':overdue',p_event_id)
  on conflict(user_id,dedupe_key) do nothing;

  return query
  select v_assignment.id,v_assignment.user_id,v_assignment.animal_name_snapshot,v_assignment.due_at,
         v_assignment.before_word,v_assignment.correct_count,v_assignment.total_questions;
end
$$;

revoke all on function public.assign_film_mission(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.assign_film_mission(uuid,uuid,uuid) to service_role;

create or replace function public.guard_submitted_review_snapshot()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if new.snapshot is distinct from old.snapshot
     or new.assignment_id is distinct from old.assignment_id
     or new.user_id is distinct from old.user_id
     or new.version is distinct from old.version
     or new.submitted_at is distinct from old.submitted_at then
    raise exception 'submitted review snapshot is immutable';
  end if;
  return new;
end
$$;

revoke all on function public.guard_submitted_review_snapshot() from public, anon, authenticated;
grant execute on function public.guard_submitted_review_snapshot() to service_role;

drop trigger if exists submitted_review_snapshot_immutable on public.submitted_reviews;
create trigger submitted_review_snapshot_immutable
before update on public.submitted_reviews
for each row execute function public.guard_submitted_review_snapshot();

insert into public.event_projector_state(event_id,state,payload)
select id,'arrival','{}'::jsonb from public.events
where slug='2026-10-03'
on conflict(event_id) do nothing;
