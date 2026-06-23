import type { MetadataRoute } from "next";
import { createServiceClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/seo";

// Regenerate the sitemap at most once a day.
export const revalidate = 86400;

type Row = { facility_id: string; state: string | null; updated_at: string | null };

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const db = createServiceClient();

  // Page through the whole catalog (select() caps at 1000/page).
  const rows: Row[] = [];
  const PAGE = 1000;
  for (let from = 0; from < 60000; from += PAGE) {
    const { data, error } = await db
      .from("facilities")
      .select("facility_id, state, updated_at")
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    rows.push(...(data as Row[]));
    if (data.length < PAGE) break;
  }

  const now = new Date();
  const states = [...new Set(rows.map((r) => r.state).filter(Boolean))] as string[];

  const staticPages: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/explore`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/lotteries`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
  ];

  const statePages: MetadataRoute.Sitemap = states.map((s) => ({
    url: `${SITE_URL}/camping/${s.toLowerCase()}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  const campgroundPages: MetadataRoute.Sitemap = rows.map((r) => ({
    url: `${SITE_URL}/campground/${encodeURIComponent(r.facility_id)}`,
    lastModified: r.updated_at ? new Date(r.updated_at) : now,
    changeFrequency: "weekly",
    priority: 0.5,
  }));

  return [...staticPages, ...statePages, ...campgroundPages];
}
