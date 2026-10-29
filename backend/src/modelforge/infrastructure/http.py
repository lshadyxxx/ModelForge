"""Small HTTP transport helpers shared by API entrypoints."""
from __future__ import annotations

from fastapi import Request

from modelforge.errors import AppError


async def read_bounded_body(
    request: Request,
    max_bytes: int,
    *,
    too_large_message: str,
    empty_message: str,
) -> bytes:
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > max_bytes:
            raise AppError(413, "file_too_large", too_large_message)
        data.extend(chunk)
    if not data:
        raise AppError(422, "validation_error", empty_message, [{"path": "body", "message": "Empty file"}])
    return bytes(data)
