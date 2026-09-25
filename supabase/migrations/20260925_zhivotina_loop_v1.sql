-- zhivotina v1: minimal server-owned game loop
-- additive only: preserves existing creature/story/cosmetic data

create table if not exists public.creature_tasks (
  id text primary key,
  title text not null,
  description text not null default '',
  reward_crumbs integer not null check (reward_crumbs > 0),
  completion_type text not null default 'manual',
  available_from timestamptz,
  available_until timestamptz,
  active boolean not null default true,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.user_creature_tasks (
  user_id uuid not null references public.users(id) on delete cascade,
  task_id text not null references public.creature_tasks(id) on delete cascade,
  status text not null default 'available' check (status in ('available','completed')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, task_id)
);

alter table public.creatures
  add column if not exists growth_progress integer not null default 0,
  add column if not exists last_fed_at timestamptz;

alter table public.crumb_ledger
  add column if not exists operation_key text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create unique index if not exists crumb_ledger_operation_key_uq
  on public.crumb_ledger(operation_key)
  where operation_key is not null;

create index if not exists user_creature_tasks_user_status_idx
  on public.user_creature_tasks(user_id,status);

alter table public.creature_tasks enable row level security;
alter table public.user_creature_tasks enable row level security;

insert into public.creature_tasks(id,title,description,reward_crumbs,completion_type,active)
values ('first_test_task','первая крошка','тестовое задание для первого вертикального среза Животины',3,'manual',true)
on conflict (id) do nothing;
