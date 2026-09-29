create or replace function public.award_event_crumbs(
  p_user_id uuid,
  p_event_id uuid,
  p_amount integer,
  p_reason text,
  p_source_id text
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $function$
declare
  v_op text;
  v_creature public.creatures%rowtype;
  v_inserted bigint;
begin
  if p_amount is null or p_amount < 1 or p_amount > 100 then
    raise exception 'invalid crumb amount';
  end if;
  if coalesce(nullif(trim(p_reason),''),'') = '' or coalesce(nullif(trim(p_source_id),''),'') = '' then
    raise exception 'reason and source id required';
  end if;
  if not exists (
    select 1 from public.registrations
    where event_id=p_event_id and user_id=p_user_id and status in ('paid','attended')
  ) then
    raise exception 'event access required';
  end if;

  insert into public.creatures(user_id)
  values(p_user_id)
  on conflict(user_id) do nothing;

  select * into v_creature
  from public.creatures
  where user_id=p_user_id
  for update;

  v_op := 'event:'||p_event_id::text||':'||trim(p_reason)||':'||trim(p_source_id);

  insert into public.crumb_ledger(user_id,delta,reason,operation_key,metadata,event_id,source_id)
  values(
    p_user_id,p_amount,trim(p_reason),v_op,
    jsonb_build_object('eventId',p_event_id,'sourceId',trim(p_source_id)),
    p_event_id,trim(p_source_id)
  )
  on conflict (user_id, operation_key) where operation_key is not null do nothing
  returning id into v_inserted;

  if v_inserted is null then
    return jsonb_build_object('ok',true,'alreadyAwarded',true,'crumbs',v_creature.crumbs);
  end if;

  update public.creatures
  set crumbs=crumbs+p_amount,updated_at=now()
  where user_id=p_user_id
  returning * into v_creature;

  return jsonb_build_object('ok',true,'alreadyAwarded',false,'rewardCrumbs',p_amount,'crumbs',v_creature.crumbs);
end
$function$;

revoke execute on function public.award_event_crumbs(uuid,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.award_event_crumbs(uuid,uuid,integer,text,text) to service_role;

update public.event_programs
set config=jsonb_set(
  config,
  '{rewards}',
  coalesce(config->'rewards','{"join":1,"vote":1,"round":2,"finale":3}'::jsonb),
  true
),
updated_at=now()
where not (config ? 'rewards');
