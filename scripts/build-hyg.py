
#!/usr/bin/env python3
"""
Create Cosmoscope's deterministic HYG v4.1 stellar subset.

Usage:
  python3 scripts/build-hyg.py \
    /path/to/hygdata_v41.csv \
    public/data/hyg-v41.json

Source: Astronexus HYG v4.1
License: CC BY-SA 4.0
Coordinates: J2000 equatorial parsecs
"""

import csv
import gzip
import json
import math
import sys
from pathlib import Path

MAX_STARS = 2048
LOCAL_PC = 15.0
BRIGHT_MAG = 5.5


def number(s: str, default: float = math.nan) -> float:
    try:
        n = float(s)
        return n if math.isfinite(n) else default
    except (TypeError, ValueError):
        return default


def valid(raw: dict):
    dist = number(raw.get("dist", ""))
    mag = number(raw.get("mag", ""))

    if not (0 < dist < 100000 and math.isfinite(mag)):
        return None

    xyz = [number(raw.get(k, "")) for k in ("x", "y", "z")]

    if not all(math.isfinite(v) for v in xyz):
        return None

    try:
        hid = int(raw["id"])
    except (ValueError, KeyError):
        return None

    if hid <= 0:
        return None

    return hid, dist, mag, xyz


def compact(
    raw: dict,
    hid: int,
    dist: float,
    mag: float,
    xyz: list[float],
):
    def tidy(s: str | None) -> str:
        return (s or "").strip()

    named = tidy(raw.get("proper"))
    bf = tidy(raw.get("bf"))
    hip = tidy(raw.get("hip"))
    hd = tidy(raw.get("hd"))

    label = (
        named
        or bf
        or (f"HIP {hip}" if hip else "")
        or (f"HD {hd}" if hd else "")
        or f"HYG {hid}"
    )

    aliases = []

    for s in (
        bf,
        f"HIP {hip}" if hip else "",
        f"HD {hd}" if hd else "",
        f"HYG {hid}",
    ):
        if s and s != label and s not in aliases:
            aliases.append(s)

    return [
        hid,
        *(round(v, 5) for v in xyz),
        round(mag, 2),
        round(number(raw.get("ci", ""), 0.0), 3),
        tidy(raw.get("spect"))[:20],
        label,
        aliases,
        round(dist, 5),
    ]


def build(source: Path, destination: Path):
    picked = []

    with source.open(
        "r",
        encoding="utf-8-sig",
        newline="",
    ) as f:
        for raw in csv.DictReader(f):
            v = valid(raw)
            if not v:
                continue

            hid, dist, mag, xyz = v

            named = bool(
                (raw.get("proper") or "").strip()
            )

            near = dist <= LOCAL_PC
            bright = mag <= BRIGHT_MAG

            if not (near or bright or named):
                continue

            # Priority:
            # 0 nearest neighborhood
            # 1 named stars
            # 2 bright stars
            tier = 0 if near else 1 if named else 2

            picked.append((
                tier,
                dist if tier == 0 else mag,
                mag,
                hid,
                compact(raw, hid, dist, mag, xyz),
            ))

    picked.sort(
        key=lambda row: (
            row[0], row[1], row[2], row[3]
        )
    )

    rows = [
        item[4]
        for item in picked[:MAX_STARS]
    ]

    # Brightness sort lets the GPU use drawRange for LOD.
    rows.sort(
        key=lambda row: (row[4], row[0])
    )

    result = {
        "source": "HYG v4.1 (Astronexus)",
        "license": "CC BY-SA 4.0",
        "epoch": "J2000",
        "axes": "equatorial",
        "unit": "parsec",
        "columns": [
            "id", "x", "y", "z", "mag",
            "ci", "spect", "name",
            "aliases", "dist"
        ],
        "stars": rows,
    }

    destination.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    content = json.dumps(
        result,
        ensure_ascii=False,
        separators=(",", ":"),
    ) + "\n"

    destination.write_text(
        content,
        encoding="utf-8",
    )

    data = content.encode("utf-8")
    compressed = gzip.compress(
        data,
        compresslevel=9,
        mtime=0,
    )

    print(
        f"{len(rows)} stars; "
        f"JSON: {len(data):,} B; "
        f"gzip: {len(compressed):,} B"
    )

    near_count = sum(
        row[9] <= LOCAL_PC for row in rows
    )

    print(f"Nearby stars: {near_count}")

    return len(rows), len(data), len(compressed)


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3):
        print(__doc__.strip())
        sys.exit(2)

    build(
        Path(sys.argv[1]),
        Path(sys.argv[2])
        if len(sys.argv) == 3
        else Path("public/data/hyg-v41.json"),
    )
