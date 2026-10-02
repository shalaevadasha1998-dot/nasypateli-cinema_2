create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  asset_key text not null unique,
  title text not null,
  category text not null check (category in ('calm','energy','creature','transition')),
  mime_type text not null,
  duration_sec numeric(10,2),
  storage_path text,
  public_url text,
  import_url text,
  source_drive_file_id text,
  status text not null default 'pending' check (status in ('pending','syncing','ready','error')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists media_assets_category_status_idx on public.media_assets(category,status);

alter table public.media_assets enable row level security;

alter table public.event_runtime
  add column if not exists audio_state jsonb not null default
  '{"mode":"auto","status":"stopped","track_key":null,"playlist_index":0,"updated_at":null}'::jsonb;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'event-media','event-media',true,104857600,
  array['audio/mpeg','audio/wav','audio/x-wav','audio/mp4','audio/ogg']::text[]
)
on conflict (id) do update
set public=excluded.public,
    file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types;
