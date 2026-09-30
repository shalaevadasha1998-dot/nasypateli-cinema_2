create table if not exists public.movie_source_candidates (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  movie_candidate_id uuid not null references public.movie_candidates(id) on delete cascade,
  use_mode text not null check (use_mode in ('fragment','trailer')),
  source_type text not null check (source_type in ('clip','full_film','trailer','teaser','unknown')),
  source_platform text not null,
  source_url text not null,
  video_id text,
  title text,
  source_channel text,
  start_sec integer not null default 0 check (start_sec >= 0),
  end_sec integer,
  verified boolean not null default false,
  embeddable boolean not null default false,
  official boolean not null default false,
  rights_status text not null default 'unknown' check (rights_status in ('unknown','allowed','restricted','blocked')),
  availability_status text not null default 'candidate' check (availability_status in ('candidate','ready','dead','blocked')),
  confidence numeric(4,3) not null default 0 check (confidence >= 0 and confidence <= 1),
  metadata jsonb not null default '{}'::jsonb,
  discovered_at timestamptz not null default now(),
  verified_at timestamptz,
  updated_at timestamptz not null default now(),
  check (end_sec is null or end_sec > start_sec),
  check (jsonb_typeof(metadata)='object')
);

create unique index if not exists movie_source_candidates_identity_idx
  on public.movie_source_candidates(movie_candidate_id,source_url,start_sec,coalesce(end_sec,-1));

create index if not exists movie_source_candidates_resolver_idx
  on public.movie_source_candidates(movie_candidate_id,availability_status,use_mode,verified,embeddable);

create index if not exists movie_source_candidates_event_idx
  on public.movie_source_candidates(event_id,movie_candidate_id);

alter table public.movie_source_candidates enable row level security;
revoke all on public.movie_source_candidates from anon, authenticated;
grant all on public.movie_source_candidates to service_role;

insert into public.movie_source_candidates(
  event_id,movie_candidate_id,use_mode,source_type,source_platform,source_url,video_id,title,source_channel,
  start_sec,end_sec,verified,embeddable,official,rights_status,availability_status,confidence,metadata,verified_at
)
select
  mc.event_id,
  mc.id,
  case when coalesce(mc.source_type,'') in ('trailer','teaser') then 'trailer' else 'fragment' end,
  case
    when coalesce(mc.source_type,'') in ('clip','full_film','trailer','teaser') then mc.source_type
    else 'unknown'
  end,
  coalesce(nullif(mc.source_platform,''),'unknown'),
  mc.source_url,
  mc.video_id,
  mc.title,
  mc.source_channel,
  coalesce(mc.start_sec,0),
  mc.end_sec,
  mc.source_verified=true,
  case when coalesce(mc.source_platform,'')='youtube' and nullif(mc.video_id,'') is not null then true else false end,
  false,
  case when nullif(mc.metadata->>'license','') is not null then 'allowed' else 'unknown' end,
  case
    when mc.source_verified=true
      and mc.source_url is not null
      and (
        (coalesce(mc.source_platform,'')='youtube' and nullif(mc.video_id,'') is not null)
        or coalesce(mc.source_platform,'')<>'youtube'
      )
    then 'ready'
    else 'candidate'
  end,
  case when mc.source_verified=true then 0.850 else 0.500 end,
  jsonb_build_object('backfilled_from','movie_candidates'),
  mc.verified_at
from public.movie_candidates mc
where mc.source_url is not null
on conflict do nothing;

create or replace function public.resolve_movie_source(p_movie_candidate_id uuid)
returns table(
  id uuid,
  use_mode text,
  source_type text,
  source_platform text,
  source_url text,
  video_id text,
  title text,
  source_channel text,
  start_sec integer,
  end_sec integer,
  verified boolean,
  embeddable boolean,
  official boolean,
  rights_status text,
  confidence numeric,
  metadata jsonb
)
language sql
security definer
set search_path=''
stable
as $$
  select
    s.id,s.use_mode,s.source_type,s.source_platform,s.source_url,s.video_id,s.title,s.source_channel,
    s.start_sec,s.end_sec,s.verified,s.embeddable,s.official,s.rights_status,s.confidence,s.metadata
  from public.movie_source_candidates s
  where s.movie_candidate_id=p_movie_candidate_id
    and s.availability_status='ready'
    and s.verified=true
    and s.embeddable=true
    and s.rights_status<>'blocked'
  order by
    case s.use_mode when 'fragment' then 0 else 1 end,
    case s.source_type when 'clip' then 0 when 'full_film' then 1 when 'trailer' then 2 when 'teaser' then 3 else 4 end,
    case s.rights_status when 'allowed' then 0 when 'unknown' then 1 when 'restricted' then 2 else 3 end,
    s.official desc,
    s.confidence desc,
    s.verified_at desc nulls last,
    s.discovered_at desc
  limit 1
$$;

revoke all on function public.resolve_movie_source(uuid) from public, anon, authenticated;
grant execute on function public.resolve_movie_source(uuid) to service_role;
