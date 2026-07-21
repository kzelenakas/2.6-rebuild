"""Live, radius-bounded lookups for adverse-influence proximity (airports, highways,
high-voltage transmission lines, commercial/industrial land use).

Kevin's call (2026-07-10, national-scope build): the subject property's address/
coordinates are not NPI or confidential, and storing a national geo dataset inside this
tool isn't practical at national scope. So this queries a public open-data API by
coordinate + small radius on each run instead of bundling/maintaining any dataset --
nothing is stored locally, ever.

Default provider: Overpass API (OpenStreetMap), free, no key required, one query covers
all four categories via OSM tags. Documented alternatives (not wired by default -- swap
`fetch` if one of these is preferred for a given deployment):
  - Airports: OurAirports public CSV (https://ourairports.com/data/airports.csv), FAA NASR
  - Highways: state DOT open-data GIS portals, in addition to OSM
  - Transmission lines: HIFLD Electric Power Transmission Lines
    (ArcGIS REST FeatureServer -- https://hifld-geoplatform.hub.arcgis.com/)
  - Commercial/industrial land use: county/city GIS parcel + zoning open-data portals

This operator makes a network call by design -- there's no XML field for "distance to
nearest airport." An external-call rule type already exists in this codebase's sibling
app (backend/app/rules/ai_backends.py's "ai" logic type calls an LLM backend), so an
I/O-boundary operator is an established shape here, not a new architecture.
"""
from __future__ import annotations

import json
import math
import urllib.error
import urllib.request
from typing import Callable

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# OSM tag filter per adverse-influence category. Each renders into an Overpass QL
# "around" clause bounded by the caller's radius -- never an unbounded/national query.
CATEGORY_TAGS: dict[str, str] = {
    "airport": '(way["aeroway"="aerodrome"](around:{r},{lat},{lon});'
    'node["aeroway"="aerodrome"](around:{r},{lat},{lon});)',
    "highway": 'way["highway"~"^(motorway|trunk|primary)$"](around:{r},{lat},{lon})',
    "high_voltage": 'way["power"="line"]["voltage"](around:{r},{lat},{lon})',
    "commercial_industrial": 'way["landuse"~"^(commercial|industrial)$"](around:{r},{lat},{lon})',
}


def haversine_ft(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in feet between two lat/lon points."""
    r_ft = 20925721.784777  # Earth's mean radius in feet
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return r_ft * 2 * math.asin(min(1.0, math.sqrt(a)))


def build_query(category: str, lat: float, lon: float, radius_m: int) -> str:
    if category not in CATEGORY_TAGS:
        raise ValueError(f"Unknown adverse-influence category: {category!r}")
    clause = CATEGORY_TAGS[category].format(r=radius_m, lat=lat, lon=lon)
    return f"[out:json][timeout:10];({clause};);out center;"


def nearest_distance_ft(
    lat: float,
    lon: float,
    category: str,
    radius_m: int = 500,
    fetch: Callable[[str], bytes] | None = None,
) -> float | None:
    """Nearest feature of `category` to (lat, lon) in feet, or None if nothing is within
    `radius_m` meters. `fetch(query) -> raw JSON bytes` is injectable so tests never hit
    the network -- defaults to a real Overpass POST."""
    query = build_query(category, lat, lon, radius_m)
    fetch = fetch or _http_fetch
    raw = fetch(query)
    data = json.loads(raw)
    best: float | None = None
    for el in data.get("elements", []):
        point = el.get("center") or el  # nodes carry lat/lon directly; ways use "center"
        elat, elon = point.get("lat"), point.get("lon")
        if elat is None or elon is None:
            continue
        dist = haversine_ft(lat, lon, elat, elon)
        if best is None or dist < best:
            best = dist
    return best


def _http_fetch(query: str) -> bytes:
    req = urllib.request.Request(
        OVERPASS_URL, data=f"data={query}".encode("utf-8"), method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.read()
    except urllib.error.URLError as exc:
        raise ConnectionError(f"Overpass API request failed: {exc}") from exc