#!/usr/bin/env python3
import csv
import glob
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
UNZIPPED = ROOT / "imports" / "notion_export_unzipped"
OUT_DIR = ROOT / "kb" / "errors"

def pick_col(headers, candidates):
  hmap = {h.replace("\ufeff","").strip().lower(): h for h in headers}
  for c in candidates:
    k = c.strip().lower()
    if k in hmap:
      return hmap[k]
  return None

def slugify(s: str) -> str:
  s = (s or "").strip().lower()
  s = re.sub(r'["“”]', "", s)
  s = re.sub(r"[^a-z0-9]+", "_", s)
  s = re.sub(r"_+", "_", s).strip("_")
  return s[:80] if s else "untitled"

def yaml_escape(s: str) -> str:
  # single-quote yaml safe
  return "'" + (s or "").replace("'", "''") + "'"

def main():
  OUT_DIR.mkdir(parents=True, exist_ok=True)

  csv_files = glob.glob(str(UNZIPPED / "**" / "*_all.csv"), recursive=True)
  if not csv_files:
    csv_files = glob.glob(str(UNZIPPED / "**" / "*.csv"), recursive=True)

  if not csv_files:
    raise SystemExit(f"No CSV found under {UNZIPPED}")

  # Pick the biggest CSV (usually the database export)
  csv_path = max(csv_files, key=lambda p: os.path.getsize(p))
  print("Using CSV:", csv_path)

  with open(csv_path, newline="", encoding="utf-8", errors="replace") as f:
    reader = csv.DictReader(f)
    headers = reader.fieldnames or []
    error_col = pick_col(headers, ["Error", "Error message", "Error Message", "SendCloud", "Error"])
    resolution_col = pick_col(headers, ["Resolution", "Fix", "Solution"])
    fc_col = pick_col(headers, ["FC", "Warehouse"])
    url_col = pick_col(headers, ["URL"])

    if not error_col:
      raise SystemExit(f"Missing required column 'Error' (or 'Error message'). CSV headers: {headers}")
    if not resolution_col:
      raise SystemExit(f"Missing required column 'Resolution'. CSV headers: {headers}")

    written = 0
    for i, row in enumerate(reader, start=1):
      err = (row.get(error_col) or "").strip()
      res = (row.get(resolution_col) or "").strip()
      fc = (row.get(fc_col) or "").strip() if fc_col else ""
      url = (row.get(url_col) or "").strip() if url_col else ""

      if not err or not res:
        continue

      _id = slugify(err)
      fname = OUT_DIR / f"{_id}.yml"

      patterns = []
      # Keep exact error as a pattern for exact-matching
      patterns.append(err)

      # Add a few helpful token fragments if present
      for tok in ["house_number", "company_name", "to_service_point", "postal", "city", "email", "phone", "weight", "sendcloud"]:
        if tok.lower() in err.lower():
          patterns.append(tok)

      # De-dupe patterns preserving order
      seen = set()
      patterns2 = []
      for ptn in patterns:
        k = ptn.strip().lower()
        if k and k not in seen:
          seen.add(k)
          patterns2.append(ptn)

      # Convert resolution into steps split by newlines or bullets
      steps = [x.strip(" -\t") for x in re.split(r"\r?\n+", res) if x.strip()]
      if not steps:
        steps = [res]

      y = []
      y.append(f"id: {yaml_escape(_id)}")
      y.append(f"title: {yaml_escape(err)}")
      y.append("patterns:")
      for ptn in patterns2[:8]:
        y.append(f"  - {yaml_escape(ptn)}")
      y.append("fixSteps:")
      for st in steps[:12]:
        y.append(f"  - {yaml_escape(st)}")
      if url:
        y.append("links:")
        y.append("  - label: 'Open resolution'")
        y.append(f"    url: {yaml_escape(url)}")
      if fc:
        y.append(f"fc: {yaml_escape(fc)}")

      fname.write_text("\n".join(y) + "\n", encoding="utf-8")
      written += 1

  print("Wrote YAML entries:", written)

if __name__ == "__main__":
  main()
