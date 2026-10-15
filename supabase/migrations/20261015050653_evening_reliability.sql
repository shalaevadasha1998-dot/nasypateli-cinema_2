-- generated migration source; create its filename with `supabase migration new evening_reliability`
-- no secrets, scheduler activation, guest data rewrites, or historical score resets
alter table public.event_runtime add column if not exists director_state jsonb not null default '{}'::jsonb;

-- Answers to a reused package belong to a round, not to a film for all time.
alter table public.film_predictions drop constraint if exists film_predictions_question_id_user_id_key;
create unique index if not exists film_predictions_round_question_user_key on public.film_predictions(round_id,question_id,user_id);

create or replace function public.save_reviewed_film_package(p_event_id uuid,p_movie_id uuid,p_title text,p_fragments jsonb,p_questions jsonb,p_review jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_id uuid; q jsonb; v_old public.film_packages%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_event_id::text,21));
  if not exists(select 1 from public.movie_candidates where id=p_movie_id and event_id=p_event_id) then raise exception 'movie outside event'; end if;
  if jsonb_typeof(p_questions) is distinct from 'array' or jsonb_array_length(p_questions) not between 1 and 5 or jsonb_typeof(p_fragments) is distinct from 'array' or jsonb_array_length(p_fragments)<>jsonb_array_length(p_questions)+1 or p_review->>'version' is distinct from '1' or coalesce(p_review->>'digest','')!~'^[a-f0-9]{64}$' then raise exception 'invalid reviewed package'; end if;
  if exists(select 1 from public.event_rounds where event_id=p_event_id and movie_candidate_id=p_movie_id and status='active') then raise exception 'active package is immutable'; end if;
  select * into v_old from public.film_packages where event_id=p_event_id and movie_candidate_id=p_movie_id for update;
  if v_old.id is not null and exists(select 1 from public.film_predictions where film_package_id=v_old.id) and (v_old.match_data->'sceneReview'->>'digest') is distinct from (p_review->>'digest') then raise exception 'used package is immutable; create a new edition'; end if;
  insert into public.film_packages(event_id,movie_candidate_id,title_snapshot,fragments,status,match_data)
    values(p_event_id,p_movie_id,p_title,p_fragments,'draft',jsonb_build_object('sceneReview',p_review))
    on conflict(event_id,movie_candidate_id) do update set title_snapshot=excluded.title_snapshot,fragments=excluded.fragments,status='draft',match_data=coalesce(public.film_packages.match_data,'{}'::jsonb)||excluded.match_data,updated_at=now()
    returning id into v_id;
  for q in select value from jsonb_array_elements(p_questions) loop
    if coalesce(q->>'prompt','')='' or coalesce(q->>'correct_answer','')='' then raise exception 'incomplete question'; end if;
    insert into public.film_questions(film_package_id,position,prompt,options,correct_answer,reveal_text,reveal_fragment)
      values(v_id,(q->>'position')::int,q->>'prompt',q->'options',q->'correct_answer',q->>'reveal_text',q->'reveal_fragment')
      on conflict(film_package_id,position) do update set prompt=excluded.prompt,options=excluded.options,correct_answer=excluded.correct_answer,reveal_text=excluded.reveal_text,reveal_fragment=excluded.reveal_fragment,updated_at=now();
  end loop;
  delete from public.film_questions where film_package_id=v_id and position>jsonb_array_length(p_questions);
  if (select count(*) from public.film_questions where film_package_id=v_id)<>jsonb_array_length(p_questions) then raise exception 'question count mismatch'; end if;
  update public.film_packages set status='ready',updated_at=now() where id=v_id;
  return v_id;
end $$;

create or replace function public.submit_film_prediction(p_event_id uuid,p_round_id uuid,p_question_id uuid,p_user_id uuid,p_animal_name text,p_answer text)
returns void language plpgsql security invoker set search_path='' as $$
declare p public.event_projector_state%rowtype;
begin
  select * into p from public.event_projector_state where event_id=p_event_id for share;
  if p.state is distinct from 'question_open' or p.round_id is distinct from p_round_id or p.payload->>'questionId' is distinct from p_question_id::text then raise exception 'question closed'; end if;
  if not exists(select 1 from public.registrations where event_id=p_event_id and user_id=p_user_id and status='attended') then raise exception 'not checked in'; end if;
  if not exists(select 1 from public.film_questions where id=p_question_id and film_package_id=p.film_package_id) then raise exception 'question outside package'; end if;
  if length(trim(p_answer)) not between 2 and 700 then raise exception 'invalid answer'; end if;
  insert into public.film_predictions(event_id,round_id,film_package_id,question_id,user_id,animal_name_snapshot,answer,is_correct)
  values(p_event_id,p_round_id,p.film_package_id,p_question_id,p_user_id,p_animal_name,to_jsonb(p_answer),false)
  on conflict(round_id,question_id,user_id) do update set answer=excluded.answer,is_correct=false,updated_at=now();
end $$;

create or replace function public.freeze_film_question(p_event_id uuid,p_round_id uuid,p_question_id uuid,p_expected_revision bigint)
returns bigint language plpgsql security invoker set search_path='' as $$
declare p public.event_projector_state%rowtype; rt public.event_runtime%rowtype; next_revision bigint;
begin
  select * into rt from public.event_runtime where event_id=p_event_id for update;
  select * into p from public.event_projector_state where event_id=p_event_id for update;
  if rt.current_round_id is distinct from p_round_id or p.round_id is distinct from p_round_id or p.run_id is distinct from rt.run_id or p.state is distinct from 'question_open' or p.payload->>'questionId' is distinct from p_question_id::text or p.revision is distinct from p_expected_revision then raise exception 'stale question close'; end if;
  update public.event_projector_state set state='question_results',revision=revision+1,updated_at=now(),payload=payload||jsonb_build_object('judgement',jsonb_build_object('status','needs_host','outcome','uncertain','method','ai','pending',true,'comment','ответы закрыты · идёт оценка; при сбое решение за ведущей')) where event_id=p_event_id returning revision into next_revision;
  update public.event_rounds set flow_status='question_results',updated_at=now() where id=p_round_id and event_id=p_event_id;
  return next_revision;
