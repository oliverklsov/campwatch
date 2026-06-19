-- CampWatch initial schema. Run in Supabase SQL editor or `supabase db push`.

create table public.watches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  facility_id text not null,
  facility_name text not null default '',
  start_date date not null,
  end_date date not null,
  sites text[] not null default '{}',          -- empty = any site
  include_fcfs boolean not null default false,  -- treat 'Open' (FCFS) as a hit
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint valid_window check (end_date >= start_date)
);
create index watches_facility_idx on public.watches (facility_id) where active;
create index watches_user_idx on public.watches (user_id);

-- One snapshot per facility (poll per campground, not per watch).
create table public.facility_snapshots (
  facility_id text primary key,
  available jsonb not null default '[]',  -- [[site, "YYYY-MM-DD", status], ...]
  updated_at timestamptz not null default now()
);

-- Dedup log: never alert the same watch about the same (site, date) twice.
create table public.alerts_sent (
  id bigint generated always as identity primary key,
  watch_id uuid not null references public.watches(id) on delete cascade,
  site text not null,
  date date not null,
  sent_at timestamptz not null default now(),
  unique (watch_id, site, date)
);

-- Phase 3 placeholders: curated deadline/lottery calendar.
create table public.deadlines (
  id bigint generated always as identity primary key,
  title text not null,
  park text not null,
  kind text not null check (kind in ('booking_window','lottery_open','lottery_close','lottery_results','permit_deadline')),
  event_date date not null,
  event_time_pt time,
  url text,
  notes text
);

-- Row Level Security
alter table public.watches enable row level security;
alter table public.alerts_sent enable row level security;
alter table public.facility_snapshots enable row level security;
alter table public.deadlines enable row level security;

create policy "own watches" on public.watches
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own alerts" on public.alerts_sent
  for select using (exists (select 1 from public.watches w where w.id = watch_id and w.user_id = auth.uid()));

create policy "deadlines are public" on public.deadlines for select using (true);

-- facility_snapshots: no policies -> only service role (poller) can touch it.
