#!/usr/bin/env python3
"""Cosmoscope GPT-6: HYG v4.1 -> 2,048-star JSON subset.

Usage:
  python3 scripts/build-hyg.py hygdata_v41.csv public/data/hyg-v41.json

Source: Astronexus HYG v4.1
License: CC BY-SA 4.0
Coordinates: J2000 equatorial XYZ in parsecs
"""

import csv
import gzip
import json
import math
import sys
from pathlib import Path

MAX_STARS = 2048
NEAR_PC = 15.0
BRIGHT_MAG = 5.5
NEAR_QUOTA = 950
BRIGHT_QUOTA = 900

SOURCE_URL = (
    "https://raw.githubusercontent.com/astronexus/HYG-Database/"
    "c7f7f883fe67/hyg/CURRENT/hygdata_v41.csv"
)

LANDMARKS = {
    "sirius", "vega", "proxima centauri", "rigil kentaurus",
    "toliman", "barnard's star", "polaris", "betelgeuse",
    "rigel", "deneb", "altair", "arcturus", "aldebaran",
    "antares", "spica", "capella", "canopus", "fomalhaut",
    "achernar", "procyon", "wolf 359",
}


def finite(raw: str | None, default: float = math.nan) -> float:
    try:
        v = float(raw or "")
        return v if math.isfinite(v) else default
    except ValueError:
        return default


def parse(raw: dict[str, str]):
    try:
        hyg_id = int(raw["id"])
    except (KeyError, ValueError):
        return None

    dist = finite(raw.get("dist"))
    mag = finite(raw.get("mag"))
    xyz = [finite(raw.get(axis)) for axis in ("x", "y", "z")]

    # HYG uses dist >= 100000 for missing/unreliable parallax.
    if not (hyg_id > 0 and 0 < dist < 100000 and math.isfinite(mag)):
        return None
    if not all(math.isfinite(v) for v in xyz):
        return None

    proper = (raw.get("proper") or "").strip()
    if not (dist <= NEAR_PC or mag <= BRIGHT_MAG or proper):
        return None

    bf, hip, hd = (
        (raw.get(k) or "").strip() for k in ("bf", "hip", "hd")
    )

    label = (
        proper or bf
        or (f"HIP {hip}" if hip else "")
        or (f"HD {hd}" if hd else "")
        or f"HYG {hyg_id}"
    )

    aliases = []
    for alias in (
        bf,
        f"HIP {hip}" if hip else "",
        f"HD {hd}" if hd else "",
        f"HYG {hyg_id}",
    ):
        if alias and alias != label and alias not in aliases:
            aliases.append(alias)

    row = [
        hyg_id,
        *(round(v, 8) for v in xyz),
        round(mag, 2),
        round(finite(raw.get("ci"), 0.0), 3),
        (raw.get("spect") or "").strip()[:20],
        label,
        aliases,
        round(dist, 8),
    ]

    return hyg_id, dist, mag, proper, row


def build(source: Path, output: Path):
    valid_rows = []

    with source.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        required = {
            "id", "x", "y", "z", "dist",
            "mag", "proper", "ci", "spect"
        }
        missing = required.difference(reader.fieldnames or [])
        if missing:
            raise ValueError(
                f"Not HYG v4.1 CSV; missing columns: {sorted(missing)}"
            )

        for raw in reader:
            item = parse(raw)
            if item is not None:
                valid_rows.append(item)

    if len(valid_rows) < MAX_STARS:
        raise ValueError(
            f"Expected {MAX_STARS} eligible stars; "
            f"got {len(valid_rows)}"
        )

    chosen: dict[int, tuple] = {}

    def add(items, limit: int):
        added = 0
        for star in items:
            if len(chosen) == MAX_STARS or added >= limit:
                break
            if star[0] not in chosen:
                chosen[star[0]] = star
                added += 1

    landmarks = sorted(
        (s for s in valid_rows if s[3].casefold() in LANDMARKS),
        key=lambda s: (s[2], s[0]),
    )
    nearby = sorted(
        (s for s in valid_rows if s[1] <= NEAR_PC),
        key=lambda s: (s[1], s[2], s[0]),
    )
    bright = sorted(
        (s for s in valid_rows if s[2] <= BRIGHT_MAG),
        key=lambda s: (s[2], s[1], s[0]),
    )
    named = sorted(
        (s for s in valid_rows if s[3]),
        key=lambda s: (s[2], s[0]),
    )

    # Reserve places for iconic, nearby and bright stars.
    add(landmarks, MAX_STARS)
    add(nearby, NEAR_QUOTA)
    add(bright, BRIGHT_QUOTA)

    # Fill remaining capacity, avoiding duplicate HYG IDs.
    add(named, MAX_STARS)
    add(nearby, MAX_STARS)
    add(bright, MAX_STARS)
    add(
        sorted(valid_rows, key=lambda s: (s[2], s[1], s[0])),
        MAX_STARS,
    )

    rows = [s[4] for s in chosen.values()]

    # Must be magnitude-sorted for the layer's drawRange LOD.
    rows.sort(key=lambda s: (s[4], s[0]))

    payload = {
        "source": "HYG v4.1, Astronexus / David Nash",
        "sourceUrl": SOURCE_URL,
        "license": "CC BY-SA 4.0",
        "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
        "modifications": (
            "Selected subset of 2048 stars, compact and rounded fields, "
            "Sun excluded"
        ),
        "epoch": "J2000",
        "axes": "equatorial",
        "unit": "parsec",
        "columns": [
            "id", "x", "y", "z", "mag",
            "ci", "spect", "name", "aliases", "dist"
        ],
        "stars": rows,
    }

    output.parent.mkdir(parents=True, exist_ok=True)

    content = json.dumps(
        payload, ensure_ascii=False, separators=(",", ":")
    ) + "\n"

    output.write_text(content, encoding="utf-8")

    raw_bytes = content.encode("utf-8")
    compressed = gzip.compress(
        raw_bytes, compresslevel=9, mtime=0
    )

    names = {s[7].casefold() for s in rows}

    print(f"{len(rows)} stars")
    print(f"JSON: {len(raw_bytes):,} bytes")
    print(f"Gzip: {len(compressed):,} bytes")
    print(
        "Within 15 pc:",
        sum(s[9] <= NEAR_PC for s in rows)
    )
    print(
        "Proper-name entries:",
        sum(s[0] in chosen for s in named)
    )
    print(
        "Landmarks included:",
        ", ".join(sorted(names & LANDMARKS)) or "none"
    )


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3):
        raise SystemExit(__doc__)

    build(
        Path(sys.argv[1]),
        Path(sys.argv[2]) if len(sys.argv) == 3
        else Path("public/data/hyg-v41.json"),
    )
