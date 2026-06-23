import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { createServiceClient } from "@/lib/supabase/server";
import { bookingUrlForFacility, bookingLabelForFacility } from "@/lib/sources";
import { SITE_URL, stateName } from "@/lib/seo";

type Facility = {
  facility_id: string;
  name: string;
  lat: number;
  lng: number;
  reservable: boolean;
  facility_type: string | null;
  city: string | null;
  state: string | null;
  parent_name: string | null;
  source: string;
};
type Review = { stars: number | null; comment: string | null; created_at: string };

async function getData(id: string): Promise<{ f: Facility; reviews: Review[] } | null> {
  const db = createServiceClient();
  const { data: f } = await db.from("facilities").select("*").eq("facility_id", id).maybeSingle();
  if (!f) return null;
  const { data: reviews } = await db
    .from("campground_reviews")
    .select("stars, comment, created_at")
    .eq("facility_id", id)
    .order("created_at", { ascending: false })
    .limit(50);
  return { f: f as Facility, reviews: (reviews ?? []) as Review[] };
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const data = await getData(params.id);
  if (!data) return { title: "Campground not found | Yonder" };
  const { f } = data;
  const loc = [f.city, stateName(f.state)].filter(Boolean).join(", ");
  const title = `${f.name}${loc ? ` — ${loc}` : ""} | Camping & Availability`;
  const description = `${f.name}${loc ? ` in ${loc}` : ""} — ${
    f.reservable ? "reservable" : "first-come, first-served"
  } camping${f.parent_name ? ` in ${f.parent_name}` : ""}. Check availability, set cancellation alerts, and read reviews on Yonder.`;
  const url = `${SITE_URL}/campground/${encodeURIComponent(f.facility_id)}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, type: "website" },
  };
}

export default async function CampgroundPage({ params }: { params: { id: string } }) {
  const data = await getData(params.id);
  if (!data) notFound();
  const { f, reviews } = data;

  const loc = [f.city, stateName(f.state)].filter(Boolean).join(", ");
  const rated = reviews.filter((r) => typeof r.stars === "number");
  const avg = rated.length ? rated.reduce((s, r) => s + (r.stars || 0), 0) / rated.length : null;
  const bookingUrl = bookingUrlForFacility(f.facility_id);
  const bookingLabel = bookingLabelForFacility(f.facility_id);
  const url = `${SITE_URL}/campground/${encodeURIComponent(f.facility_id)}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Campground",
    name: f.name,
    url,
    address: {
      "@type": "PostalAddress",
      ...(f.city ? { addressLocality: f.city } : {}),
      ...(f.state ? { addressRegion: f.state } : {}),
      addressCountry: "US",
    },
    geo: { "@type": "GeoCoordinates", latitude: f.lat, longitude: f.lng },
    ...(avg
      ? { aggregateRating: { "@type": "AggregateRating", ratingValue: Number(avg.toFixed(1)), reviewCount: rated.length } }
      : {}),
    ...(f.parent_name ? { containedInPlace: { "@type": "Place", name: f.parent_name } } : {}),
  };

  return (
    <article className="space-y-6">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <nav className="text-sm text-stone-500" aria-label="Breadcrumb">
        <Link href="/" className="hover:underline">
          Home
        </Link>
        {f.state && (
          <>
            {" · "}
            <Link href={`/camping/${f.state.toLowerCase()}`} className="hover:underline">
              Camping in {stateName(f.state)}
            </Link>
          </>
        )}
      </nav>

      <header>
        <h1 className="text-3xl font-bold tracking-tight">{f.name}</h1>
        {loc && (
          <p className="mt-1 text-stone-600">
            {loc}
            {f.parent_name ? ` · ${f.parent_name}` : ""}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span
            className={`rounded-full px-3 py-1 text-sm font-semibold ${
              f.reservable ? "bg-green-100 text-green-800" : "bg-orange-100 text-orange-800"
            }`}
          >
            {f.reservable ? "Reservable online" : "First-come, first-served"}
          </span>
          {avg && (
            <span className="text-sm text-stone-600">
              ★ {avg.toFixed(1)} ({rated.length} review{rated.length !== 1 ? "s" : ""})
            </span>
          )}
        </div>
      </header>

      <p className="text-stone-700">
        {f.name} is a {f.reservable ? "reservable" : "first-come, first-served"} campground
        {loc ? ` in ${loc}` : ""}
        {f.parent_name ? `, part of ${f.parent_name}` : ""}. Reservations and availability are handled
        through {bookingLabel}. Use Yonder to watch for cancellations and get an alert the moment a site
        opens up.
      </p>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/explore"
          className="rounded-xl bg-green-700 px-4 py-2.5 font-medium text-white hover:bg-green-800"
        >
          View on the map →
        </Link>
        {f.reservable && (
          <a
            href={bookingUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-green-700 px-4 py-2.5 font-medium text-green-700 hover:bg-green-50"
          >
            Reserve on {bookingLabel} ↗
          </a>
        )}
      </div>

      <section>
        <h2 className="text-xl font-bold">Camper reviews</h2>
        {reviews.length === 0 ? (
          <p className="mt-2 text-stone-500">No reviews yet — be the first to review {f.name} on the map.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {reviews.map((r, i) => (
              <li key={i} className="rounded-lg border border-stone-200 p-3">
                {typeof r.stars === "number" && (
                  <p className="text-amber-500" aria-label={`${r.stars} out of 5 stars`}>
                    {"★".repeat(r.stars)}
                    {"☆".repeat(5 - r.stars)}
                  </p>
                )}
                {r.comment && <p className="mt-1 text-stone-700">{r.comment}</p>}
                <p className="mt-1 text-xs text-stone-400">{new Date(r.created_at).toLocaleDateString()}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
