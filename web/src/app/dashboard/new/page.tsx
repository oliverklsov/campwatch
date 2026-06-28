"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { FacilityHit } from "@/lib/types";

export default function NewWatch() {
  const router = useRouter();
  const supabase = createClient();

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<FacilityHit[]>([]);
  const [picked, setPicked] = useState<FacilityHit | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [sites, setSites] = useState("");
  const [includeFcfs, setIncludeFcfs] = useState(false);
  const [flexDays, setFlexDays] = useState(0);
  const [weekendOnly, setWeekendOnly] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout>>();

  // Prefill when arriving from the Explore map (/dashboard/new?facility=ID&name=NAME).
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const facilityId = p.get("facility");
    const name = p.get("name");
    if (facilityId && name) {
      setPicked({ facilityId, name, city: "", state: "" });
    }
    const s = p.get("start");
    const e = p.get("end");
    if (s) setStart(s);
    if (e) setEnd(e);
    const sitesParam = p.get("sites");
    if (sitesParam) setSites(sitesParam);
  }, []);

  useEffect(() => {
    if (picked || query.trim().length < 2) {
      setHits([]);
      return;
    }
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      const res = await fetch(`/api/ridb/search?q=${encodeURIComponent(query)}`);
      if (res.ok) setHits(await res.json());
    }, 300);
    return () => clearTimeout(debounce.current);
  }, [query, picked]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!picked) return setErr("Pick a campground from the search results.");
    if (!start || !end || end < start) return setErr("Enter a valid date range.");
    setSaving(true);
    setErr(null);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("watches").insert({
      user_id: user!.id,
      facility_id: picked.facilityId,
      facility_name: picked.name,
      start_date: start,
      end_date: end,
      sites: sites.split(",").map((s) => s.trim()).filter(Boolean),
      include_fcfs: includeFcfs,
      flex_days: flexDays,
      weekend_only: weekendOnly,
    });
    setSaving(false);
    error ? setErr(error.message) : router.push("/dashboard");
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <h1 className="text-2xl font-bold">New watch</h1>
      <form onSubmit={save} className="space-y-4">
        <div className="relative">
          <label className="mb-1 block text-sm font-medium">Campground</label>
          <input
            value={picked ? picked.name : query}
            onChange={(e) => {
              setPicked(null);
              setQuery(e.target.value);
            }}
            placeholder="Search recreation.gov campgrounds…"
            className="w-full rounded-lg border border-stone-300 px-3 py-2"
          />
          {hits.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full rounded-lg border border-stone-200 bg-white shadow">
              {hits.map((h) => (
                <li key={h.facilityId}>
                  <button
                    type="button"
                    onClick={() => setPicked(h)}
                    className="block w-full px-3 py-2 text-left hover:bg-stone-100"
                  >
                    {h.name}
                    <span className="text-sm text-stone-500">
                      {" "}
                      {[h.city, h.state].filter(Boolean).join(", ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium">First night</label>
            <input type="date" value={start} onChange={(e) => setStart(e.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">Last night</label>
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2" />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">
            Specific sites <span className="font-normal text-stone-500">(optional, comma-separated — blank = any)</span>
          </label>
          <input value={sites} onChange={(e) => setSites(e.target.value)} placeholder="e.g. A23, B05"
            className="w-full rounded-lg border border-stone-300 px-3 py-2" />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium">Date flexibility</label>
          <select
            value={flexDays}
            onChange={(e) => setFlexDays(Number(e.target.value))}
            className="w-full rounded-lg border border-stone-300 px-3 py-2"
          >
            <option value={0}>Exact dates only</option>
            <option value={1}>± 1 day</option>
            <option value={2}>± 2 days</option>
            <option value={3}>± 3 days</option>
            <option value={7}>± 1 week</option>
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={weekendOnly} onChange={(e) => setWeekendOnly(e.target.checked)} />
          Weekends only (alert for Friday &amp; Saturday nights)
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={includeFcfs} onChange={(e) => setIncludeFcfs(e.target.checked)} />
          Also alert for first-come-first-served openings (&quot;Open&quot; status — can&apos;t be booked online)
        </label>

        {err && <p className="text-sm text-red-600">{err}</p>}
        <button disabled={saving}
          className="w-full rounded-lg bg-green-700 py-2.5 font-medium text-white hover:bg-green-800 disabled:opacity-50">
          {saving ? "Saving…" : "Create watch"}
        </button>
      </form>
    </div>
  );
}
