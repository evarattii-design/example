import sqlite3
from datetime import date
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models import Receipt
from app.schemas import ReceiptCreate, ReceiptResponse, ReceiptUpdate

REQUIRED_COLUMNS = {
    "id",
    "filename",
    "merchant_name",
    "date",
    "total_amount",
    "extracted_json",
    "created_at",
}


@pytest.fixture()
def sqlite_session(tmp_path: Path):
    """Create a temporary local SQLite database and yield an ORM session."""
    db_file = tmp_path / "test_receipts.db"
    engine = create_engine(f"sqlite:///{db_file.as_posix()}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = TestingSessionLocal()
    try:
        yield session, db_file, engine
    finally:
        session.close()
        engine.dispose()


def test_receipts_table_has_required_columns(sqlite_session):
    """Verify the SQLite receipts table exposes every required column."""
    _, db_file, engine = sqlite_session

    inspector = inspect(engine)
    assert "receipts" in inspector.get_table_names()

    orm_columns = {col["name"] for col in inspector.get_columns("receipts")}
    assert REQUIRED_COLUMNS.issubset(orm_columns)

    with sqlite3.connect(db_file) as conn:
        pragma_rows = conn.execute("PRAGMA table_info(receipts)").fetchall()
    sqlite_columns = {row[1] for row in pragma_rows}
    assert REQUIRED_COLUMNS.issubset(sqlite_columns)


def test_receipt_create_read_and_update(sqlite_session):
    """Verify creating, reading, and updating a receipt via schemas and SQLite ORM."""
    session, _, _ = sqlite_session

    payload = ReceiptCreate(
        filename="coffee_shop.jpg",
        merchant_name="Blue Bottle Coffee",
        date=date(2026, 11, 25),
        total_amount=14.75,
        extracted_json='{"items": [{"name": "Latte", "price": 6.50}], "currency": "USD"}',
    )

    row = Receipt(**payload.model_dump())
    session.add(row)
    session.commit()
    session.refresh(row)

    response = ReceiptResponse.model_validate(row)
    assert response.id == 1
    assert response.filename == "coffee_shop.jpg"
    assert response.merchant_name == "Blue Bottle Coffee"
    assert response.date == "2026-11-25"
    assert response.total_amount == 14.75
    assert response.extracted_json == {"items": [{"name": "Latte", "price": 6.50}], "currency": "USD"}
    assert response.created_at is not None

    update_payload = ReceiptUpdate(total_amount=15.0)
    for field, value in update_payload.model_dump(exclude_unset=True).items():
        setattr(row, field, value)
    session.commit()
    session.refresh(row)

    updated = ReceiptResponse.model_validate(row)
    assert updated.total_amount == 15.0
    assert updated.merchant_name == "Blue Bottle Coffee"
