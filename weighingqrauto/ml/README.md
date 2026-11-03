# Weight-display recognition: dataset, measurement and training

This folder is the workflow for measuring how well the app reads a weighing-scale
display, and for training a dedicated reader once there is enough real data.

**Status (15 Oct 2026): no model has been trained.** The project holds ONE photo of a
physical scale (`test-fixtures/seven-segment/physical/led_red_1p70_whole_photo.jpg`, a red
LED display showing 1.70, confirmed by the user on 15 Oct 2026). It is a regression fixture
for the segment reader and the one row of `dataset/labels.csv` (`images/s01_0001.jpg`).
One image cannot be both training and test data: `python ml/validate_dataset.py` reports
1 of the 300 images / 6 sessions a first training run needs. What exists is the pipeline,
an empty dataset template, and a baseline measurement of the current engines on images
that are *not* physical scales.

## What reads the display today

| Step | Code |
|---|---|
| Camera capture (photo) | `src/screens/WeighScanScreen.jsx` → `handleScanDisplay` (camera or gallery) |
| Camera frames (live) | `src/ui/components/LiveWeightScanner.jsx` → `LiveWeightModule.kt` `read()` takes the frame on screen |
| Finding the display | Photo: `LiveWeightModule.kt` `detect()` runs the segment reader on the whole photo, then on each window-like area from `SevenSegmentDecoder.locateCandidates()`; an area is the display only if digits are found in it. `weightOcr.js` `assessDetection` decides: crop automatically, ask for a retake (cut off, too small, reflection, blur) or hand over to manual framing. Live: the reader reports where it found the display around the guide box and `LiveWeightScanner.jsx` draws it |
| Cropping | Photo: the detected window plus a margin, or - when detection is not certain, or the user taps Adjust Crop - the area framed in `src/ui/components/DisplayCropModal.jsx`; `ScaleImageModule.kt` cuts, rotates (EXIF) and resizes. Live: the on-screen guide box plus a margin, in `LiveWeightModule.kt` |
| Preprocessing | `ScaleImageModule.kt` (grey, contrast, two thresholds) for ML Kit; the segment reader does its own inside `SevenSegmentDecoder.kt` (find the display window, straighten, background-relative threshold, de-slant) |
| Digit segmentation | `SevenSegmentDecoder.kt` `readInk()`: connected components on the de-slanted ink, one per digit |
| Recognition | `SevenSegmentDecoder.kt`: each digit from its seven segments (`TABLE`), decimal point as a small blob between digits. Four display styles: cyan LCD (`decodeImpl`), lit digits on a dark panel (`decodeLed`), over-exposed LED digits with their unlit segments showing (`decodeGlow`, see below), dark digits on another light panel (`findLightPanel`). ML Kit (`@react-native-ml-kit/text-recognition`, bundled model) reads the unit label and is a second opinion. PaddleOCR is installed but only behind a test button |
| Refusal checks | `SevenSegmentDecoder.kt`: reflection (`glareSize`), blur (`edgeSoftness`), ambiguous or unknown segment patterns, unexplained ink |
| Validation | `src/services/weightOcr.js`: `readingFromDigits` (zero, leading zeros, range), `parseWeightFromText` (ML Kit text), unit rules |
| Choosing the weight | `src/services/weightOcr.js` `combineEngines` (photo) and `src/services/liveWeight.js` `createLiveWeightTracker` (live: same value on consecutive frames, decimal point consistent) |
| Confirmation | `WeighScanScreen.jsx`: nothing reaches the weight field without a tap, nothing is sent before Next |

## Real red LED displays (`decodeGlow`)

What a phone makes of a physical red LED scale display, measured on the one photo there is:

* the lit strokes are burnt out to **white** (weakest colour channel 217-255); only the glow
  around them is red (red leads the other channels by 100 or more);
* the unlit segments show as **grey** digits "8" beside the lit ones (weakest channel up to
  about 200 where they catch the light);
* the display window is **lighter** than the black housing around it, and it ran off the
  edge of the photo.

