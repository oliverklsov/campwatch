-- Lotteries catalog + per-user follows + reminder dedup.
-- Curated (no lottery API). Dates are the next occurrence; estimated=true means the
-- agency has not yet published next cycle's exact dates (projected from this year).

create table public.lotteries (
  id           text primary key,            -- slug
  name         text not null,
  area         text not null default '',    -- park / forest / monument
  state        text default '',
  category     text not null,               -- 'hiking' | 'river' | 'campground' | 'other'
  apply_open   date,                         -- null = rolling/daily (no fixed window)
  apply_close  date,
  results_date date,
  cadence      text default '',             -- human note about how it recurs
  estimated    boolean not null default false,
  url          text,
  notes        text
);
alter table public.lotteries enable row level security;
create policy "lotteries are public" on public.lotteries for select using (true);

create table public.lottery_follows (
  user_id    uuid not null references auth.users(id) on delete cascade,
  lottery_id text not null references public.lotteries(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, lottery_id)
);
alter table public.lottery_follows enable row level security;
create policy "own follows" on public.lottery_follows
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Dedup so the daily reminder job never emails the same person twice for the same
-- date in the same cycle. Service-role only (no policies).
create table public.lottery_reminders_sent (
  id         bigint generated always as identity primary key,
  user_id    uuid not null,
  lottery_id text not null,
  kind       text not null,   -- 'open' | 'close' | 'results'
  cycle      text not null,   -- the target date string, so it re-fires next cycle
  sent_at    timestamptz not null default now(),
  unique (user_id, lottery_id, kind, cycle)
);
alter table public.lottery_reminders_sent enable row level security;

insert into public.lotteries (id, name, area, state, category, apply_open, apply_close, results_date, cadence, estimated, url, notes) values
('half-dome', 'Half Dome Cables (Preseason)', 'Yosemite National Park', 'CA', 'hiking', '2027-03-01', '2027-03-31', '2027-04-15', 'Annual preseason lottery every March; plus a daily lottery ~2 days ahead during the season', true, 'https://www.recreation.gov/permits/234652', 'Day-hike permits for the Half Dome cables. ~18% preseason success.'),
('mount-whitney', 'Mount Whitney', 'Inyo National Forest', 'CA', 'hiking', '2027-02-01', '2027-03-01', '2027-03-15', 'Annual lottery every February; unclaimed dates go first-come ~Apr 22', true, 'https://www.recreation.gov/permits/233260', 'Day and overnight permits, May 1 to Nov 1.'),
('enchantments', 'The Enchantments (Overnight)', 'Alpine Lakes Wilderness', 'WA', 'hiking', '2027-02-15', '2027-03-01', '2027-03-15', 'Annual lottery mid-February; plus a daily geofence lottery in season', true, 'https://www.recreation.gov/permits/233273', 'Core zone under 5% odds; Colchuck/Snow better.'),
('coyote-buttes-north', 'The Wave (Coyote Buttes North)', 'Vermilion Cliffs National Monument', 'AZ', 'hiking', null, null, null, 'Rolling: monthly advanced lottery (apply a full month ~4 months ahead, drawn 1st of next month) + daily geofence lottery 2 days ahead', false, 'https://www.blm.gov/arizona/public-room/fact-sheet/coyote-buttes-north-advanced-lottery-wave-faqs', '64 permits/day. $7/person.'),
('coyote-buttes-south', 'Coyote Buttes South', 'Vermilion Cliffs National Monument', 'AZ', 'hiking', null, null, null, 'Rolling: monthly advanced lottery + daily lottery', false, 'https://www.blm.gov/programs/recreation/permits-and-passes/lotteries-and-permit-systems', 'Smaller daily allotment than The Wave.'),
('angels-landing', 'Angels Landing (Fall season)', 'Zion National Park', 'UT', 'hiking', '2026-07-01', '2026-07-20', '2026-07-25', 'Seasonal lotteries (spring/summer/fall/winter) + a day-before lottery', false, 'https://www.nps.gov/zion/planyourvisit/angels-landing-hiking-permits.htm', 'Fall covers hikes Sep 1 to Nov 30, 2026.'),
('grand-canyon-river', 'Grand Canyon Noncommercial River Trip', 'Grand Canyon National Park', 'AZ', 'river', '2027-02-01', '2027-02-24', '2027-03-15', 'Annual weighted lottery every February for the following calendar year', true, 'https://grcariverpermits.nps.gov', 'Hosted on the NPS weighted-lottery site, not recreation.gov. ~478 permits.'),
('four-rivers', 'Four Rivers Lottery', 'Salmon / Selway / Snake (Hells Canyon)', 'ID', 'river', '2026-12-01', '2027-01-31', '2027-02-13', 'Annual lottery Dec 1 to Jan 31 for the next summer season', false, 'https://www.recreation.gov/lottery/available', 'Middle Fork & Main Salmon, Selway, Hells Canyon of the Snake.'),
('rogue-river', 'Rogue River (Wild Section)', 'Rogue River, Oregon', 'OR', 'river', '2026-12-01', '2027-01-31', '2027-02-15', 'Annual lottery Dec to Jan; results by mid-February', false, 'https://www.blm.gov/programs/recreation/permits-and-passes/lotteries-and-permit-systems/oregon-washington/rogue-river', 'Noncommercial float permits, May 15 to Oct 15.'),
('dinosaur-green-yampa', 'Green and Yampa River Permits', 'Dinosaur National Monument', 'CO', 'river', '2026-12-01', '2027-01-31', '2027-02-15', 'Annual lottery in winter for the coming season', true, 'https://www.recreation.gov/permits/250014', 'Multi-day float trips through Dinosaur.'),
('san-juan-river', 'San Juan River', 'Bureau of Land Management, Utah', 'UT', 'river', '2026-12-01', '2027-01-31', '2027-02-15', 'Annual lottery in winter for the coming season', true, 'https://www.recreation.gov/lottery/available', 'Sand Island to Clay Hills / Mexican Hat.'),
('mount-st-helens', 'Mount St. Helens (Monitor Ridge)', 'Mount St. Helens, Washington', 'WA', 'hiking', null, null, null, 'Monthly release on recreation.gov (permits open at 7am PT on the 1st for upcoming dates) rather than a single lottery', false, 'https://www.recreation.gov/permits/4675302', 'Above 4,800 ft climbing permits.');
