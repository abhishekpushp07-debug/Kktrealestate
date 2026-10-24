"""Legacy milestone routes (pre-Phase 7) — kept as aliases over the construction-stage module."""
from fastapi import APIRouter, Depends, Request
from pydantic import Field

from db import db
from deps import require
from routers.construction import StageSetIn, UndoIn, block_construction, ensure_block_stages, set_current_stage, undo_stage
from utils import ApiError, StrictModel, get_or_404

router = APIRouter(prefix="/blocks", tags=["milestones (legacy alias)"])


@router.get("/{block_id}/milestones")
async def list_milestones(block_id: str, user: dict = Depends(require("project.read"))):
    res = await block_construction(block_id, user)
    return {"block": res["block"], "construction_percent": res["construction_percent"], "milestones": [{"seq": s["seq"], "name": s["name"], "status": s["status"], "completed_on": s.get("completed_on"), "stage_id": s["stage_id"], "cumulative_percent": round(s["seq"] * 100 / len(res["stages"]), 2)} for s in res["stages"]], "stages": res["stages"]}


class CompleteIn(StrictModel):
    completed_on: str
    notes: str | None = Field(default=None, max_length=500)
    version: int | None = None


async def _stage_id(block_id: str, seq: int, user: dict) -> str:
    block = await get_or_404(db.blocks, block_id, "Block", {"company_id": user["company_id"]})
    st = next((s for s in await ensure_block_stages(block) if s["seq"] == seq), None)
    if not st:
        raise ApiError(404, "Milestone/stage not found", "NOT_FOUND")
    return st["stage_id"]


@router.post("/{block_id}/milestones/{seq}/complete")
async def complete_milestone(block_id: str, seq: int, body: CompleteIn, request: Request, user: dict = Depends(require("construction.update"))):
    from datetime import date
    sid = await _stage_id(block_id, seq, user)
    return await set_current_stage(block_id, StageSetIn(stage_id=sid, completed_on=date.fromisoformat(body.completed_on), notes=body.notes, version=body.version), request, user)


@router.post("/{block_id}/milestones/{seq}/undo")
async def undo_milestone(block_id: str, seq: int, body: UndoIn, request: Request, user: dict = Depends(require("construction.undo"))):
    return await undo_stage(block_id, body, request, user)
