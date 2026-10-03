create table if not exists public.event_final_votes (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  movie_candidate_id uuid not null references public.movie_candidates(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id,user_id)
);

create index if not exists event_final_votes_movie_idx
  on public.event_final_votes(event_id,movie_candidate_id);

alter table public.event_final_votes enable row level security;
