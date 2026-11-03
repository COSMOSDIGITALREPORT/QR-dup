"""Shared definitions for the weight-display dataset tools (validate / evaluate / train)."""
import csv
import hashlib
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))

COLUMNS = [
    "image",           # path relative to the labels file
    "truth",           # exactly what the display shows: 0.000, 500.0, 3190 ... empty = no reading on show
    "unit",            # kg | g | none
    "source",          # physical | laptop-screen | phone-frame-of-screen | synthetic | derived
    "session",         # one capture session = one scale, one setup, one sitting. Splits never cut a session.
    "display_type",    # see DISPLAY_TYPES
    "decimal_format",  # digits before.after the point as shown, e.g. 3.1 for 500.0 ; none for whole numbers
    "lighting",        # bright | normal | dim | backlit | mixed
    "glare",           # none | partial | over-digits
    "blur",            # none | slight | heavy
    "tilt",            # none | slight | strong | upside-down
    "distance",        # close | normal | far
    "readable",        # yes | no - can a person read EVERY digit and the point with certainty from this image alone?
    "verified_by",     # how the truth was established, independently of any OCR
    "notes",
]

ENUMS = {
    "unit": {"kg", "g", "none"},
    "source": {"physical", "laptop-screen", "phone-frame-of-screen", "synthetic", "derived"},
    "display_type": {"lcd-cyan", "lcd-grey", "lcd-green", "lcd-other", "led-red", "led-green", "led-other",
                     "vfd", "dot-matrix", "other", "none"},
    "lighting": {"bright", "normal", "dim", "backlit", "mixed"},
    "glare": {"none", "partial", "over-digits"},
    "blur": {"none", "slight", "heavy"},
    "tilt": {"none", "slight", "strong", "upside-down"},
    "distance": {"close", "normal", "far"},
    "readable": {"yes", "no"},
}

TRUTH_RE = re.compile(r"^\d+(\.\d+)?$")
CHARSET = "0123456789."


def read_labels(path):
    """Rows of a labels file as dicts, with `_dir` (folder of the file) and `_line` added."""
    rows = []
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        missing = [c for c in COLUMNS if c not in (reader.fieldnames or [])]
        if missing:
            raise SystemExit(f"{path}: missing column(s): {', '.join(missing)}")
        for n, row in enumerate(reader, start=2):
            if not any((v or "").strip() for v in row.values()):
                continue
            row = {k: (v or "").strip() for k, v in row.items() if k}
            row["_dir"] = os.path.dirname(os.path.abspath(path))
            row["_line"] = n
            rows.append(row)
    return rows


def image_path(row):
    return os.path.normpath(os.path.join(row["_dir"], row["image"]))


def session_order_key(session):
    """Stable pseudo-random order of sessions, independent of the order rows were typed in."""
    return hashlib.sha256(session.encode("utf-8")).hexdigest()


def split_sessions(rows, fractions=(0.70, 0.15, 0.15)):
    """Assigns WHOLE sessions to train / val / test, aiming at the given shares of images.

    Frames from one session are near-duplicates of each other; letting them fall on both
    sides of a split would make the test score a memory test. Returns {session: split}.
    """
    counts = {}
    for r in rows:
        counts[r["session"]] = counts.get(r["session"], 0) + 1
    sessions = sorted(counts, key=session_order_key)
    total = sum(counts.values())
    names = ("train", "val", "test")
    out = {}
    # Every split gets at least one session when there are enough; then fill towards the targets.
    seeded = dict(zip(names[::-1], sessions[:3])) if len(sessions) >= 3 else {}
    have = {n: 0 for n in names}
    for name, s in seeded.items():
        out[s] = name
        have[name] += counts[s]
    for s in sessions:
        if s in out:
            continue
        # the split furthest below its target share takes the next session
        name = max(names, key=lambda n: fractions[names.index(n)] - have[n] / max(total, 1))
        out[s] = name
        have[name] += counts[s]
    return out
