#!/usr/bin/env python
"""On-device check of the weight OCR.

Runs images through the app's own photo pipeline ON THE CONNECTED PHONE (seven-segment
reader + the four ML Kit passes, plus PaddleOCR for comparison) and reports what each
engine returned.

Two modes:

    python scripts/ocr-device-check.py
        Regression: every image in test-fixtures/seven-segment/device_manifest.tsv,
        compared with what the app is expected to do with it.

    python scripts/ocr-device-check.py --labels ml/dataset/labels.csv --json out.json
        Measurement: every image of a labelled dataset; the raw answer of each engine
        is written to out.json for ml/evaluate.py. No pass/fail is decided here.

    python scripts/ocr-device-check.py --live EXPECTED IMAGE_OR_DIR ...
        Live-reader timing: only the native seven-segment reader, called as the live
        scanner calls it, three times per image. Reports each answer against EXPECTED
        (e.g. 1.70) and the time the phone measured inside the reader (median, p95).

Options:  --raw   also print each engine's raw output
          --json  write per-image engine answers to this file (either mode)

Needs: a debug build of the app installed (it contains the development-only harness,
src/dev/ocrFixtureHarness.js), Metro running, and the phone connected over USB with
debugging allowed. If `adb devices` shows nothing although the phone is plugged in,
run `adb kill-server` then `adb start-server`.

Nothing is saved by the app, no weight is recorded and no network request is made by
this check. The copied images are removed from the phone afterwards. In regression mode
the exit status is 0 only when no image was read as a WRONG value.
"""
import argparse
import csv
import json
import os
import re
import subprocess
import sys
import tempfile
import time

APP = "com.weighingqrauto"
HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES = os.path.join(HERE, "..", "test-fixtures", "seven-segment")
os.environ["MSYS_NO_PATHCONV"] = "1"   # Git Bash must not rewrite /data/... paths


def adb(*args, check=True):
    r = subprocess.run(["adb", *args], capture_output=True, text=True, encoding="utf-8", errors="replace")
    if check and r.returncode != 0:
        sys.exit(f"adb {' '.join(args)} failed: {r.stderr.strip() or r.stdout.strip()}")
    return r.stdout


def manifest():
    """[(absolute path, shown name, expected, kind)] from the regression manifest."""
    rows = []
    for line in open(os.path.join(FIXTURES, "device_manifest.tsv"), encoding="utf-8"):
        if not line.strip() or line.startswith("#"):
            continue
        path, expected, kind = line.rstrip("\n").split("\t")[:3]
        rows.append((os.path.join(FIXTURES, path), path, expected, kind))
    return rows


