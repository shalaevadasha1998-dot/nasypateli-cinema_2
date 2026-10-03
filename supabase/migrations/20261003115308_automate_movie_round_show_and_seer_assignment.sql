create or replace function public.assign_film_mission(
  p_event_id uuid,
  p_round_id uuid,
  p_film_package_id uuid
)
returns table(
  assignment_id uuid,
  user_id uuid,
  animal_name text,
  due_at timestamptz,
  before_word text,
  correct_count integer,
  total_questions integer
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_existing public.film_assignments%rowtype;
  v_user_id uuid;
  v_animal_name text;
  v_question_count integer := 0;
  v_correct integer;
  v_before_word text := '';
  v_assignment public.film_assignments%rowtype;
  v_due_at timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_round_id::text,0));

  select fa.* into v_existing
  from public.film_assignments fa
  where fa.round_id=p_round_id;

  if found then
    return query
    select v_existing.id,v_existing.user_id,v_existing.animal_name_snapshot,
           v_existing.due_at,v_existing.before_word,v_existing.correct_count,v_existing.total_questions;
    return;
  end if;

  select greatest(0,least(5,coalesce(er.question_target,0)))::integer
  into v_question_count
  from public.event_rounds er
  where er.id=p_round_id and er.event_id=p_event_id;

  v_question_count := coalesce(v_question_count,0);

  if v_question_count > 0 then
    select r.user_id,c.name
    into v_user_id,v_animal_name
    from public.registrations r
    join public.creatures c on c.user_id=r.user_id
    where r.event_id=p_event_id
      and r.status='attended'
      and exists(
        select 1
        from public.film_predictions fp
        where fp.user_id=r.user_id
          and fp.event_id=p_event_id
          and fp.round_id=p_round_id
          and fp.film_package_id=p_film_package_id
      )
    order by
      (
        select count(*) filter(where fp.is_correct)
        from public.film_predictions fp
        where fp.user_id=r.user_id
          and fp.event_id=p_event_id
          and fp.round_id=p_round_id
          and fp.film_package_id=p_film_package_id
      ) desc,
      case when exists(
        select 1 from public.film_assignments old
        where old.event_id=p_event_id and old.user_id=r.user_id
      ) then 1 else 0 end,
      pg_catalog.random()
    limit 1;
  else
    select r.user_id,c.name
    into v_user_id,v_animal_name
    from public.registrations r
    join public.creatures c on c.user_id=r.user_id
    where r.event_id=p_event_id
      and r.status='attended'
    order by
      case when exists(
        select 1 from public.film_assignments old
        where old.event_id=p_event_id and old.user_id=r.user_id
      ) then 1 else 0 end,
      pg_catalog.random()
    limit 1;
  end if;

  if v_user_id is null then
    raise exception 'no eligible animal for assignment';
  end if;

  select fi.word
  into v_before_word
  from public.film_impressions fi
  where fi.user_id=v_user_id
    and fi.event_id=p_event_id
    and fi.round_id=p_round_id
    and fi.film_package_id=p_film_package_id
  limit 1;

  select count(*) filter(where fp.is_correct)::integer
  into v_correct
  from public.film_predictions fp
  where fp.user_id=v_user_id
    and fp.event_id=p_event_id
    and fp.round_id=p_round_id
    and fp.film_package_id=p_film_package_id;

  select coalesce(
    e.review_due_at,
    (date_trunc('week',e.starts_at at time zone 'Europe/Moscow')+interval '12 days 19 hours') at time zone 'Europe/Moscow'
  )
  into v_due_at
  from public.events e
  where e.id=p_event_id;

  insert into public.film_assignments(
    event_id,round_id,film_package_id,user_id,animal_name_snapshot,
    assigned_at,due_at,status,before_word,correct_count,total_questions
  )
  values(
    p_event_id,p_round_id,p_film_package_id,v_user_id,v_animal_name,
    now(),v_due_at,'assigned',coalesce(v_before_word,''),coalesce(v_correct,0),v_question_count
  )
  returning * into v_assignment;

  insert into public.notification_queue(user_id,kind,text,send_after,status,dedupe_key,event_id)
  values
    (v_user_id,'reminders',v_animal_name||', этот фильм твой. потом жду рецензию.',now(),'pending','film_assignment:'||v_assignment.id||':assigned',p_event_id),
    (v_user_id,'reminders',v_animal_name||', жду твою рецензию.',v_assignment.due_at,'pending','film_assignment:'||v_assignment.id||':due',p_event_id),
    (v_user_id,'reminders',v_animal_name||', жду твою рецензию.',v_assignment.due_at+interval '1 minute','pending','film_assignment:'||v_assignment.id||':overdue',p_event_id)
  on conflict do nothing;

  return query
  select v_assignment.id,v_assignment.user_id,v_assignment.animal_name_snapshot,
         v_assignment.due_at,v_assignment.before_word,v_assignment.correct_count,v_assignment.total_questions;
end
$function$;

update public.event_programs ep
set config = jsonb_set(
  jsonb_set(
    ep.config::jsonb,
    '{blocks}',
    '[
      {"id":"arrival","type":"arrival","title":"сбор","enabled":true,"audio_volume":0.28,"auto_advance":true,"duration_min":15,"rounds_target":0,"audio_playlist":["calm-exactly","calm-omg","calm-ryu"]},
      {"id":"creature_intro","type":"creature_intro","title":"животина настоящая","enabled":true,"audio_volume":0.22,"auto_advance":true,"duration_min":5,"rounds_target":0,"audio_playlist":["calm-exactly"]},
      {"id":"cinema_first","type":"cinema_rounds","title":"снимаем кино","enabled":true,"audio_volume":0.2,"auto_advance":false,"duration_min":75,"rounds_target":2,"audio_playlist":["calm-exactly","calm-omg","calm-ryu"]},
      {"id":"break","type":"break","title":"перерыв","enabled":true,"audio_volume":0.28,"auto_advance":true,"duration_min":30,"rounds_target":0,"audio_playlist":["calm-ryu","calm-omg"]},
      {"id":"cinema_second","type":"cinema_rounds","title":"снимаем кино","enabled":true,"audio_volume":0.2,"auto_advance":false,"duration_min":75,"rounds_target":2,"audio_playlist":["calm-exactly","calm-omg","calm-ryu"]},
      {"id":"final_qr","type":"final_qr","title":"творог","enabled":true,"audio_volume":0.2,"auto_advance":true,"duration_min":5,"rounds_target":0,"audio_playlist":["calm-exactly"]},
      {"id":"music_outro","type":"music_outro","title":"музыка","enabled":true,"audio_volume":0.32,"auto_advance":true,"duration_min":30,"rounds_target":0,"audio_playlist":["energy-talk","energy-goin-in","energy-dead-trollz"]}
    ]'::jsonb
  ),
  '{rounds_target}',
  '4'::jsonb
),
updated_at=now()
from public.events e
where ep.event_id=e.id
  and e.slug in ('2026-10-03','test-2026-10-03');
