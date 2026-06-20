-- User-uploaded photos for dispersed spots. Files live in the public 'spot-photos'
-- Storage bucket; this table tracks metadata + the public URL for easy querying.

create table public.spot_photos (
  id         uuid primary key default gen_random_uuid(),
  spot_id    uuid not null references public.dispersed_spots(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  path       text not null,           -- storage object path
  url        text not null,           -- public URL
  created_at timestamptz not null default now()
);
create index spot_photos_spot_idx on public.spot_photos (spot_id);
create index spot_photos_user_idx on public.spot_photos (user_id);

alter table public.spot_photos enable row level security;
create policy "spot photos public read" on public.spot_photos
  for select using (true);
create policy "insert own spot photo" on public.spot_photos
  for insert with check (auth.uid() = user_id);
create policy "delete own spot photo" on public.spot_photos
  for delete using (auth.uid() = user_id);

-- Public-read Storage bucket for the image files.
insert into storage.buckets (id, name, public)
values ('spot-photos', 'spot-photos', true)
on conflict (id) do nothing;

-- Storage object policies: anyone can read, authenticated users can upload,
-- owners can delete their own files.
create policy "spot-photos public read" on storage.objects
  for select using (bucket_id = 'spot-photos');
create policy "spot-photos authenticated upload" on storage.objects
  for insert with check (bucket_id = 'spot-photos' and auth.uid() is not null);
create policy "spot-photos owner delete" on storage.objects
  for delete using (bucket_id = 'spot-photos' and owner = auth.uid());
