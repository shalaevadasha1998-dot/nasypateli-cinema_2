import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

// Deploy-only configuration. Values stay in Actions and Vault, never in output.
const project = process.env.PROJECT_ID
const access = process.env.SUPABASE_ACCESS_TOKEN
const release = process.env.GITHUB_SHA
if (project !== 'vwteokawtqnoiyzmsldj' || !access || !release || process.env.GITHUB_REF !== 'refs/heads/main') {
  throw new Error('Show scheduler setup requires the authorized main release')
}
const endpoint = `https://${project}.supabase.co/functions/v1/app`
const token = createHash('sha256').update(`nasypateli-cron-v1:${access}`).digest('hex')
console.log(`::add-mask::${token}`)
const literal = value => "'" + String(value).replaceAll("'", "''") + "'"
async function database(sql, readOnly = false) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${project}/database/query`, {
    method: 'POST',
    headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query: sql, read_only: readOnly }),
    signal: AbortSignal.timeout(20000)
  })
  if (!r.ok) throw new Error(`Show scheduler database operation failed: HTTP ${r.status}`)
  const payload = await r.json()
  const rows = Array.isArray(payload) ? payload : payload?.result ?? payload?.data
  if (!Array.isArray(rows)) throw new Error('Unexpected scheduler database response')
  return rows
}
const health = await fetch(endpoint, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'health' }), signal: AbortSignal.timeout(15000)
}).then(r => r.json())
if (health.release !== release || !health.checks?.database || !health.checks?.cron) {
  throw new Error('Matching backend is not ready for the show scheduler')
}
await database(`do $$ begin
  if not exists(select 1 from pg_extension where extname='pg_cron')
    or not exists(select 1 from pg_extension where extname='pg_net')
    or not exists(select 1 from supabase_migrations.schema_migrations where name='evening_reliability')
  then raise exception 'scheduler prerequisites are missing'; end if;
end $$;`)
for (const [name, value] of [
  ['nasypateli_project_url', `https://${project}.supabase.co`],
  ['nasypateli_cron_access_token', token]
]) {
  await database(`do $$ declare secret_id uuid; begin
    select id into secret_id from vault.secrets where name=${literal(name)};
    if secret_id is null then
      perform vault.create_secret(${literal(value)},${literal(name)});
    elsif not exists(select 1 from vault.decrypted_secrets where id=secret_id and decrypted_secret=${literal(value)}) then
      raise exception 'existing scheduler credential differs; preserve it for explicit rotation';
    end if;
  end $$;`)
}
await database(readFileSync(new URL('./sql/configure_show_director.sql', import.meta.url), 'utf8'))
const jobs = await database("select jobname,schedule,active,username from cron.job where jobname='nasypateli-show-director'", true)
if (jobs.length !== 1 || !jobs[0].active || jobs[0].schedule !== '5 seconds') throw new Error('Show schedule was not saved')
// An isolated, no-transition probe: never issue it if an event has auto mode enabled.
const enabled = await database("select count(*)::int as count from public.events where settings->>'server_director_enabled'='true'", true)
if (Number(enabled[0]?.count) === 0) {
  const r = await fetch(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-cron-token': token },
    body: JSON.stringify({ action: 'cron-show' }), signal: AbortSignal.timeout(45000)
  })
  const result = await r.json()
  if (!r.ok || !result.ok || !Array.isArray(result.results) || result.results.some(x => x.status !== 200)) {
    throw new Error('No-transition director probe failed')
  }
  console.log(JSON.stringify({ directorProbe: 'passed', eventsChecked: result.results.length, transitionsEnabled: false }))
} else {
  console.log('Manual probe skipped: preserve active automatic shows')
}
console.log(JSON.stringify({ showSchedule: jobs[0], idleHttpRequests: false, paymentsConfigured: false, messagesDispatched: false }))
