create table if not exists public.event_hotel_keys (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  room_number text not null,
  observer_role integer not null check (observer_role between 0 and 4),
  checked_in_at timestamptz not null default now(),
  key_state text not null default 'checked_in' check (key_state in ('checked_in','number_noticed','post_film','selected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id,user_id),
  unique(event_id,room_number)
);
create index if not exists event_hotel_keys_event_idx on public.event_hotel_keys(event_id,checked_in_at);
alter table public.event_hotel_keys enable row level security;
