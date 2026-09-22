-- v0.5: persistent Jipitina chat + richer post-film reactions.
-- Safe to run after SETUP_THIS_PROJECT.sql and PATCH_V0_4.sql.

create table if not exists public.jipitina_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  event_id uuid references public.events(id) on delete set null,
  role text not null check(role in ('user','assistant')),
  mode text not null default 'general',
  text text not null check(char_length(text) <= 6000),
  created_at timestamptz not null default now()
);
create index if not exists jipitina_messages_user_created_idx on public.jipitina_messages(user_id, created_at desc);
create index if not exists jipitina_messages_event_idx on public.jipitina_messages(event_id, created_at desc);
alter table public.jipitina_messages enable row level security;

create table if not exists public.post_film_reactions (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  rating int not null check(rating between 1 and 10),
  state_word text not null check(char_length(state_word) <= 80),
  thought text not null check(char_length(thought) <= 500),
  recommendation text not null check(recommendation in ('yes','no','depends')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(event_id,user_id)
);
create index if not exists post_film_reactions_event_idx on public.post_film_reactions(event_id);
alter table public.post_film_reactions enable row level security;

-- Clients still do not get direct table policies in MVP; all reads/writes go through Edge Functions using service_role.
