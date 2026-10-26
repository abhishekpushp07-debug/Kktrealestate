"""Phase M.1: tower creation never needs a project version; statement PDF prints the two-sided ledger."""
import uuid

import requests

from tests.conftest import BASE as ROOT, session_token

API = f"{ROOT}/api"


def _h():
    return {"Authorization": f"Bearer {session_token('admin@kkt.in', 'Kkt@12345')}"}


def test_tower_create_without_project_version_and_cosmetic_patch_without_version():
    h = _h()
    proj = requests.get(f"{API}/projects?page_size=5", headers=h, timeout=30).json()["items"][0]
    bt = requests.get(f"{API}/master/block-types?page_size=20", headers=h, timeout=30).json()["items"][0]
    ft = requests.get(f"{API}/master/flat-types?page_size=20", headers=h, timeout=30).json()["items"][0]
    code = f"V{uuid.uuid4().hex[:2].upper()}"
    body = {"project_id": proj["id"], "block_type_id": bt["id"], "name": f"Ver-{code}", "code": code, "floors": 2, "flats_per_floor": 2, "floor_start": 1, "numbering_pattern": "{block}-{floor}{pos2}", "position_flat_types": [{"position": 1, "flat_type_id": ft["id"]}, {"position": 2, "flat_type_id": ft["id"]}]}
    r = requests.post(f"{API}/blocks", headers=h, json=body, timeout=60)
    assert r.status_code == 201, r.text
    blk = r.json()
    # bump the block version behind the form's back (what a stage-plan save does), then a cosmetic patch without version must still succeed
    sp = requests.post(f"{API}/stage-plans", headers=h, json={"name": f"v-{code}", "project_id": proj["id"], "block_id": blk["id"], "stage_ids": [s["id"] for s in requests.get(f"{API}/master/construction-stages?page_size=5", headers=h, timeout=30).json()["items"][:2]]}, timeout=30)
    assert sp.status_code == 201, sp.text
    r2 = requests.patch(f"{API}/blocks/{blk['id']}", headers=h, json={"name": f"Ver-{code} renamed", "block_type_id": bt["id"]}, timeout=30)
    assert r2.status_code == 200, r2.text
    stale = requests.patch(f"{API}/blocks/{blk['id']}", headers=h, json={"name": "x", "version": blk["version"]}, timeout=30)
    assert stale.status_code == 409  # optimistic check still works when a version IS supplied
    flats = requests.get(f"{API}/flats?block_id={blk['id']}&page_size=10", headers=h, timeout=30).json()
    assert (flats.get("total") or len(flats["items"])) == 4


def test_statement_pdf_two_sided():
    from io import BytesIO

    from pypdf import PdfReader
    h = _h()
    b = requests.get(f"{API}/bookings?status=Active&page_size=1", headers=h, timeout=30).json()["items"][0]
    r = requests.get(f"{API}/bookings/{b['id']}/statement.pdf", headers=h, timeout=60)
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    t = "".join(p.extract_text() for p in PdfReader(BytesIO(r.content)).pages)
    for needle in ("Ledger (Udhar / Jama)", "Udhar", "Jama", "Mode / Instrument", "Balance", "Total Udhar", "Total Jama", "Advance held"):
        assert needle in t, needle
    r2 = requests.get(f"{API}/bookings/{b['id']}/statement.pdf", headers=h, timeout=60)
    assert r.content == r2.content  # deterministic bytes



def test_allotment_pdf_two_sided_position():
    from io import BytesIO

    from pypdf import PdfReader
    h = _h()
    b = requests.get(f"{API}/bookings?status=Active&page_size=1", headers=h, timeout=30).json()["items"][0]
    r = requests.get(f"{API}/reports/allotment/{b['id']}?format=pdf", headers=h, timeout=60)
    assert r.status_code == 200 and r.content.startswith(b"%PDF")
    t = "".join(p.extract_text() for p in PdfReader(BytesIO(r.content)).pages)
    for needle in ("Account position", "Udhar", "Jama", "Total Udhar", "Total Jama", "Advance held"):
        assert needle in t, needle
    assert r.content == requests.get(f"{API}/reports/allotment/{b['id']}?format=pdf", headers=h, timeout=60).content
