# Campground Alert App — Plan

App that alerts users when campsites become available on recreation.gov, plus deadline and lottery/raffle reminders. Accounts + email alerts. Differentiation vs. rec.gov's native availability alerts: lottery/deadline tracking, multi-campground watches, flexible dates, faster notifications (SMS/push).

## Data sources

- **RIDB API (official)** — campground/site metadata catalog. Free API key, 50 req/min. Refresh weekly. Keeps bulk of traffic sanctioned.
- **Unofficial availability endpoint** — `GET recreation.gov/api/camps/availability/campground/{id}/month?start_date=YYYY-MM-01T00:00:00.000Z`. Per-site, per-day status (Available/Reserved/Closed/NYR). No auth. Undocumented → all access isolated in one adapter (`RecGovClient` in poller/poller.py); monitor for schema drift.
- **Lottery/deadline data** — no API. Manually curated + Claude-assisted monthly scrape of permit pages, human-reviewed.

### Key findings (2026-06-12)
- Bartlett Cove (Glacier Bay) is **first-come-first-served** — POI listing (246829), not reservable. Product must detect FCFS campgrounds and say so rather than fail. Test target is Upper Pines, Yosemite (**232447**) instead.
- rec.gov has a native availability-alert feature → marketing leads with lotteries/deadlines/flexibility.

## Stack

- Frontend: Next.js on Vercel
- Backend/DB/auth: Supabase (Postgres, email + Google OAuth)
- Poller: cron worker (Vercel cron → Railway/Fly if outgrown). Poll **per campground**, not per watch. Jitter, conservative rates, only poll watched campgrounds.
- Email: Resend/Postmark. Deep-link straight to booking page; speed matters (openings vanish in minutes).
- Payments: Stripe

## Schema (rough)
`users`, `watches` (user, facility_id, site filter, date range, status), `availability_snapshots`, `alerts_sent` (dedup), `deadlines`, `lotteries`.

## Monetization
Free: 1 watch, 30-min polling. Paid $5–8/mo or $20/season: unlimited watches, 5-min polling, SMS, deadline/lottery calendar.

## Dispersed camping layer ("free Dyrt")

Show all dispersed camping along Forest Service roads; users can rate and save favorite spots.

- **Data source: USFS MVUM Roads feature layer** (free, official) at data-usfs.hub.arcgis.com — "Motor Vehicle Use Map: Roads (Feature Layer)". Includes per-road attributes for whether motorized dispersed camping is allowed and seasons of use. Downloadable/queryable via ArcGIS REST — no scraping, fully sanctioned. BLM publishes similar open data for later expansion.
- **Build:** import MVUM roads where dispersed-camping flag is set → PostGIS (Supabase supports PostGIS) → map UI (MapLibre GL + free OSM/Protomaps tiles, avoid Mapbox/Google fees) rendering camp-legal road segments.
- **Crowdsourced layer:** users drop pins on specific spots, rate (access road condition, cell signal, crowding), photos, save favorites. Tables: `dispersed_spots`, `spot_ratings`, `spot_favorites`. This is the long-term moat — MVUM data is commodity, the review corpus isn't.
- **Cold start:** seed with MVUM segments only ("camping allowed along this road"), let pins/ratings accrete. Free tier = view map; this feature drives signups, ratings require account.
- **Caveats:** MVUM shows where *vehicle access* for dispersed camping is allowed (typically within 30–300 ft of road) — not guaranteed campsites. Show disclaimer. Data updates ~annually per forest; refresh pipeline needed.
- Slot as **Phase 5** (after paid alerts ship) or earlier if it proves the better acquisition hook — free map traffic funnels into paid alert subscriptions.

## App interface & map browsing (core product direction)

End goal is website + app, and browsing is a first-class value prop, not just alert utility. Map is the centerpiece:
- **Explore tab (map-first):** pins for campgrounds (rec.gov) and later dispersed sites (MVUM). Filter chips: available now / my dates / campground vs dispersed / FCFS. Tap pin → bottom sheet: photos, availability snapshot, "Watch availability" CTA. Map browsing converts browsers into watch-creators.
- **Tabs:** Explore (map) · Watches · Calendar (deadlines/lotteries) · Profile.
- **App delivery sequencing:** responsive web + email → PWA (web push: Android + iOS 16.4+ home-screen) → Capacitor wrapper for App/Play Store → native treatment only if dispersed-camping offline maps demand it.
- **Map stack:** MapLibre GL + free OSM/Protomaps tiles; campground locations from RIDB (lat/long included); availability overlay from our snapshots.
- Mockup: `mockups/app-mockup.html` (clickable, phone-frame).

## Phases
1. **Poller script** (this repo: `poller/`) — diff detection, email to self. ← current
2. Supabase auth + watches + Next.js UI + RIDB search; real alerts via Resend.
3. Deadline/lottery calendar (top ~20 permits), Stripe, free/paid gating, landing page.
4. SMS, flexible-date watches, state systems (ReserveCalifornia) as hedge.

## Scaling path

Core decision already made: poll per FACILITY, not per watch — load grows with distinct campgrounds (~3,800 max on rec.gov, demand concentrated in top few hundred), not users. DB is a non-issue at this scale.

Bottleneck: sequential fetches + jitter inside one Vercel cron function (300s cap) ≈ 150–250 facilities/run. Growth steps, in order:
1. **~500+ watched facilities:** move poll loop to a persistent worker (Railway/Fly, ~$5/mo) with bounded concurrency (~5 parallel). Logic ports as-is from `/api/cron/poll`.
2. **Tiered polling = monetization lever:** paid facilities every 5 min, free every 30.
3. Spread polling continuously (round-robin) instead of bursting at :00/:15.
4. Batch user lookups + Resend sends (current getUserById per watch is N+1).

Hard ceiling: rec.gov tolerance, not architecture. Stay at a few req/s total; 1-min polling for everyone = IP bans.

## Risks
- Unofficial endpoint could add auth/rate limits (existential; survived years of public scrapers).
- Native rec.gov alerts → don't compete on bare availability.
- ToS gray zone on automated polling → keep volumes polite, register RIDB key.

## Poller usage
```
python poller/poller.py --facility 232447 --start 2026-07-10 --end 2026-07-12 --no-state   # one-shot report
python poller/poller.py --config poller/config.json                                        # cron mode w/ diffing + email
```
