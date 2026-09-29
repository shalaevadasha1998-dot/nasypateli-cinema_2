create index if not exists crumb_ledger_event_idx on public.crumb_ledger(event_id) where event_id is not null;
create index if not exists event_presence_user_idx on public.event_presence(user_id);
create index if not exists event_rounds_movie_idx on public.event_rounds(movie_candidate_id) where movie_candidate_id is not null;
create index if not exists event_runtime_round_idx on public.event_runtime(current_round_id) where current_round_id is not null;
create index if not exists event_runtime_movie_idx on public.event_runtime(current_movie_id) where current_movie_id is not null;
create index if not exists event_runtime_log_actor_idx on public.event_runtime_log(actor_user_id) where actor_user_id is not null;
create index if not exists event_votes_user_idx on public.event_votes(user_id);
