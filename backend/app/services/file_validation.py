import io
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from uuid import uuid4

import pymupdf
from fastapi import HTTPException, status
from PIL import Image, UnidentifiedImageError

MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(10 * 1024 * 1024)))
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".pdf"}

EXTENSION_MIME_MAP: dict[str, set[str]] = {
    ".jpg": {"image/jpeg", "image/jpg", "application/octet-stream", ""},
    ".jpeg": {"image/jpeg", "image/jpg", "application/octet-stream", ""},
    ".png": {"image/png", "application/octet-stream", ""},
    ".pdf": {"application/pdf", "application/octet-stream", ""},
}


@dataclass(frozen=True)
class ValidatedUpload:
    """Metadata for a validated and safely persisted upload."""

    original_filename: str
    stored_filename: str
    file_path: Path
    file_type: Literal["image", "pdf"]
    content_bytes: bytes


def sanitize_filename(filename: str) -> str:
    """Strip directory components and unsafe characters from an uploaded filename."""
    base_name = Path(filename).name.strip()
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "_", base_name)
    cleaned = cleaned.lstrip(".")
    if not cleaned:
        return "receipt"
    return cleaned[:100]


def _has_valid_magic_bytes(ext: str, content: bytes) -> bool:
    """Verify the file signature matches the declared extension."""
    if ext in {".jpg", ".jpeg"}:
        return content.startswith(b"\xff\xd8\xff")
    if ext == ".png":
        return content.startswith(b"\x89PNG\r\n\x1a\n")
    if ext == ".pdf":
        header = content[:1024].lstrip(b"\xef\xbb\xbf \t\r\n")
        return b"%PDF-" in header[:64]
    return False


def _verify_file_structure(file_type: Literal["image", "pdf"], content: bytes) -> None:
    """Ensure the image or PDF bytes can be opened without structural corruption."""
    if file_type == "image":
        try:
            with Image.open(io.BytesIO(content)) as img:
                img.verify()
        except (UnidentifiedImageError, OSError, ValueError) as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded image appears corrupted or unreadable.",
            ) from exc
    else:
        try:
            with pymupdf.open(stream=content, filetype="pdf") as doc:
                if doc.page_count < 1:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Uploaded PDF contains no pages.",
                    )
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded PDF appears corrupted or encrypted.",
            ) from exc


def validate_and_save_upload(
    filename: str | None,
    content_type: str | None,
    content: bytes,
    upload_dir: Path,
) -> ValidatedUpload:
    """Validate extension, MIME type, size, magic signature, and structure, then store safely."""
    if not filename or not filename.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing filename on uploaded file.",
        )

    safe_name = sanitize_filename(filename)
    ext = Path(safe_name).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported file type. Allowed formats: JPG, JPEG, PNG, PDF.",
        )

    normalized_mime = (content_type or "").split(";")[0].strip().lower()
    if normalized_mime not in EXTENSION_MIME_MAP[ext]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"MIME type '{normalized_mime}' does not match file extension '{ext}'.",
        )

    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded file is empty.",
        )

    if len(content) > MAX_UPLOAD_BYTES:
        max_mb = MAX_UPLOAD_BYTES // (1024 * 1024)
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"File exceeds maximum allowed size of {max_mb} MB.",
        )

    if not _has_valid_magic_bytes(ext, content):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File content signature does not match its extension.",
        )

    file_type: Literal["image", "pdf"] = "pdf" if ext == ".pdf" else "image"
    _verify_file_structure(file_type, content)

    upload_dir.mkdir(parents=True, exist_ok=True)
    stored_filename = f"{uuid4().hex}_{safe_name}"
    target_path = (upload_dir / stored_filename).resolve()
    if upload_dir.resolve() not in target_path.parents:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid upload destination path.",
        )

    target_path.write_bytes(content)
    return ValidatedUpload(
        original_filename=safe_name,
        stored_filename=stored_filename,
        file_path=target_path,
        file_type=file_type,
        content_bytes=content,
    )
