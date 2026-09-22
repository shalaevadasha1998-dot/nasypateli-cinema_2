-- НАСЫПАТЕЛИ В КИНО — one-paste Supabase setup
-- Project: vwteokawtqnoiyzmsldj
-- Safe for a fresh project. The event seed can be rerun.

create extension if not exists pgcrypto;

do $$
begin
  create type event_status as enum (
    'DRAFT','SALES_OPEN','CHECKIN','IDEAS_OPEN','IDEAS_LOCKED','TOP3_READY','IDEA_RANDOMIZED',
    'MOVIE_SEARCH','MOVIE_FINALISTS','MOVIE_SELECTED','PREDICTIONS_OPEN','PREDICTIONS_LOCKED',
    'WATCHING','PREDICTIONS_SCORED','DISCUSSION','FINAL_REVIEW','FEEDBACK','CLOSED'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint unique not null,
  telegram_username text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists cinema_profiles (
  user_id uuid primary key references users(id) on delete cascade,
  favorite_films text[] not null default '{}',
  favorite_genres text[] not null default '{}',
  avoid text[] not null default '{}',
  profile_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists admins (
  user_id uuid primary key references users(id) on delete cascade,
  role text not null check (role in ('owner','tech','content'))
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  starts_at timestamptz not null,
  capacity int not null check (capacity > 0),
  ticket_price_rub int,
  max_movie_runtime_min int not null default 150,
  status event_status not null default 'DRAFT',
  venue_name text,
  venue_address text,
  winner_user_id uuid references users(id) on delete set null,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  status text not null check (status in ('reserved','paid','waitlist','refunded','cancelled','attended','no_show')),
  queue_position int,
  payment_provider text,
  provider_payment_id text,
  amount_rub int,
  photo_video_consent boolean not null default false,
  paid_at timestamptz,
  reservation_expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique(event_id,user_id)
);
create index if not exists registrations_event_status_idx on registrations(event_id,status);

create table if not exists film_ideas (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  title text not null check (char_length(title) <= 100),
  plot text not null check (char_length(plot) <= 500),
  submitted_at timestamptz not null default now(),
  unique(event_id,user_id)
);

create table if not exists ai_runs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,
  action text not null,
  model text not null,
  prompt_version text not null,
  input_hash text,
  input_json jsonb not null default '{}'::jsonb,
  output_json jsonb,
  status text not null check (status in ('started','success','failed','fallback')),
  error text,
  cost_estimate_usd numeric,
  created_at timestamptz not null default now()
);

create table if not exists idea_finalists (
  event_id uuid not null references events(id) on delete cascade,
  film_idea_id uuid not null references film_ideas(id) on delete cascade,
  rank int not null check (rank between 1 and 3),
  ai_reason text,
  primary key(event_id,rank),
  unique(event_id,film_idea_id)
);

create table if not exists random_draws (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  draw_type text not null,
  candidate_ids uuid[] not null,
  chosen_id uuid not null,
  random_bytes_hex text not null,
  created_at timestamptz not null default now()
);

create table if not exists selected_idea (
  event_id uuid primary key references events(id) on delete cascade,
  film_idea_id uuid not null references film_ideas(id),
  revealed_author_user_id uuid references users(id),
  selected_at timestamptz not null default now()
);

create table if not exists movie_candidates (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  provider text,
  provider_id text,
  title text not null,
  original_title text,
  year int,
  runtime_min int,
  validated boolean not null default false,
  similarity_score numeric,
  audience_fit_score numeric,
  weighted_score numeric generated always as (coalesce(similarity_score,0)*0.70 + coalesce(audience_fit_score,0)*0.30) stored,
  reason text,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists movie_finalists (
  event_id uuid not null references events(id) on delete cascade,
  movie_candidate_id uuid not null references movie_candidates(id) on delete cascade,
  rank int not null check(rank between 1 and 3),
  primary key(event_id,rank),
  unique(event_id,movie_candidate_id)
);

create table if not exists event_movie (
  event_id uuid primary key references events(id) on delete cascade,
  movie_candidate_id uuid not null references movie_candidates(id),
  availability_status text not null default 'unchecked',
  selected_at timestamptz not null default now()
);

create table if not exists prediction_questions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  position int not null check(position between 1 and 10),
  text text not null,
  actual boolean,
  void boolean not null default false,
  unique(event_id,position)
);

create table if not exists prediction_answers (
  event_id uuid not null references events(id) on delete cascade,
  question_id uuid not null references prediction_questions(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  answer boolean not null,
  created_at timestamptz not null default now(),
  primary key(question_id,user_id)
);

create table if not exists event_scores (
  event_id uuid not null references events(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  correct int not null default 0,
  total int not null default 0,
  points int not null default 0,
  rank int,
  primary key(event_id,user_id)
);

create table if not exists discussion_thoughts (
  event_id uuid not null references events(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  text text not null check(char_length(text) <= 240),
  created_at timestamptz not null default now(),
  primary key(event_id,user_id)
);

create table if not exists final_reviews (
  event_id uuid not null references events(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  rating int not null check(rating between 1 and 10),
  final_sentence text not null check(char_length(final_sentence) <= 180),
  created_at timestamptz not null default now(),
  primary key(event_id,user_id)
);

create table if not exists event_feedback (
  event_id uuid not null references events(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  return_intent text not null,
  strongest_part text,
  improve_text text,
  willingness_to_pay int,
  duration_feel text,
  invite_friend text,
  created_at timestamptz not null default now(),
  primary key(event_id,user_id)
);

create table if not exists leaderboard (
  user_id uuid primary key references users(id) on delete cascade,
  events_attended int not null default 0,
  prediction_points int not null default 0,
  wins int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists collectibles (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete set null,
  code text unique not null,
  name text not null,
  description text,
  artifact_json jsonb not null default '{}'::jsonb
);

create table if not exists user_collectibles (
  user_id uuid not null references users(id) on delete cascade,
  collectible_id uuid not null references collectibles(id) on delete cascade,
  awarded_at timestamptz not null default now(),
  primary key(user_id,collectible_id)
);

create table if not exists secret_ticket_draws (
  id uuid primary key default gen_random_uuid(),
  draw_at timestamptz not null,
  status text not null default 'scheduled',
  winner_user_id uuid references users(id),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists jipitina_memory (
  id uuid primary key default gen_random_uuid(),
  scope text not null check(scope in ('club','event','user')),
  scope_id uuid,
  memory_key text not null,
  memory_text text not null,
  source text,
  created_at timestamptz not null default now(),
  unique(scope,scope_id,memory_key)
);

create table if not exists event_transitions (
  id bigserial primary key,
  event_id uuid not null references events(id) on delete cascade,
  from_status event_status,
  to_status event_status not null,
  actor_user_id uuid references users(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Realtime publication should include only sanitized/public tables/views.
-- Do not expose service role to clients. Route writes via Edge Functions.

-- Generic generated/approved event artifacts: post-film synthesis, collective review draft, etc.
create table if not exists event_outputs (
  event_id uuid not null references events(id) on delete cascade,
  output_key text not null,
  payload jsonb not null default '{}'::jsonb,
  approved boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key(event_id, output_key)
);

create index if not exists film_ideas_event_idx on film_ideas(event_id);
create index if not exists movie_candidates_event_idx on movie_candidates(event_id);
create index if not exists prediction_answers_event_idx on prediction_answers(event_id);
create index if not exists event_transitions_event_idx on event_transitions(event_id,created_at);

-- Clients never query tables directly in MVP. Edge Functions use a secret key and bypass RLS.
alter table users enable row level security;
alter table cinema_profiles enable row level security;
alter table admins enable row level security;
alter table events enable row level security;
alter table registrations enable row level security;
alter table film_ideas enable row level security;
alter table ai_runs enable row level security;
alter table idea_finalists enable row level security;
alter table random_draws enable row level security;
alter table selected_idea enable row level security;
alter table movie_candidates enable row level security;
alter table movie_finalists enable row level security;
alter table event_movie enable row level security;
alter table prediction_questions enable row level security;
alter table prediction_answers enable row level security;
alter table event_scores enable row level security;
alter table discussion_thoughts enable row level security;
alter table final_reviews enable row level security;
alter table event_feedback enable row level security;
alter table leaderboard enable row level security;
alter table collectibles enable row level security;
alter table user_collectibles enable row level security;
alter table secret_ticket_draws enable row level security;
alter table jipitina_memory enable row level security;
alter table event_transitions enable row level security;
alter table event_outputs enable row level security;

-- Seed first event.

-- Atomic reservation to avoid overselling when several people buy at once.
create or replace function public.reserve_event_spot(
  p_event_id uuid,
  p_user_id uuid,
  p_amount_rub int,
  p_photo_video_consent boolean default false
)
returns table(
  reservation_status text,
  queue_position int,
  reservation_expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_capacity int;
  v_occupied int;
  v_queue int;
  v_expires timestamptz;
  v_existing_status text;
begin
  select e.capacity into v_capacity
  from public.events e
  where e.id = p_event_id
  for update;

  if v_capacity is null then
    raise exception 'event not found';
  end if;

  select r.status into v_existing_status
  from public.registrations r
  where r.event_id = p_event_id and r.user_id = p_user_id;

  if v_existing_status in ('paid','attended') then
    return query select v_existing_status, null::int, null::timestamptz;
    return;
  end if;

  select count(*)::int into v_occupied
  from public.registrations r
  where r.event_id = p_event_id
    and r.user_id <> p_user_id
    and (
      r.status in ('paid','attended')
      or (r.status = 'reserved' and r.reservation_expires_at > now())
    );

  if v_occupied >= v_capacity then
    select coalesce(max(r.queue_position),0) + 1 into v_queue
    from public.registrations r
    where r.event_id = p_event_id and r.status = 'waitlist';

    insert into public.registrations(
      event_id,user_id,status,queue_position,amount_rub,photo_video_consent,reservation_expires_at
    ) values (
      p_event_id,p_user_id,'waitlist',v_queue,p_amount_rub,p_photo_video_consent,null
    )
    on conflict(event_id,user_id) do update set
      status='waitlist',
      queue_position=excluded.queue_position,
      amount_rub=excluded.amount_rub,
      photo_video_consent=excluded.photo_video_consent,
      reservation_expires_at=null;

    return query select 'waitlist'::text, v_queue, null::timestamptz;
    return;
  end if;

  v_expires := now() + interval '15 minutes';

  insert into public.registrations(
    event_id,user_id,status,queue_position,amount_rub,photo_video_consent,reservation_expires_at
  ) values (
    p_event_id,p_user_id,'reserved',null,p_amount_rub,p_photo_video_consent,v_expires
  )
  on conflict(event_id,user_id) do update set
    status='reserved',
    queue_position=null,
    amount_rub=excluded.amount_rub,
    photo_video_consent=excluded.photo_video_consent,
    reservation_expires_at=excluded.reservation_expires_at;

  return query select 'reserved'::text, null::int, v_expires;
end;
$$;

revoke all on function public.reserve_event_spot(uuid,uuid,int,boolean) from public, anon, authenticated;
grant execute on function public.reserve_event_spot(uuid,uuid,int,boolean) to service_role;

insert into events (slug,title,starts_at,capacity,ticket_price_rub,max_movie_runtime_min,status,settings)
values ('2026-10-03','НАСЫПАТЕЛИ В КИНО — 3 октября','2026-10-03 18:00:00+03',30,500,150,'SALES_OPEN',jsonb_build_object('city','Москва','format','этого фильма не существует'))
on conflict (slug) do update set
  title=excluded.title,
  starts_at=excluded.starts_at,
  capacity=excluded.capacity,
  ticket_price_rub=excluded.ticket_price_rub,
  max_movie_runtime_min=excluded.max_movie_runtime_min;

alter table public.events add column if not exists winner_user_id uuid references public.users(id) on delete set null;
