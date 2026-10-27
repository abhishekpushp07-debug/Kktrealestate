"""Phase J4: resumable chunked uploads, magic-byte validation, variants isolation, signed URLs, streaming download, legal hold, no key leak."""
import hashlib
import io
import os
import sys
import time

import requests

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tests.conftest import BASE  # noqa: E402

PART = 5 * 1024 * 1024


def _png(w=64, h=64):
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (200, 120, 40)).save(buf, "PNG")
    return buf.getvalue()


def _upload(h, filename, data, parts_to_drop=(), **meta):
    size = len(data)
    r = requests.post(f"{BASE}/api/uploads/init", json={"filename": filename, "size": size, **meta}, headers=h)
    assert r.status_code == 201, r.text
    up = r.json()
    assert up["part_size"] == PART and "storage_key" not in up
    n = up["parts"]
    for i in range(1, n + 1):
        if i in parts_to_drop:
            continue  # simulate a dropped part
        chunk = data[(i - 1) * PART: i * PART]
        rr = requests.put(f"{BASE}/api/uploads/{up['id']}/parts/{i}", data=chunk, headers={**h, "X-Part-Sha256": hashlib.sha256(chunk).hexdigest()})
        assert rr.status_code == 200, rr.text
    return up


def test_200mb_upload_resumes_after_dropped_part(admin_headers):
    """40 × 5 MB parts; part 17 is dropped, complete() refuses, resume lists exactly the missing part, then completes."""
    body = b"%PDF-1.4\n" + os.urandom(1024) + bytes(200 * 1024 * 1024 - 1024 - 9)
    up = _upload(admin_headers, "deed-scan.pdf", body, parts_to_drop={17}, kind="document", entity_type="booking", entity_id="t-booking")
    r = requests.post(f"{BASE}/api/uploads/{up['id']}/complete", headers=admin_headers)
    assert r.status_code == 409 and r.json()["code"] == "UPLOAD_INCOMPLETE" and r.json()["missing"] == [17]
    st = requests.get(f"{BASE}/api/uploads/{up['id']}", headers=admin_headers).json()
    assert 17 not in st["received_parts"] and len(st["received_parts"]) == 39
    chunk = body[16 * PART: 17 * PART]
    bad = requests.put(f"{BASE}/api/uploads/{up['id']}/parts/17", data=chunk, headers={**admin_headers, "X-Part-Sha256": "0" * 64})
    assert bad.status_code == 422 and bad.json()["code"] == "PART_HASH_MISMATCH"
    ok = requests.put(f"{BASE}/api/uploads/{up['id']}/parts/17", data=chunk, headers={**admin_headers, "X-Part-Sha256": hashlib.sha256(chunk).hexdigest()})
    assert ok.status_code == 200
    r = requests.post(f"{BASE}/api/uploads/{up['id']}/complete", headers=admin_headers)
    assert r.status_code == 201, r.text
    f = r.json()
    assert f["size"] == len(body) and f["sha256"] == hashlib.sha256(body).hexdigest() and "storage_key" not in f
    # streaming download with correct filename via the signed link only
    d = requests.get(f"{BASE}{f['url']}", stream=True)
    assert d.status_code == 200 and 'filename="deed-scan.pdf"' in d.headers["Content-Disposition"] and d.headers["Cache-Control"] == "private, no-store"
    got = hashlib.sha256()
    for c in d.iter_content(1 << 20):
        got.update(c)
    assert got.hexdigest() == f["sha256"]
    assert requests.get(f"{BASE}/api/files/{f['id']}/download").status_code == 401
    assert requests.get(f"{BASE}/api/files/{f['id']}/download?exp=1&sig=deadbeef").status_code == 403


def test_magic_bytes_and_extension_allow_list(admin_headers):
    r = requests.post(f"{BASE}/api/uploads/init", json={"filename": "x.exe", "size": 10}, headers=admin_headers)
    assert r.status_code == 415 and r.json()["code"] == "FILE_TYPE_NOT_ALLOWED"
    up = _upload(admin_headers, "fake.jpg", b"not really a jpeg" * 100)
    r = requests.post(f"{BASE}/api/uploads/{up['id']}/complete", headers=admin_headers)
    assert r.status_code == 415 and r.json()["code"] == "FILE_SIGNATURE_MISMATCH"
    assert requests.post(f"{BASE}/api/uploads/init", json={"filename": "a.pdf", "size": 501 * 1024 * 1024}, headers=admin_headers).status_code == 413


