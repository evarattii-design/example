import re
from datetime import datetime
from typing import Any, Optional

MONEY_RE = re.compile(r"(?P<sign>-?)\s*[\$€£]?\s*(?P<num>\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})")
FLEX_MONEY_RE = re.compile(r"(?P<sign>-?)\s*[\$€£]?\s*(?P<num>\d+(?:[.,]\d{2}))")

DATE_PATTERNS: list[tuple[re.Pattern[str], list[str]]] = [
    (re.compile(r"\b(\d{4}[-/]\d{1,2}[-/]\d{1,2})\b"), ["%Y-%m-%d", "%Y/%m/%d"]),
    (
        re.compile(r"\b(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\b"),
        ["%m/%d/%Y", "%m-%d-%Y", "%d/%m/%Y", "%d-%m-%Y", "%m/%d/%y", "%m-%d-%y"],
    ),
    (
        re.compile(r"\b([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})\b"),
        ["%b %d, %Y", "%b %d %Y", "%B %d, %Y", "%B %d %Y"],
    ),
    (
        re.compile(r"\b(\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4})\b"),
        ["%d %b %Y", "%d %B %Y"],
    ),
]

NON_MERCHANT_HINTS = (
    "receipt",
    "tax invoice",
    "invoice",
    "customer copy",
    "merchant copy",
    "duplicate",
    "welcome",
    "thank you",
    "order #",
    "order no",
    "tel:",
    "phone",
    "www.",
    "http",
)

SUMMARY_EXCLUDE_FROM_ITEMS = (
    "subtotal",
    "sub total",
    "sub-total",
    "sales tax",
    "tax",
    "vat",
    "gst",
    "hst",
    "tip",
    "gratuity",
    "grand total",
    "amount due",
    "balance due",
    "total due",
    "total paid",
    "total",
    "change",
    "cash",
    "visa",
    "mastercard",
    "amex",
    "discover",
    "debit",
    "credit card",
    "card",
    "payment",
    "tender",
    "auth",
    "balance",
)

QTY_PREFIX_RE = re.compile(r"^\s*(\d+)\s*[xX*]\s+(.+)$")


def parse_money(text: str) -> Optional[float]:
    """Extract the last well-formed monetary amount from a text snippet."""
    matches = list(MONEY_RE.finditer(text))
    if not matches:
        matches = list(FLEX_MONEY_RE.finditer(text))
    if not matches:
        return None
    m = matches[-1]
    raw_num = m.group("num")
    if "," in raw_num and "." not in raw_num:
        raw_num = raw_num.replace(",", ".")
    else:
        raw_num = raw_num.replace(",", "")
    try:
        value = float(raw_num)
    except ValueError:
        return None
    if m.group("sign") == "-":
        value = -value
    return round(value, 2)


def _extract_merchant_name(lines: list[str]) -> Optional[str]:
    """Identify the most likely store/merchant name from top receipt lines."""
    for line in lines[:8]:
        cleaned = re.sub(r"\s+", " ", line).strip(" *#-_=:")
        if len(cleaned) < 2 or len(cleaned) > 80:
            continue
        lower = cleaned.lower()
        if any(hint in lower for hint in NON_MERCHANT_HINTS):
            continue
        if re.fullmatch(r"[\d\W]+", cleaned):
            continue
        if parse_money(cleaned) is not None and len(re.sub(r"[\d.$€£,\s-]", "", cleaned)) < 3:
            continue
        if any(p.search(cleaned) for p, _ in DATE_PATTERNS):
            continue
        # Skip pure street-address lines like "123 Main St" when searching top header.
        if re.match(r"^\d+\s+[A-Za-z0-9.\s]+(st|street|ave|avenue|rd|road|blvd|ln|lane|dr|drive)\b", lower):
            continue
        return cleaned
    return None


def _extract_date(lines: list[str]) -> Optional[str]:
    """Extract and normalize receipt date to ISO YYYY-MM-DD when unambiguously parseable."""
    for line in lines:
        for pattern, formats in DATE_PATTERNS:
            match = pattern.search(line)
            if not match:
                continue
            candidate = re.sub(r"\s+", " ", match.group(1)).strip()
            for fmt in formats:
                try:
                    parsed = datetime.strptime(candidate, fmt)
                    if 1990 <= parsed.year <= 2100:
                        return parsed.strftime("%Y-%m-%d")
                except ValueError:
                    continue
    return None


