create or replace function public.app_screen_live_state(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with e as (
  select * from events where slug=p_slug limit 1
),
r as (
  select er.* from event_runtime er join e on e.id=er.event_id
),
pr as (
  select eps.* from event_projector_state eps join e on e.id=eps.event_id
),
word_groups as (
  select fi.normalized_word,
         min(fi.word) as word,
         count(*)::int as count,
         jsonb_agg(fi.animal_name_snapshot order by fi.created_at) filter (where fi.animal_name_snapshot is not null) as animals
  from film_impressions fi, pr
  where fi.event_id=(select id from e)
    and fi.round_id=pr.round_id
    and fi.film_package_id=pr.film_package_id
    and pr.state in ('one_word_collecting','one_word_results')
  group by fi.normalized_word
),
projector_payload as (
  select case
    when pr.state='pitch_collecting' then coalesce(pr.payload,'{}'::jsonb) || jsonb_build_object(
      'count',(select count(*) from invented_films i where i.event_id=(select id from e) and i.round_id=pr.round_id),
      'total',(select count(*) from registrations rg where rg.event_id=(select id from e) and rg.status='attended')
    )
    when pr.state in ('one_word_collecting','one_word_results') then coalesce(pr.payload,'{}'::jsonb) || jsonb_build_object(
      'wordGroups',coalesce((select jsonb_agg(jsonb_build_object('word',wg.word,'count',wg.count,'animals',coalesce(wg.animals,'[]'::jsonb)) order by wg.count desc,wg.word) from word_groups wg),'[]'::jsonb)
    )
    else coalesce(pr.payload,'{}'::jsonb)
  end as payload
  from pr
)
select jsonb_build_object(
  'event',jsonb_build_object(
    'id',e.id,'slug',e.slug,'title',e.title,'starts_at',e.starts_at,'capacity',e.capacity,
    'ticket_price_rub',e.ticket_price_rub,'max_movie_runtime_min',e.max_movie_runtime_min,
    'status',e.status,'venue_name',e.venue_name,'venue_address',e.venue_address,'settings',coalesce(e.settings,'{}'::jsonb)
  ),
  'program_config',coalesce((select ep.config from event_programs ep where ep.event_id=e.id),'{}'::jsonb),
  'runtime',coalesce((select to_jsonb(r) from r),'{}'::jsonb),
  'projector',coalesce((select jsonb_build_object(
      'state',pr.state,'revision',pr.revision,'round_id',pr.round_id,'film_package_id',pr.film_package_id,
      'payload',(select payload from projector_payload),'updated_at',pr.updated_at
    ) from pr),jsonb_build_object('state','idle','revision',0,'payload','{}'::jsonb)),
  'media',coalesce((select jsonb_agg(jsonb_build_object(
      'asset_key',m.asset_key,'title',m.title,'category',m.category,'mime_type',m.mime_type,
      'duration_sec',m.duration_sec,'public_url',m.public_url
    ) order by m.asset_key) from media_assets m where m.status='ready'),'[]'::jsonb),
  'screen',coalesce((select to_jsonb(s) from event_screen_status s where s.event_id=e.id),'{}'::jsonb),
  'creatures',coalesce((select jsonb_agg(jsonb_build_object(
      'user_id',c.user_id,'name',c.name,'stage',c.stage,'crumbs',c.crumbs,
      'growth_progress',c.growth_progress,'settings',coalesce(c.settings,'{}'::jsonb)
    ) order by rg.created_at)
    from registrations rg join creatures c on c.user_id=rg.user_id
    where rg.event_id=e.id and rg.status='attended'),'[]'::jsonb)
)
from e;
$$;

create or replace function public.app_participant_live_state(p_slug text,p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with e as (
  select * from events where slug=p_slug limit 1
),
r as (
  select er.* from event_runtime er join e on e.id=er.event_id
),
pr as (
  select eps.* from event_projector_state eps join e on e.id=eps.event_id
),
round_data as (
  select er.question_target
  from event_rounds er,pr
  where er.id=pr.round_id and er.event_id=(select id from e)
),
pitch as (
  select i.id,i.title,i.description,i.updated_at
  from invented_films i,pr
  where i.round_id=pr.round_id and i.user_id=p_user_id
  limit 1
),
pack as (
  select fp.title_snapshot
  from film_packages fp,pr
  where fp.id=pr.film_package_id and fp.event_id=(select id from e)
),
preds as (
  select coalesce(jsonb_agg(jsonb_build_object('question_id',fp.question_id,'answer',fp.answer,'is_correct',fp.is_correct)),'[]'::jsonb) as rows
  from film_predictions fp,pr
  where fp.round_id=pr.round_id and fp.user_id=p_user_id
),
my_word as (
  select fi.word
  from film_impressions fi,pr
  where fi.round_id=pr.round_id and fi.user_id=p_user_id
  limit 1
)
select jsonb_build_object(
  'event_status',e.status,
  'screen_message',coalesce(e.settings->>'screen_message',''),
  'runtime',coalesce((select to_jsonb(r) from r),'{}'::jsonb),
  'film_live',case
    when not exists(select 1 from pr) or (select state from pr) in ('idle','arrival') then null
    else jsonb_build_object(
      'state',(select state from pr),
      'revision',(select revision from pr),
      'roundId',(select round_id from pr),
      'filmPackageId',(select film_package_id from pr),
      'filmTitle',(select title_snapshot from pack),
      'payload',coalesce((select payload from pr),'{}'::jsonb),
      'myWord',(select word from my_word),
      'myPitch',(select jsonb_build_object('id',pitch.id,'title',pitch.title,'description',pitch.description,'updatedAt',pitch.updated_at) from pitch),
      'questionTarget',coalesce((select question_target from round_data),3),
      'myAnswers',coalesce((select rows from preds),'[]'::jsonb)
    )
  end
)
from e;
$$;
