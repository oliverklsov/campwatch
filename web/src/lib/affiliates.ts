// Affiliate link helpers.
//
// The destination URLs are useful referrals on their own. Once you enroll in
// the Hipcamp (AvantLink) and KOA affiliate programs and get your tracking
// links, set these env vars to your network's click-redirect PREFIX — the part
// that ends in "...&url=" (we append the encoded destination):
//
//   NEXT_PUBLIC_HIPCAMP_AFFILIATE_WRAP=https://www.avantlink.com/click.php?tt=cl&mi=<merchant>&pw=<website>&url=
//   NEXT_PUBLIC_KOA_AFFILIATE_WRAP=...
//
// They're NEXT_PUBLIC (public redirect URLs, not secrets) so they work in both
// server components (campground pages) and client components (the map sheet).
// Accessed statically so Next inlines them into the client bundle.

const HIPCAMP_WRAP = process.env.NEXT_PUBLIC_HIPCAMP_AFFILIATE_WRAP;
const KOA_WRAP = process.env.NEXT_PUBLIC_KOA_AFFILIATE_WRAP;

// rel for paid/affiliate links — required by Google so they don't pass PageRank.
export const AFFILIATE_REL = "sponsored noopener noreferrer";

function applyWrap(dest: string, wrap?: string): string {
  return wrap ? `${wrap}${encodeURIComponent(dest)}` : dest;
}

/** Hipcamp camping search near a place (private land, glamping, etc.). */
export function hipcampSearchUrl(loc: { city?: string | null; state?: string | null; name?: string | null }): string {
  const q = [loc.city, loc.state].filter(Boolean).join(", ") || loc.name || "";
  const dest = `https://www.hipcamp.com/en-US/search?q=${encodeURIComponent(q)}`;
  return applyWrap(dest, HIPCAMP_WRAP);
}

/** KOA campground directory — sets the affiliate cookie; the user browses from there. */
export function koaUrl(): string {
  return applyWrap("https://koa.com/campgrounds/", KOA_WRAP);
}
