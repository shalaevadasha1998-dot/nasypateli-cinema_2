-- Isolated PostgreSQL fixture. Never execute against the event database.
create role anon; create role authenticated; create role service_role;
create table public.movie_candidates(id uuid primary key,event_id uuid not null);
create table public.event_runtime(event_id uuid primary key,run_id uuid,current_round_id uuid,video_state jsonb default '{}'::jsonb);
create table public.event_rounds(id uuid primary key,event_id uuid not null,movie_candidate_id uuid,status text,flow_status text,updated_at timestamptz);
create table public.film_packages(id uuid primary key default gen_random_uuid(),event_id uuid,movie_candidate_id uuid,title_snapshot text,fragments jsonb,status text,match_data jsonb,updated_at timestamptz default now(),unique(event_id,movie_candidate_id));
create table public.film_questions(id uuid primary key default gen_random_uuid(),film_package_id uuid references public.film_packages(id),position int check(position between 1 and 5),prompt text,options jsonb,correct_answer jsonb,reveal_text text,reveal_fragment jsonb,updated_at timestamptz default now(),unique(film_package_id,position));
create table public.registrations(event_id uuid,user_id uuid,status text,primary key(event_id,user_id));
create table public.film_predictions(id uuid primary key default gen_random_uuid(),event_id uuid,round_id uuid,film_package_id uuid references public.film_packages(id),question_id uuid references public.film_questions(id),user_id uuid,animal_name_snapshot text,answer jsonb,is_correct boolean,updated_at timestamptz default now(),unique(question_id,user_id));
create table public.event_projector_state(event_id uuid primary key,run_id uuid,round_id uuid,film_package_id uuid,state text,revision bigint default 0,payload jsonb,updated_at timestamptz default now());
create table public.event_runtime_log(id uuid primary key default gen_random_uuid(),event_id uuid,run_id uuid,action text,actor_user_id uuid,from_state jsonb,to_state jsonb);
