-- НАСЫПАТЕЛИ В КИНО v0.6 — Животина, истории, dating, notifications
-- Safe additive patch for the existing project.

create table if not exists public.creatures (
  user_id uuid primary key references public.users(id) on delete cascade,
  name text not null default 'Животина' check(char_length(name) between 1 and 32),
  born_at timestamptz,
  stage text not null default 'tiny' check(stage in ('tiny','young','grown')),
  crumbs int not null default 0 check(crumbs >= 0),
  traits jsonb not null default '{"curiosity":0,"argumentative":0,"social":0,"romantic":0,"chaotic":0,"cinephile":0}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.creature_cosmetics (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  slot text not null check(slot in ('ear','eye','neck','body','paw','aura','companion')),
  rarity text not null check(rarity in ('common','uncommon','rare','legendary','mythic')),
  visual jsonb not null default '{}'::jsonb,
  active boolean not null default true
);

create table if not exists public.story_definitions (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  category text not null check(category in ('cinema','random','social','dating','jipitina','seasonal','secret')),
  title text not null,
  description text not null,
  trigger_key text not null,
  rarity text not null check(rarity in ('common','uncommon','rare','legendary','mythic')),
  visibility text not null check(visibility in ('visible','hint','secret')),
  season_code text,
  condition jsonb not null default '{}'::jsonb,
  reward jsonb not null default '{}'::jsonb,
  repeatable boolean not null default false,
  limited_total int,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.user_stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  story_id uuid not null references public.story_definitions(id) on delete cascade,
  event_id uuid references public.events(id) on delete set null,
  occurrence_key text not null default 'once',
  context jsonb not null default '{}'::jsonb,
  happened_at timestamptz not null default now(),
  unique(user_id,story_id,occurrence_key)
);
create index if not exists user_stories_user_time_idx on public.user_stories(user_id,happened_at desc);

create table if not exists public.user_creature_cosmetics (
  user_id uuid not null references public.users(id) on delete cascade,
  cosmetic_id uuid not null references public.creature_cosmetics(id) on delete cascade,
  source_story_id uuid references public.user_stories(id) on delete set null,
  equipped boolean not null default false,
  acquired_at timestamptz not null default now(),
  primary key(user_id,cosmetic_id)
);

