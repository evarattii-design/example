from typing import Any, Optional


def _round_money(value: Optional[float]) -> Optional[float]:
    """Normalize numeric monetary values to 2 decimal places."""
    if value is None:
        return None
    return round(float(value), 2)


def validate_and_finalize(
    parsed: dict[str, Any],
    extraction_method: str,
    ocr_confidence: Optional[float],
    raw_text: str,
) -> tuple[dict[str, Any], str]:
    """Validate monetary consistency, preserve missing fields as null, and flag uncertainties."""
    merchant_name = parsed.get("merchant_name") or None
    receipt_date = parsed.get("date") or None
    subtotal = _round_money(parsed.get("subtotal"))
    tax = _round_money(parsed.get("tax"))
    tip = _round_money(parsed.get("tip"))
    total_amount = _round_money(parsed.get("total_amount"))

    line_items = []
    for item in parsed.get("line_items") or []:
        name = str(item.get("name", "")).strip()
        if not name:
            continue
        cleaned_item: dict[str, Any] = {
            "name": name,
            "price": _round_money(item.get("price")),
        }
        if item.get("quantity") is not None:
            cleaned_item["quantity"] = item["quantity"]
        line_items.append(cleaned_item)

    uncertain_fields: list[str] = []
    warnings: list[str] = []

    if not raw_text.strip():
        warnings.append("No readable text could be extracted from this document.")

    if not merchant_name:
        uncertain_fields.append("merchant_name")
        warnings.append("Merchant name could not be identified.")

    if not receipt_date:
        uncertain_fields.append("date")
        warnings.append("Receipt date could not be detected.")

    if total_amount is None:
        uncertain_fields.append("total_amount")
        warnings.append("Grand total could not be detected; missing value preserved as null.")

    if subtotal is not None and total_amount is not None:
        if subtotal > total_amount + 0.05:
            uncertain_fields.extend(["subtotal", "total_amount"])
            warnings.append(
                f"Subtotal ({subtotal:.2f}) exceeds grand total ({total_amount:.2f})."
            )
        else:
            expected_total = round(subtotal + (tax or 0.0) + (tip or 0.0), 2)
            if abs(expected_total - total_amount) > 0.15:
                warnings.append(
                    f"Subtotal + tax + tip ({expected_total:.2f}) differs from total ({total_amount:.2f})."
                )

    if line_items:
        priced_items = [item["price"] for item in line_items if item["price"] is not None]
        if priced_items:
            items_sum = round(sum(priced_items), 2)
            reference = subtotal if subtotal is not None else total_amount
            if reference is not None and abs(items_sum - reference) > max(0.5, reference * 0.25):
                warnings.append(
                    f"Sum of parsed line items ({items_sum:.2f}) differs from receipt {'subtotal' if subtotal is not None else 'total'} ({reference:.2f})."
                )

    if ocr_confidence is not None and ocr_confidence < 0.65:
        warnings.append(
            f"Average OCR confidence is low ({ocr_confidence:.0%}); please verify extracted values."
        )

    deduped_uncertain = list(dict.fromkeys(uncertain_fields))
    status = (
        "Processed"
        if merchant_name and total_amount is not None and not warnings
        else "Needs Review"
    )

    extracted_json = {
        "merchant_name": merchant_name,
        "date": receipt_date,
        "line_items": line_items,
        "subtotal": subtotal,
        "tax": tax,
        "tip": tip,
        "total_amount": total_amount,
        "currency": parsed.get("currency") or "USD",
        "extraction_method": extraction_method,
        "ocr_confidence": ocr_confidence,
        "uncertain_fields": deduped_uncertain,
        "warnings": warnings,
        "raw_text": raw_text,
    }
    return extracted_json, status
