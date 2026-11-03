#!/usr/bin/env python
"""Trains a small sequence model that reads a weight display: image -> "500.0".

    python ml/train.py                 # train on ml/dataset (refuses if the dataset is not adequate)
    python ml/train.py --self-test     # checks that this pipeline runs end to end (about 3 minutes). Trains NOTHING usable.
    python ml/train.py --predict ml/dataset/labels.csv --model ml/out/weight_reader.onnx --json answers.json

What it trains
    A fully-convolutional recogniser with a CTC output over "0123456789." - the decimal
    point is a character of its own, so it is either read or not, never implied. Input is
    the display as the app crops it (grey, 48 x 192). About 0.3 M weights.

What it will not do
    * It never trains on, validates on, or picks thresholds from the test split.
    * It only uses rows with source=physical and readable=yes for training.
    * It refuses to run until ml/validate_dataset.py says the dataset is adequate
      (override: --force, for experiments only - the result must not be shipped).
    * It does not touch the bundled ML Kit model. This is a separate model.

Refusing to guess
    Each output character comes with a probability; the reading's confidence is the
    lowest of them. The acceptance threshold is chosen on the VALIDATION split as the
    lowest value at which no wrong reading is accepted there, and then reported on the
    test split as it is - it is not tuned on the test split.

Outputs (ml/out/): weight_reader.onnx, weight_reader.json (charset, input size,
threshold, splits used, metrics). The ONNX file is loaded back and compared with the
PyTorch model before the run is called successful.
"""
import argparse
import json
import os
import random
import shutil
import subprocess
import sys
import tempfile
import time

import cv2
import numpy as np

from common import CHARSET, HERE, image_path, read_labels, split_sessions

H, W = 48, 192
BLANK = len(CHARSET)


def load_image(path, augment=False):
    img = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise SystemExit(f"cannot read image: {path}")
    if augment:
        h, w = img.shape
        # small changes a hand-held phone makes: framing, tilt, exposure, focus
        dx, dy = random.uniform(-0.04, 0.04) * w, random.uniform(-0.06, 0.06) * h
        m = cv2.getRotationMatrix2D((w / 2, h / 2), random.uniform(-4, 4), random.uniform(0.92, 1.08))
        m[:, 2] += (dx, dy)
        img = cv2.warpAffine(img, m, (w, h), borderMode=cv2.BORDER_REPLICATE)
        img = cv2.convertScaleAbs(img, alpha=random.uniform(0.7, 1.3), beta=random.uniform(-25, 25))
        if random.random() < 0.3:
            img = cv2.GaussianBlur(img, (0, 0), random.uniform(0.5, 1.5))
    img = cv2.resize(img, (W, H), interpolation=cv2.INTER_AREA)
    return (img.astype(np.float32) / 255.0 - 0.5) / 0.5


def build_model():
    import torch.nn as nn

    def block(i, o, pool):
        return [nn.Conv2d(i, o, 3, padding=1), nn.BatchNorm2d(o), nn.ReLU(inplace=True), nn.MaxPool2d(pool)]

    return nn.Sequential(
        *block(1, 32, (2, 2)),     # 24 x 96
        *block(32, 64, (2, 2)),    # 12 x 48
        *block(64, 96, (2, 1)),    # 6 x 48
        *block(96, 128, (2, 1)),   # 3 x 48
        nn.Conv2d(128, 128, (3, 1)), nn.ReLU(inplace=True),   # 1 x 48 : one column per time step
        nn.Dropout2d(0.1),
        nn.Conv2d(128, len(CHARSET) + 1, 1),                  # N x 12 x 1 x 48
    )


def decode(logits):
    """logits: (classes, T) for one image -> (text, confidence = lowest character probability)."""
    e = np.exp(logits - logits.max(axis=0, keepdims=True))
    p = e / e.sum(axis=0, keepdims=True)
    best = p.argmax(axis=0)
    text, conf, prev = [], 1.0, BLANK
    for t, k in enumerate(best):
        if k != prev and k != BLANK:
            text.append(CHARSET[k])
            conf = min(conf, float(p[k, t]))
        prev = k
    return "".join(text), (conf if text else 0.0)


def well_formed(text):
    """A reading the app could use: digits with at most one point, not starting or ending with it."""
    return bool(text) and text.count(".") <= 1 and not text.startswith(".") and not text.endswith(".")


def run_model(model, rows, batch=64):
    import torch
    model.eval()
    out = []
    with torch.no_grad():
        for i in range(0, len(rows), batch):
            x = torch.from_numpy(np.stack([load_image(image_path(r)) for r in rows[i:i + batch]])[:, None])
            y = model(x).squeeze(2).numpy()
            out += [decode(y[j]) for j in range(y.shape[0])]
    return out


