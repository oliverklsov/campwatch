-- User reviews for recreation.gov campgrounds (distinct from dispersed spot_ratings).
-- facility_name is denormalized so the profile can list reviews without a join.

create table public.campground_reviews (
  id            uuid primary key default gen_random_uuid(),
  facility_id   text not null,            -- rec.gov facility id (matches facilities.facility_id)
  facility_name text,                      -- captured at write time for easy display
  user_id       uuid not null references auth.users(id) on delete cascade,
  stars         integer check (stars between 1 and 5),
  comment       text,
  created_at    timestamptz not null default now(),
  unique (facility_id, user_id)            -- one editable review per user per campground
);
create index campground_reviews_facility_idx on public.campground_reviews (facility_id);

alter table public.campground_reviews enable row level security;
create policy "campground reviews public read" on public.campground_reviews
  for select using (true);
create policy "own campground reviews" on public.campground_reviews
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
