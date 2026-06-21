# Yonder — Campsite Sources & Competitive Roadmap

_Research compiled June 20, 2026. Covers (1) new campsite data sources to expand beyond recreation.gov, and (2) a competitive feature analysis with a prioritized build list. Where this doc says "Easy/Medium/Hard," it's an integration-effort estimate, not a promise._

Yonder today: recreation.gov availability **alerts/watches**, a nationwide **dispersed map** (USFS MVUM vector tiles), user-submitted **spots + reviews + photos**, **campground reviews**, **lottery info on the map**, and **profiles/saved spots**. Planned-but-unbuilt: a **multi-night trip planner** and **more campsite sources**. Everything below is framed against that baseline.

---

## Part 1 — Expanding campsite sources

There are three distinct expansion plays, and they serve different goals:

- **Public / state reservation systems** → extends the **alerts** product into the state-park market (the biggest near-term coverage gain).
- **Private / commercial platforms** → mostly a **monetization** play (affiliate revenue), plus one real path to private real-time availability.
- **Free open datasets** → broadens the **map** (more campgrounds + better "is this legal?" data) with no licensing cost.

### A. Public / state reservation systems

The U.S. public-campground market runs on **three platform families**, each with a recognizable technical fingerprint that determines integration difficulty. Crucially, the systems share APIs _within_ a family — so one adapter unlocks many states.

| Platform family (owner) | Fingerprint | States/agencies (camping) | Integration |
|---|---|---|---|
| **recreation.gov** (Booz Allen) | official **RIDB API** | Federal: NPS, USFS, BLM, **USACE**, **Bureau of Reclamation**, **TVA**, FWS | ✅ Already integrated |
| **US eDirect / "Recreation Dynamics"** (Tyler Technologies/NIC) | `*.usedirect.com`, `*.tylerapp.com`; JSON `rdr/search/grid` POST | **California** (ReserveCalifornia), **Florida**, **Minnesota**, **Virginia**, **Ohio**, **Nevada**, Missouri, Alabama + some counties | **Easy** — one shared JSON pattern across all |
| **Camis / "GoingToCamp"** (Camis Inc.) | `*.goingtocamp.com`, `midnrreservations.com` | **Washington**, **Michigan**, Wisconsin, Maryland + most of Canada | **Medium** — real JSON API, SPA-backed |
| **Aspira / ReserveAmerica** (Aspira) | `<state>.reserveamerica.com`; legacy `.do` servlets | **Texas**, **New York**, **Pennsylvania**, **Oregon**, **Colorado**, **Utah**, Georgia, N. Carolina | **Hard** — CAPTCHA, anti-bot, ToS bans automation |

**The shortcut: two adapters cover the majority of high-demand state inventory.**

1. **US eDirect adapter** (`rdr/search/grid` JSON) → California, Florida, Minnesota, Virginia, Ohio, Nevada, Missouri, Alabama, and several counties. California alone is the largest state-park camping market in the country.
2. **Camis / GoingToCamp adapter** (JSON API) → Washington, Michigan, Wisconsin, Maryland. Washington added statewide same-day reservations in 2025 → lots of inventory churn, which is exactly what makes good alert fodder.

The **Aspira / ReserveAmerica bloc** (TX, NY, PA, OR, CO, UT, GA, NC) is the biggest remaining chunk of demand but also the hardest and most legally fraught — save it for last as a single third project.

**Recommended first-integration shortlist (demand × ease):** California → Florida → Washington → Minnesota → Virginia → Michigan → Ohio → (Texas, deferred).

**Reference implementation:** the open-source MIT-licensed **`camply`** project (github.com/juftin/camply) already implements recreation.gov, the full US eDirect/usedirect family, and GoingToCamp/Camis — study it for the exact request/response shapes rather than reverse-engineering from scratch.

**Legal / ToS reality (read carefully):** None of these systems offer Yonder an official public API except recreation.gov. The US eDirect and Camis JSON endpoints are undocumented but stable, and Yonder's use is **read-only availability alerting + mapping** — not booking or reselling, which is the behavior these systems actually enforce against (scalping bots). ReserveAmerica's ToS **explicitly prohibits automated access** and they deploy CAPTCHA, so it carries the highest risk. Recommended posture everywhere: never place bookings or hold inventory, rate-limit politely, and get a legal gut-check before taking on ReserveAmerica. Note there's precedent for a sanctioned path — California already shares ReserveCalifornia inventory with Hipcamp via an official partnership, so a partner feed may be negotiable for the highest-value systems.

