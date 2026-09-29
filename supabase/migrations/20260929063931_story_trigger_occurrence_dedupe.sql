alter table public.story_trigger_log
  add column if not exists occurrence_key text;

create unique index if not exists story_trigger_log_occurrence_uq
  on public.story_trigger_log(user_id,trigger_key,occurrence_key);