The earlier LED reader (`decodeLed`) looks for a dark window with coloured digits in it. On
this photo it took the housing (71 % of the frame) for the window ("digits-too-small"), and
on a hand crop of the window it counted the grey segments and the glow as lit
("merged-digits"). The phone's own kept frames of that morning show the same: 24 of 24
refused.

`decodeGlow` finds the digits by themselves: a blown-out blob is a lit stroke when its
surroundings are glow (strongest channel well ahead of the others). Grey segments, the
printed "Kg." label and reflections have no glow around them. The row of lit strokes is
followed digit to digit, levelled (line through the digit bottoms, then the angle at which
the horizontal bars line up sharpest), and read by the same digit reader as every other
style. The decimal point is found separately, as a small round blob between two digits.

It refuses, and never completes: a row with less than about a digit's height of picture
left and right of it (a whole digit can hide beyond the edge without anything lit touching
it), a lit point with no digit before it, a blown-out patch on the row that is not a
stroke, ink thicker than the strokes or inside a digit's openings (a reflection run into a
digit), digits closer together or less evenly spaced than a display has them, a 1 whose
stroke is not even, and soft focus.

What was tried and what was kept. Measured with a Python port of the LED readers made for this work (it agreed with the phone on 24 of 25 LED fixtures; it is not kept in the repo - the Kotlin is the implementation, checked on the phone with `scripts/ocr-device-check.py`):

| Tried | Result on the labelled images | Kept |
|---|---|---|
| Strongest-channel / hue threshold (as `decodeLed`) | burnt-out strokes have no colour; their glow and the grey segments pass | no |
| Weakest-channel threshold alone | unlit segments catching the light pass | no |
| Weakest channel + "surrounded by glow" per blob | physical photo read in every framing; no change on the 49 earlier images | yes |
| Wider surroundings ring (0.015 of the working height and up) | 3 more degraded copies read, but a soft reflection over the 0 read as "1.78" | no (0.008) |
| Smoothing before thresholding | fewer copies read, none gained | no |
| Rotation from the digit bottoms alone | off by 2-3 degrees (a bar here, a stroke end there); refused +5 degrees and up | replaced by bar-alignment search |
| Requiring room beside the digits | stopped "70" / "1.7" when a digit was wholly outside the picture | yes |
| Stroke thickness, digit spacing, openings, even-1 checks | 3,600 painted reflections: wrong readings 63 -> 0 ("1.78", "170", "1170", "4.70", "1.701" before) | yes |

Host-side results of the final prototype (11 Oct 2026). All of it is ONE physical photo
and copies of it degraded by script, so it shows that the reader refuses instead of
misreading - not how often physical displays are read:

| Images | Read correctly | Refused | Wrong value |
|---|---|---|---|
| The physical photo: whole, automatic crop, crop of the window, half size | 4 of 4 | 0 | 0 |
| 84 degraded copies (rotation, blur, reflections, cut edges, scale, exposure, perspective, JPEG, noise) | 31 | 53 | 0 |
| 3,600 painted reflections over the digit row | 1,008 | 2,592 | 0 |
| 24 phone frames of that photo shown on a laptop screen (not physical) | 0 | 24 | 0 |
| The 49 earlier regression images | unchanged | unchanged | 0 |

### Live camera frames (15 Oct 2026)

The phone's own saved live frames (`test-fixtures/seven-segment/live-screen/`, the 1.70
photo on a PC screen - not the physical scale) were all refused, for three reasons found
by looking at the reader's working images:

* in a camera frame the **grey unlit segments are as bright as the lit strokes** (weakest
  channel 195-233 against 220-245) and the red bloom covers them, so they were taken for
  strokes with a reflection on them ("glare / unclear-ink");
* a small **lit square under the last digit** was joined onto the 0, which tilted the row
  by up to 14 degrees and made the 7 look out of line ("unassigned-ink");
* the slow dark-panel LED reader ran before the glow reader on every frame.

Changes in `SevenSegmentDecoder.kt`:

