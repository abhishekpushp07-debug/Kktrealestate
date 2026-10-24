"""Magic-byte sniffing for uploads (content-type header is not trusted)."""
SIGS = {
    "application/pdf": [b"%PDF-"],
    "image/jpeg": [b"\xff\xd8\xff"],
    "image/png": [b"\x89PNG\r\n\x1a\n"],
    "image/webp": [b"RIFF"],
    "image/x-icon": [b"\x00\x00\x01\x00"],
}


def sniff(data: bytes, declared: str) -> str | None:
    """Return the verified mime or None if bytes don't match the declared type."""
    if declared == "image/svg+xml":
        head = data[:512].lstrip().lower()
        return declared if head.startswith(b"<svg") or (head.startswith(b"<?xml") and b"<svg" in data[:2048].lower()) else None
    if declared == "image/webp":
        return declared if data[:4] == b"RIFF" and data[8:12] == b"WEBP" else None
    return declared if any(data.startswith(s) for s in SIGS.get(declared, [])) else None