def test_corrupt_image_does_not_stop_variant_batch(admin_headers):
    """Two good PNGs + one PNG-signature file with garbage body: good ones get 3 WebP variants, bad one is 'failed', job run records the error."""
    ids = []
    for name, data in (("a.png", _png()), ("bad.png", b"\x89PNG\r\n\x1a\n" + os.urandom(4000)), ("b.png", _png(300, 200))):
        up = _upload(admin_headers, name, data, kind="construction_photo", entity_type="milestone", entity_id="t-ms", project_id="t-proj")
        r = requests.post(f"{BASE}/api/uploads/{up['id']}/complete", headers=admin_headers)
        assert r.status_code == 201, r.text
        ids.append(r.json()["id"])
    deadline = time.time() + 60
    states = {}
    while time.time() < deadline:
        rows = requests.get(f"{BASE}/api/files", params={"entity_type": "milestone", "entity_id": "t-ms"}, headers=admin_headers).json()["items"]
        states = {x["id"]: x for x in rows if x["id"] in ids}
        if all(states[i]["variants_state"] in ("ready", "failed") for i in ids if i in states) and len(states) == 3:
            break
        time.sleep(1)
    assert states[ids[0]]["variants_state"] == "ready" and states[ids[2]]["variants_state"] == "ready" and states[ids[1]]["variants_state"] == "failed"
    v = states[ids[2]]["variants"]
    assert set(v) == {"thumb", "medium", "large"} and all(u.startswith("/api/files/variants/") and u.endswith(".webp") for u in v.values())
    img = requests.get(f"{BASE}{v['thumb']}")
    assert img.status_code == 200 and img.headers["Cache-Control"].endswith("immutable") and img.content[:4] == b"RIFF"
    from PIL import Image
    assert dict(Image.open(io.BytesIO(img.content)).getexif()) == {}
    assert Image.open(io.BytesIO(requests.get(f"{BASE}{v['large']}").content)).size[0] <= 2048


def test_legal_hold_blocks_delete_and_storage_card(admin_headers):
    up = _upload(admin_headers, "hold.pdf", b"%PDF-1.4\n" + b"x" * 500, kind="document", entity_type="ticket", entity_id="t-tkt", project_id="t-proj")
    f = requests.post(f"{BASE}/api/uploads/{up['id']}/complete", headers=admin_headers).json()
    assert requests.patch(f"{BASE}/api/files/{f['id']}", json={"legal_hold": True}, headers=admin_headers).status_code == 200
    r = requests.delete(f"{BASE}/api/files/{f['id']}", headers=admin_headers)
    assert r.status_code == 409 and r.json()["code"] == "FILE_RETAINED"
    requests.patch(f"{BASE}/api/files/{f['id']}", json={"legal_hold": False}, headers=admin_headers)
    assert requests.delete(f"{BASE}/api/files/{f['id']}", headers=admin_headers).status_code == 200
    ops = requests.get(f"{BASE}/api/admin/ops", headers=admin_headers).json()
    assert isinstance(ops.get("storage"), list) and any(row["project_id"] == "t-proj" and row["bytes"] > 0 for row in ops["storage"])


def test_raw_storage_key_never_in_api_responses(admin_headers):
    """Leak scan: every files/uploads payload must not contain 'storage_key' or a 'files/<xx>/' object key."""
    up = _upload(admin_headers, "leak.png", _png(), kind="document", entity_type="leak", entity_id="t-leak")
    payloads = [requests.get(f"{BASE}/api/uploads/{up['id']}", headers=admin_headers).text, requests.post(f"{BASE}/api/uploads/{up['id']}/complete", headers=admin_headers).text,
                requests.get(f"{BASE}/api/files", params={"entity_type": "leak"}, headers=admin_headers).text]
    fid = requests.get(f"{BASE}/api/files", params={"entity_type": "leak"}, headers=admin_headers).json()["items"][0]["id"]
    payloads.append(requests.get(f"{BASE}/api/files/{fid}/url", headers=admin_headers).text)
    for p in payloads:
        assert "storage_key" not in p and '"files/' not in p and "uploads/" not in p.replace("/api/uploads/", "")
