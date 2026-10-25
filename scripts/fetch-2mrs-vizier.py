# scripts/fetch-2mrs-vizier.py
"""Fetch the 2MRS catalog (Huchra et al. 2012, VizieR J/ApJS/199/26 table3)
and write the CSV that scripts/build-2mrs-web.py reads.

Columns: designation (2MASS XSC id, verbatim), ra_deg, dec_deg,
z (= cz / c, barycentric), k_mag (extinction-corrected Ks, Kcmag).
Rows without a redshift are dropped. Stdlib only.

Usage:
  python3 scripts/fetch-2mrs-vizier.py --output 2mrs.csv
  python3 scripts/build-2mrs-web.py --input 2mrs.csv \
      --output public/data/cosmic-web-2mrs.json
"""

import argparse
import csv
import urllib.request

C_KM_S = 299792.458
URL = (
    "https://vizier.cds.unistra.fr/viz-bin/asu-tsv?"
    "-source=J/ApJS/199/26/table3&-out.max=unlimited"
    "&-out=ID,RAJ2000,DEJ2000,Kcmag,cz&cz=%3E0"
)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    with urllib.request.urlopen(URL, timeout=300) as resp:
        text = resp.read().decode("utf-8")
    rows = [line.split("\t") for line in text.splitlines()
            if line.strip() and not line.startswith("#")]
    # rows[0] header, rows[1] units, rows[2] dashes
    kept = 0
    with open(args.output, "w", newline="") as f:
        out = csv.writer(f)
        out.writerow(["designation", "ra_deg", "dec_deg", "z", "k_mag"])
        for r in rows[3:]:
            if len(r) != 5 or not r[4].strip() or not r[3].strip():
                continue
            out.writerow([r[0].strip(), r[1].strip(), r[2].strip(),
                          repr(int(r[4]) / C_KM_S), r[3].strip()])
            kept += 1
    print(f"wrote {kept} rows to {args.output}")


if __name__ == "__main__":
    main()
