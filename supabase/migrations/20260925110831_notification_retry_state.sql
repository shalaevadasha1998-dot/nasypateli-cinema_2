alter table public.notification_queue
  add column if not exists attempts integer not null default 0,
  add column if not exists last_attempt_at timestamptz;

alter table public.notification_queue
  drop constraint if exists notification_queue_attempts_check;

alter table public.notification_queue
  add constraint notification_queue_attempts_check
  check (attempts >= 0);
