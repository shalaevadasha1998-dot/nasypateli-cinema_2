alter table public.users alter column telegram_id drop not null;
alter table public.users add column if not exists deleted_at timestamptz;

create or replace function public.delete_user_profile(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.users%rowtype;
  v_connection_ids uuid[];
begin
  select * into v_user
  from public.users
  where id=p_user_id
  for update;

  if not found or v_user.telegram_id is null then
    return jsonb_build_object('ok',true,'alreadyDeleted',true);
  end if;

  select coalesce(array_agg(id),'{}'::uuid[])
    into v_connection_ids
  from public.social_connections
  where user_a=p_user_id or user_b=p_user_id;

  if cardinality(v_connection_ids)>0 then
    update public.notification_queue
    set status='cancelled',
        error='counterpart profile deleted'
    where status='pending'
      and dedupe_key=any(
        select 'match:'||x::text
        from unnest(v_connection_ids) as x
      );
  end if;

  delete from public.jipitina_memory where scope='user' and scope_id=p_user_id;
  delete from public.jipitina_messages where user_id=p_user_id;
  delete from public.dating_swipes where swiper_id=p_user_id or target_id=p_user_id;
  delete from public.dating_profiles where user_id=p_user_id;
  delete from public.user_blocks where blocker_id=p_user_id or blocked_id=p_user_id;
  delete from public.social_connections where user_a=p_user_id or user_b=p_user_id;
  delete from public.notification_queue where user_id=p_user_id;
  delete from public.notification_preferences where user_id=p_user_id;
  delete from public.encounter_tokens where owner_user_id=p_user_id;
  delete from public.user_creature_tasks where user_id=p_user_id;
  delete from public.user_creature_cosmetics where user_id=p_user_id;
  delete from public.user_collectibles where user_id=p_user_id;
  delete from public.crumb_ledger where user_id=p_user_id;
  delete from public.user_stories where user_id=p_user_id;
  delete from public.story_trigger_log where user_id=p_user_id;
  delete from public.creatures where user_id=p_user_id;
  delete from public.cinema_profiles where user_id=p_user_id;
  delete from public.admins where user_id=p_user_id;

  update public.event_outputs
  set payload=jsonb_set(
    payload,
    '{scores}',
    coalesce((
      select jsonb_agg(
        case
          when item->>'userId'=p_user_id::text
            then jsonb_set(item,'{name}',to_jsonb('удалённый участник'::text),true)
          else item
        end
      )
      from jsonb_array_elements(coalesce(payload->'scores','[]'::jsonb)) item
    ),'[]'::jsonb),
    true
  )
  where output_key='score_summary'
    and jsonb_typeof(payload->'scores')='array';

  update public.event_outputs
  set payload=jsonb_set(
    payload,
    '{winners}',
    coalesce((
      select jsonb_agg(
        case
          when item->>'userId'=p_user_id::text
            then jsonb_set(item,'{name}',to_jsonb('удалённый участник'::text),true)
          else item
        end
      )
      from jsonb_array_elements(coalesce(payload->'winners','[]'::jsonb)) item
    ),'[]'::jsonb),
    true
  )
  where output_key='score_summary'
    and jsonb_typeof(payload->'winners')='array';

  update public.event_outputs
  set payload=jsonb_set(
    payload,
    '{winner,name}',
    to_jsonb('удалённый участник'::text),
    true
  )
  where output_key='score_summary'
    and payload->'winner'->>'userId'=p_user_id::text;

  update public.users
  set telegram_id=null,
      telegram_username=null,
      display_name='удалённый участник',
      deleted_at=now(),
      updated_at=now()
  where id=p_user_id;

  return jsonb_build_object(
    'ok',true,
    'alreadyDeleted',false,
    'historicalUserId',p_user_id
  );
end;
$$;

revoke all on function public.delete_user_profile(uuid) from public, anon, authenticated;
grant execute on function public.delete_user_profile(uuid) to service_role;
