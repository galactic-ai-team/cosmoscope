#!/usr/bin/env python3
"""Build Cosmoscope's static confirmed-exoplanet system catalog.

Usage:
    python3 scripts/build-exoplanets.py
    python3 scripts/build-exoplanets.py --input nasa-pscomppars.csv
    python3 scripts/build-exoplanets.py --max-hosts 600

Output:
    public/data/exoplanet-systems.json

Source: NASA Exoplanet Archive, pscomppars (confirmed planets).
Coordinates: Sun-centered ICRS/J2000 equatorial XYZ, parsecs.
No runtime NASA requests, API keys, or third-party packages.

Host coordinates are derived from RA/Dec and distance rather than
copied from HYG. They use the same axes and units as Cosmoscope.
"""

import argparse
import csv
import io
import json
import math
import re
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

SOURCE = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"

COLUMNS = (
    "hostname", "pl_name", "ra", "dec", "sy_dist",
    "pl_orbper", "pl_orbsmax", "pl_rade", "pl_bmasse",
    "sy_snum",
)

QUERY = f"SELECT {','.join(COLUMNS)} FROM pscomppars"

SOURCE_URL = SOURCE + "?" + urllib.parse.urlencode({
    "query": QUERY,
    "format": "csv",
})

DEFAULT_OUTPUT = Path("public/data/exoplanet-systems.json")
DEFAULT_MAX_HOSTS = 600

# A few useful exploration landmarks are included when their
# positions are valid. Actual membership depends on the download.
LANDMARKS = {
    "proxima cen",
    "proxima centauri",
    "trappist-1",
    "tau cet",
    "tau ceti",
    "51 peg",
    "kepler-186",
    "kepler-22",
    "kepler-452",
    "kepler-90",
    "toi-700",
    "lhs 1140",
    "gj 1214",
    "gj 667 c",
    "hd 209458",
    "hr 8799",
}

def number(value):
    try:
        x = float(value)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def positive(value):
    x = number(value)
    return x if x is not None and x > 0 else None


def rounded(value, digits=6):
    return None if value is None else round(value, digits)


def host_id(hostname):
    # Match JavaScript encodeURIComponent for common designations.
    safe = "-_.!~*'()"
    return "exo:" + urllib.parse.quote(hostname, safe=safe)


def icrs_xyz(ra_deg, dec_deg, distance_pc):
    """Equatorial unit vector multiplied by parallax distance in pc."""
    ra = math.radians(ra_deg)
    dec = math.radians(dec_deg)
    c = math.cos(dec)
    return [
        distance_pc * c * math.cos(ra),
        distance_pc * c * math.sin(ra),
        distance_pc * math.sin(dec),
    ]


