# scripts/build-2mrs-web.py
"""Build the Cosmoscope cosmic-web sample from the 2MRS catalog.

Reads a 2MRS catalog shaped as CSV and writes the static sample JSON the
galaxies layer loads from public/data/. The layer does NO unit conversion:
this script owns the conversion, so the JSON is already in cosmic-frame
units (Mpc, ICRS axes) and the layer just passes positions to
camera.toCameraRelative() with frame 'cosmic'.

Input CSV columns (header row required):
  designation : catalog designation, e.g. "2MASX J004...". Kept verbatim
                in each point's "name"; the point "id" is the same string
                with spaces removed, under the galaxy:2mrs: segment
                (CONTRACTS, PR #19).
  ra_deg      : right ascension, degrees (J2000)
  dec_deg     : declination, degrees (J2000)
  z           : redshift
  k_mag       : apparent K-band magnitude (2MASS K_s)

Get the catalog from the CfA 2MRS page (download via SAO/TDC),
HEASARC's TWOMASSRSC table, or VizieR catalog J/ApJS/199/26, and shape
it to the columns above. Only the columns matter; extra columns are
ignored.

Cosmology (team standard): flat LCDM, H0 = 70 km/s/Mpc, Omega_m = 0.3.
Comoving distance is the exact integral, evaluated by Simpson's rule
(stdlib only — no numpy/astropy dependency, so anyone can run this).
At 2MRS redshifts (z <= 0.1) the Omega_m choice moves distances by
~2% at most, so it is immaterial for a visualization layer; it is
recorded in the output provenance header either way.

Selection (v1): 0.005 <= z <= 0.1, ranked by absolute K magnitude
(brightest first), top --max-points. The low-z cut excludes Local Group
objects; the bright cut keeps the file small and the web readable.
Absolute magnitude uses luminosity distance D_L = (1+z) * D_C:
  M_K = m_K - 5*log10(D_L) - 25   (D_L in Mpc)

Output JSON:
  { "provenance": {...}, "points": [
      { "id": "galaxy:2mrs:<designation>",
        "name": "<verbatim designation>",
        "xyz": [x, y, z],   # comoving ICRS Cartesian, Mpc
        "z": <redshift>,
        "mk": <absolute K magnitude> }, ... ] }

Usage:
  python3 scripts/build-2mrs-web.py --input 2mrs.csv \
      --output public/data/cosmic-web-2mrs.json
"""

import argparse
import csv
import json
import math
import sys

C_KM_S = 299792.458  # speed of light, km/s


def e_z(z, omega_m, omega_l):
    """Dimensionless Hubble parameter E(z) for flat LCDM."""
    return math.sqrt(omega_m * (1.0 + z) ** 3 + omega_l)


def comoving_mpc(z, h0, omega_m, steps=1000):
    """Comoving distance in Mpc for redshift z (exact integral, Simpson)."""
    if z <= 0:
        return 0.0
    omega_l = 1.0 - omega_m
    dh = C_KM_S / h0  # Hubble distance, Mpc
    n = steps if steps % 2 == 0 else steps + 1
    h = z / n
    total = 1.0 / e_z(0.0, omega_m, omega_l) + 1.0 / e_z(z, omega_m, omega_l)
    for i in range(1, n):
        weight = 4.0 if i % 2 == 1 else 2.0
        total += weight / e_z(i * h, omega_m, omega_l)
    return dh * total * h / 3.0


def icrs_xyz(ra_deg, dec_deg, dist_mpc):
    """RA/Dec + comoving distance -> ICRS Cartesian in Mpc (rounded)."""
    ra = math.radians(ra_deg)
    dec = math.radians(dec_deg)
    cd = math.cos(dec)
    return [
        round(dist_mpc * cd * math.cos(ra), 3),
        round(dist_mpc * cd * math.sin(ra), 3),
        round(dist_mpc * math.sin(dec), 3),
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--input", required=True, help="input 2MRS CSV")
    parser.add_argument("--output", required=True, help="output JSON path")
    parser.add_argument("--max-points", type=int, default=4000,
                        help="brightest N galaxies to keep (default 4000)")
    parser.add_argument("--z-min", type=float, default=0.005,
                        help="minimum redshift (default 0.005)")
    parser.add_argument("--z-max", type=float, default=0.1,
                        help="maximum redshift (default 0.1)")
    parser.add_argument("--h0", type=float, default=70.0,
                        help="Hubble constant km/s/Mpc (team standard: 70)")
    parser.add_argument("--omega-m", type=float, default=0.3,
                        help="matter density, flat LCDM (default 0.3)")
    args = parser.parse_args()

    rows = []
    skipped = 0
    with open(args.input, newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"designation", "ra_deg", "dec_deg", "z", "k_mag"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            sys.exit(f"input is missing columns: {sorted(missing)}")
        for row in reader:
            try:
                z = float(row["z"])
                k_mag = float(row["k_mag"])
                ra = float(row["ra_deg"])
                dec = float(row["dec_deg"])
            except (TypeError, ValueError):
                skipped += 1
                continue
            if not (args.z_min <= z <= args.z_max):
                skipped += 1
                continue
            dc = comoving_mpc(z, args.h0, args.omega_m)
            dl = (1.0 + z) * dc
            mk = k_mag - 5.0 * math.log10(dl) - 25.0
            rows.append({
                "designation": row["designation"].strip(),
                "ra": ra, "dec": dec, "z": z, "mk": mk, "dc": dc,
            })

    rows.sort(key=lambda r: r["mk"])  # brightest first (most negative M_K)
    chosen = rows[:args.max_points]

    points = []
    for row in chosen:
        clean = "".join(row["designation"].split())
        points.append({
            "id": f"galaxy:2mrs:{clean}",
            "name": row["designation"],
            "xyz": icrs_xyz(row["ra"], row["dec"], row["dc"]),
            "z": row["z"],
            "mk": round(row["mk"], 2),
        })

    output = {
        "provenance": {
            "source": "2MRS (Huchra et al. 2012), as supplied in the input CSV",
            "frame": "cosmic",
            "axes": "ICRS",
            "units": "Mpc",
            "cosmology": {
                "h0": args.h0,
                "omega_m": args.omega_m,
                "omega_l": round(1.0 - args.omega_m, 3),
                "flat": True,
            },
            "selection": {
                "z_min": args.z_min,
                "z_max": args.z_max,
                "ranked_by": "absolute K magnitude (brightest first)",
                "max_points": args.max_points,
            },
            "note": ("Positions are comoving ICRS Cartesian in Mpc. Ids "
                     "sanitize the designation (spaces removed); the verbatim "
                     "designation is kept in 'name'."),
        },
        "points": points,
    }
    with open(args.output, "w") as handle:
        json.dump(output, handle, separators=(",", ":"))

    if chosen:
        dc_min = min(r["dc"] for r in chosen)
        dc_max = max(r["dc"] for r in chosen)
        print(f"kept {len(points)} of {len(rows) + skipped} rows "
              f"({skipped} skipped); distance range "
              f"{dc_min:.1f}-{dc_max:.1f} Mpc; "
              f"M_K range {chosen[0]['mk']:.2f} to {chosen[-1]['mk']:.2f}")
    else:
        print(f"no rows passed the selection ({skipped} skipped)")


if __name__ == "__main__":
    main()
