import logging
from collections import defaultdict
from collections.abc import Awaitable, Callable

from db import db

logger = logging.getLogger("kkt.events")


class EventBus:
    """In-process event bus. Subscribers run sequentially after publish (awaited) so audit is durable before response."""

    def __init__(self):
        self._subs: dict[str, list[Callable[[dict], Awaitable[None]]]] = defaultdict(list)

    def subscribe(self, topic: str):
        def deco(handler):
            self._subs[topic].append(handler)
            return handler
        return deco

    async def publish(self, topic: str, payload: dict):
        for h in self._subs.get(topic, []) + self._subs.get("*", []):
            try:
                await h({"topic": topic, **payload})
            except Exception:
                logger.exception("event handler failed for %s", topic)


bus = EventBus()


@bus.subscribe("entity.changed")
async def audit_subscriber(evt: dict):
    from utils import new_id, now_iso
    actor = evt.get("actor")
    await db.audit_logs.insert_one({
        "id": new_id(), "company_id": evt.get("company_id"),
        "actor_id": actor["id"] if actor else "system", "actor_name": actor["name"] if actor else "System",
        "action": evt["action"], "entity_type": evt["entity_type"], "entity_id": evt["entity_id"],
        "before": evt.get("before"), "after": evt.get("after"), "ip": evt.get("ip", ""), "created_at": now_iso(),
    })


@bus.subscribe("entity.changed")
async def roles_version_bump(evt: dict):
    if evt["entity_type"] == "role":
        await db.settings.update_one({"key": "roles_version"}, {"$inc": {"value": 1}}, upsert=True)
