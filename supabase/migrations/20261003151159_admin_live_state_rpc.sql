create or replace function public.app_admin_live_state(p_slug text)
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
cr as (
  select rd.* from event_rounds rd,r where rd.id=r.current_round_id and rd.event_id=(select id from e)
),
sp as (
  select i.id,i.user_id,i.animal_name_snapshot,i.title,i.description,i.created_at,i.updated_at
  from invented_films i,cr where i.id=cr.selected_submission_id
),
pack as (
  select fp.* from film_packages fp,pr where fp.id=pr.film_package_id and fp.event_id=(select id from e)
),
package_questions as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',fq.id,'position',fq.position,'prompt',fq.prompt,'options',coalesce(fq.options,'[]'::jsonb),
    'correct_answer',fq.correct_answer,'reveal_text',fq.reveal_text,'reveal_fragment',coalesce(fq.reveal_fragment,'{}'::jsonb)
  ) order by fq.position),'[]'::jsonb) rows
  from film_questions fq,pack where fq.film_package_id=pack.id
),
current_pitches as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,'user_id',i.user_id,'animal_name_snapshot',i.animal_name_snapshot,
    'title',i.title,'description',i.description,'created_at',i.created_at,'updated_at',i.updated_at
  ) order by i.created_at),'[]'::jsonb) rows
  from invented_films i,cr where i.event_id=(select id from e) and i.round_id=cr.id
),
participants as (
  select coalesce(jsonb_agg(jsonb_build_object(
    'registrationId',rg.id,
    'displayName',case when u.deleted_at is not null then 'удалённый участник' else coalesce(u.display_name,u.telegram_username,'участник') end,
    'telegramUsername',case when u.deleted_at is not null or u.telegram_username is null then '' else '@'||u.telegram_username end,
    'creatureName',case when u.deleted_at is not null then '' else coalesce(c.name,'животина') end,
    'deleted',u.deleted_at is not null,
    'profileComplete',u.deleted_at is null and coalesce((cp.profile_json->>'completed')::boolean,false),
    'onboardingStep',case when u.deleted_at is not null then 0 else coalesce((cp.profile_json->>'onboarding_step')::int,0) end,
    'status',rg.status,'queuePosition',rg.queue_position,'reservationExpiresAt',rg.reservation_expires_at,
    'photoVideoConsent',rg.photo_video_consent is true,'paidAt',rg.paid_at,'registeredAt',rg.created_at
  ) order by rg.created_at),'[]'::jsonb) rows
  from registrations rg join e on e.id=rg.event_id
  left join users u on u.id=rg.user_id
  left join cinema_profiles cp on cp.user_id=rg.user_id
  left join creatures c on c.user_id=rg.user_id
),
round_movie as (
  select mc.* from movie_candidates mc,cr where mc.id=cr.movie_candidate_id
),
block_round_count as (
  select count(*)::int n from event_rounds rd,r
  where rd.event_id=(select id from e) and rd.block_id=r.current_block_id
),
vote_results as (
  select coalesce(jsonb_agg(jsonb_build_object('answer',v.answer,'count',v.n) order by v.n desc),'[]'::jsonb) rows
  from (
    select ev.answer,count(*)::int n
    from event_votes ev,cr
    where ev.event_id=(select id from e) and ev.round_id=cr.id
    group by ev.answer
  ) v
)
select jsonb_build_object(
  'event',jsonb_build_object(
    'id',e.id,'slug',e.slug,'title',e.title,'starts_at',e.starts_at,'capacity',e.capacity,
    'ticket_price_rub',e.ticket_price_rub,'max_movie_runtime_min',e.max_movie_runtime_min,
    'status',e.status,'venue_name',e.venue_name,'venue_address',e.venue_address,'settings',coalesce(e.settings,'{}'::jsonb)
  ),
  'program_config',coalesce((select ep.config from event_programs ep where ep.event_id=e.id),'{}'::jsonb),
  'runtime',coalesce((select to_jsonb(r) from r),'{}'::jsonb),
  'projector',coalesce((select to_jsonb(pr) from pr),'{}'::jsonb),
  'screen',coalesce((select to_jsonb(s) from event_screen_status s where s.event_id=e.id),'{}'::jsonb),
  'media',coalesce((select jsonb_agg(jsonb_build_object(
      'asset_key',m.asset_key,'title',m.title,'category',m.category,'mime_type',m.mime_type,
      'duration_sec',m.duration_sec,'public_url',m.public_url
    ) order by m.asset_key) from media_assets m where m.status='ready'),'[]'::jsonb),
  'participants',(select rows from participants),
  'pitches',(select rows from current_pitches),
  'block_round_count',coalesce((select n from block_round_count),0),
  'vote_results',(select rows from vote_results),
  'round',case when (select id from cr) is null then null else jsonb_build_object(
    'id',(select id from cr),'round_no',(select round_no from cr),'block_id',(select block_id from cr),
    'status',(select status from cr),'flow_status',(select flow_status from cr),
    'selected_submission_id',(select selected_submission_id from cr),
    'question_position',(select question_position from cr),'question_target',(select question_target from cr),
    'vote_state',(select vote_state from cr),'results_visible',(select results_visible from cr),
    'video_state',(select video_state from cr),'started_at',(select started_at from cr),
    'updated_at',(select updated_at from cr),'closed_at',(select closed_at from cr),
    'pitch_count',(select count(*)::int from invented_films i where i.round_id=(select id from cr)),
    'selected_pitch',(select to_jsonb(sp) from sp),
    'movie',(select to_jsonb(round_movie) from round_movie)
  ) end,
  'current_package',case when (select id from pack) is null then null else
    (select jsonb_build_object(
      'id',pack.id,'movie_candidate_id',pack.movie_candidate_id,'title_snapshot',pack.title_snapshot,
      'fragments',coalesce(pack.fragments,'[]'::jsonb),'status',pack.status,
      'questions',(select rows from package_questions)
    ) from pack)
  end
)
from e;
$$;
