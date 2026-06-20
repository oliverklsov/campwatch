-- CampWatch: dispersed-camping layer ("free Dyrt").
-- Two parts:
--   1) mvum_roads        — USFS Motor Vehicle Use Map road segments where dispersed
--                          camping is allowed (read-only reference data, seeded by
--                          scripts/seed-mvum.mjs). Geometry stored as GeoJSON in jsonb
--                          with a bounding box (min/max lat/lng) for viewport queries —
--                          no PostGIS needed at pilot scale.
--   2) crowdsourced layer — user-dropped spots, ratings, and favorites (the moat).

-- ---- 1) MVUM road segments (public reference data) ----------------------
create table public.mvum_roads (
  id          text primary key,          -- USFS route id (RTE_CN / unique route key)
  name        text,                       -- road name / number (e.g. "FR 300")
  forest      text,                       -- administering national forest
  state       text not null default 'AZ',
  corridor_ft integer,                    -- dispersed-camping corridor width (150/300) when known
  season      text,                       -- season-of-use note from MVUM, when known
  geom        jsonb not null,             -- GeoJSON geometry (LineString | MultiLineString)
  min_lat     double precision not null,  -- bounding box for viewport overlap queries
  max_lat     double precision not null,
  min_lng     double precision not null,
  max_lng     double precision not null,
  updated_at  timestamptz not null default now()
);
-- Viewport overlap filter uses these ranges.
create index mvum_roads_minlat_idx on public.mvum_roads (min_lat);
create index mvum_roads_maxlat_idx on public.mvum_roads (max_lat);
create index mvum_roads_minlng_idx on public.mvum_roads (min_lng);
create index mvum_roads_maxlng_idx on public.mvum_roads (max_lng);
create index mvum_roads_state_idx  on public.mvum_roads (state);

alter table public.mvum_roads enable row level security;
-- Public read (it's public USFS data); writes only via the service-role seed script.
create policy "mvum roads are public" on public.mvum_roads for select using (true);

-- ---- 2) Crowdsourced dispersed spots ------------------------------------
create table public.dispersed_spots (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  lat        double precision not null,
  lng        double precision not null,
  notes      text,
  created_at timestamptz not null default now()
);
alter table public.dispersed_spots enable row level security;
-- Anyone can see spots; only the author can create/edit/remove their own.
create policy "spots public read" on public.dispersed_spots
  for select using (true);
create policy "insert own spot" on public.dispersed_spots
  for insert with check (auth.uid() = user_id);
create policy "update own spot" on public.dispersed_spots
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own spot" on public.dispersed_spots
  for delete using (auth.uid() = user_id);

-- Ratings: one editable rating per user per spot (upsert on the unique pair).
create table public.spot_ratings (
  id             uuid primary key default gen_random_uuid(),
  spot_id        uuid not null references public.dispersed_spots(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  stars          integer check (stars between 1 and 5),
  road_condition text,   -- 'paved' | 'gravel' | 'rough' | '4x4-only'
  cell_signal    text,   -- 'none' | 'weak' | 'good'
  crowding       text,   -- 'empty' | 'some' | 'crowded'
  comment        text,
  created_at     timestamptz not null default now(),
  unique (spot_id, user_id)
);
alter table public.spot_ratings enable row level security;
create policy "ratings public read" on public.spot_ratings
  for select using (true);
create policy "own ratings" on public.spot_ratings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Favorites: a user's saved spots.
create table public.spot_favorites (
  user_id    uuid not null references auth.users(id) on delete cascade,
  spot_id    uuid not null references public.dispersed_spots(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, spot_id)
);
alter table public.spot_favorites enable row level security;
create policy "own favorites" on public.spot_favorites
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
