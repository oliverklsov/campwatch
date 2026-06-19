-- Alert-quality options on watches:
--   flex_days    : also match openings up to N days before start / after end
--   weekend_only : only alert for Friday or Saturday nights
alter table public.watches
  add column if not exists flex_days int not null default 0,
  add column if not exists weekend_only boolean not null default false;