| Change | Why |
|---|---|
| A lit stroke must also be saturated (`GLOW_SAT`, strongest channel >= 245) | grey segments top out at 220-236 even inside the bloom |
| A bright spot whose surroundings are largely grey segment (`GLOW_RING_GREY` >= 0.28) is a spot on an unlit segment | lit strokes and points: 0.05-0.22; such spots: 0.33-1.00 |
| ... and is ignored only outside the digits being read; inside them, or where a point after the last digit would be, the frame is refused | so a lit segment or point is never dropped silently |
| Point-sized marks are left out when finding the row; lit ink wholly above or below the row is dropped before reading | the lit square under the 0 |
| The glow reader runs before the dark-panel LED reader | that reader cannot read burnt-out digits and cost most of the frame time |
| Pixel counting in the rotation and de-slant searches done by OpenCV | same counts, less time |

Measured on the V2403 phone (`scripts/ocr-device-check.py --live 1.70 ...`, the native
reader as the live scanner calls it, 3 runs per image):

| Images | Read 1.70 | Refused | Wrong value | Reader time |
|---|---|---|---|---|
| 22 live frames of the photo on a PC screen (2 of them show no display) | 15 | 7 | 0 | ~500-560 ms when read |
| The physical photo | 1 | 0 | 0 | 452-554 ms |
| 12 degraded copies of the physical photo | 2 (rotated +-8 degrees) | 10 | 0 | |
| All 37 | | | **0** | median 473 ms, p95 592 ms |

None of this is a live camera on the physical scale. Live scanning: a value is shown from
the first frame read, becomes steady after 3 agreeing frames and is then captured for the
user to confirm (`AUTO_CAPTURE.steadyFrames` 1, was 4); the ML Kit unit check no longer
holds up the frame loop.

Known limits: a reflection the exact shape and place of a segment cannot be told from a
lit segment; photos exposed so the digits stay red (not burnt out) go to the earlier LED
reader, which has only been checked on pictures of screens; mild blur (sigma 1.5 px at
900 px across) is refused; the room rule refuses a tight crop of the digits alone.
`python scripts/derive-led-fixtures.py` regenerates the degraded copies kept as fixtures.

## The dataset

`dataset/labels.csv` is the list of labelled photos; images go in `dataset/images/`.
One row per image. The columns and their allowed values are defined in `common.py`.

| Column | Meaning |
|---|---|
| `image` | file, relative to `labels.csv`, e.g. `images/s01_0007.jpg` |
| `truth` | exactly what the display shows, character for character: `0.000`, `500.0`, `3190`. Empty only when nothing is on show |
| `unit` | `kg`, `g` or `none` |
| `source` | `physical` for a photo of a real scale. Anything else is kept apart in every report |
| `session` | one scale, one position, one sitting, e.g. `s01`. A new scale, a new place or a new day is a new session |
| `display_type` | `lcd-cyan`, `lcd-grey`, `lcd-green`, `lcd-other`, `led-red`, `led-green`, `led-other`, `vfd`, `dot-matrix`, `other` |
| `decimal_format` | digits before and after the point, e.g. `3.1` for `500.0`; `none` for whole numbers |
| `lighting` | `bright`, `normal`, `dim`, `backlit`, `mixed` |
| `glare` | `none`, `partial` (reflection, digits clear), `over-digits` |
| `blur` | `none`, `slight`, `heavy` |
| `tilt` | `none`, `slight`, `strong`, `upside-down` |
| `distance` | `close`, `normal`, `far` |
| `readable` | `yes` if a person can read every digit and the point with certainty from the image alone, else `no`. For `no`, the right behaviour is to refuse |
| `verified_by` | how the true weight was established without any OCR, e.g. `read from the scale and written down at capture` or `5 kg reference weight` |
| `notes` | anything else |

### How to collect

1. Put a load on the scale and wait for the reading to settle.
2. **Write the reading down from the scale itself** before taking photos. That is the
   ground truth. Never fill `truth` in from what the app or any OCR says.