def _amount_from_line_or_next(lines: list[str], idx: int) -> Optional[float]:
    """Read money amount from the current line or the immediate next line if split."""
    val = parse_money(lines[idx])
    if val is not None:
        return val
    if idx + 1 < len(lines):
        next_line = lines[idx + 1].strip()
        if len(next_line) <= 20:
            return parse_money(next_line)
    return None


def _extract_totals(lines: list[str]) -> dict[str, Optional[float]]:
    """Extract subtotal, tax, tip, and grand total without confusing labels."""
    subtotal: Optional[float] = None
    tax: Optional[float] = None
    tip: Optional[float] = None
    grand_total: Optional[float] = None

    for idx, line in enumerate(lines):
        lower = line.lower()

        if any(k in lower for k in ("subtotal", "sub-total", "sub total", "net amount", "merchandise total")):
            val = _amount_from_line_or_next(lines, idx)
            if val is not None:
                subtotal = val
            continue

        if any(k in lower for k in ("sales tax", "tax", "vat", "gst", "hst", "pst")) and not any(
            skip in lower for skip in ("tax id", "tax invoice", "taxable", "before tax", "pre-tax")
        ):
            val = _amount_from_line_or_next(lines, idx)
            if val is not None:
                tax = val
            continue

        if any(k in lower for k in ("tip", "gratuity")):
            val = _amount_from_line_or_next(lines, idx)
            if val is not None:
                tip = val
            continue

        if any(
            k in lower
            for k in ("grand total", "total due", "amount due", "balance due", "total paid", "total")
        ) and not any(excl in lower for excl in ("subtotal", "sub-total", "sub total", "items", "qty")):
            val = _amount_from_line_or_next(lines, idx)
            if val is not None:
                grand_total = val

    return {
        "subtotal": subtotal,
        "tax": tax,
        "tip": tip,
        "total_amount": grand_total,
    }


def _extract_line_items(lines: list[str]) -> list[dict[str, Any]]:
    """Parse item rows containing a product description followed by a monetary price."""
    items: list[dict[str, Any]] = []

    for line in lines:
        lower = line.lower()
        if any(keyword in lower for keyword in SUMMARY_EXCLUDE_FROM_ITEMS):
            continue
        if any(p.search(line) for p, _ in DATE_PATTERNS):
            continue

        match = re.match(r"^(?P<desc>.+?)\s+(?P<price>-?[\$€£]?\s*\d+(?:[.,]\d{2}))\s*[A-Za-z]?$", line)
        if not match:
            continue

        desc = match.group("desc").strip(" .:-")
        price = parse_money(match.group("price"))
        if not desc or price is None or len(desc) < 2:
            continue
        if re.fullmatch(r"[\d\W]+", desc):
            continue

        quantity: Optional[float] = None
        qty_match = QTY_PREFIX_RE.match(desc)
        if qty_match:
            quantity = float(qty_match.group(1))
            desc = qty_match.group(2).strip()

        item: dict[str, Any] = {"name": desc, "price": price}
        if quantity is not None:
            item["quantity"] = quantity
        items.append(item)

    return items


def parse_receipt_text(lines: list[str], raw_text: str) -> dict[str, Any]:
    """Parse OCR or embedded PDF text into structured receipt fields."""
    clean_lines = [line.strip() for line in lines if line and line.strip()]
    if not clean_lines and raw_text:
        clean_lines = [line.strip() for line in raw_text.splitlines() if line.strip()]

    merchant_name = _extract_merchant_name(clean_lines)
    receipt_date = _extract_date(clean_lines)
    totals = _extract_totals(clean_lines)
    line_items = _extract_line_items(clean_lines)

    return {
        "merchant_name": merchant_name,
        "date": receipt_date,
        "line_items": line_items,
        "subtotal": totals["subtotal"],
        "tax": totals["tax"],
        "tip": totals["tip"],
        "total_amount": totals["total_amount"],
        "currency": "USD",
    }
