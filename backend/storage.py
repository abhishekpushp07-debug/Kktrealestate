import asyncio
import logging
import os

import requests

logger = logging.getLogger("kkt.storage")
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = "kkt-erp"
_state = {"key": None}


def init_storage(force: bool = False):
    if _state["key"] and not force:
        return _state["key"]
    resp = requests.post(f"{STORAGE_URL}/init", json={"emergent_key": EMERGENT_KEY}, timeout=30)
    resp.raise_for_status()
    _state["key"] = resp.json()["storage_key"]
    return _state["key"]


def _put(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key, "Content-Type": content_type}, data=data, timeout=120)
    if resp.status_code == 404:
        key = init_storage(force=True)
        resp = requests.put(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key, "Content-Type": content_type}, data=data, timeout=120)
    resp.raise_for_status()
    return resp.json()


def _get(path: str) -> tuple[bytes, str]:
    key = init_storage()
    resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    if resp.status_code == 404:
        key = init_storage(force=True)
        resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


async def put_object(path: str, data: bytes, content_type: str) -> dict:
    return await asyncio.to_thread(_put, path, data, content_type)


async def get_object(path: str) -> tuple[bytes, str]:
    return await asyncio.to_thread(_get, path)


async def init_storage_async():
    try:
        await asyncio.to_thread(init_storage)
        logger.info("Object storage initialized")
    except Exception as e:
        logger.error("Object storage init failed: %s", e)


# ---- Phase J4: streaming primitives (no whole-file buffering) ----------------------------------------------------
def _put_stream(path: str, fileobj, content_type: str, size: int) -> dict:
    key = init_storage()
    headers = {"X-Storage-Key": key, "Content-Type": content_type, "Content-Length": str(size)}
    resp = requests.put(f"{STORAGE_URL}/objects/{path}", headers=headers, data=fileobj, timeout=900)
    if resp.status_code == 404:
        fileobj.seek(0)
        headers["X-Storage-Key"] = init_storage(force=True)
        resp = requests.put(f"{STORAGE_URL}/objects/{path}", headers=headers, data=fileobj, timeout=900)
    resp.raise_for_status()
    return resp.json()


def _iter_stream(path: str, chunk: int = 1 << 20):
    key = init_storage()
    with requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=900, stream=True) as resp:
        resp.raise_for_status()
        yield from resp.iter_content(chunk)


async def put_stream(path: str, fileobj, content_type: str, size: int) -> dict:
    """Upload from an open file object (chunked transfer, memory O(chunk))."""
    return await asyncio.to_thread(_put_stream, path, fileobj, content_type, size)


def iter_object(path: str, chunk: int = 1 << 20):
    """Sync generator of bytes for StreamingResponse (run in threadpool by Starlette)."""
    return _iter_stream(path, chunk)


def _delete(path: str) -> None:
    key = init_storage()
    resp = requests.delete(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": key}, timeout=60)
    if resp.status_code not in (200, 204, 404, 405):  # 405: gateway without delete → parts are orphaned, listed by upload record for GC
        resp.raise_for_status()


async def delete_object(path: str) -> None:
    await asyncio.to_thread(_delete, path)
