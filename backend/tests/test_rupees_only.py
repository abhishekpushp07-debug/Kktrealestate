"""Rupees-only guarantee (Phase C4): no user-visible 'paise' in the ERP UI source, the 4 PDFs, or CSV export headers."""
import io
import os
import re

import requests

FRONTEND_SRC = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "src")


def test_frontend_has_no_visible_paise_strings():
    hits = []
    for root, _, files in os.walk(FRONTEND_SRC):
        for f in files:
            if not f.endswith((".js", ".jsx", ".ts", ".tsx")):
                continue
            for n, line in enumerate(open(os.path.join(root, f), encoding="utf-8"), 1):
                if "paise" not in line.lower():
                    continue
                stripped = re.sub(r"\w*_paise\w*|\w*paise_\w*", "", line, flags=re.I)  # API field names are fine
                stripped = re.sub(r"//.*$|/\*.*?\*/", "", stripped)  # comments
                if re.search(r"\bpaise\b", stripped, re.I):
                    hits.append(f"{f}:{n}: {line.strip()[:120]}")
    assert not hits, "\n".join(hits)


def _pdf_text(content: bytes) -> str:
    from pypdf import PdfReader
    return "\n".join((p.extract_text() or "") for p in PdfReader(io.BytesIO(content)).pages)


def test_pdfs_and_csv_have_no_paise(base_url, admin_headers):
    bk = next(x for x in requests.get(f"{base_url}/api/bookings?page_size=50&search=BK-2526-0001", headers=admin_headers).json()["items"] if x["booking_number"] == "BK-2526-0001")
    b = requests.get(f"{base_url}/api/bookings/{bk['id']}", headers=admin_headers).json()
    urls = [f"/api/bookings/{b['id']}/statement.pdf", f"/api/bookings/{b['id']}/allotment.pdf"]
    if b.get("payments"):
        urls.append(f"/api/payments/{b['payments'][0]['id']}/receipt.pdf")
    if b.get("demands"):
        urls.append(f"/api/bookings/{b['id']}/demands/{b['demands'][0]['id']}/letter.pdf")
    assert len(urls) == 4, urls
    for u in urls:
        r = requests.get(f"{base_url}{u}", headers=admin_headers)
        assert r.status_code == 200 and r.content[:4] == b"%PDF", (u, r.status_code)
        txt = _pdf_text(r.content)
        assert "paise" not in txt.lower(), (u, [ln for ln in txt.splitlines() if "paise" in ln.lower()][:3])
        assert "KKT Constructions" in txt, (u, txt[:200])
    reports = requests.get(f"{base_url}/api/reports", headers=admin_headers).json()
    keys = [x["key"] if isinstance(x, dict) else x for x in (reports.get("items") or reports)]
    checked = 0
    for k in keys:
        r = requests.get(f"{base_url}/api/reports/{k}", params={"format": "csv"}, headers=admin_headers)
        if r.status_code != 200 or not r.headers.get("content-type", "").startswith("text/csv"):
            continue
        header = r.text.splitlines()[0] if r.text else ""
        assert "paise" not in header.lower(), (k, header)
        checked += 1
    assert checked >= 3, checked