def pick_threshold(preds, rows):
    """Lowest confidence at which no wrong, well-formed reading is accepted on these rows."""
    wrong = [c for (t, c), r in zip(preds, rows) if well_formed(t) and t != r["truth"]]
    return min(0.999, max(wrong) + 1e-4) if wrong else 0.5


def score(preds, rows, threshold):
    n = len(rows)
    acc = [(t, r) for (t, c), r in zip(preds, rows) if well_formed(t) and c >= threshold]
    exact = sum(1 for t, r in acc if t == r["truth"])
    return {"images": n, "accepted": len(acc), "exact": exact, "wrong_accepted": len(acc) - exact,
            "exact_rate": round(exact / n, 4) if n else None,
            "false_accept_rate": round((len(acc) - exact) / n, 4) if n else None}


def export_and_check(model, out_dir):
    """Writes the ONNX file and proves it gives the same answer as the PyTorch model."""
    import torch
    model.eval()
    path = os.path.join(out_dir, "weight_reader.onnx")
    dummy = torch.zeros(1, 1, H, W)
    # the classic exporter: plain Conv / BatchNorm / Relu / MaxPool nodes at opset 13, which the
    # ONNX Runtime build already shipped in the app (onnxruntime-android 1.21.1) reads
    torch.onnx.export(model, dummy, path, input_names=["image"], output_names=["logits"], opset_version=13, dynamo=False)
    import onnx
    onnx.checker.check_model(onnx.load(path))
    probe = np.random.RandomState(0).uniform(-1, 1, (1, 1, H, W)).astype(np.float32)
    with torch.no_grad():
        ref = model(torch.from_numpy(probe)).numpy()
    net = cv2.dnn.readNetFromONNX(path)       # an independent runtime, not PyTorch
    net.setInput(probe)
    got = net.forward()
    diff = float(np.abs(ref - got).max())
    if diff > 1e-3:
        raise SystemExit(f"exported model disagrees with the trained one (max difference {diff})")
    t0 = time.time()
    for _ in range(50):
        net.setInput(probe)
        net.forward()
    return path, os.path.getsize(path), diff, (time.time() - t0) / 50 * 1000


