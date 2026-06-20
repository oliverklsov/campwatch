# Yonder — Handoff / New-PC Setup

Campsite-availability alerts for recreation.gov, plus a map explorer, a free
dispersed-camping layer, a lottery tracker, and reservation-release dates. Live at
**https://yonder.camp**. This doc gets the project running on a fresh machine and
records where everything lives.

> Formerly "CampWatch." The Vercel project is still named `campwatch` and the
> `campwatch-tau.vercel.app` URL still resolves, but the product, domain, and
> branding are now **Yonder**.

## Stack

- **Web app:** Next.js 14 (App Router) + Tailwind, in `web/`. Deployed on Vercel.
- **Domain/DNS:** `yonder.camp` registered on **Cloudflare**; DNS on Cloudflare
  (CNAME → `*.vercel-dns-017.com`, **DNS only / gray cloud**). Bare `yonder.camp`
  is primary; `www` 308-redirects to it.
- **DB/auth:** Supabase (Postgres + email magic-link / Google auth).
- **Email:** Resend. Domain `yonder.camp` verified in Resend. App alerts send from
  `alerts@yonder.camp`; Supabase Auth emails send via **Resend custom SMTP**.
- **Data:** RIDB (official recreation.gov API) for the campground catalog +
  reservation type; the undocumented rec.gov availability + lottery endpoints
  (isolated in `web/src/lib/recgov.ts` and `web/src/lib/lotteries-import.ts`); USFS
  MVUM Roads (ArcGIS) for dispersed-camping forest roads.
- **Maps:** MapLibre GL + OSM raster (streets) and a satellite layer (MapTiler if
  `NEXT_PUBLIC_MAPTILER_KEY` is set, else USGS public-domain imagery).
- **Polling/reminders:** Vercel route handlers triggered by cron-job.org.

## Everything that lives in the cloud (survives a PC change)

- Vercel deployment — primary domain **https://yonder.camp**
- Cloudflare — domain registration + DNS for yonder.camp
- Supabase database (all tables + data: ~4,370 campgrounds, lotteries, ~6,235 AZ
  MVUM road segments, dispersed spots/ratings/favorites)
- Resend (domain-verified), RIDB, MapTiler accounts
- cron-job.org schedules (poll + reminders)

A new PC only needs the code + env vars re-connected.

## New-PC setup

1. Install Node.js and the Vercel CLI: `npm i -g vercel`
2. Get the code: `git clone https://github.com/oliverklsov/campwatch.git` (or let
   OneDrive sync the folder down).
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
- `RESEND_API_KEY`, `ALERT_FROM_EMAIL` (= `alerts@yonder.camp`)
- `CRON_SECRET` (bearer token the cron jobs send)
- `NEXT_PUBLIC_MAPTILER_KEY` (optional — high-res satellite; falls back to USGS if absent)

## Database migrations (`web/supabase/migrations/`)

Already applied to the live Supabase. To rebuild a fresh DB, run them in order in
the Supabase SQL editor:

1. `0001_init.sql` — watches, facility_snapshots, alerts_sent, deadlines
2. `0002_facilities.sql` — campground catalog for the map
3. `0003_flexible_watches.sql` — flex_days + weekend_only on watches
4. `0004_lotteries.sql` — lotteries, lottery_follows, lottery_reminders_sent
5. `0005_dispersed.sql` — mvum_roads + dispersed_spots, spot_ratings, spot_favorites (RLS)

## Data seeding

- **Campgrounds:** `cd web && node scripts/seed-facilities.mjs` — pages RIDB and
  upserts ~4,370 campgrounds. Idempotent; includes a coordinate-corrections map +
  per-state bbox guard so bad RIDB coords don't land in the ocean.
- **Dispersed roads (Arizona):** `node scripts/seed-mvum.mjs` — imports AZ Forest
  Service roads open to all vehicles from USFS MVUM into `mvum_roads` (geometry as
  GeoJSON + bbox columns). Re-runnable (clears AZ rows first). `scripts/mvum-probe.mjs`
  is a discovery helper for the USFS endpoint/schema.
- **Lotteries:** auto-imported from rec.gov each time `/api/cron/reminders` runs.
- Note: seed/probe scripts must run **locally** — the cloud sandbox can't reach
  RIDB/USFS.

## Auth & email setup (Supabase + Resend)

- **Resend:** `yonder.camp` is a verified domain (DKIM/SPF/DMARC in Cloudflare DNS).
- **Supabase → Authentication → URL Configuration:**
  - Site URL: `https://yonder.camp`
  - Redirect URLs: `https://yonder.camp/**`, `https://www.yonder.camp/**`, `http://localhost:3000/**`
- **Supabase → Authentication → Emails → SMTP:** custom SMTP via Resend
  (`smtp.resend.com:465`, user `resend`, password = a Resend API key, sender
  `noreply@yonder.camp`). This removes the built-in email rate limit and sends real
  magic-link emails. Bump the email rate limit under Authentication → Rate Limits.

## Deploy

```
cd web
vercel --prod
```

(If you connect the GitHub repo to Vercel, set the project's Root Directory to
`web` and pushes auto-deploy. Env-var changes require a redeploy to take effect.)

## Cron schedules (cron-job.org)

Both send header `Authorization: Bearer <CRON_SECRET>`:

- **Poll availability** — every 15 min → `https://yonder.camp/api/cron/poll`
- **Lottery import + reminders** — once daily → `https://yonder.camp/api/cron/reminders`

(Vercel Hobby caps built-in cron at once/day, so the 15-min cadence is driven
externally. `vercel.json` keeps a daily safety-net run.)

## Gotchas worth knowing

- **OneDrive vs `next dev`:** the project lives in a OneDrive folder; cloud-only
  files and rapid saves can hang the dev server or throw `UNKNOWN: read/write`.
  Fix: pause OneDrive sync + "Always keep on this device", delete `.next`, restart
  `npm run dev`. The sandbox's OneDrive mount can also lag behind edits (type-check
  locally with `npm run typecheck`).
- **Reservation type:** RIDB's facility-level `Reservable` flag is unreliable.
  Authoritative source is per-campsite `CampsiteReservable` (`web/src/lib/ridb.ts`)
  → reservable / fcfs / mixed. The sheet states FCFS vs "fully booked" definitively
  from this, and shows distinct site counts (not site-nights).
- **Coordinates:** `/api/facilities` pages past Supabase's 1,000-row cap, rescues
  sign-flipped longitudes, applies a per-state bbox guard, and has a known-bad
  `COORD_CORRECTIONS` map (kept in sync in `scripts/seed-facilities.mjs`).
- **Dispersed data:** the national USFS MVUM service has no "dispersed camping"
  attribute, so we import FS roads *open to all vehicles* as the proxy (camping is
  generally allowed within ~300 ft of NFS roads unless posted) and show a
  disclaimer. Precise spots come from the crowdsourced layer.
- **Cloudflare DNS:** Vercel records must be **DNS only (gray cloud)** — proxying
  breaks Vercel's SSL.
- **Maps:** Esri imagery avoided for licensing; MapTiler (key) or USGS only.

## Continuing with Claude

Sign into the same Claude account in the desktop app. The project and its memory
(state, decisions, gotchas) travel with the account, so a new session can pick up
where this one left off.