### B. Private / commercial platforms

Mostly a monetization layer — most of these have no public availability API, but several have affiliate programs that turn Yonder's existing audience into revenue with zero engineering.

| Platform | Scale | Opportunity | Effort |
|---|---|---|---|
| **Hipcamp** | 10M+ users, private-land marketplace | **Affiliate** (Avantlink, 5%, 30-day cookie) — "Book on Hipcamp" links on map pins + alert emails | Easy |
| **Spot2Nite** | 265,000+ private RV sites, real-time availability, syndicates to ~12 OTAs | **Channel partnership** — the single best path to *private real-time availability* for the alerts product | Medium (business deal) |
| **Pitchup.com** | 70+ partners, US growing | **Free, documented public API** — lowest-friction OTA integration / proof-of-concept | Easy–Medium |
| **KOA** | 500+ locations | **Affiliate** (network-managed), strong brand; no data API | Easy |
| **Good Sam** | 12,500+ listed POIs | **Affiliate** via Rakuten (membership/roadside) | Easy |
| **Campspot** | 3,500+ parks | Online Booking API exists but **costs $7,500+** and is built for operators — reach this inventory via Spot2Nite instead | Skip (direct) |

**Skip:** Harvest Hosts / Boondockers Welcome (membership, referral-only, no API), Tentrr (shrinking, unreliable affiliate), AutoCamp / Sun Outdoors (closed owned portfolios).

**Net:** start with **Hipcamp + KOA + Good Sam affiliates** for immediate zero-engineering revenue (apply as a pure content/discovery publisher — Hipcamp bars PMS/host-affiliated applicants). Pursue **Spot2Nite** if/when you want to extend alerts into private campgrounds, and pilot **Pitchup's free API** as a low-risk first OTA integration.

### C. Free open datasets to broaden the map

Yonder already has recreation.gov (RIDB) + MVUM. The highest-value additions, all openly licensed:

- **RIDB — maximize what you already have.** The same free API already covers **Bureau of Reclamation** (549 campgrounds) and **USACE/Army Corps** (~2,400 campgrounds) sites — no separate ingestion needed for bookable federal inventory.
- **PAD-US 4.0 (USGS Protected Areas Database)** — authoritative national polygons of all public/protected land. This is the **"is this spot legal to camp on?" backbone** for validating and classifying dispersed pins. Free download + WMS/WFS services.
- **BLM Geospatial Business Platform Hub** — BLM recreation sites, surface-management boundaries, and travel/route data. Use it to power BLM dispersed camping the way MVUM powers USFS. (FreeRoam derives its accurate overlays from exactly these BLM + USGS sources.)
- **OpenStreetMap camping tags** (`tourism=camp_site`, `caravan_site`, `camp_pitch`) — fills informal/private sites the federal feeds miss. ODbL license = attribution + share-alike obligations.

**Use with caution / do NOT scrape:** **iOverlander** (personal-use only, not redistributable), **Campendium** and **The Dyrt** (no open API + direct competitors). **Ultimate Public Campground Project** (46,300+ public locations) is the one paid-but-worthwhile licensing conversation if you need a state/county coverage backstop.

**Recommended map stack:** RIDB (bookable federal) + PAD-US (legality polygons) + BLM GBP (BLM dispersed/boundaries) + OSM (informal fill) — the broadest legitimate coverage with no licensing risk.

---

## Part 2 — Competitive landscape

**Yonder's defensible position is the _combination_** of fast alerts + an MVUM-grade dispersed map + community. No single competitor does all three well:

- **Alert-only tools** (Campnab $10–90/mo, CampScanner, Campflare, Hipcamp, WildPermits) have no dispersed map or community. Note the market has **commoditized paid alerts**: Hipcamp now offers free, ~15-second alerts and Campflare is free forever. Yonder should treat alerts as one pillar, not a standalone paid product.
- **Discovery/map apps** (The Dyrt, Campendium, FreeRoam, iOverlander, Sēkr) own free/dispersed discovery but their alerts are weak or absent. **The Dyrt** is the closest all-in-one ($35.99/yr PRO bundles dispersed maps + offline + trip planner + alerts; 1M+ reviews is its moat) — but its alerts are thin and its MVUM/public-land layers are weaker than Gaia/onX.
- **Outdoor GPS apps** (Gaia GPS, onX Backcountry, AllTrails) are the technical benchmark for map layers (official MVUM, carrier cell-coverage, 3D, route building) but don't do campsite booking or alerts.

**The clearest white space:** a polished **multi-night backpacking trip planner** that stitches together an _itinerary of bookable sites/permits with live availability_ — genuinely unbuilt across the entire market (Gaia/onX/FarOut help you navigate a route, none assemble a bookable multi-night plan). That's Yonder's biggest potential differentiator, and it's already on the roadmap.

**Most urgent gap-closers** (table-stakes everywhere except Yonder): **cell-coverage layers** and **offline maps**.

---

## Part 3 — Prioritized development roadmap

| # | Feature | Why | Effort/Impact |
|---|---|---|---|
| 1 | **Flexible-date alert windows (±N days)** | Campnab's single most-loved feature; big hit-rate boost; pure logic on the existing scan engine | Quick win |
| 2 | **One-tap deep-link-to-book in alerts** | Closes the "we texted you, now scramble" gap; deep link into a pre-filtered rec.gov cart | Quick win |
| 3 | **Contributor reputation / gamified reviews** | The Dyrt's review moat is reputation-driven; deepens existing user content; cheap retention lever | Quick win |
| 4 | **Saved-spot collections + shareable trip links** | Low-effort virality on top of existing profiles/saved spots; organic acquisition | Quick win |
| 5 | **Add state sources (US eDirect adapter: CA, FL, MN, VA, OH)** | Biggest coverage gain; every serious alert tool covers these; one adapter = many states | Medium |
| 6 | **Cell-coverage map layer (by carrier)** | Table-stakes for dispersed/van users; overlay alongside MVUM tiles | Medium |
| 7 | **Public-land boundary layer (PAD-US / BLM)** | Dispersed legality depends on knowing whose land you're on; pairs with MVUM | Medium |
| 8 | **Permit/lottery cancellation alerts** | Natural extension of existing lottery-on-map + alert engine; steals WildPermits' niche; backpacker channel | Medium |
| 9 | **Drive-time "open this weekend near me" search** | No strong competitor in dispersed space; combine availability + free-camping + isochrone | Medium |
| 10 | **Weather + wildfire/smoke + road-condition overlay** | Rare in camping apps (only AllTrails/Roadtrippers); high trust/safety value; free gov APIs | Medium |
| 11 | **Camis/GoingToCamp adapter (WA, MI, WI, MD)** | Second state-source adapter; WA same-day churn is great alert fodder | Medium |
| 12 | **Hipcamp + KOA affiliate links** | Zero-engineering revenue from existing audience | Quick win (biz) |
| 13 | **Offline map downloads (MVUM + saved spots)** | #1 paywalled feature industry-wide; essential where dispersed users have no signal; subscription anchor | Big bet |
| 14 | **Multi-night backpacking trip planner** | The genuinely unbuilt category-first; ties alerts engine to itinerary nodes; strongest moat | Big bet |
| 15 | **Spot2Nite private-availability integration** | Extends alerts into the private-campground market rec.gov can't reach | Big bet (biz + eng) |

**Suggested sequencing:**

1. **Quick wins first (1–4, 12)** — sharpen the alert + community core that's already live, and turn on affiliate revenue.
2. **Map differentiators next (6, 7, 10)** — close the obvious table-stakes gaps with open-data layers.
3. **Coverage expansion (5, 11)** — the two state-source adapters that multiply addressable inventory.
4. **Premium tier / big bets (13, 14)** — offline maps and the trip planner are the hardest for single-feature competitors to match and the best justification for a subscription.

**Monetization thread:** affiliates (12) are free money now; offline maps + trip planner (13, 14) are the natural premium tier; alerts should stay cheap/free as the top-of-funnel hook since competitors have commoditized them.

