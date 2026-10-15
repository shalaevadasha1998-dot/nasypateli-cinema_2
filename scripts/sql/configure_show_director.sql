-- run only after the matching production code, migrations and Vault configuration are verified
-- release setup runs this idempotent configuration; it never enables an event automatically
-- required Vault secret names: nasypateli_project_url, nasypateli_cron_access_token
-- the cron token must match the Edge Function's existing CRON_ACCESS_TOKEN
-- never print, paste into source control, or send the secret to a chat
-- pg_cron and pg_net must already be enabled in this existing project
-- no HTTP calls for abandoned test rooms or screens that are offline

do $$
begin
  if not exists(select 1 from pg_extension where extname='pg_cron') or not exists(select 1 from pg_extension where extname='pg_net') then raise exception 'enable cron and pg_net in the dashboard first'; end if;
  if not exists(select 1 from vault.secrets where name='nasypateli_project_url') or not exists(select 1 from vault.secrets where name='nasypateli_cron_access_token') then raise exception 'configure both named Vault secrets first'; end if;
end $$;
select cron.schedule('nasypateli-show-director','5 seconds',$job$
  select net.http_post(
    url:=(select decrypted_secret from vault.decrypted_secrets where name='nasypateli_project_url')||'/functions/v1/app',
    headers:=jsonb_build_object('Content-Type','application/json','x-cron-token',(select decrypted_secret from vault.decrypted_secrets where name='nasypateli_cron_access_token')),
    body:='{"action":"cron-show"}'::jsonb,timeout_milliseconds:=10000
  ) where exists(
    select 1 from public.event_runtime r
    join public.event_screen_status s on s.event_id=r.event_id and s.run_id=r.run_id
    where r.run_status in ('running','paused')
      and s.last_seen_at > now() - interval '60 seconds'
  );
$job$);
-- Inspect edge HTTP responses + event_runtime.director_state, not just cron's queued/succeeded status.
-- Stop without data deletion: select cron.alter_job((select jobid from cron.job where jobname='nasypateli-show-director'), active:=false);
-- Per-event stop: select "переключаю сама" in the admin UI. Other events are unaffected.
