-- Multi-source support for the facility catalog.
--
-- Until now every row in `facilities` was a recreation.gov campground and
-- `facility_id` was a bare numeric RIDB id. To add state-park systems we tag
-- each row with its data source and namespace non-recreation.gov ids with a
-- prefix so they stay globally unique:
--
--   recreation.gov : "10300375"            (unchanged, bare numeric)
--   US eDirect     : "ued-ca-708"          (ued-<state>-<facilityId>)
--   Camis          : "camis-wa--2147483635" (camis-<tenant>-<resourceId>)
--
-- `source` is derivable from the id prefix, but storing it explicitly makes
-- map filtering and re-seeding (e.g. "delete all CA rows") trivial.

alter table public.facilities
  add column if not exists source text not null default 'recreation.gov';

-- Backfill is implicit via the default for existing rows.

create index if not exists facilities_source_idx on public.facilities (source);

-- Watches/snapshots/reviews continue to key on `facility_id` (now namespaced),
-- so they need no schema change — the poller derives the provider from the id
-- prefix.
