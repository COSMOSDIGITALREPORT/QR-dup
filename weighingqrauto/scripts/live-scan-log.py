#!/usr/bin/env python
"""Timing and results of live-scanner sessions, from the phone's log.

    python scripts/live-scan-log.py --expect 1.70 [--clear]

Reads the [LIVE] lines a debug build of the app writes to logcat while the live
scanner (LiveWeightScanner.jsx) is open: one per camera frame read, one when a
reading is captured. Each opening of the scanner is a session. Reports, per
session and overall:

  first     ms from opening the scanner to the first weight shown
  capture   ms from opening the scanner to the reading frozen for confirmation
  frames    frames read, how many the reader accepted, and every value shown
  read ms   time inside the native reader per frame; wall ms: per frame end to end
            (frame grab + reader + bridge)

A value shown that differs from --expect is reported as WRONG. Nothing on the
phone is changed; --clear only empties the log buffer first (then open the
scanner, scan, and run this again without --clear).
"""
import argparse
import json
import os
import subprocess
import sys

os.environ["MSYS_NO_PATHCONV"] = "1"


def pct(values, p):
    v = sorted(values)
    return v[min(len(v) - 1, int(round(p / 100 * (len(v) - 1))))] if v else None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--expect", help="the weight the display shows, exactly, e.g. 1.70")
    ap.add_argument("--clear", action="store_true", help="empty the phone's log buffer and exit")
    args = ap.parse_args()
    if args.clear:
        subprocess.run(["adb", "logcat", "-c"], check=True)
        print("log cleared - now open the live scanner and scan")
        return

    out = subprocess.run(["adb", "logcat", "-d", "-s", "ReactNativeJS:V"], capture_output=True, text=True,
                         encoding="utf-8", errors="replace").stdout
    sessions = []
    for line in out.splitlines():
        if "[LIVE] " not in line:
            continue
        body = line.split("[LIVE] ", 1)[1].strip()
        if body.startswith("START"):
            sessions.append({"frames": [], "captures": []})
        elif not sessions:
            continue
        elif body.startswith("CAPTURE "):
            sessions[-1]["captures"].append(json.loads(body[len("CAPTURE "):]))
        elif body.startswith("{"):
            sessions[-1]["frames"].append(json.loads(body))
    sessions = [s for s in sessions if s["frames"]]
    if not sessions:
        sys.exit("No [LIVE] lines in the log. Debug build + Metro, open the live scanner, then run this.")

    firsts, captures, reads, walls, wrong = [], [], [], [], 0
    n_frames = n_ok = 0
    for i, s in enumerate(sessions, 1):
        fr = s["frames"]
        first = next((f["first"] for f in fr if f.get("first") is not None), None)
        shown = sorted({f["shown"] for f in fr if f.get("shown")})
        bad = [v for v in shown if args.expect and v != args.expect]
        wrong += len(bad)
        cap = s["captures"][0]["since"] if s["captures"] else None
        oks = sum(1 for f in fr if f["ok"])
        n_frames += len(fr)
        n_ok += oks
        reads += [f["ms"] for f in fr if f.get("ms") is not None]
        walls += [f["wall"] for f in fr if f.get("wall") is not None]
        if first is not None:
            firsts.append(first)
        if cap is not None:
            captures.append(cap)
        reasons = {}
        for f in fr:
            if not f["ok"]:
                reasons[f["reason"]] = reasons.get(f["reason"], 0) + 1
        print(f"session {i}: {len(fr)} frames, {oks} read; first shown {first} ms; captured {cap} ms; "
              f"values shown {shown}{'  WRONG ' + str(bad) if bad else ''}; refusals {reasons}")

    print()
    within = sum(1 for f in firsts if f <= 1000)
    print(f"sessions: {len(sessions)}; first weight shown in {len(firsts)}; within 1000 ms: {within} "
          f"({100 * within / len(sessions):.0f}% of sessions)")
    print(f"first weight shown: median {pct(firsts, 50)} ms, p95 {pct(firsts, 95)} ms")
    print(f"captured for confirmation: median {pct(captures, 50)} ms, p95 {pct(captures, 95)} ms ({len(captures)} sessions)")
    print(f"per frame - reader: median {pct(reads, 50)} ms, p95 {pct(reads, 95)} ms; "
          f"end to end: median {pct(walls, 50)} ms, p95 {pct(walls, 95)} ms")
    print(f"frames read by the reader: {n_ok} of {n_frames} ({100 * n_ok / max(n_frames, 1):.0f}%)")
    if args.expect:
        print(f"values shown other than {args.expect}: {wrong}")
    sys.exit(1 if wrong else 0)


if __name__ == "__main__":
    main()