def fetch_csv():
    request = urllib.request.Request(
        SOURCE_URL,
        headers={
            "User-Agent": "Cosmoscope-static-exoplanet-builder/1.0",
            "Accept": "text/csv",
        },
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        return response.read().decode("utf-8-sig")


def parse_csv(text):
    reader = csv.DictReader(io.StringIO(text))
    missing = set(COLUMNS) - set(reader.fieldnames or [])
    if missing:
        raise ValueError(
            "NASA CSV missing columns: " + ", ".join(sorted(missing))
        )

    groups = defaultdict(list)

    for row in reader:
        host = (row.get("hostname") or "").strip()
        planet = (row.get("pl_name") or "").strip()
        ra = number(row.get("ra"))
        dec = number(row.get("dec"))
        dist = positive(row.get("sy_dist"))

        if not host or not planet or ra is None or dec is None:
            continue
        if dist is None or dist >= 100000:
            continue
        if not (0 <= ra < 360 and -90 <= dec <= 90):
            continue

        groups[host].append({
            "name": planet,
            "ra": ra,
            "dec": dec,
            "distancePc": dist,
            "periodDays": positive(row.get("pl_orbper")),
            "semiMajorAu": positive(row.get("pl_orbsmax")),
            "radiusEarth": positive(row.get("pl_rade")),
            "massEarth": positive(row.get("pl_bmasse")),
            "starCount": positive(row.get("sy_snum")),
        })

    return groups


def build_payload(source_text, max_hosts=DEFAULT_MAX_HOSTS):
    groups = parse_csv(source_text)
    systems = []

    for hostname, rows in groups.items():
        # Multiple planets should share one host location.
        # Use the first valid location and omit grossly inconsistent
        # positions, rather than averaging incompatible astrometry.
        anchor = rows[0]
        ra = anchor["ra"]
        dec = anchor["dec"]
        distance = anchor["distancePc"]

        planets = []
        seen = set()

        for row in sorted(rows, key=lambda p: p["name"].casefold()):
            if row["name"].casefold() in seen:
                continue

            if abs(row["distancePc"] - distance) > max(
                1.0, distance * 0.1
            ):
                continue

            # Reject distinct positions from a bad/corrupt CSV.
            if abs(row["dec"] - dec) > 0.1:
                continue
            dra = abs(row["ra"] - ra)
            if min(dra, 360 - dra) > 0.1:
                continue

            seen.add(row["name"].casefold())
            planets.append({
                "name": row["name"],
                "periodDays": rounded(row["periodDays"]),
                "semiMajorAu": rounded(row["semiMajorAu"]),
                "radiusEarth": rounded(row["radiusEarth"]),
                "massEarth": rounded(row["massEarth"]),
            })

        if not planets:
            continue

        xyz = icrs_xyz(ra, dec, distance)

        systems.append({
            "id": host_id(hostname),
            "hostname": hostname,
            "positionPc": [round(v, 9) for v in xyz],
            "distancePc": round(distance, 9),
            "raDeg": round(ra, 8),
            "decDeg": round(dec, 8),
            "starCount": int(anchor["starCount"] or 1),
            "planets": planets,
        })

    # Prioritize recognizable systems, nearby systems, and
    # multi-planet systems while retaining deterministic output.
    systems.sort(key=lambda s: (
        0 if s["hostname"].casefold() in LANDMARKS else 1,
        0 if s["distancePc"] <= 50 else 1,
        -len(s["planets"]),
        s["distancePc"],
        s["hostname"].casefold(),
    ))

    selected = systems[:max_hosts]

    # Sort the on-disk file by stable ID, not input-row order.
    selected.sort(key=lambda s: s["id"])

    return {
        "schemaVersion": 1,
        "source": "NASA Exoplanet Archive",
        "sourceUrl": SOURCE_URL,
        "table": "pscomppars",
        "license": "NASA Exoplanet Archive data; cite source",
        "epoch": "J2000",
        "axes": "equatorial",
        "unit": "parsec",
        "notes": (
            "Confirmed exoplanets with usable host coordinates. "
            "Orbits shown in Cosmoscope are schematic unless full "
            "orbital elements and reference epochs are available. "
            "Missing physical values are null, not invented."
        ),
        "systems": selected,
    }


def build(source, output, max_hosts):
    if not 1 <= max_hosts <= 10000:
        raise ValueError("--max-hosts must be between 1 and 10000")

    text = (
        source.read_text(encoding="utf-8-sig")
        if source is not None
        else fetch_csv()
    )

    payload = build_payload(text, max_hosts)

    if not payload["systems"]:
        raise ValueError("No usable exoplanet systems found")

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(
            payload,
            ensure_ascii=False,
            separators=(",", ":"),
        ) + "\n",
        encoding="utf-8",
    )

    count = sum(
        len(s["planets"]) for s in payload["systems"]
    )

    print(f"NASA systems: {len(payload['systems'])}")
    print(f"Confirmed planets: {count}")
    print(f"Output: {output}")
    print(f"Bytes: {output.stat().st_size:,}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input",
        type=Path,
        help="Optional local pscomppars CSV; otherwise download from NASA",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
    )
    parser.add_argument(
        "--max-hosts",
        type=int,
        default=DEFAULT_MAX_HOSTS,
    )
    args = parser.parse_args()
    build(args.input, args.output, args.max_hosts)


if __name__ == "__main__":
    main()
