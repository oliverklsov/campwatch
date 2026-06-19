import { NextResponse } from "next/server";

// Official RIDB facility media (photos). Proxied so the API key stays server-side.
// https://ridb.recreation.gov/docs -> Facility Media
export const dynamic = "force-dynamic";

type RidbMedia = {
  MediaType?: string;
  URL?: string;
  Title?: string;
  IsPrimary?: boolean;
};

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const url = `https://ridb.recreation.gov/api/v1/facilities/${params.id}/media?limit=12`;
  try {
    const res = await fetch(url, {
      headers: { apikey: process.env.RIDB_API_KEY!, accept: "application/json" },
      next: { revalidate: 86400 }, // images rarely change; cache a day
    });
    if (!res.ok) return NextResponse.json({ images: [] });
    const data = await res.json();
    const images = ((data.RECDATA ?? []) as RidbMedia[])
      .filter((m) => (m.MediaType ?? "").toLowerCase() === "image" && m.URL)
      .sort((a, b) => Number(b.IsPrimary) - Number(a.IsPrimary))
      .map((m) => ({ url: m.URL as string, title: m.Title ?? "" }));
    return NextResponse.json(
      { images },
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } }
    );
  } catch {
    return NextResponse.json({ images: [] });
  }
}
