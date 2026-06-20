"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import TabBar from "@/components/TabBar";

type SpotRef = { id: string; name: string; lat?: number; lng?: number; notes?: string | null } | null;
type Favorite = { created_at: string; dispersed_spots: SpotRef };
type Review = {
  stars: number | null;
  road_condition: string | null;
  cell_signal: string | null;
  crowding: string | null;
  comment: string | null;
  created_at: string;
  dispersed_spots: SpotRef;
};
type MySpot = { id: string; name: string; lat: number; lng: number; notes: string | null; created_at: string };
type CampgroundReview = {
  stars: number | null;
  comment: string | null;
  created_at: string;
  facility_id: string;
  facility_name: string | null;
};

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default function ProfilePage() {
  const supabase = createClient();
  const [email, setEmail] = useState<string | null>(null);
  const [joined, setJoined] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [spots, setSpots] = useState<MySpot[]>([]);
  const [cgReviews, setCgReviews] = useState<CampgroundReview[]>([]);
  const [photos, setPhotos] = useState<{ id: string; url: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        window.location.href = "/login";
        return;
      }
      setEmail(user.email ?? null);
      setJoined(user.created_at ?? null);
      const [favs, revs, mine, cg, phs] = await Promise.all([
        supabase
          .from("spot_favorites")
          .select("created_at, dispersed_spots(id,name,lat,lng,notes)")
          .eq("user_id", user.id),
        supabase
          .from("spot_ratings")
          .select("stars,road_condition,cell_signal,crowding,comment,created_at, dispersed_spots(id,name)")
          .eq("user_id", user.id),
        supabase
          .from("dispersed_spots")
          .select("id,name,lat,lng,notes,created_at")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("campground_reviews")
          .select("stars,comment,created_at,facility_id,facility_name")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
        supabase
          .from("spot_photos")
          .select("id,url")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
      ]);
      setFavorites((favs.data ?? []) as unknown as Favorite[]);
      setReviews((revs.data ?? []) as unknown as Review[]);
      setSpots((mine.data ?? []) as unknown as MySpot[]);
      setCgReviews((cg.data ?? []) as unknown as CampgroundReview[]);
      setPhotos((phs.data ?? []) as unknown as { id: string; url: string }[]);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-8 pb-24">
      <div>
        <h1 className="text-2xl font-bold">Profile</h1>
        {email && (
          <p className="text-sm text-stone-600">
            {email}
            {joined ? ` · member since ${fmtDate(joined)}` : ""}
          </p>
        )}
      </div>

      {loading ? (
        <p className="text-stone-500">Loading…</p>
      ) : (
        <>
          <Section title={`Saved spots (${favorites.length})`}>
            {favorites.length === 0 ? (
              <Empty>Tap ☆ Save on any dispersed spot to keep it here.</Empty>
            ) : (
              <div className="space-y-2">
                {favorites.map(
                  (f, i) =>
                    f.dispersed_spots && (
                      <Card
                        key={i}
                        title={f.dispersed_spots.name}
                        lat={f.dispersed_spots.lat}
                        lng={f.dispersed_spots.lng}
                        note={f.dispersed_spots.notes}
                      />
                    )
                )}
              </div>
            )}
          </Section>

          <Section title={`Your reviews (${reviews.length})`}>
            {reviews.length === 0 ? (
              <Empty>You haven&apos;t reviewed any spots yet.</Empty>
            ) : (
              <div className="space-y-2">
                {reviews.map((r, i) => (
                  <div key={i} className="rounded-lg border border-stone-200 bg-white p-3 text-sm">
                    <p className="font-medium">
                      {r.dispersed_spots?.name ?? "Spot"}{" "}
                      {r.stars ? <span className="text-amber-500">{"★".repeat(r.stars)}</span> : null}
                    </p>
                    <p className="text-xs text-stone-500">
                      {[
                        r.road_condition && `road: ${r.road_condition}`,
                        r.cell_signal && `cell: ${r.cell_signal}`,
                        r.crowding && `crowding: ${r.crowding}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {r.comment && <p className="mt-1 text-stone-700">{r.comment}</p>}
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title={`Campground reviews (${cgReviews.length})`}>
            {cgReviews.length === 0 ? (
              <Empty>Rate a campground from its map pin and it&apos;ll show here.</Empty>
            ) : (
              <div className="space-y-2">
                {cgReviews.map((r, i) => (
                  <div key={i} className="rounded-lg border border-stone-200 bg-white p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium">
                        {r.facility_name ?? "Campground"}{" "}
                        {r.stars ? <span className="text-amber-500">{"★".repeat(r.stars)}</span> : null}
                      </p>
                      <a
                        href={`https://www.recreation.gov/camping/campgrounds/${r.facility_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 text-xs font-medium text-green-700 hover:underline"
                      >
                        View ↗
                      </a>
                    </div>
                    {r.comment && <p className="mt-1 text-stone-700">{r.comment}</p>}
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title={`Your spots (${spots.length})`}>
            {spots.length === 0 ? (
              <Empty>Spots you add on the map show up here.</Empty>
            ) : (
              <div className="space-y-2">
                {spots.map((s) => (
                  <Card key={s.id} title={s.name} lat={s.lat} lng={s.lng} note={s.notes} />
                ))}
              </div>
            )}
          </Section>

          <Section title={`Your photos (${photos.length})`}>
            {photos.length === 0 ? (
              <Empty>Photos you add to spots show up here.</Empty>
            ) : (
              <div className="-mx-1 flex flex-wrap gap-2 px-1">
                {photos.map((p) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <a key={p.id} href={p.url} target="_blank" rel="noreferrer">
                    <img src={p.url} alt="spot photo" loading="lazy" className="h-24 w-32 rounded-lg object-cover" />
                  </a>
                ))}
              </div>
            )}
          </Section>
        </>
      )}

      <TabBar />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-400">{title}</h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-stone-200 p-3 text-sm text-stone-500">{children}</p>
  );
}

function Card({
  title,
  lat,
  lng,
  note,
}: {
  title: string;
  lat?: number;
  lng?: number;
  note?: string | null;
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{title}</p>
        {lat != null && lng != null && (
          <a
            href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-xs font-medium text-green-700 hover:underline"
          >
            Directions ↗
          </a>
        )}
      </div>
      {note && <p className="mt-1 text-sm text-stone-600">{note}</p>}
    </div>
  );
}