def train(train_rows, val_rows, epochs, lr=2e-3, batch=32, quiet=False):
    import torch
    import torch.nn.functional as F
    torch.manual_seed(0)
    random.seed(0)
    np.random.seed(0)
    model = build_model()
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=lr, total_steps=max(1, epochs * ((len(train_rows) + batch - 1) // batch)))
    best = (-1, None)
    for epoch in range(epochs):
        model.train()
        random.shuffle(train_rows)
        total = 0.0
        for i in range(0, len(train_rows), batch):
            part = train_rows[i:i + batch]
            x = torch.from_numpy(np.stack([load_image(image_path(r), augment=True) for r in part])[:, None])
            targets = torch.tensor([CHARSET.index(ch) for r in part for ch in r["truth"]], dtype=torch.long)
            lengths = torch.tensor([len(r["truth"]) for r in part], dtype=torch.long)
            logp = F.log_softmax(model(x).squeeze(2).permute(2, 0, 1), dim=2)      # T x N x C
            loss = F.ctc_loss(logp, targets, torch.full((len(part),), logp.shape[0], dtype=torch.long), lengths,
                              blank=BLANK, zero_infinity=True)
            opt.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            opt.step()
            sched.step()
            total += loss.item() * len(part)
        preds = run_model(model, val_rows)
        exact = sum(1 for (t, _), r in zip(preds, val_rows) if t == r["truth"])
        if exact > best[0]:
            best = (exact, {k: v.clone() for k, v in model.state_dict().items()})
        if not quiet:
            print(f"epoch {epoch + 1:3d}  loss {total / max(len(train_rows), 1):.4f}  validation exact {exact}/{len(val_rows)}")
    model.load_state_dict(best[1])
    return model


def self_test():
    """Runs every stage on throw-away drawings of digit strings. Proves the code path, nothing else."""
    tmp = tempfile.mkdtemp(prefix="weight_selftest_")
    try:
        rng = random.Random(0)
        rows = []
        for i in range(1200):
            n = rng.randint(1, 5)
            text = "".join(rng.choice("0123456789") for _ in range(n))
            if n > 1 and rng.random() < 0.6:
                k = rng.randint(1, n - 1)
                text = text[:k] + "." + text[k:]
            img = np.full((96, 384, 3), rng.randint(0, 60), np.uint8)
            cv2.putText(img, text, (rng.randint(10, 60), rng.randint(60, 80)), cv2.FONT_HERSHEY_DUPLEX, 2.0,
                        (rng.randint(170, 255),) * 3, 3, cv2.LINE_AA)
            path = os.path.join(tmp, f"{i:04d}.png")
            cv2.imwrite(path, img)
            rows.append({"image": os.path.basename(path), "truth": text, "session": f"s{i % 12}", "_dir": tmp, "_line": i})
        splits = split_sessions(rows)
        part = lambda name: [r for r in rows if splits[r["session"]] == name]
        model = train(part("train"), part("val"), epochs=8, quiet=True)
        vp, tp = run_model(model, part("val")), run_model(model, part("test"))
        thr = pick_threshold(vp, part("val"))
        s = score(tp, part("test"), thr)
        path, size, diff, ms = export_and_check(model, tmp)
        print("PIPELINE SELF-TEST - drawn digit strings, not weight displays. No model is kept.")
        print(f"  split by session: train {len(part('train'))}, val {len(part('val'))}, test {len(part('test'))} images")
        print(f"  training ran; held-out drawings read exactly: {s['exact']}/{s['images']} (threshold {thr:.3f} chosen on validation)")
        print(f"  ONNX export: {size / 1024:.0f} KB, reloaded in a second runtime, max difference {diff:.2e}, {ms:.1f} ms per image on this PC")
        if s["exact"] < 0.5 * s["images"]:
            raise SystemExit("self-test FAILED: the pipeline does not learn even its own toy task")
        print("  self-test passed: the training, thresholding and export steps work. This says nothing about scale displays.")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--labels", default=os.path.join(HERE, "dataset", "labels.csv"))
    ap.add_argument("--out", default=os.path.join(HERE, "out"))
    ap.add_argument("--epochs", type=int, default=60)
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--force", action="store_true", help="train although the dataset is not adequate (experiments only)")
    ap.add_argument("--predict", help="labels file to run a trained model on")
    ap.add_argument("--model", help="ONNX model for --predict")
    ap.add_argument("--json", help="where --predict writes its answers (for ml/evaluate.py)")
    args = ap.parse_args()

    if args.self_test:
        return self_test()

    if args.predict:
        if not (args.model and args.json):
            sys.exit("--predict needs --model and --json")
        meta = json.load(open(os.path.splitext(args.model)[0] + ".json", encoding="utf-8"))
        net = cv2.dnn.readNetFromONNX(args.model)
        out = []
        for r in read_labels(args.predict):
            t0 = time.time()
            net.setInput(load_image(image_path(r))[None, None])
            text, conf = decode(net.forward()[0, :, 0, :])
            ok = well_formed(text) and conf >= meta["threshold"]
            out.append({"image": r["image"], "model": text if ok else f"REJECT:{'low-confidence' if well_formed(text) else 'malformed'}",
                        "model_confidence": round(conf, 4), "ms_model": round((time.time() - t0) * 1000, 2)})
        json.dump(out, open(args.json, "w", encoding="utf-8"), indent=1)
        print(f"wrote {args.json} ({len(out)} images). Times are for this PC, not the phone.")
        return

    check = subprocess.run([sys.executable, os.path.join(HERE, "validate_dataset.py"), "--labels", args.labels, "--write-splits"])
    if check.returncode == 1:
        sys.exit("The labels file has errors (see above). Not training.")
    if check.returncode == 2 and not args.force:
        sys.exit("\nNot training: the dataset is not adequate yet (see above).")

    rows = [r for r in read_labels(args.labels) if r["source"] == "physical"]
    splits = split_sessions(rows)
    usable = [r for r in rows if r["readable"] == "yes" and r["truth"]]
    part = lambda name: [r for r in usable if splits[r["session"]] == name]
    tr, va, te = part("train"), part("val"), part("test")
    if not (tr and va and te):
        sys.exit("Need at least one session in each of train / validation / test.")
    print(f"\ntraining on {len(tr)} images, validating on {len(va)}, testing on {len(te)} (whole sessions each)")
    model = train(tr, va, args.epochs)
    threshold = pick_threshold(run_model(model, va), va)
    os.makedirs(args.out, exist_ok=True)
    path, size, diff, ms = export_and_check(model, args.out)
    metrics = {"validation": score(run_model(model, va), va, threshold), "test": score(run_model(model, te), te, threshold)}
    meta = {"charset": CHARSET, "input": [H, W], "threshold": threshold, "onnx_bytes": size,
            "sessions": {s: splits[s] for s in sorted(splits)}, "metrics": metrics,
            "inadequate_dataset_forced": bool(check.returncode == 2)}
    json.dump(meta, open(os.path.join(args.out, "weight_reader.json"), "w", encoding="utf-8"), indent=1)
    print(json.dumps(metrics, indent=1))
    print(f"\nwrote {path} ({size / 1024:.0f} KB), verified against the trained model (max difference {diff:.2e}).")
    print("Next: python ml/train.py --predict <labels> --model <onnx> --json <answers>, then ml/evaluate.py,")
    print("and compare with the existing engines on the same TEST images before integrating anything.")
    if check.returncode == 2:
        print("WARNING: trained with --force on an inadequate dataset. Do not ship this model.")


if __name__ == "__main__":
    main()
