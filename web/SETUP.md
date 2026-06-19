# CampWatch — Setup

## 1. Supabase (~5 min)
1. [supabase.com](https://supabase.com) → New project (free tier).
2. SQL Editor → paste `supabase/migrations/0001_init.sql` → Run.
3. Authentication → Providers: Email is on by default; enable Google if wanted (needs Google OAuth creds — optional, magic links work without it).
4. Project Settings → API → copy **URL**, **anon key**, **service_role key** into `.env.local`.

## 2. RIDB API key (~2 min)
1. Sign in at [ridb.recreation.gov](https://ridb.recreation.gov) → profile → generate API key → `.env.local` `RIDB_API_KEY`.

## 3. Resend (~5 min, can defer)
1. [resend.com](https://resend.com) free tier → API key.
2. Verify a sending domain (or use their onboarding address for testing) → set `ALERT_FROM_EMAIL`.
3. Without `RESEND_API_KEY` set, alerts log to console instead of sending — fine for dev.

## 4. Run locally
```
cd web
copy .env.local.example .env.local   # then fill it in
npm install
npm run dev                          # http://localhost:3000
```
Trigger the poller manually:
```
curl -H "Authorization: Bearer YOUR_CRON_SECRET" http://localhost:3000/api/cron/poll
```

## 5. Deploy (Vercel)
1. Push `web/` to a GitHub repo → import in Vercel.
2. Add all `.env.local` vars in Vercel project settings.
3. `vercel.json` already schedules `/api/cron/poll` every 15 min (Vercel sends `CRON_SECRET` automatically if set as env var).
4. Supabase → Authentication → URL Configuration: add your Vercel domain to redirect URLs.

## Notes
- OneDrive + `node_modules` don't mix well. If installs are slow/flaky, move the repo out of OneDrive (e.g. `C:\dev\campwatch`) once you set up git.
- The Python poller (`../poller/`) remains your standalone local tool; production logic now lives in `src/app/api/cron/poll/route.ts`.
