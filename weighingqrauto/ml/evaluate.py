#!/usr/bin/env python
"""Accuracy of each recognition engine against labelled ground truth.

    python ml/evaluate.py --labels ml/nonphysical/labels.csv --answers ml/nonphysical/answers.json
    python ml/evaluate.py --labels ml/dataset/labels.csv     --answers ml/dataset/answers.json --by display_type lighting

`answers.json` comes from `python scripts/ocr-device-check.py --labels <labels> --json <answers>`
(the engines running on the phone) or from `ml/train.py --predict` (a trained model); several
--answers files can be given and are merged per image.

Images are grouped by `source` first, and the groups are never added together: a number
measured on laptop-screen or synthetic images says nothing about physical scales.

What is counted, per engine and group:
  images         all images in the group
  readable       images a person can read with certainty (readable=yes, truth filled in)
  exact          readable images answered with exactly the displayed text (500.0, not 500)
  numeric        readable images answered with the right value (500 counts for 500.0)
  missed         readable images the engine refused
  wrong          images where the engine OFFERED a value that is not the true one -
                 on a readable image or an unreadable one. This is the dangerous number.
  refused-ok     unreadable images the engine refused, as it should
  lucky          unreadable images where the engine offered the true value anyway
  digit acc.     of the digits in readable images the engine answered: share reproduced
                 (edit distance on the digit string - a dropped digit costs one)
  decimal acc.   of the readable images the engine answered: decimal point in the right place
  false accept   wrong / images
A zero on the display is a special case for the app only: it must refuse it AS zero
(REJECT:zero), because zero is not a weight to record; for the engines themselves the
right answer is the zero they see.
"""
import argparse
import json
import os
import sys

from common import read_labels

ENGINES = ("segment", "mlkit", "paddle", "app", "model")


def edit_distance(a, b):
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def judge(engine, row, answer):
    """-> dict of counters for one image and one engine."""
    readable = row["readable"] == "yes" and bool(row["truth"])
    truth = row["truth"]
    accepted = not answer.startswith(("REJECT", "ERROR"))
    out = {"images": 1, "readable": int(readable)}
    if engine == "app" and readable and float(truth) == 0:
        # the app must recognise the zero and refuse it for that reason
        out["exact" if answer == "REJECT:zero" else ("wrong" if accepted else "missed")] = 1
        out["numeric"] = int(answer == "REJECT:zero")
        return out
    if not accepted:
        out["missed" if readable else "refused_ok"] = 1
        return out
    right_value = readable and float(answer) == float(truth)
    if not readable and truth and float(answer) == float(truth):
        # offered the true value for an image a person could not be sure of: not an error,
        # but not something to rely on either - counted on its own
        out["lucky"] = 1
        return out
    if readable and engine != "app":      # the app reports kg as a plain number, not the display text
        digits_t, digits_a = truth.replace(".", ""), answer.replace(".", "")
        out["digits_total"] = len(digits_t)
        out["digits_bad"] = min(len(digits_t), edit_distance(digits_t, digits_a))
        out["answered"] = 1
        places = lambda t: len(t.split(".")[1]) if "." in t else 0
        # (an engine that reports a plain number - 500 for 500.0 - is not marked down for it)
        out["decimal_ok"] = int(float(answer) == float(truth) or places(answer) == places(truth))
    if right_value:
        out["numeric"] = 1
        out["exact"] = int(answer == truth)
    else:
        out["wrong"] = 1
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--labels", required=True)
    ap.add_argument("--answers", required=True, nargs="+")
    ap.add_argument("--by", nargs="*", default=[], help="extra label columns to break physical results down by")
    ap.add_argument("--list-wrong", action="store_true", help="list every wrongly offered value")
    args = ap.parse_args()

    rows = {r["image"]: r for r in read_labels(args.labels)}
    answers = {}
    for path in args.answers:
        for a in json.load(open(path, encoding="utf-8")):
            answers.setdefault(a["image"], {}).update(a)
    unlabelled = sorted(set(answers) - set(rows))
    if unlabelled:
        print(f"note: {len(unlabelled)} answered image(s) have no label and are ignored, e.g. {unlabelled[0]}")
    no_answer = sorted(set(rows) - set(answers))
    if no_answer:
        print(f"note: {len(no_answer)} labelled image(s) have no answers yet, e.g. {no_answer[0]}")
    if not set(rows) & set(answers):
        sys.exit("Nothing to evaluate: no image has both a label and an answer.")

    def table(title, selected):
        print(f"\n{title}  ({len(selected)} images)")
        print(f"  {'engine':8s} {'readable':>8s} {'exact':>6s} {'numeric':>7s} {'missed':>6s} {'WRONG':>6s} {'refused-ok':>10s} {'lucky':>5s} "
              f"{'digit acc.':>10s} {'decimal acc.':>12s} {'false accept':>12s} {'median ms':>9s}")
        for engine in ENGINES:
            tot, wrongs, times = {}, [], []
            for img in selected:
                a = answers[img]
                if engine not in a:
                    continue
                j = judge(engine, rows[img], a[engine])
                for k, v in j.items():
                    tot[k] = tot.get(k, 0) + v
                if j.get("wrong"):
                    wrongs.append(f"{img}: truth {rows[img]['truth'] or '(none)'} -> offered {a[engine]}")
                ms = a.get("ms_paddle" if engine == "paddle" else "ms_model" if engine == "model" else "ms_app")
                if ms is not None and engine in ("paddle", "app", "model"):
                    times.append(ms)
            if not tot:
                continue
            g = lambda k: tot.get(k, 0)
            digit = f"{100 * (1 - g('digits_bad') / g('digits_total')):.1f}%" if g("digits_total") else "-"
            dec = f"{100 * g('decimal_ok') / g('answered'):.1f}%" if g("answered") else "-"
            far = f"{100 * g('wrong') / g('images'):.1f}%"
            med = f"{sorted(times)[len(times) // 2]:.0f}" if times else "-"
            print(f"  {engine:8s} {g('readable'):8d} {g('exact'):6d} {g('numeric'):7d} {g('missed'):6d} {g('wrong'):6d} {g('refused_ok'):10d} {g('lucky'):5d} "
                  f"{digit:>10s} {dec:>12s} {far:>12s} {med:>9s}")
            if args.list_wrong:
                for w in wrongs:
                    print(f"           WRONG {w}")

    both = [i for i in rows if i in answers]
    sources = sorted({rows[i]["source"] for i in both})
    for s in sources:
        label = "PHYSICAL SCALES" if s == "physical" else f"NOT physical - {s}"
        table(label, [i for i in both if rows[i]["source"] == s])
    for col in args.by:
        for value in sorted({rows[i][col] for i in both if rows[i]["source"] == "physical"}):
            table(f"PHYSICAL SCALES, {col} = {value}", [i for i in both if rows[i]["source"] == "physical" and rows[i][col] == value])
    if "physical" not in sources:
        print("\nNo physical-scale images were evaluated. Nothing above is evidence about real scales.")


if __name__ == "__main__":
    main()
