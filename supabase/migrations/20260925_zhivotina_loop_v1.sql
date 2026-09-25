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

drop index if exists public.crumb_ledger_operation_key_uq;
create unique index if not exists crumb_ledger_user_operation_key_uq
  on public.crumb_ledger(user_id, operation_key)
  where operation_key is not null;

create index if not exists user_creature_tasks_user_status_idx
  on public.user_creature_tasks(user_id,status);

alter table public.creature_tasks enable row level security;
alter table public.user_creature_tasks enable row level security;

insert into public.creature_tasks(id,title,description,reward_crumbs,completion_type,active)
values ('first_test_task','первая крошка','тестовое задание для первого вертикального среза Животины',3,'manual',true)
on conflict (id) do nothing;


create table if not exists public.creature_game_config (
  id text primary key,
  feeding_cost integer not null default 1 check (feeding_cost > 0),
  feeding_growth integer not null default 3 check (feeding_growth > 0),
  stage_thresholds jsonb not null default '{"stage_0":0,"stage_1":10,"stage_2":25,"stage_3":50,"stage_4":90}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.creature_game_config enable row level security;
insert into public.creature_game_config(id) values ('default') on conflict (id) do nothing;

create or replace function public.complete_creature_task(p_user_id uuid, p_task_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.creature_tasks%rowtype;
  c public.creatures%rowtype;
  op text := 'task:' || p_task_id || ':' || p_user_id::text;
begin
  select * into t from public.creature_tasks
  where id=p_task_id and active=true
    and completion_type='manual'
    and (available_from is null or available_from <= now())
    and (available_until is null or available_until >= now());
  if not found then raise exception 'task_unavailable'; end if;

  select * into c from public.creatures where user_id=p_user_id for update;
  if not found or c.born_at is null then raise exception 'creature_not_born'; end if;

  insert into public.user_creature_tasks(user_id,task_id,status,completed_at)
  values(p_user_id,p_task_id,'completed',now())
  on conflict (user_id,task_id) do nothing;
  if not found then
    return jsonb_build_object('ok',true,'alreadyCompleted',true,'crumbs',c.crumbs);
  end if;

  insert into public.crumb_ledger(user_id,delta,reason,operation_key,metadata)
  values(p_user_id,t.reward_crumbs,'task_reward',op,jsonb_build_object('taskId',p_task_id))
  on conflict (user_id, operation_key) where operation_key is not null do nothing;

  update public.creatures set crumbs=crumbs+t.reward_crumbs,updated_at=now()
  where user_id=p_user_id returning * into c;
  return jsonb_build_object('ok',true,'alreadyCompleted',false,'rewardCrumbs',t.reward_crumbs,'crumbs',c.crumbs);
end $$;

create or replace function public.feed_creature(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.creatures%rowtype;
  cfg public.creature_game_config%rowtype;
  feed_day date := (now() at time zone 'Europe/Moscow')::date;
  op text := 'feed:' || p_user_id::text || ':' || feed_day::text;
  next_growth integer;
  next_stage text;
begin
  select * into cfg from public.creature_game_config where id='default';
  select * into c from public.creatures where user_id=p_user_id for update;
  if not found or c.born_at is null then raise exception 'creature_not_born'; end if;
  if exists(select 1 from public.crumb_ledger where user_id=p_user_id and operation_key=op) then
    return jsonb_build_object('ok',true,'alreadyFed',true,'crumbs',c.crumbs,'growthProgress',c.growth_progress,'stage',c.stage);
  end if;
  if c.crumbs < cfg.feeding_cost then raise exception 'not_enough_crumbs'; end if;

  next_growth := c.growth_progress + cfg.feeding_growth;
  next_stage := case
    when next_growth >= coalesce((cfg.stage_thresholds->>'stage_4')::int,90) then 'stage_4'
    when next_growth >= coalesce((cfg.stage_thresholds->>'stage_3')::int,50) then 'stage_3'
    when next_growth >= coalesce((cfg.stage_thresholds->>'stage_2')::int,25) then 'stage_2'
    when next_growth >= coalesce((cfg.stage_thresholds->>'stage_1')::int,10) then 'stage_1'
    else 'stage_0' end;

  insert into public.crumb_ledger(user_id,delta,reason,operation_key,metadata)
  values(p_user_id,-cfg.feeding_cost,'feeding',op,jsonb_build_object('feedDay',feed_day,'growth',cfg.feeding_growth));

  update public.creatures set crumbs=crumbs-cfg.feeding_cost,growth_progress=next_growth,
    stage=next_stage,last_fed_at=now(),updated_at=now()
  where user_id=p_user_id returning * into c;

  return jsonb_build_object('ok',true,'alreadyFed',false,'cost',cfg.feeding_cost,'crumbs',c.crumbs,
    'growthProgress',c.growth_progress,'stage',c.stage,'lastFedAt',c.last_fed_at);
end $$;


-- RPCs are internal service-role entry points. Authenticated clients must use the Edge Function,
-- which authenticates Telegram initData and passes the canonical user id.
revoke execute on function public.complete_creature_task(uuid, text) from public;
revoke execute on function public.complete_creature_task(uuid, text) from anon;
revoke execute on function public.complete_creature_task(uuid, text) from authenticated;
grant execute on function public.complete_creature_task(uuid, text) to service_role;

revoke execute on function public.feed_creature(uuid) from public;
revoke execute on function public.feed_creature(uuid) from anon;
revoke execute on function public.feed_creature(uuid) from authenticated;
grant execute on function public.feed_creature(uuid) to service_role;
