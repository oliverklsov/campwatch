import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/server";
import { SITE_URL, stateName, US_STATES } from "@/lib/seo";

type Row = { facility_id: string; name: string; city: string | null; reservable: boolean };

export async function generateMetadata({ params }: { params: { state: string } }): Promise<Metadata> {
  const code = params.state.toUpperCase();
  if (!US_STATES[code]) return { title: "Camping | Yonder" };
  const name = stateName(code);
  const title = `Camping in ${name} — Campgrounds & Availability | Yonder`;
  const description = `Browse campgrounds across ${name}, check live availability, set cancellation alerts, and find free dispersed camping on Yonder.`;
  const url = `${SITE_URL}/camping/${params.state.toLowerCase()}`;
  return { title, description, alternates: { canonical: url }, openGraph: { title, description, url } };
}

async function getFacilities(code: string): Promise<Row[]> {
  const db = createServiceClient();
  const rows: Row[] = [];
  const PAGE = 1000;
  for (let from = 0; from < 20000; from += PAGE) {
    const { data, error } = await db
      .from("facilities")
      .select("facility_id, name, city, reservable")
      .eq("state", code)
      .order("name")
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    rows.push(...(data as Row[]));
    if (data.length < PAGE) break;
  }
  return rows;
}

export default async function StatePage({ params }: { params: { state: string } }) {
  const code = params.state.toUpperCase();
  if (!US_STATES[code]) notFound();
  const facilities = await getFacilities(code);
  if (facilities.length === 0) notFound();
  const name = stateName(code);

  return (
    <div className="space-y-6">
      <nav className="text-sm text-stone-500" aria-label="Breadcrumb">
        <Link href="/" className="hover:underline">
          Home
        </Link>
        {" · "}Camping in {name}
      </nav>

      <header>
        <h1 className="text-3xl font-bold tracking-tight">Camping in {name}</h1>
        <p className="mt-1 text-stone-600">
          {facilities.length} campgrounds — check availability and set cancellation alerts on Yonder.
        </p>
      </header>

      <ul className="grid gap-2 sm:grid-cols-2">
        {facilities.map((f) => (
          <li key={f.facility_id}>
            <Link
              href={`/campground/${encodeURIComponent(f.facility_id)}`}
              className="block rounded-lg border border-stone-200 px-3 py-2 hover:bg-stone-50"
            >
              <span className="font-medium">{f.name}</span>
              {f.city && <span className="text-sm text-stone-500"> · {f.city}</span>}
            </Link>
          </li>
        ))}
      </ul>

      <Link
        href="/explore"
        className="inline-block rounded-xl bg-green-700 px-4 py-2.5 font-medium text-white hover:bg-green-800"
      >
        Explore the map →
      </Link>
    </div>
  );
}
