import json
from datetime import date as DateType, datetime
from typing import Annotated, Any, Literal, Optional, Union

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

ReceiptStatus = Literal["Processed", "Needs Review", "Processing", "Failed"]


def _coerce_date(value: Any) -> Optional[str]:
    """Normalize date or datetime instances to ISO-8601 strings."""
    if value is None:
        return None
    if isinstance(value, (DateType, datetime)):
        return value.isoformat()
    trimmed = str(value).strip()
    return trimmed or None


def _parse_extracted_json(value: Any) -> Optional[Union[dict[str, Any], list[Any]]]:
    """Parse JSON strings into Python dicts or lists when provided as text."""
    if value is None:
        return None
    if isinstance(value, str):
        return json.loads(value)
    return value


DateStr = Annotated[Optional[str], Field(max_length=64), BeforeValidator(_coerce_date)]
JsonPayload = Annotated[
    Optional[Union[dict[str, Any], list[Any]]],
    BeforeValidator(_parse_extracted_json),
]


class LineItemSchema(BaseModel):
    """Structured line item extracted from a receipt."""

    name: str
    price: Optional[float] = None
    quantity: Optional[float] = None


class ReceiptBase(BaseModel):
    """Shared fields and validation rules for receipt records."""

    filename: str = Field(..., min_length=1, max_length=255)
    merchant_name: Optional[str] = Field(default=None, max_length=255)
    date: DateStr = None
    total_amount: Optional[float] = None
    status: ReceiptStatus = "Processed"
    error_message: Optional[str] = None
    extracted_json: JsonPayload = Field(default_factory=dict)


class ReceiptCreate(ReceiptBase):
    """Schema for creating a new receipt row."""


class ReceiptUpdate(BaseModel):
    """Schema for updating an existing receipt row."""

    filename: Optional[str] = Field(default=None, min_length=1, max_length=255)
    merchant_name: Optional[str] = Field(default=None, max_length=255)
    date: DateStr = None
    total_amount: Optional[float] = None
    status: Optional[ReceiptStatus] = None
    error_message: Optional[str] = None
    extracted_json: JsonPayload = None


class ReceiptResponse(ReceiptBase):
    """Schema returned when reading receipt records from the API/database."""

    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ReceiptListResponse(BaseModel):
    """Paginated/summary wrapper returned by GET /receipts."""

    total: int
    receipts: list[ReceiptResponse]
