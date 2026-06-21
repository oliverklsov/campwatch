-- Coordinates for the curated lotteries so they can render on the Explore map.
-- (rec.gov-imported lotteries without coords simply won't appear as pins.)

alter table public.lotteries
  add column if not exists lat double precision,
  add column if not exists lng double precision;

update public.lotteries set lat = 37.746,  lng = -119.533 where id = 'half-dome';
update public.lotteries set lat = 36.578,  lng = -118.292 where id = 'mount-whitney';
update public.lotteries set lat = 47.477,  lng = -120.798 where id = 'enchantments';
update public.lotteries set lat = 36.996,  lng = -112.006 where id = 'coyote-buttes-north';
update public.lotteries set lat = 36.860,  lng = -111.980 where id = 'coyote-buttes-south';
update public.lotteries set lat = 37.269,  lng = -112.948 where id = 'angels-landing';
update public.lotteries set lat = 36.865,  lng = -111.588 where id = 'grand-canyon-river';
update public.lotteries set lat = 45.400,  lng = -114.800 where id = 'four-rivers';
update public.lotteries set lat = 42.690,  lng = -123.880 where id = 'rogue-river';
update public.lotteries set lat = 40.520,  lng = -108.970 where id = 'dinosaur-green-yampa';
update public.lotteries set lat = 37.260,  lng = -109.620 where id = 'san-juan-river';
update public.lotteries set lat = 46.191,  lng = -122.196 where id = 'mount-st-helens';
