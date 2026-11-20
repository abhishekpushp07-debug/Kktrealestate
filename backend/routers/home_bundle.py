"""Phase 2D Home Command Center: ONE bundle endpoint (`GET /api/home/bundle`). Each widget is computed in isolation
(a failure returns {ok: false} for that widget only) and only widgets the user's role may see are ever computed."""

import asyncio

from fastapi import APIRouter, Depends, Query, Request

from deps import ensure_project_access, report_scope_filter, require
from routers import home_defs as H
from routers.catalogues import etag_response
from routers.home_layout import WIDGETS, allowed_widgets, present_layout
from services import clock
from services.money import present_money

router = APIRouter(prefix="/home", tags=["home"])
STATIC = ("next_milestone", "inventory", "flat_status", "construction", "pipeline")
STATIC_DEPS = ("bills", "bookings", "inventory", "leads", "other")


@router.get("/bundle")
async def bundle(
    request: Request,
    period: str = Query("month", pattern="^(today|month|fy)$"),
    project_id: str | None = None,
    user: dict = Depends(require("masters.project.view")),
):
    from db import db
    from services import stamps, ttlcache

    if project_id:
        ensure_project_access(user, project_id)
    today = clock.today()
    key = f"home:bundle:{user['id']}:{ttlcache.scope_key(user)}:{today.isoformat()}:{period}:{project_id or ''}"

    async def compute():
        layout = present_layout(
            await db.user_home_layouts.find_one({"user_id": user["id"], "company_id": user["company_id"]}, {"_id": 0}),
            user,
        )
        want = {w["id"] for w in layout["widgets"] if w["visible"]} & set(allowed_widgets(user))
        base = {"company_id": user["company_id"], **report_scope_filter(user)} | (
            {"project_id": project_id} if project_id else {}
        )
        rng = H.period_range(period, today)
        perms = set(user["permissions"])
        out = {}
        need_age = "ageing" in want or ("call_today" in want and "reports.outstanding.view" in perms)

        async def age():
            return await H.guarded(H.ageing, user, base, project_id, today) if need_age else None

        async def blk():
            return (
                await H._blocks(base) if want & {"next_milestone", "inventory", "flat_status", "construction"} else []
            )

        async def run(jobs: dict) -> dict:
            ids = [i for i in jobs if i in want]
            return dict(zip(ids, await asyncio.gather(*(H.guarded(*jobs[i]) for i in ids))))

        async def money():
            return await run(
                {
                    "money_today": (H.money_today, user, base, project_id, today),
                    "due_vs_received": (H.due_vs_received, user, base, project_id, rng),
                    "inflow_30": (H.inflow_30, user, base, project_id, today),
                    "attention": (H.attention, user, base, project_id),
                }
            )

        async def static_widgets():
            async def compute_static():
                blocks = await blk()
                return await run(
                    {
                        "next_milestone": (H.next_milestone, user, base, blocks),
                        "inventory": (H.inventory, user, base, blocks),
                        "flat_status": (H.flat_status, user, base, blocks),
                        "construction": (H.construction, user, base, blocks),
                        "pipeline": (H.pipeline, user, base, project_id, rng),
                    }
                )

            if not want & set(STATIC):
                return {}
            # 3I: kept ready across saves that don't touch them (a receipt never recomputes towers / stock / pipeline);
            # the per-domain stamp is shared by every process, so another server's save is seen at once
            st = await stamps.read(user["company_id"], STATIC_DEPS)
            skey = f"home:static:{key}:{','.join(sorted(want & set(STATIC)))}:{st}"
            return await ttlcache.cached(skey, 300, compute_static, stamped=True, stamp=st)

        # 3I: ageing runs beside every other widget; Call today starts at once and waits only for ageing's list
        age_task = asyncio.ensure_future(age())

        async def per():
            res = await age_task
            return res["data"][1] if res is not None and res["ok"] else None

        async def call():
            return await H.guarded(H.call_today, user, base, project_id, today, per) if "call_today" in want else None

        res, m, s, ct = await asyncio.gather(age_task, money(), static_widgets(), call())
        others = m | s
        if res is not None:
            if res["ok"]:
                res["data"] = res["data"][0]
            if "ageing" in want:
                out["ageing"] = res
        if ct is not None:
            out["call_today"] = ct
        out |= others
        order = ("ageing", "money_today", "due_vs_received", "call_today", "inflow_30", "next_milestone", "inventory")
        order += ("flat_status", "construction", "pipeline", "attention")
        out = {i: out[i] for i in order if i in out}  # same key order as before
        projects = (
            await db.projects.find(
                {"company_id": user["company_id"], "is_active": True, **report_scope_filter(user, "id")},
                {"_id": 0, "id": 1, "name": 1, "code": 1},
            )
            .sort("name", 1)
            .to_list(50)
        )
        return present_money(
            {
                "business_day": today.isoformat(),
                "business_hour": clock.now(clock.business_tz()).hour,
                "computed_at": clock.now().isoformat(),
                "period": {"id": period, "from": rng[0], "to": rng[1], "label": rng[2]},
                "project_id": project_id,
                "projects": projects,
                "layout": layout,
                "labels": {i: WIDGETS[i][0] for i in WIDGETS},
                "widgets": out,
            }
        )

    return etag_response(request, await ttlcache.cached(key, 10, compute), max_age=0)
