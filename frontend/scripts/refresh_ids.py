"""Refresh p3_ids.json from the live preview (IDs change on every demo reseed). Read-only.
usage: KKT_DEMO_PASSWORD=… python refresh_ids.py https://<preview>"""

import json
import os
import sys

import requests

api = sys.argv[1].rstrip("/") + "/api"
t = requests.post(api + "/auth/login", json={"email": "admin@kkt.in", "password": os.environ["KKT_DEMO_PASSWORD"]}).json()
h = {"Authorization": "Bearer " + (t.get("access_token") or t.get("token"))}


def first(path, **k):
    items = requests.get(api + path, headers=h, params={"page_size": 1, **k}).json().get("items") or [{}]
    return items[0].get("id")


ids = {
    "booking": first("/bookings", status="Active"),
    "customer": first("/customers", card_segment="overdue30"),
    "project": first("/projects", search="Shree Ganesh Heights"),
    "ye": first("/projects", search="Ye"),
    "payment": first("/payments"),
    "demand": None,
    "service_request": first("/service-requests"),
}
if not ids["demand"]:  # the bill register is grouped (no flat list) — take the newest open bill of the booking above
    from dotenv import load_dotenv
    from pymongo import MongoClient

    load_dotenv("/app/backend/.env")
    d = MongoClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]].demands.find_one(
        {"booking_id": ids["booking"], "voided": {"$ne": True}}, {"_id": 0, "id": 1}, sort=[("demand_date", -1)]
    )
    ids["demand"] = (d or {}).get("id")
json.dump(ids, open(os.path.join(os.path.dirname(__file__), "p3_ids.json"), "w"))
print(ids)
