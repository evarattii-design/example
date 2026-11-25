import io
from dataclasses import dataclass
from typing import Literal, Optional

import pymupdf
from PIL import Image, ImageOps

from app.services.ocr_service import extract_text_from_image

MAX_PDF_PAGES = 5
PDF_RENDER_DPI = 220


@dataclass(frozen=True)
class ProcessedDocument:
    """Text and provenance produced from an image or PDF document."""

    raw_text: str
    lines: list[str]
    extraction_method: str
    ocr_confidence: Optional[float]


def _preprocess_image(image: Image.Image, high_contrast: bool = False) -> Image.Image:
    """Normalize EXIF orientation, resize small/huge images, and apply optional contrast boost."""
    transposed = ImageOps.exif_transpose(image)
    rgb = transposed.convert("RGB")

    width, height = rgb.size
    longest = max(width, height)
    if longest < 600:
        scale = min(2.0, 1200 / max(1, longest))
        rgb = rgb.resize(
            (int(width * scale), int(height * scale)),
            Image.Resampling.LANCZOS,
        )
    elif longest > 2400:
        scale = 2400 / longest
        rgb = rgb.resize(
            (int(width * scale), int(height * scale)),
            Image.Resampling.LANCZOS,
        )

    if high_contrast:
        gray = ImageOps.grayscale(rgb)
        boosted = ImageOps.autocontrast(gray, cutoff=2)
        return boosted.convert("RGB")

    return ImageOps.autocontrast(rgb, cutoff=1)


def _extract_pdf_lines_from_page(page: pymupdf.Page) -> list[str]:
    """Extract embedded PDF words grouped by visual row to preserve column alignment."""
    words = page.get_text("words")
    if not words:
        raw = page.get_text("text")
        return [line.strip() for line in raw.splitlines() if line.strip()]

    # Each word tuple: (x0, y0, x1, y1, word, block_no, line_no, word_no)
    sorted_words = sorted(words, key=lambda w: (round(w[1], 1), w[0]))
    rows: list[list[tuple]] = []
    for w in sorted_words:
        y_mid = (w[1] + w[3]) / 2.0
        if not rows or abs(y_mid - ((rows[-1][0][1] + rows[-1][0][3]) / 2.0)) > 4.5:
            rows.append([w])
        else:
            rows[-1].append(w)

    lines: list[str] = []
    for row in rows:
        row.sort(key=lambda w: w[0])
        parts: list[str] = []
        for idx, word in enumerate(row):
            if idx > 0 and (word[0] - row[idx - 1][2]) > 8:
                parts.append("  ")
            elif idx > 0:
                parts.append(" ")
            parts.append(str(word[4]))
        line = "".join(parts).strip()
        if line:
            lines.append(line)
    return lines


def _process_pdf(file_bytes: bytes) -> ProcessedDocument:
    """Extract embedded PDF text first, falling back to page rendering + OCR for scanned PDFs."""
    embedded_lines: list[str] = []
    with pymupdf.open(stream=file_bytes, filetype="pdf") as doc:
        page_limit = min(doc.page_count, MAX_PDF_PAGES)
        for idx in range(page_limit):
            embedded_lines.extend(_extract_pdf_lines_from_page(doc[idx]))

        embedded_text = "\n".join(embedded_lines).strip()
        if len(embedded_text.replace(" ", "").replace("\n", "")) >= 20:
            return ProcessedDocument(
                raw_text=embedded_text,
                lines=embedded_lines,
                extraction_method="pdf_text",
                ocr_confidence=1.0,
            )

        # Scanned PDF fallback: render pages and run local OCR.
        ocr_lines: list[str] = []
        confidences: list[float] = []
        matrix = pymupdf.Matrix(PDF_RENDER_DPI / 72.0, PDF_RENDER_DPI / 72.0)
        for idx in range(page_limit):
            pix = doc[idx].get_pixmap(matrix=matrix, alpha=False)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            processed = _preprocess_image(img)
            ocr_result = extract_text_from_image(processed)
            ocr_lines.extend(ocr_result.lines)
            if ocr_result.average_confidence is not None:
                confidences.append(ocr_result.average_confidence)

        avg_conf = round(sum(confidences) / len(confidences), 4) if confidences else None
        return ProcessedDocument(
            raw_text="\n".join(ocr_lines),
            lines=ocr_lines,
            extraction_method="pdf_ocr",
            ocr_confidence=avg_conf,
        )


def _process_image(file_bytes: bytes) -> ProcessedDocument:
    """Preprocess an image receipt and run local OCR."""
    with Image.open(io.BytesIO(file_bytes)) as img:
        standard = _preprocess_image(img, high_contrast=False)
        ocr_result = extract_text_from_image(standard)
        if not ocr_result.lines:
            boosted = _preprocess_image(img, high_contrast=True)
            ocr_result = extract_text_from_image(boosted)

    return ProcessedDocument(
        raw_text=ocr_result.text,
        lines=ocr_result.lines,
        extraction_method="rapidocr",
        ocr_confidence=ocr_result.average_confidence,
    )


def process_document(
    file_bytes: bytes,
    file_type: Literal["image", "pdf"],
) -> ProcessedDocument:
    """Route validated bytes through PDF text extraction or image OCR."""
    if file_type == "pdf":
        return _process_pdf(file_bytes)
    return _process_image(file_bytes)
