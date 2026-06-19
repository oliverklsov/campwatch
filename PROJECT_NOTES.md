# CampWatch — Project Notes (context for a new session)

Drop this (and `HANDOFF.md`) in front of a fresh Claude/Cowork session to catch it
up — Cowork doesn't sync across devices yet, so this file is the portable memory.

## Where things stand (as of 2026-06-13)

- **Phase 1 — poller:** `poller/poller.py`, validated live. TS port runs in the
  web app at `web/src/app/api/cron/poll/route.ts` (poll per-facility, snapshot
  diff, `alerts_sent` dedup, Resend email).
- **Phase 2 — web app:** Next.js 14 + Supabase + Tailwind in `web/`. **Deployed
  live** at https://campwatch-tau.vercel.app (Vercel Hobby). Auth (magic link +
  Google), create/list watches, RIDB campground search.
- **Explore map** (`web/src/app/explore/page.tsx`): MapLibre; OSM streets + a
  satellite toggle (MapTiler hybrid if `NEXT_PUBLIC_MAPTILER_KEY` set, else USGS
  public-domain). 4,370 campgrounds seeded into `facilities` (via
  `scripts/seed-facilities.mjs`), clustered teardrop-tent pins, state-filter
  dropdown (flies map to the state), bottom sheet with photos (RIDB), NWS weather
  (high/low), live availability for a chosen date range, authoritative
  reservation-type badge, and reservation-release-date detection.
- **Watches:** flexible dates (`flex_days`) + weekend-only matching.
- **Lotteries** (`web/src/app/lotteries/page.tsx`): full catalog auto-imported
  from rec.gov (`src/lib/lotteries-import.ts`, ~41 distinct), Follow button,
  state filter; daily email reminders before open/close and on results day via
  `/api/cron/reminders` (which also refreshes the catalog).
- **Bottom TabBar:** Explore · Watches · Lotteries · Profile (Profile still a
  disabled stub).

## Built but NOT yet deployed (do a `vercel --prod` from web/)

Lotteries + reminders, release-date detection, satellite/labels + default
satellite view, state dropdowns, tab bar on Watches, ocean-dot coordinate fix.
After deploying, add a **daily cron-job.org job** for `/api/cron/reminders`
(bearer `CRON_SECRET`) — alongside the existing every-15-min `/api/cron/poll` job.

## Key technical facts / gotchas

- **Reservation type:** RIDB facility-level `Reservable` is unreliable. Use
  per-campsite `CampsiteReservable` (`src/lib/ridb.ts`) → reservable / fcfs /
  mixed. Verified: 10215904 = fcfs (0/4), 249291 = mixed (20/20).
- **Availability statuses:** Available (bookable), Open (FCFS season), Reserved,
  Closed, NYR (not yet released). Release-window detection scans forward for the
  NYR boundary.
- **Vercel Hobby** caps cron at once/day → 15-min cadence runs via cron-job.org;
  `vercel.json` keeps a daily safety-net. Always set Vercel env before deploying
  (build fails on missing `NEXT_PUBLIC_*`).
- **Maps:** Esri imagery avoided for licensing; MapTiler (commercial-OK with key)
  or USGS (public domain) only. Sign-flipped longitudes rescued + US bbox filter
  in `/api/facilities`.
- **OneDrive + `next dev`:** rapid saves can hang the dev server (multi-minute
  404s) — restart it or pause OneDrive sync.
- **Sandbox** can't reach recreation.gov/RIDB (live tests run on the user's
  machine) and its OneDrive mount can lag behind edits.

## Roadmap / next up

1. Deploy the above + set up the daily reminders cron.
2. Option 3 — monetization: Stripe, free/paid gating, landing page (pricing TBD,
   seasonal ~$20 vs monthly $5–8). SMS deferred.
3. Other planned free features: amenity filters (RIDB), web push / PWA,
   whole-park (multi-campground) watches, recently-opened feed, iCal export.
4. Later (Phase 5): dispersed-camping "free Dyrt" map layer from USFS MVUM roads
   (data-usfs.hub.arcgis.com).

See `HANDOFF.md` for new-PC setup, env vars, migrations, and deploy steps.
