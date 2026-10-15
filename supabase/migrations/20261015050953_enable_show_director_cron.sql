-- built-in scheduler on the existing project; no paid service or automatic show start
create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;
-- credentials and the disabled-by-default per-event switch are configured separately
