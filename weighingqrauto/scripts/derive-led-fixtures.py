#!/usr/bin/env python
"""Makes the degraded copies of the physical LED photo used by the regression check.

    python scripts/derive-led-fixtures.py

Reads   test-fixtures/seven-segment/physical/led_red_1p70_whole_photo.jpg
Writes  test-fixtures/seven-segment/physical/derived_*.jpg  (listed in device_manifest.tsv)

These are DERIVED images: one real photo with a reflection painted on, blurred, cut or
turned by this script. They test that the reader refuses what it cannot read with
certainty. They are not evidence of how well physical scales are read, and they never go
into ml/dataset.
"""
import os

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "test-fixtures", "seven-segment", "physical")
base = cv2.imread(os.path.join(OUT, "led_red_1p70_whole_photo.jpg"))
if base is None:
    raise SystemExit("physical/led_red_1p70_whole_photo.jpg is missing")
H, W = base.shape[:2]


def reflection(cx, cy, rx, ry, soft):
    mask = np.zeros((H, W), np.float32)
    cv2.ellipse(mask, (cx, cy), (rx, ry), 0, 0, 360, 1.0, -1)
    if soft:
        mask = cv2.GaussianBlur(mask, (0, 0), soft)
    out = base.astype(np.float32) * (1 - mask[..., None]) + 255.0 * mask[..., None]
    return out.clip(0, 255).astype(np.uint8)


def rotated(deg):
    m = cv2.getRotationMatrix2D((W / 2, H / 2), deg, 1.0)
    return cv2.warpAffine(base, m, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


# In the photo: the 1 is at x 345-362, the decimal point at (366, 698), the 7 at x 400-445,
# the 0 at x 475-548; the digit row spans y 590-700.
images = {
    "derived_reflection_over_1": reflection(354, 640, 22, 50, 6),
    "derived_reflection_over_point": reflection(366, 698, 14, 14, 0),
    "derived_reflection_streak": reflection(430, 640, 160, 9, 0),
    "derived_blurred": cv2.GaussianBlur(base, (0, 0), 4),
    "derived_slightly_soft": cv2.GaussianBlur(base, (0, 0), 1.5),
    "derived_cut_left_1_outside": base[:, 375:],
    "derived_cut_left_through_1": base[:, 352:],
    "derived_cut_right_0_outside": base[:, :470],
    "derived_cut_bottom": base[:680, :],
    "derived_rotated_8": rotated(8),
    "derived_rotated_minus_8": rotated(-8),
    "derived_too_small": cv2.resize(base, None, fx=0.28, fy=0.28, interpolation=cv2.INTER_AREA),
}
for name, img in images.items():
    cv2.imwrite(os.path.join(OUT, name + ".jpg"), img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    print("wrote", name + ".jpg", f"{img.shape[1]}x{img.shape[0]}")
