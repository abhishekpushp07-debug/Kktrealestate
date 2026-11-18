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
    """Timeout scales with payload (200 MB under load needs > 120 s); transient 5xx / timeouts retried 3× with backoff."""
    import time

    key = init_storage()
    timeout = 120 + len(data) // (1024 * 1024)
    last = None
    for attempt in range(3):
        try:
            resp = requests.put(
                f"{STORAGE_URL}/objects/{path}",
                headers={"X-Storage-Key": key, "Content-Type": content_type},
                data=data,
                timeout=timeout,
            )
            if resp.status_code == 404:
                key = init_storage(force=True)
                resp = requests.put(
                    f"{STORAGE_URL}/objects/{path}",
                    headers={"X-Storage-Key": key, "Content-Type": content_type},
                    data=data,
                    timeout=timeout,
                )
            if resp.status_code >= 500:
                raise requests.HTTPError(f"storage {resp.status_code}", response=resp)
            resp.raise_for_status()
            return resp.json()
        except (requests.HTTPError, requests.ConnectionError, requests.Timeout) as e:
            if isinstance(e, requests.HTTPError) and e.response is not None and e.response.status_code < 500:
                raise
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise last


def _transient(fn, what: str):
    """Gateway 5xx / connection reset / timeout under load are retried 3× with backoff (4xx are real answers)."""
    import time

    last = None
    for attempt in range(3):
        try:
            resp = fn()
            if resp.status_code >= 500:
                raise requests.HTTPError(f"storage {resp.status_code}", response=resp)
            return resp
        except (requests.HTTPError, requests.ConnectionError, requests.Timeout) as e:
            last = e
            logger.warning("storage %s transient (attempt %d): %s", what, attempt + 1, e)
            time.sleep(1.5 * (attempt + 1))
    raise last


def _get(path: str) -> tuple[bytes, str]:
    def go():
        resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": init_storage()}, timeout=60)
        if resp.status_code == 404:
            init_storage(force=True)
            resp = requests.get(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": _state["key"]}, timeout=60)
        return resp

    resp = _transient(go, "get")
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
        logging.getLogger(__name__).debug("handled error", exc_info=True)
        logger.error("Object storage init failed: %s", e)


# ---- Phase J4: streaming primitives (no whole-file buffering) ----------------------------------------------------
def _put_stream(path: str, fileobj, content_type: str, size: int) -> dict:
    headers = {"Content-Type": content_type, "Content-Length": str(size)}

    def go():
        fileobj.seek(0)  # every attempt re-sends the whole spool
        resp = requests.put(
            f"{STORAGE_URL}/objects/{path}",
            headers={**headers, "X-Storage-Key": init_storage()},
            data=fileobj,
            timeout=900,
        )
        if resp.status_code == 404:
            fileobj.seek(0)
            init_storage(force=True)
            resp = requests.put(
                f"{STORAGE_URL}/objects/{path}",
                headers={**headers, "X-Storage-Key": _state["key"]},
                data=fileobj,
                timeout=900,
            )
        return resp

    resp = _transient(go, "put_stream")
    resp.raise_for_status()
    return resp.json()


def _iter_stream(path: str, chunk: int = 1 << 20):
    resp = _transient(  # retried only while opening; once bytes flow a failure surfaces (no silent splice)
        lambda: requests.get(
            f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": init_storage()}, timeout=900, stream=True
        ),
        "iter",
    )
    with resp:
        resp.raise_for_status()
        yield from resp.iter_content(chunk)


async def put_stream(path: str, fileobj, content_type: str, size: int) -> dict:
    """Upload from an open file object (chunked transfer, memory O(chunk))."""
    return await asyncio.to_thread(_put_stream, path, fileobj, content_type, size)


def iter_object(path: str, chunk: int = 1 << 20):
    """Sync generator of bytes for StreamingResponse (run in threadpool by Starlette)."""
    return _iter_stream(path, chunk)


def _delete(path: str) -> None:
    resp = _transient(
        lambda: requests.delete(f"{STORAGE_URL}/objects/{path}", headers={"X-Storage-Key": init_storage()}, timeout=60),
        "delete",
    )
    if resp.status_code not in (
        200,
        204,
        404,
        405,
    ):  # 405: gateway without delete → parts are orphaned, listed by upload record for GC
        resp.raise_for_status()


async def delete_object(path: str) -> None:
    await asyncio.to_thread(_delete, path)
