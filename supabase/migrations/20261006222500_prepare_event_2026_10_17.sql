-- prepare the 17 october event without opening sales
insert into public.events(
  slug,title,starts_at,capacity,ticket_price_rub,max_movie_runtime_min,status,venue_name,venue_address,settings
)
values(
  '2026-10-17',
  'насыпатели в кино · 17 октября',
  '2026-10-17 13:00:00+00'::timestamptz,
  30,
  1000,
  150,
  'DRAFT'::public.event_status,
  null,
  null,
  '{"city":"Москва","sales_confirmed":false,"venue_status":"tbd"}'::jsonb
)
on conflict(slug) do nothing;

insert into public.event_programs(event_id,config,updated_at)
select target.id,
       coalesce(source.config,'{"version":1,"rounds_target":4,"rewards":{"join":1,"vote":1,"round":2,"finale":3},"blocks":[]}'::jsonb),
       now()
from public.events target
left join public.event_programs source
  on source.event_id=(select id from public.events where slug='2026-10-03' limit 1)
where target.slug='2026-10-17'
on conflict(event_id) do nothing;

insert into public.event_runs(event_id,run_key,sequence_no,mode,status,started_at,metadata)
select e.id,'live_001',1,'live','active',now(),'{"prepared_for":"2026-10-17"}'::jsonb
from public.events e
where e.slug='2026-10-17'
  and not exists(select 1 from public.event_runs r where r.event_id=e.id);

insert into public.event_runtime(
  event_id,run_id,run_status,current_block_id,current_block_index,current_round,
  current_round_id,current_movie_id,current_question,vote_state,results_visible,video_state,
  revision,started_at,block_started_at,paused_at,director_cue_index,audio_state,updated_at
)
select e.id,r.id,'idle',
       coalesce((select x->>'id' from jsonb_array_elements(coalesce(ep.config->'blocks','[]'::jsonb)) x limit 1),'arrival'),
       0,0,null,null,null,'closed',false,'{"status":"idle"}'::jsonb,
       0,null,null,null,0,
       '{"mode":"auto","status":"stopped","track_key":null,"playlist_index":0,"volume":0.32,"updated_at":null}'::jsonb,
       now()
from public.events e
join public.event_runs r on r.event_id=e.id and r.status='active'
left join public.event_programs ep on ep.event_id=e.id
where e.slug='2026-10-17'
on conflict(event_id) do nothing;

insert into public.event_projector_state(event_id,run_id,state,round_id,film_package_id,payload,revision,updated_at)
select e.id,r.id,'arrival',null,null,'{}'::jsonb,0,now()
from public.events e
join public.event_runs r on r.event_id=e.id and r.status='active'
where e.slug='2026-10-17'
on conflict(event_id) do nothing;
