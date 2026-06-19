# CampWatch — Handoff / New-PC Setup

Campsite-availability alerts for recreation.gov, plus a map explorer, lottery
tracker, and reservation-release dates. This doc gets the project running on a
fresh machine and records where everything lives.

## Stack

- **Web app:** Next.js 14 (App Router) + Tailwind, in `web/`. Deployed on Vercel.
- **DB/auth:** Supabase (Postgres + email/Google auth).
- **Email:** Resend.
- **Data:** RIDB (official recreation.gov API) for campground catalog + reservation
  type; the undocumented rec.gov availability + lottery endpoints (isolated in
  `web/src/lib/recgov.ts` and `web/src/lib/lotteries-import.ts`).
- **Maps:** MapLibre GL + OSM raster (streets) and a satellite layer (MapTiler if
  `NEXT_PUBLIC_MAPTILER_KEY` is set, else USGS public-domain imagery).
- **Polling/reminders:** Vercel route handlers triggered by cron-job.org.

## Everything that lives in the cloud (survives a PC change)

- Vercel deployment — production alias **https://campwatch-tau.vercel.app**
- Supabase database (all tables + data, incl. 4,370 seeded campgrounds + lotteries)
- Resend, RIDB, MapTiler accounts
- cron-job.org schedules (poll + reminders)

A new PC only needs the code + env vars re-connected.

## New-PC setup

1. Install Node.js and the Vercel CLI: `npm i -g vercel`
2. Get the code: `git clone <your-repo>` (or let OneDrive sync the folder down).
3. `cd web && npm install`
4. Restore secrets from Vercel (cleanest):
   ```
   vercel login
   vercel link        # link to the existing "campwatch" project
   vercel env pull .env.local
   ```
   (Or copy `web/.env.local` from the synced OneDrive folder.)
5. `npm run dev` → http://localhost:3000

## Environment variables (`web/.env.local`)

Names only — values come from `vercel env pull` or the service dashboards:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `RIDB_API_KEY`
- `RESEND_API_KEY`, `ALERT_FROM_EMAIL`
- `CRON_SECRET` (bearer token the cron jobs send)
- `NEXT_PUBLIC_MAPTILER_KEY` (optional — high-res satellite; falls back to USGS if absent)

## Database migrations (`web/supabase/migrations/`)

Already applied to the live Supabase. To rebuild a fresh DB, run them in order in
the Supabase SQL editor:

1. `0001_init.sql` — watches, facility_snapshots, alerts_sent, deadlines
2. `0002_facilities.sql` — campground catalog for the map
3. `0003_flexible_watches.sql` — flex_days + weekend_only on watches
4. `0004_lotteries.sql` — lotteries, lottery_follows, lottery_reminders_sent

## Data seeding

- **Campgrounds:** `cd web && node scripts/seed-facilities.mjs` — pages RIDB and
  upserts ~4,370 campgrounds with coordinates. Idempotent; safe to re-run.
- **Lotteries:** auto-imported from rec.gov each time `/api/cron/reminders` runs
  (no manual seed needed).

## Deploy

```
cd web
vercel --prod
```

(If you connect the GitHub repo to Vercel, set the project's Root Directory to
`web` and pushes auto-deploy.)

## Cron schedules (cron-job.org)

Both send header `Authorization: Bearer <CRON_SECRET>`:

- **Poll availability** — every 15 min → `https://campwatch-tau.vercel.app/api/cron/poll`
- **Lottery import + reminders** — once daily → `https://campwatch-tau.vercel.app/api/cron/reminders`

(Vercel Hobby caps built-in cron at once/day, so the 15-min cadence is driven
externally. `vercel.json` keeps a daily safety-net run.)

## Gotchas worth knowing

- **OneDrive vs `next dev`:** the project lives in a OneDrive folder; rapid file
  saves can make the dev server hang with multi-minute responses / blanket 404s.
  Fix: restart `npm run dev`, or pause OneDrive sync while developing.
- **Reservation type:** RIDB's facility-level `Reservable` flag is unreliable.
  Authoritative source is per-campsite `CampsiteReservable` (`web/src/lib/ridb.ts`).
- **FCFS vs reservable** can vary by season; the app states only what the live
  feed proves and defers policy to recreation.gov.
- **Coordinates:** `/api/facilities` rescues sign-flipped longitudes and filters
  to a US bounding box (fixes pins landing in the ocean).

## Continuing with Claude

Sign into the same Claude account in the desktop app. The "Campground app"
project and its memory (state, decisions, gotchas) travel with the account, so a
new session can pick up where this one left off.
