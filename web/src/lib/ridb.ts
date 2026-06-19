// Authoritative reservation type from RIDB (official recreation.gov API).
// Each campsite carries CampsiteReservable; tallying them tells us whether a
// campground is fully reservable, fully first-come-first-served, or mixed —
// far more reliable than the facility-level static flag.

export type ResType = "reservable" | "fcfs" | "mixed" | "unknown";

export type ReservationType = {
  resType: ResType;
  reservableSites: number;
  fcfsSites: number;
  siteTotal: number;
};

export async function fetchReservationType(facilityId: string): Promise<ReservationType> {
  let reservableSites = 0;
  let fcfsSites = 0;
  let total = 0;
  try {
    // RIDB pages at 50; campgrounds are small enough to scan fully (cached a week).
    for (let offset = 0; offset < 1500; offset += 50) {
      const r = await fetch(
        `https://ridb.recreation.gov/api/v1/facilities/${facilityId}/campsites?limit=50&offset=${offset}`,
        { headers: { apikey: process.env.RIDB_API_KEY!, accept: "application/json" }, next: { revalidate: 604800 } }
      );
      if (!r.ok) break;
      const d = await r.json();
      const recs: any[] = d.RECDATA ?? [];
      total = Number(d.METADATA?.RESULTS?.TOTAL_COUNT ?? recs.length);
      for (const c of recs) {
        if (c.CampsiteReservable === true) reservableSites++;
        else if (c.CampsiteReservable === false) fcfsSites++;
      }
      if (recs.length < 50 || reservableSites + fcfsSites >= total) break;
    }
  } catch {
    /* fall through to whatever we tallied */
  }

  let resType: ResType;
  if (reservableSites > 0 && fcfsSites > 0) resType = "mixed";
  else if (fcfsSites > 0) resType = "fcfs";
  else if (reservableSites > 0) resType = "reservable";
  else resType = "unknown";

  return { resType, reservableSites, fcfsSites, siteTotal: total || reservableSites + fcfsSites };
}
