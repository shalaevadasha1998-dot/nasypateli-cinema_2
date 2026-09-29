create unique index if not exists crumb_ledger_story_award_uq
  on public.crumb_ledger(story_award_id)
  where story_award_id is not null;

create or replace function public.award_story(
  p_user_id uuid,
  p_story_code text,
  p_event_id uuid default null,
  p_occurrence_key text default 'once',
  p_context jsonb default '{}'::jsonb
)
returns table(
  awarded boolean,
  story_award_id uuid,
  crumbs_awarded integer,
  cosmetic_code text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_story public.story_definitions%rowtype;
  v_creature public.creatures%rowtype;
  v_award_id uuid;
  v_crumbs integer := 0;
  v_cosmetic text;
  v_cosmetic_id uuid;
  v_slot text;
  v_traits jsonb;
  v_key text;
  v_value integer;
  v_count integer;
  v_occurrence text;
begin
  select *
    into v_story
  from public.story_definitions
  where code=p_story_code
    and active=true;

  if v_story.id is null then
    return query select false,null::uuid,0,null::text;
    return;
  end if;

  if v_story.limited_total is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('story-limit:'||v_story.id::text,0)
    );

    select count(*)::integer
      into v_count
    from public.user_stories
    where story_id=v_story.id;

    if v_count >= v_story.limited_total then
      return query select false,null::uuid,0,null::text;
      return;
    end if;
  end if;

  v_occurrence :=
    case
      when v_story.repeatable then coalesce(
        nullif(p_occurrence_key,''),
        coalesce(p_event_id::text,pg_catalog.gen_random_uuid()::text)
      )
      else 'once'
    end;

  insert into public.user_stories(
    user_id,story_id,event_id,occurrence_key,context
  )
  values(
    p_user_id,v_story.id,p_event_id,v_occurrence,coalesce(p_context,'{}'::jsonb)
  )
  on conflict(user_id,story_id,occurrence_key) do nothing
  returning id into v_award_id;

  if v_award_id is null then
    return query select false,null::uuid,0,null::text;
    return;
  end if;

  insert into public.creatures(user_id)
  values(p_user_id)
  on conflict(user_id) do nothing;

  select *
    into v_creature
  from public.creatures
  where user_id=p_user_id
  for update;

  v_crumbs := coalesce((v_story.reward->>'crumbs')::integer,0);

  if v_crumbs <> 0 then
    update public.creatures
    set crumbs=greatest(0,crumbs+v_crumbs),
        updated_at=now()
    where user_id=p_user_id
    returning * into v_creature;

    insert into public.crumb_ledger(
      user_id,delta,reason,story_award_id,operation_key,metadata
    )
    values(
      p_user_id,
      v_crumbs,
      'story:'||p_story_code,
      v_award_id,
      'story:'||v_award_id::text,
      jsonb_build_object('storyCode',p_story_code,'occurrenceKey',v_occurrence)
    );
  end if;

  v_traits := coalesce(v_creature.traits,'{}'::jsonb);

  for v_key,v_value in
    select key,(value::text)::integer
    from pg_catalog.jsonb_each(
      coalesce(v_story.reward->'traits','{}'::jsonb)
    )
  loop
    v_traits := pg_catalog.jsonb_set(
      v_traits,
      array[v_key],
      pg_catalog.to_jsonb(coalesce((v_traits->>v_key)::integer,0)+v_value),
      true
    );
  end loop;

  update public.creatures
  set traits=v_traits,
      updated_at=now()
  where user_id=p_user_id;

  v_cosmetic := nullif(v_story.reward->>'cosmetic','');

  if v_cosmetic is not null then
    select id,slot
      into v_cosmetic_id,v_slot
    from public.creature_cosmetics
    where code=v_cosmetic
      and active=true;

    if v_cosmetic_id is not null then
      insert into public.user_creature_cosmetics(
        user_id,cosmetic_id,source_story_id,equipped
      )
      values(
        p_user_id,
        v_cosmetic_id,
        v_award_id,
        not exists(
          select 1
          from public.user_creature_cosmetics uc
          join public.creature_cosmetics c on c.id=uc.cosmetic_id
          where uc.user_id=p_user_id
            and uc.equipped=true
            and c.slot=v_slot
        )
      )
      on conflict(user_id,cosmetic_id) do nothing;
    end if;
  end if;

  return query select true,v_award_id,v_crumbs,v_cosmetic;
end;
$$;

revoke all on function public.award_story(uuid,text,uuid,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.award_story(uuid,text,uuid,text,jsonb)
  to service_role;
