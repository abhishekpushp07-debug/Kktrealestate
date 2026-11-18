"""In-app notifications fan-out (leaf service: no routers imports)."""

from db import db
from utils import base_doc, now_iso


async def notify_roles(
    company_id: str,
    roles: list[str],
    title: str,
    body: str,
    kind: str,
    entity_type: str,
    entity_id: str,
    link: str | None = None,
    exclude: set | None = None,
):
    role_ids = [
        r["id"]
        for r in await db.roles.find({"company_id": company_id, "name": {"$in": roles}}, {"_id": 0, "id": 1}).to_list(
            None
        )
    ]
    users = [
        u
        for u in await db.users.find(
            {
                "company_id": company_id,
                "$or": [{"role_id": {"$in": role_ids}}, {"role_ids": {"$in": role_ids}}],
                "is_active": True,
            },
            {"_id": 0, "id": 1},
        ).to_list(None)
        if u["id"] not in (exclude or set())
    ]
    if not users:
        return
    now = now_iso()
    await db.notifications.insert_many(
        [
            {
                **base_doc(None, company_id),
                "user_id": u["id"],
                "title": title,
                "body": body,
                "kind": kind,
                "entity_type": entity_type,
                "entity_id": entity_id,
                "link": link,
                "read": False,
                "created_at": now,
            }
            for u in users
        ]
    )


async def notify_users(
    company_id: str,
    user_ids: list[str],
    title: str,
    body: str,
    kind: str,
    entity_type: str,
    entity_id: str,
    link: str | None = None,
):
    ids = [u for u in dict.fromkeys(user_ids) if u]
    if not ids:
        return
    now = now_iso()
    await db.notifications.insert_many(
        [
            {
                **base_doc(None, company_id),
                "user_id": u,
                "title": title,
                "body": body,
                "kind": kind,
                "entity_type": entity_type,
                "entity_id": entity_id,
                "link": link,
                "read": False,
                "created_at": now,
            }
            for u in ids
        ]
    )
