create table if not exists public.admin_handles (
  username text primary key,
  role text not null check (role in ('owner','tech','content')),
  created_at timestamptz not null default now()
);

alter table public.admin_handles enable row level security;
revoke all on public.admin_handles from public, anon, authenticated;
grant select, insert, update, delete on public.admin_handles to service_role;

insert into public.admin_handles(username,role)
values ('dashhkunsik','owner'),('iivankhudyakov','owner')
on conflict(username) do update set role=excluded.role;

insert into public.admins(user_id,role)
select id,'owner' from public.users
where lower(coalesce(telegram_username,''))='dashhkunsik'
on conflict(user_id) do update set role=excluded.role;