def labelled(path):
    """[(absolute path, shown name, None, source)] from a dataset labels file."""
    base = os.path.dirname(os.path.abspath(path))
    rows = []
    with open(path, newline="", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            if (r.get("image") or "").strip():
                rows.append((os.path.normpath(os.path.join(base, r["image"].strip())), r["image"].strip(), None, (r.get("source") or "").strip()))
    return rows


def same(expected, got, final):
    """expected: a number, REJECT, ZERO, or alternatives joined by '|'."""
    for option in expected.split("|"):
        if option == "ZERO":
            if final == "REJECT:zero":
                return True
        elif option == "REJECT":
            if got == "REJECT":
                return True
        elif got != "REJECT" and float(option) == float(got):
            return True
    return False


def engine_answers(r):
    """What each engine said about one image, as text: a number, or REJECT:<why>.

    segment  the seven-segment reader's digits, exactly as it returned them
    mlkit    ML Kit by itself: the value at least two of its four passes agreed on, with
             no pass reading a different one (the rule the app applies to it)
    paddle   PaddleOCR by itself: accepted only when its whole output is one clean number
             with an optional kg / g, nothing else
    app      what the app would offer the user for this photo
    auto     the same photo with the display found automatically instead of read whole:
             {mode, final, found, box, cutOff, tooSmall, tried, ms}. mode auto = found and
             read without asking; retake / manual = the user is asked (never a value)
    """
    passes = r.get("passes") or []
    seg = passes[0].replace("segment: ", "") if passes else ""
    m = re.match(r"^(\d+(?:\.\d+)?) \((\w+)\)$", seg)
    segment = m.group(1) if m else "REJECT:" + (seg.split(" ")[0] or "no-output")

    values = []
    for p in passes[1:]:
        v = re.match(r"^[\w-]+: (\d+(?:\.\d+)?)kg ", p)
        if v:
            values.append(v.group(1))
    distinct = {float(v) for v in values}
    if len(distinct) == 1 and len(values) >= 2:
        mlkit = values[0]
    elif len(distinct) > 1:
        mlkit = "REJECT:passes-disagree"
    else:
        mlkit = "REJECT:" + ("single-pass" if values else "nothing-read")

    paddle_raw = r.get("paddle") or {}
    text = " ".join(str(paddle_raw.get("text", "")).split())
    pm = re.match(r"^(\d+(?:\.\d+)?) ?(kg|g)?$", text, re.I)
    if "error" in paddle_raw:
        paddle = "REJECT:error"
    elif pm:
        value = float(pm.group(1)) / (1000 if (pm.group(2) or "").lower() == "g" else 1)
        paddle = pm.group(1) if (pm.group(2) or "").lower() != "g" else repr(value)
    else:
        paddle = "REJECT:" + ("nothing-read" if not text else "not-a-clean-number")

    return {
        "app": r.get("final", "REJECT:no-output"),
        "auto": r.get("auto"),
        "segment": segment,
        "mlkit": mlkit,
        "paddle": paddle,
        "ms_app": r.get("ms"),
        "ms_paddle": paddle_raw.get("ms"),
        "paddle_confidence": paddle_raw.get("confidence"),
        "raw": {"passes": passes, "paddle_text": paddle_raw.get("text", paddle_raw.get("error", ""))},
    }


def run_on_phone(rows, prefix=""):
    if "device" not in adb("devices").split("\n", 1)[1]:
        sys.exit("No authorised phone connected (adb devices). Plug it in, allow USB debugging, "
                 "or run `adb kill-server` then `adb start-server`.")
    missing = [name for path, name, _, _ in rows if not os.path.isfile(path)]
    if missing:
        sys.exit("Image file(s) not found: " + ", ".join(missing[:5]))

    # Images are copied under a numbered name so the log lines map back to the rows.
    stage = tempfile.mkdtemp(prefix="ocrfix_")
    for i, (path, _, _, _) in enumerate(rows):
        ext = os.path.splitext(path)[1]
        with open(path, "rb") as src, open(os.path.join(stage, f"{prefix}{i:04d}{ext}"), "wb") as dst:
            dst.write(src.read())
    adb("shell", "rm -rf /data/local/tmp/ocr_fixtures")
    adb("push", stage, "/data/local/tmp/ocr_fixtures")
    adb("shell", f"chmod -R a+rX /data/local/tmp/ocr_fixtures; am force-stop {APP}; "
                 f"run-as {APP} sh -c 'rm -rf cache/ocr_fixtures; mkdir -p cache/ocr_fixtures; "
                 f"cp /data/local/tmp/ocr_fixtures/* cache/ocr_fixtures/'")
    adb("reverse", "tcp:8081", "tcp:8081", check=False)
    adb("logcat", "-G", "16M", check=False)
    adb("logcat", "-c")
    adb("shell", "input keyevent KEYCODE_WAKEUP")
    # `monkey` sometimes exits non-zero without launching anything; start the activity directly
    # and only fall back to it.
    started = adb("shell", f"am start -n {APP}/.MainActivity", check=False)
    if "Error" in started or not started.strip():
        adb("shell", f"monkey -p {APP} -c android.intent.category.LAUNCHER 1", check=False)

    print(f"Running {len(rows)} images on the phone ...")
    lines = []
    deadline = time.time() + 120 + (4 if prefix else 12) * len(rows)
    try:
        while time.time() < deadline:
            time.sleep(5)
            out = adb("logcat", "-d", "-s", "ReactNativeJS:V")
            lines = [l.split("[OCRFIX] ", 1)[1] for l in out.splitlines() if "[OCRFIX] " in l]
            if any(l.startswith(("DONE", "FAILED")) for l in lines):
                break
        else:
            sys.exit("Timed out. Is Metro running, and is this a debug build with the harness?")
    finally:
        adb("shell", f"am force-stop {APP}; run-as {APP} rm -rf cache/ocr_fixtures; rm -rf /data/local/tmp/ocr_fixtures", check=False)

    results = {}
    for l in lines:
        if l.startswith("{"):
            r = json.loads(l)
            results[int(os.path.splitext(r["file"])[0][len(prefix):])] = r
    return results


def live_mode(expected, paths):
    rows = []
    for a in paths:
        if os.path.isdir(a):
            rows += [(os.path.join(a, f), f, expected, "") for f in sorted(os.listdir(a))
                     if f.lower().endswith((".jpg", ".jpeg", ".png"))]
        else:
            rows.append((a, os.path.basename(a), expected, ""))
    results = run_on_phone(rows, prefix="L_")
    first, warm, tally = [], [], {"PASS": 0, "refused": 0, "WRONG": 0, "not run": 0}
    print(f"\n{'image':44s} answers (3 runs)                     reader ms")
    for i, (_, name, _, _) in enumerate(rows):
        r = results.get(i)
        if r is None:
            tally["not run"] += 1
            print(f"{name[:44]:44s} (no output)")
            continue
        runs = r["runs"]
        texts = [x.get("text") or ("REJECT:" + str(x.get("reason") or x.get("error"))) for x in runs]
        ms = [x.get("ms") for x in runs if x.get("ms") is not None]
        if ms:
            first.append(ms[0])
            warm += ms[1:]
        t = texts[-1]
        verdict = "PASS" if t == expected else ("refused" if t.startswith("REJECT") else "WRONG")
        if any(not x.startswith("REJECT") and x != expected for x in texts):
            verdict = "WRONG"
        tally[verdict] += 1
        detail = (runs[-1].get("detail") or "")[:40]
        print(f"{name[:44]:44s} {verdict:7s} {t:22s} {detail:40s} {ms}")

    def pct(v, p):
        v = sorted(v)
        return v[min(len(v) - 1, int(round(p / 100 * (len(v) - 1))))] if v else None
    print(f"\n{tally}")
    print(f"reader time on the phone, first call per image: median {pct(first, 50)} ms, p95 {pct(first, 95)} ms")
    print(f"reader time on the phone, repeat calls:        median {pct(warm, 50)} ms, p95 {pct(warm, 95)} ms")
    sys.exit(1 if tally["WRONG"] or tally["not run"] else 0)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--labels", help="measure a labelled dataset instead of the regression manifest")
    ap.add_argument("--json", help="write each engine's answer per image to this file")
    ap.add_argument("--raw", action="store_true")
    ap.add_argument("--live", nargs="+", metavar=("EXPECTED", "IMAGE"))
    args = ap.parse_args()
    if args.live:
        return live_mode(args.live[0], args.live[1:])

    rows = labelled(args.labels) if args.labels else manifest()
    if not rows:
        sys.exit("No images listed - nothing to run.")
    results = run_on_phone(rows)

    answers = []
    tally = {"PASS": 0, "missed": 0, "WRONG": 0, "not run": 0}
    auto_tally = {"PASS": 0, "missed": 0, "WRONG": 0, "found": 0, "auto": 0, "retake": 0, "manual": 0}
    print(f"\n{'image':40s} {'kind':22s} {'expected':14s} {'app result':30s} verdict")
    for i, (_, name, expected, kind) in enumerate(rows):
        r = results.get(i)
        if r is None:
            tally["not run"] += 1
            print(f"{name[:40]:40s} {kind[:22]:22s} {str(expected or ''):14s} {'(no output)':30s} not run")
            continue
        a = engine_answers(r)
        answers.append({"image": name, **a})
        final = a["app"]
        got = final if not final.startswith(("REJECT", "ERROR")) else "REJECT"
        if expected is None:
            verdict = ""
        elif same(expected, got, final):
            verdict = "PASS"
        else:
            verdict = "missed" if got == "REJECT" else "WRONG"
        if verdict:
            tally[verdict] += 1
        print(f"{name[:40]:40s} {kind[:22]:22s} {str(expected or ''):14s} {final[:30]:30s} {verdict:7s} "
              f"segment={a['segment'][:24]} mlkit={a['mlkit'][:22]} paddle={a['paddle'][:24]}")
        au = a.get("auto") or {}
        if au and "error" not in au:
            afinal = au.get("final", "REJECT:no-output")
            agot = afinal if not afinal.startswith(("REJECT", "ERROR")) else "REJECT"
            averdict = ""
            if expected is not None:
                averdict = "PASS" if same(expected, agot, afinal) else ("missed" if agot == "REJECT" else "WRONG")
                auto_tally[averdict] += 1
            auto_tally["found"] += 1 if au.get("found") else 0
            if au.get("mode") in auto_tally:
                auto_tally[au["mode"]] += 1
            print(f"{'':40s} {'  automatic detection':22s} {'':14s} {afinal[:30]:30s} {averdict:7s} "
                  f"mode={au.get('mode')} found={au.get('found')} box={au.get('box')} "
                  f"cutOff={au.get('cutOff')} tooSmall={au.get('tooSmall')} tried={au.get('tried')} {au.get('ms')}ms")
        elif au:
            print(f"{'':40s}   automatic detection ERROR {au.get('error')}")
        if args.raw:
            for p in a["raw"]["passes"]:
                print(f"      {p[:150]}")
            print(f"      paddle: {str(a['raw']['paddle_text']).replace(chr(10), '/')[:80]} conf={a['paddle_confidence']}")

    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(answers, f, indent=1, ensure_ascii=False)
        print(f"\nwrote {args.json} ({len(answers)} images)")

    if args.labels:
        if tally["not run"]:
            sys.exit(f"{tally['not run']} image(s) produced no output.")
        return
    print(f"\n{tally}")
    print(f"automatic detection: {auto_tally}")
    print("PASS = the right value, or a refusal where a refusal is acceptable.")
    print("missed = refused an image it should have read.  WRONG = a different value was offered.")
    sys.exit(1 if tally["WRONG"] or auto_tally["WRONG"] or tally["not run"] else 0)


if __name__ == "__main__":
    main()