3. Take the photos with the phone's normal camera, display filling most of the frame,
   as the app's guide box would have it. Several photos per reading are fine: vary the
   angle, the distance and the light. Include some deliberately bad ones (reflection
   over the digits, out of focus, too far) and mark them `readable=no`.
4. Change the load and repeat. Aim for readings that cover every digit, and include:
   zero, whole numbers, decimals, repeated digits (`100.0`, `111.1`), the digit 1 next
   to other digits, and a decimal point right beside a digit.
5. Use a new `session` whenever the scale, its position or the day changes.

For a red LED scale like the one in the fixture, also: photos with the digits burnt out
to white AND photos exposed so they stay red (tap the display, drag the exposure down);
readings that light up every digit position; a reading with a 1 next to a 7 and next to
the point (1.10, 1.70, 7.11); the display in shade and with a ceiling light reflected on
the window. Name the files `sNN_NNNN.jpg`, add one row each, and never crop them.

A first training run needs at least (checked by `validate_dataset.py`): 300 readable
physical images from 6 sessions, every digit in 30 images, 60 with a decimal point, 20
zero readings, 40 with a 1, 40 with a repeated digit, 40 unreadable ones, and 45 readable
images in the held-out test sessions. These are minimums for the result to mean anything,
not a promise of a good model. Each display type you want supported needs at least two
sessions, or it cannot be both trained and tested.

Splits are made by whole session (`common.split_sessions`), so near-identical frames
never sit on both sides. The test sessions are not used for training or for choosing
the acceptance threshold.

## Commands

Run from the `weighingqrauto` folder.

```
python ml/validate_dataset.py                      # is the dataset valid, and is it enough?
python ml/validate_dataset.py --write-splits       # also writes dataset/splits.csv

# measure the engines in the app, on the phone (debug build, Metro running, USB)
python scripts/ocr-device-check.py --labels ml/dataset/labels.csv --json ml/dataset/answers.json
python ml/evaluate.py --labels ml/dataset/labels.csv --answers ml/dataset/answers.json --by display_type lighting --list-wrong

python ml/train.py --self-test                     # does the training code run? (toy data, ~3 min, keeps nothing)
python ml/train.py                                 # trains; refuses until the dataset is adequate
python ml/train.py --predict ml/dataset/labels.csv --model ml/out/weight_reader.onnx --json ml/dataset/model_answers.json
python ml/evaluate.py --labels ml/dataset/labels.csv --answers ml/dataset/answers.json ml/dataset/model_answers.json

python scripts/ocr-device-check.py                 # regression check of the app (49 non-physical images, 1 physical photo, 12 copies derived from it)
```

`evaluate.py` reports, per engine and per `source`: exact full-weight matches, numeric
matches, digit-level and decimal-point accuracy, refusals of unreadable images, values
wrongly offered, and the false-acceptance rate.

## The model `train.py` would train

A small fully-convolutional reader with a CTC output over `0123456789.` — the decimal
point is a character of its own. Input: the cropped display, grey, 48 × 192. About
0.9 MB as ONNX. ONNX was chosen because ONNX Runtime (`onnxruntime-android` 1.21.1) is
already in the app through `ppocr-sdk`, so no new runtime would be needed. The export is
loaded back in a second runtime and compared with the trained model before a run counts
as successful. It would be a separate model: the bundled ML Kit model is not retrained
and cannot be.

It should be integrated only if, on the untouched physical test sessions, it offers
fewer wrong values than the segment reader and reads more images. Until then the
segment reader stays the engine.

## Baseline on non-physical images

`nonphysical/labels.csv` labels the 49 images of the regression set (laptop-screen
photos, phone frames of pictures on a screen, synthetic and derived images), and
`nonphysical/answers.json` holds what each engine returned for them on the V2403 phone
on 10 Oct 2026. `python ml/evaluate.py --labels ml/nonphysical/labels.csv --answers
ml/nonphysical/answers.json` reproduces the table. **None of it is evidence about
physical scales.**
