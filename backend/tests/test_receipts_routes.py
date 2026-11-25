import io
from pathlib import Path

import pymupdf
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFont
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app
from app.routes import receipts as receipts_route


def _render_receipt_image_bytes(image_format: str) -> bytes:
    """Create a realistic synthetic receipt image in PNG or JPEG format for OCR tests."""
    img = Image.new("RGB", (760, 760), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    font_path = Path(r"C:\Windows\Fonts\arial.ttf")
    font = (
        ImageFont.truetype(str(font_path), 24)
        if font_path.is_file()
        else ImageFont.load_default(size=24)
    )
    lines = [
        "BLUE BOTTLE COFFEE",
        "123 Market St, San Francisco",
        "Date: 2026-11-24",
        "------------------------------",
        "Caffe Latte             6.50",
        "Almond Croissant        5.25",
        "------------------------------",
        "Subtotal               11.75",
        "Sales Tax               1.00",
        "Tip                     2.00",
        "Grand Total            14.75",
    ]
    y = 40
    for line in lines:
        draw.text((40, y), line, fill=(15, 15, 15), font=font)
        y += 55

    buf = io.BytesIO()
    img.save(buf, format=image_format)
    return buf.getvalue()


def _render_receipt_pdf_bytes() -> bytes:
    """Create a realistic text-based PDF receipt for PDF extraction tests."""
    doc = pymupdf.open()
    page = doc.new_page(width=420, height=560)
    lines = [
        "TRADER JOE'S",
        "Receipt Date: 2026-11-20",
        "Organic Honeycrisp Apples    4.99",
        "Sourdough Boule              3.99",
        "Subtotal                     8.98",
        "Tax                          0.00",
        "Total                        8.98",
    ]
    y = 60
    for line in lines:
        page.insert_text((40, y), line, fontsize=12)
        y += 28
    pdf_bytes = doc.tobytes()
    doc.close()
    return pdf_bytes


@pytest.fixture()
def api_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Provide an isolated SQLite DB and upload directory per test."""
    db_file = tmp_path / "test_api.db"
    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(receipts_route, "UPLOAD_DIR", upload_dir)

    engine = create_engine(
        f"sqlite:///{db_file.as_posix()}",
        connect_args={"check_same_thread": False},
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def _override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as client:
        yield client, upload_dir, engine
    app.dependency_overrides.clear()
    engine.dispose()


def test_health_endpoint(api_client):
    client, _, _ = api_client
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_upload_png_receipt_and_ocr_extraction(api_client):
    client, upload_dir, _ = api_client
    png_bytes = _render_receipt_image_bytes("PNG")

    resp = client.post(
        "/upload",
        files={"file": ("coffee_receipt.png", png_bytes, "image/png")},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["filename"] == "coffee_receipt.png"
    assert data["merchant_name"] is not None
    normalized_merchant = data["merchant_name"].upper().replace(" ", "")
    assert "BLUEBOTTLE" in normalized_merchant
    assert data["date"] == "2026-11-24"
    assert data["total_amount"] == 14.75
    assert data["extracted_json"]["subtotal"] == 11.75
    assert data["extracted_json"]["tax"] == 1.0
    assert data["extracted_json"]["tip"] == 2.0
    assert len(data["extracted_json"]["line_items"]) >= 2
    assert len(list(upload_dir.iterdir())) == 1


def test_upload_jpg_receipt_extraction(api_client):
    client, _, _ = api_client
    jpg_bytes = _render_receipt_image_bytes("JPEG")

    resp = client.post(
        "/upload",
        files={"file": ("coffee_receipt.jpg", jpg_bytes, "image/jpeg")},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["filename"] == "coffee_receipt.jpg"
    assert data["total_amount"] == 14.75
    assert data["date"] == "2026-11-24"


def test_upload_pdf_receipt_extraction_and_crud_lifecycle(api_client):
    client, upload_dir, engine = api_client
    pdf_bytes = _render_receipt_pdf_bytes()

    resp = client.post(
        "/upload",
        files={"file": ("grocery.pdf", pdf_bytes, "application/pdf")},
    )
    assert resp.status_code == 201
    created = resp.json()
    receipt_id = created["id"]

    assert created["merchant_name"] == "TRADER JOE'S"
    assert created["date"] == "2026-11-20"
    assert created["total_amount"] == 8.98
    assert created["status"] == "Processed"
    assert created["extracted_json"]["extraction_method"] == "pdf_text"

    # GET all receipts
    list_resp = client.get("/receipts")
    assert list_resp.status_code == 200
    assert list_resp.json()["total"] == 1
    assert list_resp.json()["receipts"][0]["id"] == receipt_id

    # GET individual receipt
    get_resp = client.get(f"/receipts/{receipt_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["merchant_name"] == "TRADER JOE'S"

    # PUT update receipt
    put_resp = client.put(
        f"/receipts/{receipt_id}",
        json={"merchant_name": "Trader Joe's #104", "total_amount": 9.48},
    )
    assert put_resp.status_code == 200
    assert put_resp.json()["merchant_name"] == "Trader Joe's #104"
    assert put_resp.json()["total_amount"] == 9.48

    # DELETE receipt and verify file cleanup
    del_resp = client.delete(f"/receipts/{receipt_id}")
    assert del_resp.status_code == 204
    assert list(upload_dir.iterdir()) == []
    assert client.get(f"/receipts/{receipt_id}").status_code == 404

    # Ensure required columns exist in SQLite table
    cols = {c["name"] for c in inspect(engine).get_columns("receipts")}
    assert {"id", "filename", "merchant_name", "date", "total_amount", "extracted_json", "created_at"}.issubset(cols)


def test_upload_rejects_invalid_and_missing_files(api_client):
    client, _, _ = api_client

    # Missing file
    missing_resp = client.post("/upload")
    assert missing_resp.status_code == 422

    # Disallowed extension
    txt_resp = client.post(
        "/upload",
        files={"file": ("notes.txt", b"hello world", "text/plain")},
    )
    assert txt_resp.status_code == 400

    # Spoofed extension (text bytes labeled as .png)
    spoof_resp = client.post(
        "/upload",
        files={"file": ("fake.png", b"not actually a png", "image/png")},
    )
    assert spoof_resp.status_code == 400


def test_missing_fields_preserved_as_null_and_flagged(api_client):
    client, _, _ = api_client
    img = Image.new("RGB", (400, 200), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    draw.text((40, 80), "THANK YOU FOR VISITING", fill=(20, 20, 20))
    buf = io.BytesIO()
    img.save(buf, format="PNG")

    resp = client.post(
        "/upload",
        files={"file": ("partial.png", buf.getvalue(), "image/png")},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["status"] == "Needs Review"
    assert data["total_amount"] is None
    assert data["date"] is None
    assert "total_amount" in data["extracted_json"]["uncertain_fields"]
