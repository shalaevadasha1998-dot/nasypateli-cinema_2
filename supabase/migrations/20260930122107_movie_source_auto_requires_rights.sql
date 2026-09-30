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
    and (
      s.rights_status='allowed'
      or coalesce(s.metadata->>'manual_selected','false')='true'
    )
  order by
    case when coalesce(s.metadata->>'manual_selected','false')='true' then 0 else 1 end,
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
