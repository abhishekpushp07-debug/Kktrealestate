import requests

JPG = open("/app/backend/assets/elite_tower.jpg", "rb").read()


def _sgh(base_url, h):
    # demo project only — never write to owner-created projects
    items = requests.get(f"{base_url}/api/projects", headers=h, params={"page_size": 50}).json()["items"]
    return next(p for p in items if p["code"] == "SGH")


def test_cover_upload_round_trip(base_url, admin_headers):
    p = _sgh(base_url, admin_headers)
    before = requests.get(f"{base_url}/api/projects/{p['id']}/photos", headers=admin_headers).json()
    r = requests.post(
        f"{base_url}/api/projects/{p['id']}/cover",
        headers=admin_headers,
        files={"file": ("cover.jpg", JPG, "image/jpeg")},
    )
    assert r.status_code == 201, r.text
    url = r.json()["cover_image_url"]
    assert url.startswith(f"/api/public/project-cover/{p['id']}")
    g = requests.get(f"{base_url}{url}")
    assert g.status_code == 200 and g.content == JPG
    after = requests.get(f"{base_url}/api/projects/{p['id']}", headers=admin_headers).json()
    assert after["cover_image_url"] == url
    new_id = after["cover_photo_id"]
    requests.delete(f"{base_url}/api/projects/{p['id']}/photos/{new_id}", headers=admin_headers)
    requests.put(
        f"{base_url}/api/projects/{p['id']}/photos/order",
        headers=admin_headers,
        json={"ids": [x["id"] for x in before["photos"]], "cover_id": before["cover_photo_id"]},
    )


def test_cover_rejects_non_image(base_url, admin_headers):
    p = _sgh(base_url, admin_headers)
    r = requests.post(
        f"{base_url}/api/projects/{p['id']}/cover",
        headers=admin_headers,
        files={"file": ("x.txt", b"hello", "text/plain")},
    )
    assert r.status_code == 422
