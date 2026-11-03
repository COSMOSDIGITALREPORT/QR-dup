#!/usr/bin/env python
"""Checks a labelled weight-display dataset and says whether it is enough to train on.

    python ml/validate_dataset.py                       # ml/dataset/labels.csv
    python ml/validate_dataset.py --labels other.csv
    python ml/validate_dataset.py --write-splits        # also writes splits.csv next to the labels

Exit status: 0 = valid and adequate for training, 2 = valid but not adequate yet,
1 = errors in the labels that must be fixed.

The adequacy limits below are the minimum for a FIRST training run to mean anything.
Meeting them does not promise a good model; missing them guarantees an unreliable one.
"""
import argparse
import csv
import os
import sys

from common import ENUMS, HERE, TRUTH_RE, image_path, read_labels, split_sessions

MIN = {
    "physical readable images": 300,
    "capture sessions": 6,
    "images per digit (each of 0-9 present in at least this many)": 30,
    "images with a decimal point": 60,
    "zero readings (0, 0.0, 0.000 ...)": 20,
    "images containing the digit 1": 40,
    "images with a repeated digit (00, 11 ...)": 40,
    "unreadable images (glare / blur / too far), for testing refusal": 40,
    "readable images in the test split": 45,
}


def check_rows(rows):
    errors, warnings = [], []
    seen = {}
    for r in rows:
        where = f"line {r['_line']} ({r['image']})"
        for col, allowed in ENUMS.items():
            if r[col] not in allowed:
                errors.append(f"{where}: {col}='{r[col]}' is not one of {sorted(allowed)}")
        if r["truth"] and not TRUTH_RE.match(r["truth"]):
            errors.append(f"{where}: truth='{r['truth']}' must be digits with at most one point, exactly as displayed")
        if not r["truth"] and r["readable"] == "yes" and r["display_type"] != "none":
            errors.append(f"{where}: readable=yes needs the truth filled in")
        if not r["session"]:
            errors.append(f"{where}: session is empty")
        if not os.path.isfile(image_path(r)):
            errors.append(f"{where}: image file not found")
        if r["image"] in seen:
            errors.append(f"{where}: same image as line {seen[r['image']]}")
        seen[r["image"]] = r["_line"]
        if r["source"] == "physical":
            v = r["verified_by"].lower()
            if not v:
                errors.append(f"{where}: verified_by is empty - how was the true weight established?")
            elif any(w in v for w in ("ocr", "app", "model", "predict", "decoder", "ml kit", "mlkit")):
                errors.append(f"{where}: verified_by='{r['verified_by']}' - the truth must not come from an OCR prediction")
        if r["truth"] and "." in r["truth"] and r["decimal_format"] in ("", "none"):
            warnings.append(f"{where}: truth has a decimal point but decimal_format is '{r['decimal_format']}'")
    return errors, warnings


def adequacy(rows, splits):
    phys = [r for r in rows if r["source"] == "physical"]
    ok = [r for r in phys if r["readable"] == "yes" and r["truth"]]
    digits = {d: sum(1 for r in ok if d in r["truth"]) for d in "0123456789"}
    have = {
        "physical readable images": len(ok),
        "capture sessions": len({r["session"] for r in phys}),
        "images per digit (each of 0-9 present in at least this many)": min(digits.values()) if ok else 0,
        "images with a decimal point": sum(1 for r in ok if "." in r["truth"]),
        "zero readings (0, 0.0, 0.000 ...)": sum(1 for r in ok if float(r["truth"]) == 0),
        "images containing the digit 1": digits["1"],
        "images with a repeated digit (00, 11 ...)": sum(1 for r in ok if any(a == b for a, b in zip(r["truth"].replace(".", ""), r["truth"].replace(".", "")[1:]))),
        "unreadable images (glare / blur / too far), for testing refusal": sum(1 for r in phys if r["readable"] == "no"),
        "readable images in the test split": sum(1 for r in ok if splits.get(r["session"]) == "test"),
    }
    return have, digits


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--labels", default=os.path.join(HERE, "dataset", "labels.csv"))
    ap.add_argument("--write-splits", action="store_true")
    args = ap.parse_args()

    rows = read_labels(args.labels)
    print(f"{args.labels}: {len(rows)} labelled image(s)")
    by_source = {}
    for r in rows:
        by_source[r["source"]] = by_source.get(r["source"], 0) + 1
    for s, n in sorted(by_source.items()):
        print(f"   {s:24s} {n}")

    errors, warnings = check_rows(rows)
    for w in warnings:
        print("warning:", w)
    for e in errors:
        print("ERROR:", e)
    if errors:
        print(f"\n{len(errors)} error(s). Fix the labels file and run again.")
        sys.exit(1)

    phys = [r for r in rows if r["source"] == "physical"]
    splits = split_sessions(phys) if phys else {}
    have, digits = adequacy(rows, splits)

    print("\nPhysical-scale data against the minimum for a first training run:")
    short = []
    for key, need in MIN.items():
        mark = "ok " if have[key] >= need else "LOW"
        if have[key] < need:
            short.append(key)
        print(f"   [{mark}] {have[key]:5d} / {need:<4d} {key}")
    if phys:
        print("   images containing each digit:", " ".join(f"{d}:{n}" for d, n in digits.items()))
        per = {}
        for r in phys:
            per.setdefault(splits[r["session"]], set()).add(r["session"])
        print("   sessions per split:", {k: len(v) for k, v in sorted(per.items())})
        types = {}
        for r in phys:
            types.setdefault(r["display_type"], set()).add(r["session"])
        for t, s in sorted(types.items()):
            note = "" if len(s) >= 2 else "   <- one session only: this type cannot be both trained and tested"
            print(f"   display type {t:12s} {len(s)} session(s){note}")

    if args.write_splits and phys:
        out = os.path.join(os.path.dirname(os.path.abspath(args.labels)), "splits.csv")
        with open(out, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["session", "split"])
            for s in sorted(splits):
                w.writerow([s, splits[s]])
        print(f"\nwrote {out}")

    if short:
        print("\nNOT ADEQUATE FOR TRAINING YET. Still needed: " + "; ".join(short) + ".")
        sys.exit(2)
    print("\nAdequate for a first training run.")


if __name__ == "__main__":
    main()
