-- Telegram identity is verified in the Edge Function. Only service_role may call these RPCs.
alter table public.jipitina_messages add column if not exists request_id uuid;
alter table public.jipitina_messages add column if not exists delivery_status text;
alter table public.jipitina_messages add column if not exists lease_until timestamptz;
alter table public.jipitina_messages add column if not exists attempt_id uuid;
create unique index if not exists jipitina_request_role_unique on public.jipitina_messages(user_id,request_id,role) where request_id is not null;

create or replace function public.claim_creature_chat(p_user_id uuid,p_event_id uuid,p_request_id uuid,p_mode text,p_text text,p_attempt_id uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare row public.jipitina_messages; answer public.jipitina_messages;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,38));
  select * into row from public.jipitina_messages where user_id=p_user_id and request_id=p_request_id and role='user' for update;
  if found then
    if row.text<>p_text or row.mode<>p_mode then raise exception 'CHAT_REQUEST_CONFLICT'; end if;
    select * into answer from public.jipitina_messages where user_id=p_user_id and request_id=p_request_id and role='assistant';
    if found then return jsonb_build_object('state','completed','messages',jsonb_build_array(to_jsonb(row),to_jsonb(answer))); end if;
    if row.lease_until>now() then return jsonb_build_object('state','pending'); end if;
  end if;
  if exists(select 1 from public.jipitina_messages where user_id=p_user_id and role='user' and request_id<>p_request_id and lease_until>now()) then
    return jsonb_build_object('state','pending');
  end if;
  if row.id is null then
    if (select count(*) from public.jipitina_messages where user_id=p_user_id and role='user' and created_at>now()-interval '1 minute')>=12 or
       (select count(*) from public.jipitina_messages where user_id=p_user_id and role='user' and created_at>now()-interval '1 day')>=150 then raise exception 'CHAT_RATE_LIMIT'; end if;
    insert into public.jipitina_messages(user_id,event_id,request_id,role,mode,text,delivery_status,lease_until,attempt_id)
    values(p_user_id,p_event_id,p_request_id,'user',p_mode,p_text,'pending',now()+interval '95 seconds',p_attempt_id) returning * into row;
  else
    update public.jipitina_messages set delivery_status='pending',lease_until=now()+interval '95 seconds',attempt_id=p_attempt_id where id=row.id returning * into row;
  end if;
  return jsonb_build_object('state','claimed','message',to_jsonb(row));
end $$;

create or replace function public.finish_creature_chat(p_user_id uuid,p_request_id uuid,p_attempt_id uuid,p_reply text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare row public.jipitina_messages; answer public.jipitina_messages;
begin
  select * into row from public.jipitina_messages where user_id=p_user_id and request_id=p_request_id and role='user' for update;
  if not found or row.attempt_id is distinct from p_attempt_id then raise exception 'CHAT_LEASE_LOST'; end if;
  if not exists(select 1 from public.creatures where user_id=p_user_id and born_at is not null) then raise exception 'CHAT_CREATURE_MISSING'; end if;
  insert into public.jipitina_messages(user_id,event_id,request_id,role,mode,text,delivery_status,created_at)
  values(p_user_id,row.event_id,p_request_id,'assistant',row.mode,p_reply,'completed',greatest(clock_timestamp(),row.created_at+interval '1 microsecond'))
  on conflict(user_id,request_id,role) where request_id is not null do nothing;
  update public.jipitina_messages set delivery_status='completed',lease_until=null where id=row.id returning * into row;
  select * into answer from public.jipitina_messages where user_id=p_user_id and request_id=p_request_id and role='assistant';
  return jsonb_build_array(to_jsonb(row),to_jsonb(answer));
end $$;
revoke all on function public.claim_creature_chat(uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated;
revoke all on function public.finish_creature_chat(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_creature_chat(uuid,uuid,uuid,text,text,uuid) to service_role;
grant execute on function public.finish_creature_chat(uuid,uuid,uuid,text) to service_role;
