"""REQ-181…184 project photos: add, reorder, cover pick, remove, refusal; SGH keeps the Elite tower cover."""

import requests

JPG = open("/app/backend/assets/elite_tower.jpg", "rb").read()


def _sgh(base_url, h):
    items = requests.get(f"{base_url}/api/projects", headers=h, params={"page_size": 50}).json()["items"]
    return next(p for p in items if p["code"] == "SGH")


def test_photos_lifecycle_restores_cover(base_url, admin_headers):
    h = admin_headers
    p = _sgh(base_url, h)
    base = f"{base_url}/api/projects/{p['id']}/photos"
    before = requests.get(base, headers=h).json()
    assert before["photos"], "SGH must carry the Elite tower cover (REQ-184)"
    added = []
    for n in range(2):
        r = requests.post(base, headers=h, files={"file": (f"p{n}.jpg", JPG, "image/jpeg")})
        assert r.status_code == 201, r.text
        added.append(r.json()["photos"][-1]["id"])
    assert r.json()["cover_photo_id"] == before["cover_photo_id"]  # adding never steals the cover
    ids = [x["id"] for x in r.json()["photos"]]
    rev = list(reversed(ids))
    r = requests.put(f"{base}/order", headers=h, json={"ids": rev, "cover_id": added[0]})
    assert r.status_code == 200 and [x["id"] for x in r.json()["photos"]] == rev
    assert r.json()["cover_photo_id"] == added[0]
    pub = requests.get(f"{base_url}{r.json()['cover_image_url']}")
    assert pub.status_code == 200 and pub.content == JPG
    g = requests.get(f"{base_url}/api/projects/{p['id']}", headers=h).json()
    assert g["cover_photo_id"] == added[0] and all("storage_key" not in x for x in g["photos"])
    for pid in added:
        assert requests.delete(f"{base}/{pid}", headers=h).status_code == 200
    r = requests.put(
        f"{base}/order",
        headers=h,
        json={"ids": [x["id"] for x in before["photos"]], "cover_id": before["cover_photo_id"]},
    )
    assert r.status_code == 200 and r.json()["cover_photo_id"] == before["cover_photo_id"]


def test_photo_refusal_message(base_url, admin_headers):
    p = _sgh(base_url, admin_headers)
    base = f"{base_url}/api/projects/{p['id']}/photos"
    for f in [("x.txt", b"hello", "text/plain"), ("big.jpg", JPG[:4] + b"0" * (15 * 1024 * 1024 + 1), "image/jpeg")]:
        r = requests.post(base, headers=admin_headers, files={"file": f})
        assert r.status_code == 422 and "Photo must be an image under 15 MB" in r.text
