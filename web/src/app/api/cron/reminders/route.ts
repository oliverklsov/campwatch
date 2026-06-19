import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { importLotteries } from "@/lib/lotteries-import";

// Daily lottery reminders. Triggered by an external scheduler (cron-job.org) once
// a day with the CRON_SECRET bearer, same pattern as /api/cron/poll.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Lottery = {
  id: string;
  name: string;
  apply_open: string | null;
  apply_close: string | null;
  results_date: string | null;
  url: string | null;
};

const isoToday = () => new Date().toISOString().slice(0, 10);
const daysUntil = (date: string) =>
  Math.round((new Date(date + "T00:00:00Z").getTime() - new Date(isoToday() + "T00:00:00Z").getTime()) / 86400_000);
const fmt = (d: string) =>
  new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });

export async function GET(request: Request) {
  if (request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = createServiceClient();

  // Refresh the catalog from recreation.gov first (best-effort).
  let imported = 0;
  try {
    imported = (await importLotteries(db)).distinct;
  } catch (e) {
    console.log(`[reminders] import skipped: ${e instanceof Error ? e.message : e}`);
  }

  const { data: lotteries } = await db.from("lotteries").select("*").returns<Lottery[]>();

  // What's due today: open ~7 days out, close ~3 days out, results today/tomorrow.
  type Due = { l: Lottery; kind: "open" | "close" | "results"; date: string };
  const due: Due[] = [];
  for (const l of lotteries ?? []) {
    if (/daily/i.test(l.name)) continue; // daily lotteries recur every day — not reminder-worthy
    if (l.apply_open) {
      const d = daysUntil(l.apply_open);
      if (d >= 0 && d <= 7) due.push({ l, kind: "open", date: l.apply_open });
    }
    if (l.apply_close) {
      const d = daysUntil(l.apply_close);
      if (d >= 0 && d <= 3) due.push({ l, kind: "close", date: l.apply_close });
    }
    if (l.results_date) {
      const d = daysUntil(l.results_date);
      if (d >= 0 && d <= 1) due.push({ l, kind: "results", date: l.results_date });
    }
  }

  let sent = 0;
  for (const { l, kind, date } of due) {
    const { data: follows } = await db.from("lottery_follows").select("user_id").eq("lottery_id", l.id);
    for (const f of follows ?? []) {
      const userId = (f as { user_id: string }).user_id;
      const { data: already } = await db
        .from("lottery_reminders_sent")
        .select("id")
        .eq("user_id", userId)
        .eq("lottery_id", l.id)
        .eq("kind", kind)
        .eq("cycle", date)
        .maybeSingle();
      if (already) continue;

      const { data: u } = await db.auth.admin.getUserById(userId);
      const email = u?.user?.email;
      if (!email) continue;

      const { subject, body } = message(l, kind, date);
      const ok = await sendEmail(email, subject, body);
      if (ok) {
        await db.from("lottery_reminders_sent").insert({ user_id: userId, lottery_id: l.id, kind, cycle: date });
        sent++;
      }
    }
  }

  return NextResponse.json({ imported, due: due.length, reminders: sent });
}

function message(l: Lottery, kind: "open" | "close" | "results", date: string) {
  const link = l.url ? `\n\n${l.url}` : "";
  if (kind === "open")
    return {
      subject: `🎟️ ${l.name} lottery opens ${fmt(date)}`,
      body: `The application window for the ${l.name} lottery opens ${fmt(date)}. Get your application ready.${link}`,
    };
  if (kind === "close")
    return {
      subject: `⏳ ${l.name} lottery closes ${fmt(date)}`,
      body: `Last chance — the ${l.name} lottery application window closes ${fmt(date)}. Apply before then.${link}`,
    };
  return {
    subject: `📣 ${l.name} lottery results ${fmt(date)}`,
    body: `Results for the ${l.name} lottery should be posted ${fmt(date)}. Check your account.${link}`,
  };
}

async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key || key.startsWith("re_your")) {
    console.log(`[reminder email — dev] To: ${to}\n${subject}\n${text}`);
    return true;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.ALERT_FROM_EMAIL, to, subject, text }),
  });
  if (!res.ok) console.log(`[reminder] resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.ok;
}