create table if not exists public.crumb_ledger (
  id bigserial primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  delta int not null,
  reason text not null,
  story_award_id uuid references public.user_stories(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists crumb_ledger_user_idx on public.crumb_ledger(user_id,created_at desc);

create table if not exists public.dating_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  enabled boolean not null default false,
  self_gender text check(self_gender in ('woman','man')),
  show_gender text check(show_gender in ('women','men','all')),
  intents text[] not null default '{}',
  paused boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.dating_swipes (
  swiper_id uuid not null references public.users(id) on delete cascade,
  target_id uuid not null references public.users(id) on delete cascade,
  direction text not null check(direction in ('like','pass')),
  created_at timestamptz not null default now(),
  primary key(swiper_id,target_id),
  check(swiper_id <> target_id)
);

create table if not exists public.social_connections (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.users(id) on delete cascade,
  user_b uuid not null references public.users(id) on delete cascade,
  kind text not null check(kind in ('friend','cinema','romantic')),
  status text not null default 'active' check(status in ('active','hidden','blocked')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check(user_a <> user_b)
);
create index if not exists social_connections_a_idx on public.social_connections(user_a,status);
create index if not exists social_connections_b_idx on public.social_connections(user_b,status);

create table if not exists public.user_blocks (
  blocker_id uuid not null references public.users(id) on delete cascade,
  blocked_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(blocker_id,blocked_id),
  check(blocker_id <> blocked_id)
);

create table if not exists public.notification_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  write_access boolean not null default false,
  events boolean not null default true,
  creature boolean not null default true,
  stories boolean not null default true,
  matches boolean not null default true,
  tickets boolean not null default true,
  reminders boolean not null default true,
  quiet_hours boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.encounter_tokens (
  id uuid primary key default gen_random_uuid(),
  token text unique not null,
  owner_user_id uuid references public.users(id) on delete cascade,
  event_id uuid references public.events(id) on delete cascade,
  kind text not null default 'rabbit',
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.creatures enable row level security;
alter table public.creature_cosmetics enable row level security;
alter table public.story_definitions enable row level security;
alter table public.user_stories enable row level security;
alter table public.user_creature_cosmetics enable row level security;
alter table public.crumb_ledger enable row level security;
alter table public.dating_profiles enable row level security;
alter table public.dating_swipes enable row level security;
alter table public.social_connections enable row level security;
alter table public.user_blocks enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.encounter_tokens enable row level security;


insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-didnt_understand_watched','след «не понял, но смотрел»','body','uncommon','{"glyph": "◒", "category": "cinema"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-silent_night','след «без слов»','companion','uncommon','{"glyph": "◒", "category": "cinema"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-no_plot','след «сюжет не пришёл»','neck','uncommon','{"glyph": "◒", "category": "cinema"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-animation_is_cinema','след «мультик, говорили они»','aura','uncommon','{"glyph": "◒", "category": "cinema"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-prediction_perfect','след «я так и знал»','eye','rare','{"glyph": "◒", "category": "cinema"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-rating_with_room','след «как все, и это нормально»','paw','uncommon','{"glyph": "◒", "category": "cinema"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-film_after_recommendation','след «по чужому совету»','ear','uncommon','{"glyph": "◒", "category": "cinema"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-morning_after','след «на утро не отпустил»','body','uncommon','{"glyph": "◒", "category": "cinema"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('random-bag','сумка «куда меня занесло»','body','rare','{"glyph": "□", "category": "random"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-random_accomplice','след «случайный соучастник»','companion','uncommon','{"glyph": "✦", "category": "random"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-wrong_door','след «не в ту дверь»','neck','rare','{"glyph": "✦", "category": "random"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-three_randoms','след «три случайности»','aura','uncommon','{"glyph": "✦", "category": "random"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-dice_night','след «кубик виноват»','eye','uncommon','{"glyph": "✦", "category": "random"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-reverse_choice','след «выбрал противоположное»','paw','uncommon','{"glyph": "✦", "category": "random"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-surprise_double','след «второй фильм случился сам»','ear','uncommon','{"glyph": "✦", "category": "random"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-nothing_common','след «у нас ничего общего»','body','rare','{"glyph": "∞", "category": "social"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-same_rating','след «одна оценка»','companion','uncommon','{"glyph": "∞", "category": "social"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-came_alone_left_group','след «пришёл один»','neck','uncommon','{"glyph": "∞", "category": "social"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-film_exchange','след «обменялись фильмами»','aura','uncommon','{"glyph": "∞", "category": "social"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-same_event_three_times','след «мы опять в одном зале»','eye','uncommon','{"glyph": "∞", "category": "social"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-physical_token','след «унесли один след»','paw','rare','{"glyph": "∞", "category": "social"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-cinema_match','след «мэтч на кино»','ear','uncommon','{"glyph": "♥", "category": "dating"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-opposites_match','след «противоположности»','body','uncommon','{"glyph": "♥", "category": "dating"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-second_shared_event','след «второй вечер вместе»','companion','uncommon','{"glyph": "♥", "category": "dating"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-jipitina_match','след «животина нас познакомила»','neck','rare','{"glyph": "♥", "category": "dating"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-different_genres_match','след «любим разное»','aura','rare','{"glyph": "♥", "category": "dating"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-match_reconnected','след «снова нашлись»','eye','uncommon','{"glyph": "♥", "category": "dating"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-match_anniversary','след «год назад зайцы встретились»','paw','legendary','{"glyph": "♥", "category": "dating"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-we_agreed','след «мы сошлись»','ear','uncommon','{"glyph": "?", "category": "jipitina"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-first_argument','след «первый спор»','body','uncommon','{"glyph": "?", "category": "jipitina"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-asked_for_surprise','след «удиви меня»','companion','rare','{"glyph": "?", "category": "jipitina"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-taste_calibrated','след «настроили вкус»','neck','uncommon','{"glyph": "?", "category": "jipitina"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-late_night_chat','след «ночной разговор»','aura','uncommon','{"glyph": "?", "category": "jipitina"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('first-flower','цветок первого вечера','ear','legendary','{"glyph": "✦", "category": "seasonal"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-first_thirty','след «первые 30»','neck','legendary','{"glyph": "✶", "category": "seasonal"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('horror-fangs','хэллоуинские клыки','eye','legendary','{"glyph": "⌁", "category": "seasonal"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-halloween_last_viewer','след «последний зритель»','paw','rare','{"glyph": "✶", "category": "seasonal"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('scarf-red','шарф семи дней','neck','legendary','{"glyph": "≈", "category": "seasonal"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('romantic-heart','сердце случайного свидания','body','legendary','{"glyph": "♥", "category": "seasonal"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-valentine_third','след «третий лишний»','body','uncommon','{"glyph": "✶", "category": "seasonal"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('travel-ticket','билет из другого города','paw','legendary','{"glyph": "▱", "category": "seasonal"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-season_zero','след «season 0»','ear','legendary','{"glyph": "✶", "category": "seasonal"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('night-cap','ночной колпак','ear','rare','{"glyph": "☾", "category": "secret"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-last_ticket','след «последний билет»','aura','rare','{"glyph": "•", "category": "secret"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.creature_cosmetics(code,name,slot,rarity,visual)
values ('trace-one_of_one','след «один из одного»','eye','mythic','{"glyph": "•", "category": "secret"}'::jsonb)
on conflict(code) do update set name=excluded.name,slot=excluded.slot,rarity=excluded.rarity,visual=excluded.visual,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('not_the_film','cinema','НЕ ТОТ ФИЛЬМ','посмотрел фильм, который изначально вообще не собирался смотреть: выбор сделала случайность','film_completed','common','visible','{"metadata_equals": {"story_code": "not_the_film"}}'::jsonb,'{"crumbs": 1, "traits": {"cinephile": 2}, "reaction_key": "not_the_film"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('changed_mind','cinema','ПЕРЕДУМАЛ','оставил ожидание до просмотра и после фильма честно поменял мнение','reaction_saved','common','visible','{"metadata_equals": {"story_code": "changed_mind"}}'::jsonb,'{"crumbs": 1, "traits": {"cinephile": 2}, "reaction_key": "changed_mind"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('didnt_understand_watched','cinema','НЕ ПОНЯЛ, НО СМОТРЕЛ','низко оценил понятность фильма, но высоко — впечатление','reaction_saved','uncommon','visible','{"metadata_lte": {"understanding": 3}, "metadata_gte": {"impression": 8}}'::jsonb,'{"crumbs": 2, "traits": {"cinephile": 3}, "reaction_key": "didnt_understand_watched", "cosmetic": "trace-didnt_understand_watched"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('after_credits','cinema','ДОСМОТРЕЛ ДО КОНЦА','киношная история: досмотрел до конца','reaction_saved','common','visible','{"metadata_equals": {"story_code": "after_credits"}}'::jsonb,'{"crumbs": 1, "traits": {"cinephile": 2}, "reaction_key": "after_credits"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('old_world','cinema','СТАРШЕ МЕНЯ','киношная история: старше меня','reaction_saved','rare','visible','{"metadata_equals": {"story_code": "old_world"}}'::jsonb,'{"crumbs": 3, "traits": {"cinephile": 5}, "reaction_key": "old_world"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('silent_night','cinema','БЕЗ СЛОВ','киношная история: без слов','reaction_saved','uncommon','visible','{"metadata_equals": {"story_code": "silent_night"}}'::jsonb,'{"crumbs": 2, "traits": {"cinephile": 3}, "reaction_key": "silent_night", "cosmetic": "trace-silent_night"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('long_haul','cinema','ДВА С ПОЛОВИНОЙ ЧАСА','киношная история: два с половиной часа','reaction_saved','common','visible','{"metadata_equals": {"story_code": "long_haul"}}'::jsonb,'{"crumbs": 1, "traits": {"cinephile": 2}, "reaction_key": "long_haul"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('one_room','cinema','ОДНА КОМНАТА','киношная история: одна комната','reaction_saved','common','visible','{"metadata_equals": {"story_code": "one_room"}}'::jsonb,'{"crumbs": 1, "traits": {"cinephile": 2}, "reaction_key": "one_room"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('no_plot','cinema','СЮЖЕТ НЕ ПРИШЁЛ','киношная история: сюжет не пришёл','reaction_saved','uncommon','visible','{"metadata_equals": {"story_code": "no_plot"}}'::jsonb,'{"crumbs": 2, "traits": {"cinephile": 3}, "reaction_key": "no_plot", "cosmetic": "trace-no_plot"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('subtitles_only','cinema','БЕЗ ДУБЛЯЖА','киношная история: без дубляжа','reaction_saved','rare','visible','{"metadata_equals": {"story_code": "subtitles_only"}}'::jsonb,'{"crumbs": 3, "traits": {"cinephile": 5}, "reaction_key": "subtitles_only"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('country_jump','cinema','ДРУГАЯ СТРАНА','киношная история: другая страна','reaction_saved','common','visible','{"metadata_equals": {"story_code": "country_jump"}}'::jsonb,'{"crumbs": 1, "traits": {"cinephile": 2}, "reaction_key": "country_jump"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('animation_is_cinema','cinema','МУЛЬТИК, ГОВОРИЛИ ОНИ','киношная история: мультик, говорили они','reaction_saved','uncommon','visible','{"metadata_equals": {"story_code": "animation_is_cinema"}}'::jsonb,'{"crumbs": 2, "traits": {"cinephile": 3}, "reaction_key": "animation_is_cinema", "cosmetic": "trace-animation_is_cinema"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('documentary_detour','cinema','ЭТО ВООБЩЕ БЫЛО','киношная история: это вообще было','reaction_saved','common','visible','{"metadata_equals": {"story_code": "documentary_detour"}}'::jsonb,'{"crumbs": 1, "traits": {"cinephile": 2}, "reaction_key": "documentary_detour"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('rewatch_changed','cinema','ВТОРОЙ РАЗ — ДРУГОЕ КИНО','киношная история: второй раз — другое кино','reaction_saved','common','visible','{"metadata_equals": {"story_code": "rewatch_changed"}}'::jsonb,'{"crumbs": 1, "traits": {"cinephile": 2}, "reaction_key": "rewatch_changed"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('prediction_perfect','cinema','Я ТАК И ЗНАЛ','киношная история: я так и знал','prediction_scored','rare','visible','{"metadata_equals": {"correct": 10, "total": 10}}'::jsonb,'{"crumbs": 3, "traits": {"cinephile": 5}, "reaction_key": "prediction_perfect", "cosmetic": "trace-prediction_perfect"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('prediction_zero','cinema','НИЧЕГО НЕ УГАДАЛ','киношная история: ничего не угадал','prediction_scored','common','visible','{"metadata_equals": {"correct": 0}}'::jsonb,'{"crumbs": 1, "traits": {"cinephile": 2}, "reaction_key": "prediction_zero"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('rating_against_room','cinema','ПРОТИВ ЗАЛА','киношная история: против зала','reaction_saved','common','visible','{"metadata_gte": {"rating_gap": 4}}'::jsonb,'{"crumbs": 1, "traits": {"cinephile": 2}, "reaction_key": "rating_against_room"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('rating_with_room','cinema','КАК ВСЕ, И ЭТО НОРМАЛЬНО','киношная история: как все, и это нормально','reaction_saved','uncommon','visible','{"metadata_equals": {"story_code": "rating_with_room"}}'::jsonb,'{"crumbs": 2, "traits": {"cinephile": 3}, "reaction_key": "rating_with_room", "cosmetic": "trace-rating_with_room"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('genre_conversion','cinema','Я ЭТОТ ЖАНР НЕ ЛЮБЛЮ','киношная история: я этот жанр не люблю','reaction_saved','common','visible','{"metadata_equals": {"story_code": "genre_conversion"}}'::jsonb,'{"crumbs": 1, "traits": {"cinephile": 2}, "reaction_key": "genre_conversion"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('director_rabbit_hole','cinema','ОДИН РЕЖИССЁР — ТРИ ФИЛЬМА','киношная история: один режиссёр — три фильма','film_completed','rare','visible','{"metadata_equals": {"story_code": "director_rabbit_hole"}}'::jsonb,'{"crumbs": 3, "traits": {"cinephile": 5}, "reaction_key": "director_rabbit_hole"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('film_after_recommendation','cinema','ПО ЧУЖОМУ СОВЕТУ','киношная история: по чужому совету','film_completed','uncommon','visible','{"metadata_equals": {"story_code": "film_after_recommendation"}}'::jsonb,'{"crumbs": 2, "traits": {"cinephile": 3}, "reaction_key": "film_after_recommendation", "cosmetic": "trace-film_after_recommendation"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('trailer_lied','cinema','ТРЕЙЛЕР ВРАЛ','киношная история: трейлер врал','reaction_saved','common','visible','{"metadata_equals": {"story_code": "trailer_lied"}}'::jsonb,'{"crumbs": 1, "traits": {"cinephile": 2}, "reaction_key": "trailer_lied"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('blind_watch','cinema','НЕ ЧИТАЛ ОПИСАНИЕ','киношная история: не читал описание','reaction_saved','common','visible','{"metadata_equals": {"story_code": "blind_watch"}}'::jsonb,'{"crumbs": 1, "traits": {"cinephile": 2}, "reaction_key": "blind_watch"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('morning_after','cinema','НА УТРО НЕ ОТПУСТИЛ','киношная история: на утро не отпустил','reaction_saved','uncommon','visible','{"metadata_equals": {"story_code": "morning_after"}}'::jsonb,'{"crumbs": 2, "traits": {"cinephile": 3}, "reaction_key": "morning_after", "cosmetic": "trace-morning_after"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('where_am_i','random','КУДА МЕНЯ ЗАНЕСЛО','выполнил случайное офлайн-задание и оказался в сценарии, которого не планировал','random_task','rare','hint','{"metadata_equals": {"story_code": "where_am_i"}}'::jsonb,'{"crumbs": 3, "traits": {"chaotic": 5}, "reaction_key": "where_am_i", "cosmetic": "random-bag"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('queue_person','random','ЧЕЛОВЕК ИЗ ОЧЕРЕДИ','посмотрел фильм по совету случайного человека из очереди','random_task','common','hint','{"metadata_equals": {"story_code": "queue_person"}}'::jsonb,'{"crumbs": 1, "traits": {"chaotic": 2}, "reaction_key": "queue_person"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('random_accomplice','random','СЛУЧАЙНЫЙ СОУЧАСТНИК','выполнил совместное задание с незнакомым человеком, который получил ту же механику','random_task','uncommon','hint','{"metadata_equals": {"story_code": "random_accomplice"}}'::jsonb,'{"crumbs": 2, "traits": {"chaotic": 3}, "reaction_key": "random_accomplice", "cosmetic": "trace-random_accomplice"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('coin_chose','random','МОНЕТКА РЕШИЛА','случайность внутри клуба: монетка решила','random_task','common','hint','{"metadata_equals": {"story_code": "coin_chose"}}'::jsonb,'{"crumbs": 1, "traits": {"chaotic": 2}, "reaction_key": "coin_chose"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('rabbit_chose','random','ЖИВОТИНА РЕШИЛА','случайность внутри клуба: животина решила','random_task','common','hint','{"metadata_equals": {"story_code": "rabbit_chose"}}'::jsonb,'{"crumbs": 1, "traits": {"chaotic": 2}, "reaction_key": "rabbit_chose"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('wrong_door','random','НЕ В ТУ ДВЕРЬ','случайность внутри клуба: не в ту дверь','random_task','rare','secret','{"metadata_equals": {"story_code": "wrong_door"}}'::jsonb,'{"crumbs": 3, "traits": {"chaotic": 5}, "reaction_key": "wrong_door", "cosmetic": "trace-wrong_door"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('seat_lottery','random','НЕ МОЁ МЕСТО','случайность внутри клуба: не моё место','random_task','common','hint','{"metadata_equals": {"story_code": "seat_lottery"}}'::jsonb,'{"crumbs": 1, "traits": {"chaotic": 2}, "reaction_key": "seat_lottery"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('mystery_card','random','КАРТОЧКА БЕЗ ОБЪЯСНЕНИЙ','случайность внутри клуба: карточка без объяснений','random_task','common','secret','{"metadata_equals": {"story_code": "mystery_card"}}'::jsonb,'{"crumbs": 1, "traits": {"chaotic": 2}, "reaction_key": "mystery_card"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('three_randoms','random','ТРИ СЛУЧАЙНОСТИ','случайность внутри клуба: три случайности','random_task','uncommon','secret','{"metadata_equals": {"story_code": "three_randoms"}}'::jsonb,'{"crumbs": 2, "traits": {"chaotic": 3}, "reaction_key": "three_randoms", "cosmetic": "trace-three_randoms"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('last_minute_plan','random','Я ЭТОГО НЕ ПЛАНИРОВАЛ','случайность внутри клуба: я этого не планировал','random_task','common','hint','{"metadata_equals": {"story_code": "last_minute_plan"}}'::jsonb,'{"crumbs": 1, "traits": {"chaotic": 2}, "reaction_key": "last_minute_plan"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('stranger_program','random','ЧУЖАЯ ПРОГРАММА','случайность внутри клуба: чужая программа','random_task','rare','hint','{"metadata_equals": {"story_code": "stranger_program"}}'::jsonb,'{"crumbs": 3, "traits": {"chaotic": 5}, "reaction_key": "stranger_program"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('dice_night','random','КУБИК ВИНОВАТ','случайность внутри клуба: кубик виноват','random_task','uncommon','hint','{"metadata_equals": {"story_code": "dice_night"}}'::jsonb,'{"crumbs": 2, "traits": {"chaotic": 3}, "reaction_key": "dice_night", "cosmetic": "trace-dice_night"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('random_city','random','КИНО УВЕЛО ИЗ ДОМА','случайность внутри клуба: кино увело из дома','random_task','common','hint','{"metadata_equals": {"story_code": "random_city"}}'::jsonb,'{"crumbs": 1, "traits": {"chaotic": 2}, "reaction_key": "random_city"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('mystery_genre','random','ЖАНР УЗНАЛ ПОТОМ','случайность внутри клуба: жанр узнал потом','random_task','common','hint','{"metadata_equals": {"story_code": "mystery_genre"}}'::jsonb,'{"crumbs": 1, "traits": {"chaotic": 2}, "reaction_key": "mystery_genre"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('reverse_choice','random','ВЫБРАЛ ПРОТИВОПОЛОЖНОЕ','случайность внутри клуба: выбрал противоположное','random_task','uncommon','hint','{"metadata_equals": {"story_code": "reverse_choice"}}'::jsonb,'{"crumbs": 2, "traits": {"chaotic": 3}, "reaction_key": "reverse_choice", "cosmetic": "trace-reverse_choice"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('rabbit_dare','random','ЖИВОТИНА ПОДБИЛА','случайность внутри клуба: животина подбила','random_task','rare','hint','{"metadata_equals": {"story_code": "rabbit_dare"}}'::jsonb,'{"crumbs": 3, "traits": {"chaotic": 5}, "reaction_key": "rabbit_dare"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('no_takebacks','random','НАЗАД НЕЛЬЗЯ','случайность внутри клуба: назад нельзя','random_task','common','secret','{"metadata_equals": {"story_code": "no_takebacks"}}'::jsonb,'{"crumbs": 1, "traits": {"chaotic": 2}, "reaction_key": "no_takebacks"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('surprise_double','random','ВТОРОЙ ФИЛЬМ СЛУЧИЛСЯ САМ','случайность внутри клуба: второй фильм случился сам','random_task','uncommon','hint','{"metadata_equals": {"story_code": "surprise_double"}}'::jsonb,'{"crumbs": 2, "traits": {"chaotic": 3}, "reaction_key": "surprise_double", "cosmetic": "trace-surprise_double"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('stranger','social','НЕЗНАКОМЕЦ','впервые взаимодействовал с человеком, которого до этого не знал, через конкретное кино-задание','encounter','common','hint','{"metadata_equals": {"story_code": "stranger"}}'::jsonb,'{"crumbs": 1, "traits": {"social": 2}, "reaction_key": "stranger"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('same_taste','social','У НАС ОДИН ВКУС','встретил человека с совпавшим любимым фильмом','encounter','common','hint','{"metadata_gte": {"shared_favorites": 1}}'::jsonb,'{"crumbs": 1, "traits": {"social": 2}, "reaction_key": "same_taste"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('nothing_common','social','У НАС НИЧЕГО ОБЩЕГО','встретил человека без совпадений по кино и всё равно сделал что-то вместе','encounter','rare','hint','{"metadata_equals": {"shared_favorites": 0, "shared_genres": 0}}'::jsonb,'{"crumbs": 3, "traits": {"social": 5}, "reaction_key": "nothing_common", "cosmetic": "trace-nothing_common"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('convinced','social','ПЕРЕУБЕДИЛ','посмотрел фильм по рекомендации другого участника и изменил мнение о жанре, режиссёре или фильме','social_task','common','hint','{"metadata_equals": {"story_code": "convinced"}}'::jsonb,'{"crumbs": 1, "traits": {"social": 2}, "reaction_key": "convinced"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('first_rabbit_meet','social','ЗАЙЦЫ ВСТРЕТИЛИСЬ','история, которая произошла между людьми: зайцы встретились','encounter','common','hint','{"metadata_equals": {"story_code": "first_rabbit_meet"}}'::jsonb,'{"crumbs": 1, "traits": {"social": 2}, "reaction_key": "first_rabbit_meet"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('same_rating','social','ОДНА ОЦЕНКА','история, которая произошла между людьми: одна оценка','encounter','uncommon','hint','{"metadata_equals": {"same_rating": true}}'::jsonb,'{"crumbs": 2, "traits": {"social": 3}, "reaction_key": "same_rating", "cosmetic": "trace-same_rating"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('opposite_rating','social','ДВА РАЗНЫХ ФИЛЬМА','история, которая произошла между людьми: два разных фильма','encounter','common','hint','{"metadata_gte": {"rating_gap": 5}}'::jsonb,'{"crumbs": 1, "traits": {"social": 2}, "reaction_key": "opposite_rating"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('shared_recommendation','social','ПОСОВЕТОВАЛ ТРЕТЬЕМУ','история, которая произошла между людьми: посоветовал третьему','social_task','rare','hint','{"metadata_equals": {"story_code": "shared_recommendation"}}'::jsonb,'{"crumbs": 3, "traits": {"social": 5}, "reaction_key": "shared_recommendation"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('came_alone_left_group','social','ПРИШЁЛ ОДИН','история, которая произошла между людьми: пришёл один','social_task','uncommon','hint','{"metadata_equals": {"story_code": "came_alone_left_group"}}'::jsonb,'{"crumbs": 2, "traits": {"social": 3}, "reaction_key": "came_alone_left_group", "cosmetic": "trace-came_alone_left_group"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('brought_new_person','social','ПРИВЁЛ НОВОГО','история, которая произошла между людьми: привёл нового','social_task','common','hint','{"metadata_equals": {"story_code": "brought_new_person"}}'::jsonb,'{"crumbs": 1, "traits": {"social": 2}, "reaction_key": "brought_new_person"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('discussion_pair','social','ДОСПОРИЛИСЬ','история, которая произошла между людьми: доспорились','social_task','common','hint','{"metadata_equals": {"story_code": "discussion_pair"}}'::jsonb,'{"crumbs": 1, "traits": {"social": 2}, "reaction_key": "discussion_pair"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('film_exchange','social','ОБМЕНЯЛИСЬ ФИЛЬМАМИ','история, которая произошла между людьми: обменялись фильмами','social_task','uncommon','hint','{"metadata_equals": {"story_code": "film_exchange"}}'::jsonb,'{"crumbs": 2, "traits": {"social": 3}, "reaction_key": "film_exchange", "cosmetic": "trace-film_exchange"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('three_rabbits','social','ТРИ ЗАЙЦА','история, которая произошла между людьми: три зайца','encounter','rare','hint','{"metadata_gte": {"party_size": 3}}'::jsonb,'{"crumbs": 3, "traits": {"social": 5}, "reaction_key": "three_rabbits"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('met_again','social','ОПЯТЬ ТЫ','история, которая произошла между людьми: опять ты','encounter','common','hint','{"metadata_equals": {"story_code": "met_again"}}'::jsonb,'{"crumbs": 1, "traits": {"social": 2}, "reaction_key": "met_again"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('same_event_three_times','social','МЫ ОПЯТЬ В ОДНОМ ЗАЛЕ','история, которая произошла между людьми: мы опять в одном зале','encounter','uncommon','secret','{"metadata_equals": {"story_code": "same_event_three_times"}}'::jsonb,'{"crumbs": 2, "traits": {"social": 3}, "reaction_key": "same_event_three_times", "cosmetic": "trace-same_event_three_times"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('helped_choice','social','ПОМОГ ВЫБРАТЬ','история, которая произошла между людьми: помог выбрать','social_task','common','hint','{"metadata_equals": {"story_code": "helped_choice"}}'::jsonb,'{"crumbs": 1, "traits": {"social": 2}, "reaction_key": "helped_choice"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('shared_secret','social','ОБЩИЙ СЕКРЕТ','история, которая произошла между людьми: общий секрет','encounter','common','secret','{"metadata_equals": {"story_code": "shared_secret"}}'::jsonb,'{"crumbs": 1, "traits": {"social": 2}, "reaction_key": "shared_secret"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('physical_token','social','УНЕСЛИ ОДИН СЛЕД','история, которая произошла между людьми: унесли один след','encounter','rare','hint','{"metadata_equals": {"story_code": "physical_token"}}'::jsonb,'{"crumbs": 3, "traits": {"social": 5}, "reaction_key": "physical_token", "cosmetic": "trace-physical_token"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('first_like','dating','ПЕРВЫЙ ЛАЙК','история двух Животин: первый лайк','dating_swipe','common','visible','{"metadata_equals": {"story_code": "first_like"}}'::jsonb,'{"crumbs": 1, "traits": {"romantic": 2}, "reaction_key": "first_like"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('first_match','dating','ЗАЙЦЫ СОВПАЛИ','два человека взаимно выбрали друг друга — их Животины впервые встретились','dating_match','rare','visible','{"metadata_equals": {"story_code": "first_match"}}'::jsonb,'{"crumbs": 3, "traits": {"romantic": 5}, "reaction_key": "first_match"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('cinema_match','dating','МЭТЧ НА КИНО','история двух Животин: мэтч на кино','dating_match','uncommon','visible','{"metadata_equals": {"story_code": "cinema_match"}}'::jsonb,'{"crumbs": 2, "traits": {"romantic": 3}, "reaction_key": "cinema_match", "cosmetic": "trace-cinema_match"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('friend_match','dating','ЗАЙЦЫ ПОДРУЖИЛИСЬ','история двух Животин: зайцы подружились','dating_match','common','visible','{"metadata_equals": {"story_code": "friend_match"}}'::jsonb,'{"crumbs": 1, "traits": {"romantic": 2}, "reaction_key": "friend_match"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('romantic_match','dating','ЭТО УЖЕ ПОХОЖЕ НА СВИДАНИЕ','история двух Животин: это уже похоже на свидание','dating_match','rare','visible','{"metadata_equals": {"story_code": "romantic_match"}}'::jsonb,'{"crumbs": 3, "traits": {"romantic": 5}, "reaction_key": "romantic_match"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('opposites_match','dating','ПРОТИВОПОЛОЖНОСТИ','история двух Животин: противоположности','dating_match','uncommon','secret','{"metadata_equals": {"story_code": "opposites_match"}}'::jsonb,'{"crumbs": 2, "traits": {"romantic": 3}, "reaction_key": "opposites_match", "cosmetic": "trace-opposites_match"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('same_favorite_match','dating','ОДИН ЛЮБИМЫЙ ФИЛЬМ','история двух Животин: один любимый фильм','dating_match','common','visible','{"metadata_equals": {"story_code": "same_favorite_match"}}'::jsonb,'{"crumbs": 1, "traits": {"romantic": 2}, "reaction_key": "same_favorite_match"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('match_watched_together','dating','ПОСМОТРЕЛИ ВМЕСТЕ','история двух Животин: посмотрели вместе','dating_match','common','visible','{"metadata_equals": {"story_code": "match_watched_together"}}'::jsonb,'{"crumbs": 1, "traits": {"romantic": 2}, "reaction_key": "match_watched_together"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('second_shared_event','dating','ВТОРОЙ ВЕЧЕР ВМЕСТЕ','история двух Животин: второй вечер вместе','dating_swipe','uncommon','visible','{"metadata_gte": {"shared_event_count": 2}}'::jsonb,'{"crumbs": 2, "traits": {"romantic": 3}, "reaction_key": "second_shared_event", "cosmetic": "trace-second_shared_event"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('third_shared_event','dating','ЭТО УЖЕ СИСТЕМА','история двух Животин: это уже система','dating_swipe','rare','visible','{"metadata_gte": {"shared_event_count": 3}}'::jsonb,'{"crumbs": 3, "traits": {"romantic": 5}, "reaction_key": "third_shared_event"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('match_after_three_coincidences','dating','ТРИ СОВПАДЕНИЯ','история двух Животин: три совпадения','dating_match','common','secret','{"metadata_gte": {"shared_event_count": 3}}'::jsonb,'{"crumbs": 1, "traits": {"romantic": 2}, "reaction_key": "match_after_three_coincidences"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('jipitina_match','dating','ЖИВОТИНА НАС ПОЗНАКОМИЛА','мэтч появился после рекомендации Животины-свахи','dating_match','rare','visible','{"metadata_equals": {"story_code": "jipitina_match"}}'::jsonb,'{"crumbs": 3, "traits": {"romantic": 5}, "reaction_key": "jipitina_match", "cosmetic": "trace-jipitina_match"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('random_date','dating','СЛУЧАЙНОЕ СВИДАНИЕ','история двух Животин: случайное свидание','dating_match','rare','visible','{"metadata_equals": {"story_code": "random_date"}}'::jsonb,'{"crumbs": 3, "traits": {"romantic": 5}, "reaction_key": "random_date"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('date_no_photo','dating','СНАЧАЛА ЗАЯЦ','история двух Животин: сначала заяц','dating_swipe','common','visible','{"metadata_equals": {"story_code": "date_no_photo"}}'::jsonb,'{"crumbs": 1, "traits": {"romantic": 2}, "reaction_key": "date_no_photo"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('different_genres_match','dating','ЛЮБИМ РАЗНОЕ','история двух Животин: любим разное','dating_match','rare','visible','{"metadata_equals": {"story_code": "different_genres_match"}}'::jsonb,'{"crumbs": 3, "traits": {"romantic": 5}, "reaction_key": "different_genres_match", "cosmetic": "trace-different_genres_match"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('same_hate_match','dating','НЕНАВИДИМ ОДНО И ТО ЖЕ','история двух Животин: ненавидим одно и то же','dating_match','common','visible','{"metadata_equals": {"story_code": "same_hate_match"}}'::jsonb,'{"crumbs": 1, "traits": {"romantic": 2}, "reaction_key": "same_hate_match"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('mutual_recommendation','dating','ВЫБРАЛИ ДРУГ ДРУГУ','история двух Животин: выбрали друг другу','dating_swipe','common','visible','{"metadata_equals": {"story_code": "mutual_recommendation"}}'::jsonb,'{"crumbs": 1, "traits": {"romantic": 2}, "reaction_key": "mutual_recommendation"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('match_reconnected','dating','СНОВА НАШЛИСЬ','история двух Животин: снова нашлись','dating_match','uncommon','visible','{"metadata_equals": {"story_code": "match_reconnected"}}'::jsonb,'{"crumbs": 2, "traits": {"romantic": 3}, "reaction_key": "match_reconnected", "cosmetic": "trace-match_reconnected"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('double_match_event','dating','ДВА МЭТЧА ЗА ВЕЧЕР','история двух Животин: два мэтча за вечер','dating_match','common','visible','{"metadata_equals": {"story_code": "double_match_event"}}'::jsonb,'{"crumbs": 1, "traits": {"romantic": 2}, "reaction_key": "double_match_event"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('cinema_companion','dating','ЕСТЬ С КЕМ ИДТИ','история двух Животин: есть с кем идти','dating_match','rare','visible','{"metadata_equals": {"story_code": "cinema_companion"}}'::jsonb,'{"crumbs": 3, "traits": {"romantic": 5}, "reaction_key": "cinema_companion"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('match_anniversary','dating','ГОД НАЗАД ЗАЙЦЫ ВСТРЕТИЛИСЬ','история двух Животин: год назад зайцы встретились','dating_match','legendary','visible','{"metadata_equals": {"story_code": "match_anniversary"}}'::jsonb,'{"crumbs": 5, "traits": {"romantic": 8}, "reaction_key": "match_anniversary", "cosmetic": "trace-match_anniversary"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('rabbit_wingman','dating','ЖИВОТИНА-СВАХА','история двух Животин: животина-сваха','dating_match','common','visible','{"metadata_equals": {"story_code": "rabbit_wingman"}}'::jsonb,'{"crumbs": 1, "traits": {"romantic": 2}, "reaction_key": "rabbit_wingman"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('rabbit_wrong','jipitina','ЗАЙЧИК, ТЫ НЕ ПРАВ','реально поспорил с Животиной о фильме и развил спор дальше одного сообщения','jipitina_chat','common','visible','{"metadata_equals": {"story_code": "rabbit_wrong"}}'::jsonb,'{"crumbs": 1, "traits": {"argumentative": 2}, "reaction_key": "rabbit_wrong"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('we_agreed','jipitina','МЫ СОШЛИСЬ','независимо от Животины выбрал тот же фильм','jipitina_chat','uncommon','visible','{"metadata_equals": {"story_code": "we_agreed"}}'::jsonb,'{"crumbs": 2, "traits": {"argumentative": 3}, "reaction_key": "we_agreed", "cosmetic": "trace-we_agreed"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('rabbit_knows_me','jipitina','ЖИВОТИНА МЕНЯ ЗНАЕТ','доверил выбор Животине, посмотрел и подтвердил, что она попала во вкус','jipitina_chat','rare','visible','{"metadata_equals": {"story_code": "rabbit_knows_me"}}'::jsonb,'{"crumbs": 3, "traits": {"argumentative": 5}, "reaction_key": "rabbit_knows_me"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('rabbit_doesnt_know','jipitina','ЖИВОТИНА МЕНЯ НЕ ЗНАЕТ','Животина промахнулась с рекомендацией, а пользователь объяснил почему — профиль вкуса обновился','jipitina_chat','common','visible','{"metadata_equals": {"story_code": "rabbit_doesnt_know"}}'::jsonb,'{"crumbs": 1, "traits": {"argumentative": 2}, "reaction_key": "rabbit_doesnt_know"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('first_argument','jipitina','ПЕРВЫЙ СПОР','история отношений с собственной Животиной: первый спор','jipitina_chat','uncommon','visible','{"metadata_equals": {"story_code": "first_argument"}}'::jsonb,'{"crumbs": 2, "traits": {"argumentative": 3}, "reaction_key": "first_argument", "cosmetic": "trace-first_argument"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('changed_rabbit_mind','jipitina','ПЕРЕУБЕДИЛ ЖИВОТИНУ','история отношений с собственной Животиной: переубедил животину','jipitina_chat','common','visible','{"metadata_equals": {"story_code": "changed_rabbit_mind"}}'::jsonb,'{"crumbs": 1, "traits": {"argumentative": 2}, "reaction_key": "changed_rabbit_mind"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('rabbit_changed_mine','jipitina','ЖИВОТИНА ПЕРЕУБЕДИЛА МЕНЯ','история отношений с собственной Животиной: животина переубедила меня','jipitina_chat','common','visible','{"metadata_equals": {"story_code": "rabbit_changed_mine"}}'::jsonb,'{"crumbs": 1, "traits": {"argumentative": 2}, "reaction_key": "rabbit_changed_mine"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('asked_for_surprise','jipitina','УДИВИ МЕНЯ','история отношений с собственной Животиной: удиви меня','jipitina_chat','rare','visible','{"metadata_equals": {"story_code": "asked_for_surprise"}}'::jsonb,'{"crumbs": 3, "traits": {"argumentative": 5}, "reaction_key": "asked_for_surprise", "cosmetic": "trace-asked_for_surprise"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('trusted_choice','jipitina','Я ТЕБЕ ДОВЕРЯЮ','история отношений с собственной Животиной: я тебе доверяю','jipitina_chat','common','visible','{"metadata_equals": {"story_code": "trusted_choice"}}'::jsonb,'{"crumbs": 1, "traits": {"argumentative": 2}, "reaction_key": "trusted_choice"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('rejected_three','jipitina','НЕТ, НЕТ И ЕЩЁ РАЗ НЕТ','история отношений с собственной Животиной: нет, нет и ещё раз нет','jipitina_chat','common','visible','{"metadata_equals": {"story_code": "rejected_three"}}'::jsonb,'{"crumbs": 1, "traits": {"argumentative": 2}, "reaction_key": "rejected_three"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('taste_calibrated','jipitina','НАСТРОИЛИ ВКУС','история отношений с собственной Животиной: настроили вкус','jipitina_chat','uncommon','visible','{"metadata_equals": {"story_code": "taste_calibrated"}}'::jsonb,'{"crumbs": 2, "traits": {"argumentative": 3}, "reaction_key": "taste_calibrated", "cosmetic": "trace-taste_calibrated"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('rabbit_predicted_rating','jipitina','ОНА УГАДАЛА ОЦЕНКУ','история отношений с собственной Животиной: она угадала оценку','reaction_saved','common','visible','{"metadata_equals": {"story_code": "rabbit_predicted_rating"}}'::jsonb,'{"crumbs": 1, "traits": {"argumentative": 2}, "reaction_key": "rabbit_predicted_rating"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('rabbit_missed_rating','jipitina','ОНА НЕ УГАДАЛА ВООБЩЕ','история отношений с собственной Животиной: она не угадала вообще','reaction_saved','rare','visible','{"metadata_equals": {"story_code": "rabbit_missed_rating"}}'::jsonb,'{"crumbs": 3, "traits": {"argumentative": 5}, "reaction_key": "rabbit_missed_rating"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('late_night_chat','jipitina','НОЧНОЙ РАЗГОВОР','история отношений с собственной Животиной: ночной разговор','jipitina_chat','uncommon','visible','{"metadata_equals": {"story_code": "late_night_chat"}}'::jsonb,'{"crumbs": 2, "traits": {"argumentative": 3}, "reaction_key": "late_night_chat", "cosmetic": "trace-late_night_chat"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('ten_real_conversations','jipitina','МЫ УЖЕ ЗНАКОМЫ','история отношений с собственной Животиной: мы уже знакомы','jipitina_chat','common','visible','{"min_trigger_count": 10}'::jsonb,'{"crumbs": 1, "traits": {"argumentative": 2}, "reaction_key": "ten_real_conversations"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('rabbit_secret','jipitina','ЖИВОТИНА ЧТО-ТО СКРЫВАЕТ','история отношений с собственной Животиной: животина что-то скрывает','jipitina_chat','common','secret','{"metadata_equals": {"story_code": "rabbit_secret"}}'::jsonb,'{"crumbs": 1, "traits": {"argumentative": 2}, "reaction_key": "rabbit_secret"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('first_event','seasonal','ПЕРВООТКРЫВАТЕЛЬ','пришёл на самый первый публичный вечер НАСЫПАТЕЛЕЙ В КИНО','event_checkin','legendary','visible','{"metadata_equals": {"event_slug": "2026-10-03"}}'::jsonb,'{"crumbs": 5, "traits": {"curiosity": 8}, "reaction_key": "first_event", "cosmetic": "first-flower"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('first_thirty','seasonal','ПЕРВЫЕ 30','оказался среди первых тридцати участников проекта','event_checkin','legendary','visible','{"metadata_lte": {"member_number": 30}}'::jsonb,'{"crumbs": 5, "traits": {"curiosity": 8}, "reaction_key": "first_thirty", "cosmetic": "trace-first_thirty"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('halloween','seasonal','ХЭЛЛОУИН','пришёл на лимитированный хэллоуинский показ','event_checkin','legendary','visible','{"metadata_equals": {"story_code": "halloween"}}'::jsonb,'{"crumbs": 5, "traits": {"curiosity": 8}, "reaction_key": "halloween", "cosmetic": "horror-fangs"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('halloween_last_viewer','seasonal','ПОСЛЕДНИЙ ЗРИТЕЛЬ','лимитированная история конкретного периода проекта: последний зритель','event_checkin','rare','secret','{"metadata_equals": {"story_code": "halloween_last_viewer"}}'::jsonb,'{"crumbs": 3, "traits": {"curiosity": 5}, "reaction_key": "halloween_last_viewer", "cosmetic": "trace-halloween_last_viewer"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('new_year_day1','seasonal','НАЧАЛО','лимитированная история конкретного периода проекта: начало','event_checkin','common','visible','{"metadata_equals": {"story_code": "new_year_day1"}}'::jsonb,'{"crumbs": 1, "traits": {"curiosity": 2}, "reaction_key": "new_year_day1"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('new_year_day3','seasonal','СЛУЧАЙНЫЙ ФИЛЬМ','лимитированная история конкретного периода проекта: случайный фильм','event_checkin','common','visible','{"metadata_equals": {"story_code": "new_year_day3"}}'::jsonb,'{"crumbs": 1, "traits": {"curiosity": 2}, "reaction_key": "new_year_day3"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('new_year_day7','seasonal','СЕМЬ ДНЕЙ','прошёл все семь дней новогоднего киномарафона','event_checkin','legendary','visible','{"requires_story_codes": ["new_year_day1", "new_year_day3"], "metadata_gte": {"marathon_days": 7}}'::jsonb,'{"crumbs": 5, "traits": {"curiosity": 8}, "reaction_key": "new_year_day7", "cosmetic": "scarf-red"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('valentine_stranger','seasonal','СВИДАНИЕ С НЕЗНАКОМЦЕМ','согласился на кино-встречу с незнакомым человеком через механику проекта','event_checkin','legendary','visible','{"metadata_equals": {"story_code": "valentine_stranger"}}'::jsonb,'{"crumbs": 5, "traits": {"curiosity": 8}, "reaction_key": "valentine_stranger", "cosmetic": "romantic-heart"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('valentine_not_date','seasonal','НЕ СВИДАНИЕ','лимитированная история конкретного периода проекта: не свидание','event_checkin','common','visible','{"metadata_equals": {"story_code": "valentine_not_date"}}'::jsonb,'{"crumbs": 1, "traits": {"curiosity": 2}, "reaction_key": "valentine_not_date"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('valentine_third','seasonal','ТРЕТИЙ ЛИШНИЙ','лимитированная история конкретного периода проекта: третий лишний','event_checkin','uncommon','visible','{"metadata_equals": {"story_code": "valentine_third"}}'::jsonb,'{"crumbs": 2, "traits": {"curiosity": 3}, "reaction_key": "valentine_third", "cosmetic": "trace-valentine_third"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('summer_away','seasonal','УЕХАЛ ЗА КИНО','лимитированная история конкретного периода проекта: уехал за кино','event_checkin','common','visible','{"metadata_equals": {"story_code": "summer_away"}}'::jsonb,'{"crumbs": 1, "traits": {"curiosity": 2}, "reaction_key": "summer_away"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('open_air','seasonal','КИНО ПОД ОТКРЫТЫМ НЕБОМ','лимитированная история конкретного периода проекта: кино под открытым небом','event_checkin','rare','visible','{"metadata_equals": {"story_code": "open_air"}}'::jsonb,'{"crumbs": 3, "traits": {"curiosity": 5}, "reaction_key": "open_air"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('other_city','seasonal','ДРУГОЙ ГОРОД','лимитированная история конкретного периода проекта: другой город','event_checkin','legendary','visible','{"metadata_equals": {"story_code": "other_city"}}'::jsonb,'{"crumbs": 5, "traits": {"curiosity": 8}, "reaction_key": "other_city", "cosmetic": "travel-ticket"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('season_zero','seasonal','SEASON 0','лимитированная история конкретного периода проекта: season 0','event_checkin','legendary','visible','{"metadata_equals": {"story_code": "season_zero"}}'::jsonb,'{"crumbs": 5, "traits": {"curiosity": 8}, "reaction_key": "season_zero", "cosmetic": "trace-season_zero"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('five_minutes_before','secret','ПЯТЬ МИНУТ ДО','трижды пришёл на событие за пять минут до начала','event_checkin','common','secret','{"min_trigger_count": 3, "metadata_lte": {"minutes_before": 5}}'::jsonb,'{"crumbs": 1, "traits": {"curiosity": 2}, "reaction_key": "five_minutes_before"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('no_sleep','secret','НЕ СПАЛ','был на ночном показе и вернулся на утренний','event_checkin','rare','secret','{"metadata_equals": {"story_code": "no_sleep"}}'::jsonb,'{"crumbs": 3, "traits": {"curiosity": 5}, "reaction_key": "no_sleep", "cosmetic": "night-cap"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('accidental_three','secret','ЭТО БЫЛО СЛУЧАЙНО','секретная история, которую нельзя специально фармить: это было случайно','manual_story','rare','secret','{"metadata_equals": {"story_code": "accidental_three"}}'::jsonb,'{"crumbs": 3, "traits": {"curiosity": 5}, "reaction_key": "accidental_three"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('rabbit_shocked','secret','ЖИВОТИНА В ШОКЕ','оценка фильма оказалась настолько далека от прогноза Животины, что её модель вкуса заметно перестроилась','manual_story','rare','secret','{"metadata_gte": {"prediction_error": 5}}'::jsonb,'{"crumbs": 3, "traits": {"curiosity": 5}, "reaction_key": "rabbit_shocked"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('last_ticket','secret','ПОСЛЕДНИЙ БИЛЕТ','купил одно из последних мест на событие','ticket_paid','rare','secret','{"metadata_lte": {"seats_left": 3}}'::jsonb,'{"crumbs": 3, "traits": {"curiosity": 5}, "reaction_key": "last_ticket", "cosmetic": "trace-last_ticket"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('i_stayed','secret','Я ОСТАЛСЯ','остался после фильма на продолжение вечера, хотя изначально собирался уйти','manual_story','rare','secret','{"metadata_equals": {"story_code": "i_stayed"}}'::jsonb,'{"crumbs": 3, "traits": {"curiosity": 5}, "reaction_key": "i_stayed"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('returned_same_day','secret','А Я ДУМАЛ, ТЫ ДОМОЙ','секретная история, которую нельзя специально фармить: а я думал, ты домой','event_checkin','rare','secret','{"metadata_equals": {"story_code": "returned_same_day"}}'::jsonb,'{"crumbs": 3, "traits": {"curiosity": 5}, "reaction_key": "returned_same_day"}'::jsonb,false,null,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;

insert into public.story_definitions(code,category,title,description,trigger_key,rarity,visibility,condition,reward,repeatable,limited_total,active)
values ('one_of_one','secret','ОДИН ИЗ ОДНОГО','получил уникальную одноэкземплярную историю конкретного вечера','manual_story','mythic','secret','{"metadata_equals": {"story_code": "one_of_one"}}'::jsonb,'{"crumbs": 8, "traits": {"curiosity": 12}, "reaction_key": "one_of_one", "cosmetic": "trace-one_of_one"}'::jsonb,false,1,true)
on conflict(code) do update set category=excluded.category,title=excluded.title,description=excluded.description,trigger_key=excluded.trigger_key,rarity=excluded.rarity,visibility=excluded.visibility,condition=excluded.condition,reward=excluded.reward,limited_total=excluded.limited_total,active=true;


create or replace function public.award_story(
  p_user_id uuid,
  p_story_code text,
  p_event_id uuid default null,
  p_occurrence_key text default 'once',
  p_context jsonb default '{}'::jsonb
)
returns table(awarded boolean, story_award_id uuid, crumbs_awarded int, cosmetic_code text)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_story public.story_definitions%rowtype;
  v_award_id uuid;
  v_crumbs int := 0;
  v_cosmetic text;
  v_cosmetic_id uuid;
  v_slot text;
  v_traits jsonb;
  v_key text;
  v_value int;
  v_count int;
  v_occurrence text;
begin
  select * into v_story from public.story_definitions where code=p_story_code and active=true;
  if v_story.id is null then
    return query select false,null::uuid,0,null::text; return;
  end if;
  if v_story.limited_total is not null then
    select count(*)::int into v_count from public.user_stories where story_id=v_story.id;
    if v_count >= v_story.limited_total then
      return query select false,null::uuid,0,null::text; return;
    end if;
  end if;
  v_occurrence := case when v_story.repeatable then coalesce(nullif(p_occurrence_key,''),coalesce(p_event_id::text,gen_random_uuid()::text)) else 'once' end;
  insert into public.user_stories(user_id,story_id,event_id,occurrence_key,context)
  values(p_user_id,v_story.id,p_event_id,v_occurrence,coalesce(p_context,'{}'::jsonb))
  on conflict(user_id,story_id,occurrence_key) do nothing
  returning id into v_award_id;
  if v_award_id is null then
    return query select false,null::uuid,0,null::text; return;
  end if;

  insert into public.creatures(user_id) values(p_user_id) on conflict(user_id) do nothing;
  v_crumbs := coalesce((v_story.reward->>'crumbs')::int,0);
  if v_crumbs <> 0 then
    update public.creatures set crumbs=greatest(0,crumbs+v_crumbs),updated_at=now() where user_id=p_user_id;
    insert into public.crumb_ledger(user_id,delta,reason,story_award_id) values(p_user_id,v_crumbs,'story:'||p_story_code,v_award_id);
  end if;

  select traits into v_traits from public.creatures where user_id=p_user_id for update;
  v_traits := coalesce(v_traits,'{}'::jsonb);
  for v_key,v_value in select key,(value::text)::int from jsonb_each(coalesce(v_story.reward->'traits','{}'::jsonb))
  loop
    v_traits := jsonb_set(v_traits,array[v_key],to_jsonb(coalesce((v_traits->>v_key)::int,0)+v_value),true);
  end loop;
  update public.creatures set traits=v_traits,updated_at=now() where user_id=p_user_id;

  v_cosmetic := nullif(v_story.reward->>'cosmetic','');
  if v_cosmetic is not null then
    select id,slot into v_cosmetic_id,v_slot from public.creature_cosmetics where code=v_cosmetic and active=true;
    if v_cosmetic_id is not null then
      insert into public.user_creature_cosmetics(user_id,cosmetic_id,source_story_id,equipped)
      values(
        p_user_id,v_cosmetic_id,v_award_id,
        not exists(
          select 1 from public.user_creature_cosmetics uc
          join public.creature_cosmetics c on c.id=uc.cosmetic_id
          where uc.user_id=p_user_id and uc.equipped=true and c.slot=v_slot
        )
      )
      on conflict(user_id,cosmetic_id) do nothing;
    end if;
  end if;

  select count(*)::int into v_count from public.user_stories where user_id=p_user_id;
  update public.creatures
  set stage=case when v_count>=20 then 'grown' when v_count>=5 then 'young' else 'tiny' end,updated_at=now()
  where user_id=p_user_id;

  return query select true,v_award_id,v_crumbs,v_cosmetic;
end;
$$;

revoke all on function public.award_story(uuid,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.award_story(uuid,text,uuid,text,jsonb) to service_role;

create table if not exists public.story_trigger_log (
  id bigserial primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  trigger_key text not null,
  event_id uuid references public.events(id) on delete set null,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists story_trigger_log_user_key_idx on public.story_trigger_log(user_id,trigger_key,created_at desc);
alter table public.story_trigger_log enable row level security;

create table if not exists public.notification_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null check(kind in ('events','creature','stories','matches','tickets','reminders')),
  text text not null check(char_length(text) <= 1000),
  send_after timestamptz not null default now(),
  status text not null default 'pending' check(status in ('pending','sent','cancelled','failed')),
  dedupe_key text,
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create unique index if not exists notification_queue_dedupe_idx on public.notification_queue(user_id,dedupe_key);
create index if not exists notification_queue_due_idx on public.notification_queue(status,send_after);
alter table public.notification_queue enable row level security;
