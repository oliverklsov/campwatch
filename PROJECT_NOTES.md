# Yonder — Project Notes (context for a new session)

Drop this (and `HANDOFF.md`) in front of a fresh Claude/Cowork session to catch it
up. Yonder (formerly "CampWatch") is a campsite-availability + dispersed-camping app
for recreation.gov, live at **https://yonder.camp**.

## Where things stand (as of 2026-06-20)

- **Phase 1 — poller:** `poller/poller.py` (validated live) + TS port in the web app
  at `web/src/app/api/cron/poll/route.ts` (poll per-facility, snapshot diff,
  `alerts_sent` dedup, Resend email).
- **Phase 2 — web app:** Next.js 14 + Supabase + Tailwind in `web/`. **Live** at
  https://yonder.camp (Vercel Hobby). Auth (magic link + Google), create/list
  watches, RIDB campground search.
- **Explore map** (`web/src/app/explore/page.tsx`): MapLibre; OSM streets + satellite
  toggle. ~4,370 campgrounds in `facilities`, clustered teardrop-tent pins (green =
  reservable, tan = FCFS), state filter, bottom sheet with photos (RIDB, click to
  enlarge), NWS weather, live availability for a date range (distinct site counts),
  authoritative reservation-type badge with definitive FCFS-vs-booked messaging, and
  reservation-release-date detection.
- **Dispersed camping (Phase 5)** — on the Explore map behind the 🚐 Dispersed
  toggle: AZ USFS MVUM forest roads as **magenta lines + a tappable bubble on every
  road** (tap → white-glow highlight + road info sheet), loaded by viewport bbox
  (zoom ≥ 9). Plus a **crowdsourced layer**: signed-in users drop spots, rate them
  (road condition / cell / crowding / stars), and save favorites
  (`dispersed_spots`, `spot_ratings`, `spot_favorites`, all via browser Supabase
  client + RLS). ~6,235 AZ road segments seeded.
- **Watches:** flexible dates (`flex_days`) + weekend-only matching.
- **Lotteries** (`web/src/app/lotteries/page.tsx`): catalog auto-imported from
  rec.gov, Follow button, state filter; daily reminders via `/api/cron/reminders`.
- **Branding:** sun-over-mountains logo (green `#2d6a4f` + amber `#E0A100`) in the
  header + `web/src/app/icon.svg` favicon. Dispersed accent = magenta `#e0218a`.
- **Domain/email:** yonder.camp on Cloudflare DNS → Vercel; Resend-verified email
  (`alerts@yonder.camp`); Supabase custom SMTP via Resend + Site URL `https://yonder.camp`.

## Recently shipped (2026-06-20)

Map data fixes (1,000→4,350 row cap, ocean-dot coordinate guard, Big Reservoir
relocation), the full dispersed-camping layer + user spots, sheet upgrades (distinct
site counts, definitive FCFS, photo lightbox), the CampWatch→Yonder rebrand, and the
yonder.camp domain + email cutover. All deployed and verified live.

## Key technical facts / gotchas

- **Reservation type:** RIDB facility-level `Reservable` is unreliable. Use
  per-campsite `CampsiteReservable` (`src/lib/ridb.ts`) → reservable / fcfs / mixed.
- **Availability statuses:** Available (bookable), Open (FCFS season), Reserved,
  Closed, NYR (not yet released). Release-window detection scans for the NYR boundary.
- **Supabase 1,000-row cap:** `.select()` returns ≤1,000 rows by default — paginate
  (`/api/facilities` does). Watch for this on any full-table read.
- **Dispersed data model:** USFS MVUM has no camping flag → we use FS roads open to
  all vehicles as the proxy + disclaimer; crowdsourced spots are the precision/moat.
- **Vercel Hobby** caps cron at once/day → 15-min cadence via cron-job.org;
  `vercel.json` keeps a daily safety-net. Env changes need a redeploy.
- **Cloudflare DNS** for Vercel records must be gray-cloud (DNS only) or SSL breaks.
- **OneDrive + `next dev`:** rapid saves / cloud-only files hang the dev server —
  pause sync, keep files on device, clear `.next`. Sandbox OneDrive mount lags edits.
- **Sandbox** can't reach recreation.gov / RIDB / USFS — seed + probe scripts run on
  the user's machine.

## Roadmap / next up

1. **Monetization:** Stripe + free/paid gating (e.g., unlimited watches, faster
   polling, SMS, dispersed favorites). Pricing TBD (~seasonal $20 vs monthly $5–8).
2. **Expand dispersed camping** beyond Arizona (re-run `seed-mvum.mjs` per state;
   BLM data later).
3. Other planned features: amenity filters (RIDB), web push / PWA, whole-park
   (multi-campground) watches, recently-opened feed, iCal export, Profile tab
   (currently a stub).

See `HANDOFF.md` for setup, env vars, migrations, auth/email config, and deploy.
