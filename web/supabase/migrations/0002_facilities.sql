-- CampWatch: campground catalog for the Explore map.
-- Seeded from RIDB (official recreation.gov API) by scripts/seed-facilities.mjs.
-- Public read so the map can render pins; writes only via service role (seed script).

create table public.facilities (
  facility_id   text primary key,
  name          text not null,
  lat           double precision not null,
  lng           double precision not null,
  reservable    boolean not null default true,   -- false => first-come-first-served / not bookable online
  facility_type text,                             -- RIDB FacilityTypeDescription, e.g. 'Campground'
  city          text,
  state         text,
  parent_name   text,                             -- parent rec area / park name
  updated_at    timestamptz not null default now()
);

-- Bounding-box queries for the current map viewport.
create index facilities_lat_idx on public.facilities (lat);
create index facilities_lng_idx on public.facilities (lng);
create index facilities_reservable_idx on public.facilities (reservable);

alter table public.facilities enable row level security;

-- Anyone can read the catalog (it's public rec.gov data); nobody can write via the
-- anon/auth client. The seed script uses the service-role key, which bypasses RLS.
create policy "facilities are public" on public.facilities
  for select using (true);
