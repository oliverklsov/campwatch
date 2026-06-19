#!/usr/bin/env python3
"""
Campsite availability poller — Phase 1.

Fetches availability for a recreation.gov campground, diffs against the last
snapshot, and reports newly available (site, date) openings that match your
watch window. Designed to run on a cron (every 5-30 min).

Usage:
    python poller.py --config config.json
    python poller.py --facility 232447 --start 2026-07-10 --end 2026-07-12

The unofficial endpoint this relies on:
    GET https://www.recreation.gov/api/camps/availability/campground/{id}/month
        ?start_date=YYYY-MM-01T00:00:00.000Z

It is undocumented and may change — all access goes through RecGovClient so a
schema change is a one-file fix.
"""

import argparse
import json
import random
import smtplib
import sys
import time
import urllib.request
import urllib.error
from datetime import date, datetime, timedelta
from email.mime.text import MIMEText
from pathlib import Path

BASE_URL = "https://www.recreation.gov/api/camps/availability/campground/{facility_id}/month"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
STATE_DIR = Path(__file__).parent / "state"

AVAILABLE_STATUSES = {"Available"}  # others: Reserved, Closed, NYR (not yet released), Open


# ---------------------------------------------------------------- data layer

class RecGovClient:
    """Single adapter around the unofficial availability endpoint."""

    def __init__(self, jitter_max_s: float = 2.0):
        self.jitter_max_s = jitter_max_s

    def fetch_month(self, facility_id: str, month_start: date) -> dict:
        """Return {campsite_id: {"site": str, "loop": str, "availabilities": {iso_date: status}}}."""
        params = f"?start_date={month_start.isoformat()}T00%3A00%3A00.000Z"
        url = BASE_URL.format(facility_id=facility_id) + params
        time.sleep(random.uniform(0.2, self.jitter_max_s))  # politeness jitter
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                payload = json.loads(resp.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 404:
                raise SystemExit(
                    f"Facility {facility_id} has no availability endpoint (404). "
                    "It may be first-come-first-served or a permit/POI listing, not a reservable campground."
                )
            raise
        return self._parse(payload)

    @staticmethod
    def _parse(payload: dict) -> dict:
        """Isolates schema assumptions. If rec.gov changes shape, fix here."""
        out = {}
        for cid, c in payload.get("campsites", {}).items():
            out[cid] = {
                "site": c.get("site", cid),
                "loop": c.get("loop", ""),
                "type": c.get("campsite_type", ""),
                "availabilities": {
                    d[:10]: status for d, status in c.get("availabilities", {}).items()
                },
            }
        return out


# ------------------------------------------------------------------- helpers

def months_covering(start: date, end: date):
    m = start.replace(day=1)
    while m <= end:
        yield m
        m = (m.replace(day=28) + timedelta(days=4)).replace(day=1)


def daterange(start: date, end: date):
    d = start
    while d <= end:  # end = last NIGHT, inclusive
        yield d
        d += timedelta(days=1)


def load_snapshot(path: Path) -> dict:
    if path.exists():
        return json.loads(path.read_text())
    return {}


def find_available(data: dict, start: date, end: date, site_filter: list[str]) -> set[tuple[str, str]]:
    """Return {(site_name, iso_date)} available within the window, honoring site filter."""
    wanted = {d.isoformat() for d in daterange(start, end)}
    hits = set()
    for c in data.values():
        if site_filter and c["site"] not in site_filter:
            continue
        for day, status in c["availabilities"].items():
            if day in wanted and status in AVAILABLE_STATUSES:
                hits.add((c["site"], day))
    return hits


def send_email(cfg: dict, subject: str, body: str) -> bool:
    e = cfg.get("email", {})
    if not e.get("enabled"):
        return False
    msg = MIMEText(body)
    msg["Subject"], msg["From"], msg["To"] = subject, e["from"], e["to"]
    with smtplib.SMTP(e["smtp_host"], e.get("smtp_port", 587)) as s:
        s.starttls()
        s.login(e["smtp_user"], e["smtp_password"])
        s.send_message(msg)
    return True


# ---------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description="Recreation.gov availability poller")
    ap.add_argument("--config", help="Path to config.json")
    ap.add_argument("--facility", help="Facility ID (e.g. 232447 = Upper Pines)")
    ap.add_argument("--start", help="First night, YYYY-MM-DD")
    ap.add_argument("--end", help="Last night, YYYY-MM-DD")
    ap.add_argument("--sites", help="Comma-separated site names to watch (default: any)")
    ap.add_argument("--no-state", action="store_true", help="Skip snapshot diffing; just report current availability")
    ap.add_argument("--debug", action="store_true", help="Print status breakdown for the window (diagnose zero-availability results)")
    ap.add_argument("--include-open", action="store_true",
                    help="Also treat 'Open' (first-come-first-served, not online-bookable) as available")
    args = ap.parse_args()

    cfg = json.loads(Path(args.config).read_text()) if args.config else {}
    facility = args.facility or cfg.get("facility_id")
    start = date.fromisoformat(args.start or cfg["start_date"]) if (args.start or cfg.get("start_date")) else None
    end = date.fromisoformat(args.end or cfg["end_date"]) if (args.end or cfg.get("end_date")) else None
    site_filter = (args.sites.split(",") if args.sites else cfg.get("sites", [])) or []
    if not (facility and start and end):
        ap.error("facility, start, and end are required (via flags or config)")

    client = RecGovClient()
    data = {}
    for m in months_covering(start, end):
        data.update(client.fetch_month(str(facility), m))
    if not data:
        raise SystemExit("Endpoint returned no campsites — facility may not be reservable, or schema changed.")

    if args.include_open:
        global AVAILABLE_STATUSES
        AVAILABLE_STATUSES = AVAILABLE_STATUSES | {"Open"}
    now_avail = find_available(data, start, end, site_filter)

    if args.debug:
        from collections import Counter
        wanted = {d.isoformat() for d in daterange(start, end)}
        counts = Counter(
            status
            for c in data.values()
            for day, status in c["availabilities"].items()
            if day in wanted
        )
        print(f"  debug: {len(data)} campsites parsed; status counts in window: {dict(counts) or 'NO DATES IN WINDOW'}")

    STATE_DIR.mkdir(exist_ok=True)
    snap_path = STATE_DIR / f"{facility}_{start}_{end}.json"
    prev_avail = set(map(tuple, load_snapshot(snap_path).get("available", []))) if not args.no_state else set()
    new_openings = now_avail - prev_avail
    gone = prev_avail - now_avail

    if not args.no_state:
        snap_path.write_text(json.dumps({
            "checked_at": datetime.now().isoformat(timespec="seconds"),
            "available": sorted(now_avail),
        }, indent=2))

    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] facility={facility} window={start}..{end} "
          f"sites={'any' if not site_filter else ','.join(site_filter)} | "
          f"available={len(now_avail)} new={len(new_openings)} gone={len(gone)}")

    if new_openings:
        lines = [f"  NEW: site {s} on {d}" for s, d in sorted(new_openings, key=lambda x: (x[1], x[0]))]
        book_url = f"https://www.recreation.gov/camping/campgrounds/{facility}"
        body = "\n".join(lines) + f"\n\nBook now: {book_url}"
        print(body)
        if send_email(cfg, f"Campsite open: {len(new_openings)} new at facility {facility}", body):
            print("  -> email sent")
    elif now_avail and args.no_state:
        for s, d in sorted(now_avail, key=lambda x: (x[1], x[0])):
            print(f"  AVAILABLE: site {s} on {d}")


if __name__ == "__main__":
    sys.exit(main())
