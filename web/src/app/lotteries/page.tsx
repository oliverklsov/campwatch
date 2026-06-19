"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import TabBar from "@/components/TabBar";

type Lottery = {
  id: string;
  name: string;
  area: string;
  state: string | null;
  category: string;
  apply_open: string | null;
  apply_close: string | null;
  results_date: string | null;
  cadence: string | null;
  estimated: boolean;
  url: string | null;
  notes: string | null;
};

const GROUPS: { key: string; label: string }[] = [
  { key: "hiking", label: "Hiking & permit lotteries" },
  { key: "river", label: "River trips" },
  { key: "campground", label: "Campgrounds & cabins" },
  { key: "hunting", label: "Hunting & wildlife" },
  { key: "event", label: "Special events" },
  { key: "other", label: "Other" },
];

const fmt = (d: string) =>
  new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default function LotteriesPage() {
  const supabase = createClient();
  const [lotteries, setLotteries] = useState<Lottery[]>([]);
  const [following, setFollowing] = useState<Set<string>>(new Set());
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stateFilter, setStateFilter] = useState("all");

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setUserId(user?.id ?? null);
      const { data: lots } = await supabase.from("lotteries").select("*").returns<Lottery[]>();
      setLotteries(lots ?? []);
      if (user) {
        const { data: f } = await supabase.from("lottery_follows").select("lottery_id");
        setFollowing(new Set((f ?? []).map((r: { lottery_id: string }) => r.lottery_id)));
      }
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggle(id: string) {
    if (!userId) {
      window.location.href = "/login";
      return;
    }
    if (following.has(id)) {
      setFollowing((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
      await supabase.from("lottery_follows").delete().eq("lottery_id", id).eq("user_id", userId);
    } else {
      setFollowing((s) => new Set(s).add(id));
      await supabase.from("lottery_follows").insert({ lottery_id: id, user_id: userId });
    }
  }

  return (
    <div className="space-y-6 pb-24">
      <div>
        <h1 className="text-2xl font-bold">Lotteries</h1>
        <p className="text-sm text-stone-600">
          Follow a lottery and we&apos;ll email you before the application window opens, before it closes, and
          on results day. {!userId && <a href="/login" className="text-green-700 underline">Sign in</a>}
        </p>
      </div>

      {!loading && (
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
        >
          <option value="all">All states</option>
          {[...new Set(lotteries.map((l) => l.state ?? "").filter(Boolean))].sort().map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      )}

      {loading ? (
        <p className="text-stone-500">Loading lotteries…</p>
      ) : (
        GROUPS.map(({ key, label }) => {
          const items = lotteries.filter(
            (l) => l.category === key && (stateFilter === "all" || l.state === stateFilter)
          );
          if (!items.length) return null;
          return (
            <section key={key} className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-400">{label}</h2>
              {items.map((l) => {
                const isFollowing = following.has(l.id);
                return (
                  <div key={l.id} className="rounded-lg border border-stone-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold">{l.name}</p>
                        <p className="text-sm text-stone-500">
                          {[l.area, l.state].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <button
                        onClick={() => toggle(l.id)}
                        className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium ${
                          isFollowing
                            ? "border border-green-700 text-green-700 hover:bg-green-50"
                            : "bg-green-700 text-white hover:bg-green-800"
                        }`}
                      >
                        {isFollowing ? "Following ✓" : "Follow"}
                      </button>
                    </div>

                    <div className="mt-2 text-sm text-stone-700">
                      {l.apply_open ? (
                        <p>
                          <span className="font-medium">Apply</span> {fmt(l.apply_open)}
                          {l.apply_close ? ` – ${fmt(l.apply_close)}` : ""}
                          {l.results_date ? ` · Results ${fmt(l.results_date)}` : ""}
                          {l.estimated && (
                            <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                              estimated
                            </span>
                          )}
                        </p>
                      ) : (
                        <p className="text-stone-500">{l.cadence}</p>
                      )}
                      {l.apply_open && l.cadence && (
                        <p className="mt-0.5 text-xs text-stone-500">{l.cadence}</p>
                      )}
                      {l.notes && <p className="mt-1 text-xs text-stone-500">{l.notes}</p>}
                    </div>

                    {l.url && (
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 inline-block text-sm font-medium text-green-700 hover:underline"
                      >
                        Details ↗
                      </a>
                    )}
                  </div>
                );
              })}
            </section>
          );
        })
      )}

      <TabBar />
    </div>
  );
}
