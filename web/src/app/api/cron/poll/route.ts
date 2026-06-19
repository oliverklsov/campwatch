import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { fetchOpenings, bookingUrl } from "@/lib/recgov";
import type { Opening, Watch } from "@/lib/types";

export const maxDuration = 300; // Vercel: allow up to 5 min
export const dynamic = "force-dynamic";

const addDays = (d: string, n: number) =>
  new Date(new Date(d + "T00:00:00Z").getTime() + n * 86400_000).toISOString().slice(0, 10);
const isWeekendNight = (d: string) => {
  const day = new Date(d + "T00:00:00Z").getUTCDay(); // Fri=5, Sat=6
  return day === 5 || day === 6;
};

// TS port of poller.py main loop. Key invariant preserved: poll per FACILITY,
// not per watch — 200 watches on Upper Pines is still one fetch.
export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = createServiceClient();
  // Note: supabase-js .gte()/.eq() filters were dropping rows for unknown reasons
  // when service-role client called with no session — filter in JS instead.
  const today = new Date().toISOString().slice(0, 10);
  const { data: allRows, error } = await db.from("watches").select("*").returns<Watch[]>();
  const watches = (allRows ?? []).filter((w) => w.active && w.end_date >= today);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!watches.length) return NextResponse.json({ facilities: 0, alerts: 0 });

  // Group watches by facility; fetch widest date window per facility.
  const byFacility = new Map<string, Watch[]>();
  for (const w of watches) {
    byFacility.set(w.facility_id, [...(byFacility.get(w.facility_id) ?? []), w]);
  }

  let alertCount = 0;
  const errors: string[] = [];

  for (const [facilityId, group] of byFacility) {
    try {
      // Widen the fetch window by each watch's flex_days so flexible matches are covered.
      const start = group
        .map((w) => addDays(w.start_date, -(w.flex_days || 0)))
        .reduce((a, b) => (b < a ? b : a));
      const end = group
        .map((w) => addDays(w.end_date, w.flex_days || 0))
        .reduce((a, b) => (b > a ? b : a));
      const openings = await fetchOpenings(facilityId, start, end);

      // Diff vs last snapshot (new openings only — that's what's alert-worthy).
      const { data: snap } = await db
        .from("facility_snapshots")
        .select("available")
        .eq("facility_id", facilityId)
        .maybeSingle();
      const prev = new Set(
        ((snap?.available ?? []) as [string, string, string][]).map(([s, d, st]) => `${s}|${d}|${st}`)
      );
      const fresh = openings.filter((o) => !prev.has(`${o.site}|${o.date}|${o.status}`));

      await db.from("facility_snapshots").upsert({
        facility_id: facilityId,
        available: openings.map((o) => [o.site, o.date, o.status]),
        updated_at: new Date().toISOString(),
      });

      if (!fresh.length) continue;

      for (const w of group) {
        const winStart = addDays(w.start_date, -(w.flex_days || 0));
        const winEnd = addDays(w.end_date, w.flex_days || 0);
        const matches = fresh.filter(
          (o) =>
            o.date >= winStart &&
            o.date <= winEnd &&
            (w.sites.length === 0 || w.sites.includes(o.site)) &&
            (o.status === "Available" || w.include_fcfs) &&
            (!w.weekend_only || isWeekendNight(o.date))
        );
        if (!matches.length) continue;
        const sent = await alertWatch(db, w, matches);
        alertCount += sent;
      }
    } catch (e) {
      errors.push(`${facilityId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({ facilities: byFacility.size, alerts: alertCount, errors });
}

async function alertWatch(
  db: ReturnType<typeof createServiceClient>,
  w: Watch,
  matches: Opening[]
): Promise<number> {
  // Dedup: skip (site, date) pairs already alerted for this watch.
  const { data: sent } = await db
    .from("alerts_sent")
    .select("site, date")
    .eq("watch_id", w.id);
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
    `New campsite availability for your watch (${w.start_date} → ${w.end_date}):\n\n${lines}\n\nBook now: ${bookingUrl(w.facility_id)}\n\nOpenings get re-grabbed fast — go!`
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
