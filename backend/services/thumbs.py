"""Image variants for uploaded photos: thumb (480px) and medium (1080px) WebP, generated on upload and pre-warmed at startup."""
import asyncio
import hashlib
import io

from storage import get_object, put_object

SIZES = {"thumb": 480, "medium": 1080}


def make_variant(data: bytes, width: int) -> bytes:
    from PIL import Image, ImageOps
    im = Image.open(io.BytesIO(data))
    im = ImageOps.exif_transpose(im)
    if im.mode not in ("RGB", "RGBA"):
        im = im.convert("RGB")
    im.thumbnail((width, width * 2))
    out = io.BytesIO()
    im.save(out, "WEBP", quality=78 if width <= 480 else 82, method=4)
    return out.getvalue()


def make_thumb(data: bytes) -> bytes:
    return make_variant(data, SIZES["thumb"])


def variant_key(key: str, size: str = "thumb") -> str:
    base = key.rsplit(".", 1)[0]
    return f"thumbs/{base}.webp" if size == "thumb" else f"{size}/{base}.webp"


thumb_key = variant_key


async def ensure_variant(key: str, size: str, data: bytes | None = None) -> str:
    vk = variant_key(key, size)
    try:
        await get_object(vk)
        return vk
    except Exception:
        pass
    if data is None:
        data, _ = await get_object(key)
    await put_object(vk, await asyncio.to_thread(make_variant, data, SIZES[size]), "image/webp")
    return vk


async def ensure_thumb(key: str, data: bytes | None = None) -> str:
    for size in SIZES:
        await ensure_variant(key, size, data)
    return variant_key(key, "thumb")


async def get_variant(key: str, size: str | None) -> tuple[bytes, str]:
    if size in SIZES:
        try:
            return (await get_object(await ensure_variant(key, size)))[0], "image/webp"
        except Exception:
            pass
    return await get_object(key)


def etag_for(data: bytes) -> str:
    return '"' + hashlib.sha1(data).hexdigest()[:20] + '"'


async def prewarm_variants(db, concurrency: int = 2) -> dict:
    """Generate missing thumb/medium variants for active photos & CMS media (admin one-off job; variants are otherwise created lazily on first request)."""
    sem = asyncio.Semaphore(concurrency)
    keys = [d["storage_key"] async for d in db.construction_photos.find({"is_active": True}, {"_id": 0, "storage_key": 1})]
    keys += [d["storage_key"] async for d in db.cms_media.find({}, {"_id": 0, "storage_key": 1})]
    made, failed = 0, 0
    async def one(k, size):
        nonlocal made, failed
        async with sem:
            try:
                await get_object(variant_key(k, size))
                return
            except Exception:
                pass
            try:
                await ensure_variant(k, size)
                made += 1
            except Exception:
                failed += 1
    await asyncio.gather(*(one(k, size) for k in dict.fromkeys(keys) for size in SIZES))
    return {"photos": len(set(keys)), "generated": made, "failed": failed}