---

## Sources

**State / public reservation systems**
- camply (open-source reference for rec.gov / usedirect / GoingToCamp endpoints) — https://github.com/juftin/camply · https://juftin.com/camply/providers/
- ReserveCalifornia + Hipcamp official data partnership — https://www.parks.ca.gov/NewsRelease/1012
- Tyler Technologies → ReserveCalifornia (Aug 2024) — https://statescoop.com/tyler-technologies-california-state-parks-digital-services/
- Tyler acquires US eDirect — https://www.govtech.com/biz/tyler-acquires-us-edirect-to-beef-up-recreation-management
- Florida State Parks → US eDirect — https://www.prnewswire.com/news-releases/florida-state-parks-adopts-new-reservation-and-point-of-sale-platform-focused-on-improved-visitor-experience-301311105.html
- Washington "Going to Camp" (Camis) + same-day expansion — https://washington.goingtocamp.com/ · https://parks.wa.gov/news/2025/state-parks-expands-same-day-camping-reservations-all-campgrounds
- ReserveAmerica / Aspira (Texas, NY, PA, OR, CO, UT, GA, NC) — https://en.wikipedia.org/wiki/ReserveAmerica · https://aspiraconnect.com/state-parks
- Anti-bot / ToS context — https://www.kqed.org/news/11450483/cant-get-that-camping-spot-it-could-be-bots
- recreation.gov RIDB API — https://ridb.recreation.gov/ · https://www.recreation.gov/use-our-data

**Private / commercial platforms + open data**
- Hipcamp affiliate program — https://support.hipcamp.com/hc/en-us/articles/20182550376724-Hipcamp-s-Affiliate-Marketing-Program
- Campspot Online Booking API (pricing) — https://support.campspot.com/online-booking-api
- Spot2Nite operators / channel network — https://partners.spot2nite.com/marketplace/
- Pitchup API docs — https://pitchup.docs.apiary.io/ · https://www.pitchup.com/integration/
- KOA affiliate — https://linkclicky.com/affiliate-program/kampgrounds-of-america/ · Good Sam affiliate — https://www.goodsam.com/affiliate
- Bureau of Reclamation recreation — https://www.usbr.gov/recreation/overview.html
- USGS PAD-US 4 — https://www.usgs.gov/data/protected-areas-database-united-states-pad-us-4
- BLM Geospatial Hub — https://gbp-blm-egis.hub.arcgis.com/
- OSM camping tags — https://wiki.openstreetmap.org/wiki/Tag:tourism=camp_site
- Ultimate Public Campground Project — https://www.ultimatecampgrounds.com/index.php/products/poi-list/poi-resources
- iOverlander licensing (personal-use only) — https://support.garmin.com/en-US/?faq=O82Xu3Qvc63AgF93l8Tho5

**Competitors / features**
- Campnab — https://campnab.com/faq · Campflare — https://campflare.com/
- CampScanner — https://www.campscanner.com/ · WildPermits — https://www.wildpermits.com/
- Hipcamp Alerts (~15s) — https://www.hipcamp.com/en-US/alerts · https://www.businesswire.com/news/home/20230828317407/en/Hipcamp-Partners-With-Campflare-To-Help-Campers-Snag-Reservations-at-Sold-Out-Public-Campgrounds
- The Dyrt PRO — https://thedyrt.com/pro · https://thedyrt.com/alerts
- Campendium / Roadpass — https://campendium.com/ · https://support.campendium.com/hc/en-us/articles/23574686004372-Campendium-Features-Now-in-Roadtrippers
- FreeRoam — https://northwestrving.com/freeroam-app-for-boondocking · Sēkr — https://vanlife.sekr.com/
- Gaia GPS layers + cell coverage — https://blog.gaiagps.com/enhanced-cell-coverage-maps/
- onX Backcountry — https://www.onxmaps.com/backcountry/app · AllTrails Peak — https://www.alltrails.com/press/alltrails-expands-membership-offering-with-alltrails-peak
- Roadtrippers — https://roadtrippers.com/rv/ · Recreation.gov app — https://www.recreation.gov/mobile-app
