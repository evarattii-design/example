from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy.orm import Session

from app.database import UPLOAD_DIR, get_db
from app.models import Receipt
from app.schemas import ReceiptListResponse, ReceiptResponse, ReceiptUpdate
from app.services.document_processor import process_document
from app.services.extraction import parse_receipt_text
from app.services.file_validation import validate_and_save_upload
from app.services.validation import validate_and_finalize

router = APIRouter(tags=["receipts"])


def _get_receipt_or_404(db: Session, receipt_id: int) -> Receipt:
    """Fetch a receipt by primary key or raise HTTP 404 if missing."""
    receipt = db.get(Receipt, receipt_id)
    if receipt is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Receipt {receipt_id} not found.",
        )
    return receipt


def _delete_stored_file(stored_filename: str | None) -> None:
    """Safely remove an uploaded file inside UPLOAD_DIR if it exists."""
    if not stored_filename:
        return
    base = UPLOAD_DIR.resolve()
    target = (base / stored_filename).resolve()
    if base in target.parents and target.is_file():
        target.unlink(missing_ok=True)


@router.post("/upload", response_model=ReceiptResponse, status_code=status.HTTP_201_CREATED)
async def upload_receipt(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> Receipt:
    """Validate, OCR/extract, validate fields, and persist an uploaded receipt."""
    content = await file.read()
    validated = validate_and_save_upload(
        filename=file.filename,
        content_type=file.content_type,
        content=content,
        upload_dir=UPLOAD_DIR,
    )

    try:
        processed = process_document(validated.content_bytes, validated.file_type)
        parsed = parse_receipt_text(processed.lines, processed.raw_text)
        extracted_json, receipt_status = validate_and_finalize(
            parsed=parsed,
            extraction_method=processed.extraction_method,
            ocr_confidence=processed.ocr_confidence,
            raw_text=processed.raw_text,
        )
    except HTTPException:
        _delete_stored_file(validated.stored_filename)
        raise
    except Exception as exc:
        _delete_stored_file(validated.stored_filename)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Failed to process and extract text from the uploaded receipt.",
        ) from exc

    receipt = Receipt(
        filename=validated.original_filename,
        stored_filename=validated.stored_filename,
        merchant_name=extracted_json.get("merchant_name"),
        date=extracted_json.get("date"),
        total_amount=extracted_json.get("total_amount"),
        status=receipt_status,
        error_message=None,
        extracted_json=extracted_json,
    )
    db.add(receipt)
    db.commit()
    db.refresh(receipt)
    return receipt


@router.get("/receipts", response_model=ReceiptListResponse)
def get_receipts(
    merchant_name: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
) -> ReceiptListResponse:
    """Return all saved receipts with optional merchant or status filtering."""
    query = db.query(Receipt)
    if merchant_name:
        query = query.filter(Receipt.merchant_name.ilike(f"%{merchant_name.strip()}%"))
    if status_filter:
        query = query.filter(Receipt.status == status_filter.strip())

    rows = query.order_by(Receipt.created_at.desc(), Receipt.id.desc()).all()
    return ReceiptListResponse(total=len(rows), receipts=rows)


@router.get("/receipts/{receipt_id}", response_model=ReceiptResponse)
def get_receipt(receipt_id: int, db: Session = Depends(get_db)) -> Receipt:
    """Return a single receipt record and its extracted JSON payload."""
    return _get_receipt_or_404(db, receipt_id)


def _apply_receipt_update(receipt: Receipt, payload: ReceiptUpdate, db: Session) -> Receipt:
    """Apply partial or full field updates and keep extracted_json synchronized."""
    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(receipt, field, value)

    if isinstance(receipt.extracted_json, dict):
        synced = dict(receipt.extracted_json)
        if "merchant_name" in updates:
            synced["merchant_name"] = receipt.merchant_name
        if "date" in updates:
            synced["date"] = receipt.date
        if "total_amount" in updates:
            synced["total_amount"] = receipt.total_amount
        receipt.extracted_json = synced

    db.commit()
    db.refresh(receipt)
    return receipt


@router.put("/receipts/{receipt_id}", response_model=ReceiptResponse)
def replace_receipt(
    receipt_id: int,
    payload: ReceiptUpdate,
    db: Session = Depends(get_db),
) -> Receipt:
    """Update corrected receipt information."""
    receipt = _get_receipt_or_404(db, receipt_id)
    return _apply_receipt_update(receipt, payload, db)


@router.patch("/receipts/{receipt_id}", response_model=ReceiptResponse)
def patch_receipt(
    receipt_id: int,
    payload: ReceiptUpdate,
    db: Session = Depends(get_db),
) -> Receipt:
    """Partially update corrected receipt information."""
    receipt = _get_receipt_or_404(db, receipt_id)
    return _apply_receipt_update(receipt, payload, db)


@router.delete("/receipts/{receipt_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_receipt(receipt_id: int, db: Session = Depends(get_db)) -> None:
    """Delete a receipt from SQLite and remove its uploaded file if present."""
    receipt = _get_receipt_or_404(db, receipt_id)
    stored_filename = receipt.stored_filename
    db.delete(receipt)
    db.commit()
    _delete_stored_file(stored_filename)