end $$;

create or replace function public.commit_film_judgement(p_event_id uuid,p_round_id uuid,p_package_id uuid,p_question_id uuid,p_expected_revision bigint,p_judgement jsonb,p_payload jsonb,p_actor uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare p public.event_projector_state%rowtype; rt public.event_runtime%rowtype; ids uuid[]; wanted int; decision text; outcome text; method text;
begin
  select * into rt from public.event_runtime where event_id=p_event_id for update;
  select * into p from public.event_projector_state where event_id=p_event_id for update;
  if rt.current_round_id is distinct from p_round_id or p.round_id is distinct from p_round_id or p.run_id is distinct from rt.run_id or p.film_package_id is distinct from p_package_id or p.payload->>'questionId' is distinct from p_question_id::text or p.revision is distinct from p_expected_revision then raise exception 'stale question decision'; end if;
  if p.state not in ('question_open','question_results') then raise exception 'judging phase closed'; end if;
  if not exists(select 1 from public.film_questions where id=p_question_id and film_package_id=p_package_id) then raise exception 'question outside package'; end if;
  decision=p_judgement->>'status';outcome=p_judgement->>'outcome';method=p_judgement->>'method';
  if decision is null or decision not in ('needs_host','decided') or outcome is null or outcome not in ('winner','none','uncertain') or method is null or method not in ('ai','host','no_answers') then raise exception 'invalid judgement'; end if;
  if p.state='question_results' and method<>'host' and (p.payload->'judgement'->>'pending' is distinct from 'true' or p.payload->'judgement'->>'status' is distinct from 'needs_host') then raise exception 'automatic judgement already attempted'; end if;
  if p_judgement->'winnerIds' is null or jsonb_typeof(p_judgement->'winnerIds')<>'array' then raise exception 'invalid winner ids'; end if;
  select coalesce(array_agg(value::uuid),'{}'::uuid[]) into ids from jsonb_array_elements_text(p_judgement->'winnerIds');
  wanted=cardinality(ids);
  if wanted<>(select count(distinct i) from unnest(ids) i) then raise exception 'duplicate winner ids'; end if;
  if wanted<>(select count(*) from public.film_predictions where event_id=p_event_id and round_id=p_round_id and question_id=p_question_id and film_package_id=p_package_id and id=any(ids)) then raise exception 'winner outside question'; end if;
  if (decision='needs_host' and (outcome<>'uncertain' or wanted<>0)) or (decision='decided' and ((outcome='winner' and wanted=0) or (outcome='none' and wanted<>0) or outcome='uncertain')) then raise exception 'inconsistent decision'; end if;
  if p_payload->>'questionId' is distinct from p_question_id::text or p_payload->'judgement'->>'status' is distinct from decision then raise exception 'invalid public decision'; end if;
  update public.film_predictions set is_correct=(decision='decided' and id=any(ids)),updated_at=now() where event_id=p_event_id and round_id=p_round_id and question_id=p_question_id;
  update public.event_rounds set flow_status='question_results',updated_at=now() where id=p_round_id and event_id=p_event_id;
  update public.event_projector_state set state='question_results',payload=p_payload,revision=revision+1,updated_at=now() where event_id=p_event_id;
  insert into public.event_runtime_log(event_id,run_id,action,actor_user_id,from_state,to_state)
    values(p_event_id,rt.run_id,'question_judgement',p_actor,jsonb_build_object('revision',p.revision),jsonb_build_object('questionId',p_question_id,'roundId',p_round_id,'judgement',p_judgement));
end $$;

create or replace function public.record_projector_playback(p_event_id uuid,p_run_id uuid,p_projection_revision bigint,p_previous jsonb,p_next jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare rt public.event_runtime%rowtype; p public.event_projector_state%rowtype;
begin
  select * into rt from public.event_runtime where event_id=p_event_id for update;
  select * into p from public.event_projector_state where event_id=p_event_id for share;
  if rt.run_id is distinct from p_run_id or p.run_id is distinct from p_run_id or p.revision is distinct from p_projection_revision or p.state not in ('film_intro','playing_clip','question_reveal') or rt.video_state is distinct from p_previous then return false; end if;
  if p_next->>'runId' is distinct from p_run_id::text or p_next->>'projectorRevision' is distinct from p_projection_revision::text then return false; end if;
  update public.event_runtime set video_state=p_next where event_id=p_event_id;
  return true;
end $$;

revoke all on function public.save_reviewed_film_package(uuid,uuid,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.submit_film_prediction(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.commit_film_judgement(uuid,uuid,uuid,uuid,bigint,jsonb,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.record_projector_playback(uuid,uuid,bigint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_reviewed_film_package(uuid,uuid,text,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.submit_film_prediction(uuid,uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.commit_film_judgement(uuid,uuid,uuid,uuid,bigint,jsonb,jsonb,uuid) to service_role;
grant execute on function public.record_projector_playback(uuid,uuid,bigint,jsonb,jsonb) to service_role;

revoke all on function public.freeze_film_question(uuid,uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.freeze_film_question(uuid,uuid,uuid,bigint) to service_role;
