from dataclasses import dataclass
from functools import lru_cache
from statistics import median
from typing import Optional

import numpy as np
from PIL import Image


@dataclass(frozen=True)
class OCRResult:
    """Structured OCR output preserving reading-order lines and confidence."""

    text: str
    lines: list[str]
    average_confidence: Optional[float]


@lru_cache(maxsize=1)
def _get_ocr_engine():
    """Lazily initialize a shared local RapidOCR ONNX engine."""
    from rapidocr_onnxruntime import RapidOCR

    return RapidOCR(use_cls=False)


def _group_boxes_into_lines(detections: list) -> tuple[list[str], Optional[float]]:
    """Group bounding boxes into horizontal receipt rows so item names stay paired with prices."""
    items: list[tuple[float, float, float, str, float]] = []
    heights: list[float] = []

    for det in detections:
        if len(det) < 3:
            continue
        box, text, score = det[0], str(det[1]).strip(), float(det[2])
        if not text:
            continue
        xs = [float(pt[0]) for pt in box]
        ys = [float(pt[1]) for pt in box]
        y_center = (min(ys) + max(ys)) / 2.0
        height = max(1.0, max(ys) - min(ys))
        heights.append(height)
        items.append((y_center, min(xs), max(xs), text, score))

    if not items:
        return [], None

    y_tolerance = max(10.0, median(heights) * 0.55)
    items.sort(key=lambda row: (row[0], row[1]))

    rows: list[list[tuple[float, float, float, str, float]]] = []
    for item in items:
        if not rows or abs(item[0] - rows[-1][0][0]) > y_tolerance:
            rows.append([item])
        else:
            rows[-1].append(item)

    lines: list[str] = []
    scores: list[float] = []
    for row in rows:
        row.sort(key=lambda cell: cell[1])
        line_parts: list[str] = []
        for idx, cell in enumerate(row):
            if idx > 0 and (cell[1] - row[idx - 1][2]) > 8:
                line_parts.append("  ")
            elif idx > 0:
                line_parts.append(" ")
            line_parts.append(cell[3])
            scores.append(cell[4])
        joined = "".join(line_parts).strip()
        if joined:
            lines.append(joined)

    avg_conf = round(sum(scores) / len(scores), 4) if scores else None
    return lines, avg_conf


def extract_text_from_image(image: Image.Image) -> OCRResult:
    """Run local RapidOCR on a PIL image and return reading-order lines."""
    engine = _get_ocr_engine()
    rgb_image = image.convert("RGB")
    img_array = np.array(rgb_image)
    detections, _ = engine(img_array)

    if not detections:
        return OCRResult(text="", lines=[], average_confidence=None)

    lines, avg_conf = _group_boxes_into_lines(detections)
    return OCRResult(
        text="\n".join(lines),
        lines=lines,
        average_confidence=avg_conf,
    )
