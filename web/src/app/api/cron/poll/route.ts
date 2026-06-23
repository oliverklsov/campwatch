import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { fetchOpeningsForFacility, bookingUrlForFacility } from "@/lib/sources";
import { widestWindow, freshOpenings, matchWatch } from "@/lib/alerts";
import type { Opening, Watch } from "@/lib/types";

export const maxDuration = 300; // Vercel: allow up to 5 min
export const dynamic = "force-dynamic";

// Poll a few facilities at once to cut wall-clock, but stay polite to the
// (mostly undocumented) upstreams — each source also throttles internally.
const FACILITY_CONCURRENCY = 4;

// TS port of poller.py main loop. Key invariant preserved: poll per FACILITY,
// not per watch — 200 watches on Upper Pines is still one fetch.
export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = createServiceClient();
  const today = new Date().toISOString().slice(0, 10);

  // Page through ALL watches. supabase-js .gte()/.eq() filters were dropping rows
  // under the no-session service-role client, so we filter active/end_date in JS —
  // but select() caps at 1000 rows per page, so we must page or silently stop
  // polling some watches once there are >1000.
  const watches: Watch[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("watches")
      .select("*")
      .range(from, from + PAGE - 1)
      .returns<Watch[]>();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const rows = data ?? [];
    for (const w of rows) if (w.active && w.end_date >= today) watches.push(w);
    if (rows.length < PAGE) break;
  }
  if (!watches.length) return NextResponse.json({ facilities: 0, alerts: 0 });

  // Group watches by facility; fetch the widest date window per facility once.
  const byFacility = new Map<string, Watch[]>();
  for (const w of watches) {
    byFacility.set(w.facility_id, [...(byFacility.get(w.facility_id) ?? []), w]);
  }

  let alertCount = 0;
  const errors: string[] = [];

  async function processFacility(facilityId: string, group: Watch[]) {
    try {
      const { start, end } = widestWindow(group);
      const openings = await fetchOpeningsForFacility(facilityId, start, end);

      const { data: snap } = await db
        .from("facility_snapshots")
        .select("available")
        .eq("facility_id", facilityId)
        .maybeSingle();
      const prev = (snap?.available ?? []) as [string, string, string][];
      const fresh = freshOpenings(prev, openings);

      // Dispatch alerts BEFORE advancing the snapshot. If the function times out
      // mid-run, this facility's snapshot stays put so the openings are re-detected
      // next run instead of being silently marked seen-and-never-sent. (alerts_sent
      // dedup makes the re-detect safe — no double emails.)
      if (fresh.length) {
        for (const w of group) {
          const matches = matchWatch(w, fresh);
          if (matches.length) alertCount += await alertWatch(db, w, matches);
        }
      }

      // Now record current state as the new baseline.
      await db.from("facility_snapshots").upsert({
        facility_id: facilityId,
        available: openings.map((o) => [o.site, o.date, o.status]),
        updated_at: new Date().toISOString(),
      });
    } catch (e) {
      errors.push(`${facilityId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const entries = [...byFacility.entries()];
  for (let i = 0; i < entries.length; i += FACILITY_CONCURRENCY) {
    await Promise.all(entries.slice(i, i + FACILITY_CONCURRENCY).map(([f, g]) => processFacility(f, g)));
  }

  return NextResponse.json({ facilities: byFacility.size, alerts: alertCount, errors });
}

async function alertWatch(
  db: ReturnType<typeof createServiceClient>,
  w: Watch,
  matches: Opening[]
): Promise<number> {
  // Dedup: skip (site, date) pairs already alerted for this watch.
  const { data: sent } = await db.from("alerts_sent").select("site, date").eq("watch_id", w.id);
  const sentSet = new Set((sent ?? []).map((r) => `${r.site}|${r.date}`));
  const toSend = matches.filter((m) => !sentSet.has(`${m.site}|${m.date}`));
  if (!toSend.length) return 0;

  const { data } = await db.auth.admin.getUserById(w.user_id);
  const email = data?.user?.email;
  if (!email) return 0;

  const lines = toSend
    .sort((a, b) => a.date.localeCompare(b.date) || a.site.localeCompare(b.site))
    .map(
      (m) =>
        `• Site ${m.site} — ${m.date}${m.status === "Open" ? " (first-come-first-served, not bookable online)" : ""}`
    )
    .join("\n");

  const ok = await sendEmail(
    email,
    `🏕️ ${toSend.length} opening${toSend.length > 1 ? "s" : ""} at ${w.facility_name || w.facility_id}`,
    `New campsite availability for your watch (${w.start_date} → ${w.end_date}):\n\n${lines}\n\nBook now: ${bookingUrlForFacility(w.facility_id)}\n\nOpenings get re-grabbed fast — go!`
  );
  if (!ok) return 0;

  await db.from("alerts_sent").insert(toSend.map((m) => ({ watch_id: w.id, site: m.site, date: m.date })));
  return toSend.length;
}

async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key || key.startsWith("re_your") || key === "your-resend-key") {
    console.log(`\n=================== [EMAIL — dev log only] ===================`);
    console.log(`To: ${to}\nSubject: ${subject}\n\n${text}`);
    console.log(`==============================================================\n`);
    return true; // treat as sent in dev so dedup still works
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.ALERT_FROM_EMAIL, to, subject, text }),
  });
  if (!res.ok) console.log(`[email] resend returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.ok;
}
