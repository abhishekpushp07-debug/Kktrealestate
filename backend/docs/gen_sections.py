"""Generate data-driven appendix sections (markdown) from the live code/DB so the documentation stays accurate.
Writes /app/docs/generated/*.md. Run from /app/backend."""
import asyncio
import json
import os
import re
import sys
import urllib.request

sys.path.insert(0, "/app/backend")
from dotenv import load_dotenv  # noqa: E402

load_dotenv("/app/backend/.env")
OUT = "/app/docs/generated"
os.makedirs(OUT, exist_ok=True)


def api_map():
    spec = json.load(urllib.request.urlopen("http://localhost:8001/api/openapi.json", timeout=30))
    groups = {}
    for path, ops in spec["paths"].items():
        for method, op in ops.items():
            tag = (op.get("tags") or ["misc"])[0]
            summary = op.get("summary") or op.get("operationId", "").replace("_", " ")
            desc = (op.get("description") or "").strip().split("\n")[0]
            groups.setdefault(tag, []).append((method.upper(), path, summary, desc[:110]))
    perms = {}
    for root, _, files in os.walk("/app/backend/routers"):
        for f in files:
            if f.endswith(".py"):
                src = open(os.path.join(root, f)).read()
                for m in re.finditer(r'@router\.(get|post|patch|put|delete)\("([^"]*)"[^\n]*\n(?:[^\n]*\n){0,3}?[^\n]*require\("([a-z_.]+)"', src):
                    perms[(m.group(1).upper(), m.group(2))] = m.group(3)
    lines = ["## A. API map (generated from the OpenAPI specification)", "", f"Total endpoints: **{sum(len(v) for v in groups.values())}** across **{len(groups)}** routers. All paths are prefixed `/api`. Permission is the `require(...)` guard on the endpoint (blank = public or authenticated-only).", ""]
    for tag in sorted(groups):
        lines += [f"### {tag}", "", "| Method | Path | Permission | Purpose |", "|---|---|---|---|"]
        for method, path, summary, desc in sorted(groups[tag], key=lambda x: (x[1], x[0])):
            rel = path.replace("/api", "", 1)
            perm = next((v for (m, p), v in perms.items() if m == method and rel.endswith(p) and p), "")
            lines.append(f"| {method} | `{path}` | {perm} | {summary} |")
        lines.append("")
    open(f"{OUT}/api_map.md", "w").write("\n".join(lines))
    return sum(len(v) for v in groups.values())


def permissions_md():
    from permissions import PERMISSION_GROUPS, SYSTEM_ROLES
    lines = ["### 3.4 Permission registry (generated from `permissions.py`)", "", "| Group | Permission | Description |", "|---|---|---|"]
    allp = []
    for group, items in PERMISSION_GROUPS:
        for key, desc in items:
            lines.append(f"| {group} | `{key}` | {desc} |")
            allp.append(key)
    roles = list(SYSTEM_ROLES.keys())
    lines += ["", f"### 3.5 Role × permission matrix ({len(roles)} system roles × {len(allp)} permissions)", "", "| Permission | " + " | ".join(roles) + " |", "|---|" + "---|" * len(roles)]
    for p in allp:
        lines.append(f"| `{p}` | " + " | ".join("●" if (SYSTEM_ROLES[r].get("permissions") == "*" or p in SYSTEM_ROLES[r].get("permissions", [])) else "" for r in roles) + " |")
    lines += ["", "Role scope notes:", ""]
    for r in roles:
        scope = "all projects" if r in ("Super Admin", "Accounts", "Marketing") else "assigned projects only"
        lines.append(f"- **{r}** — {SYSTEM_ROLES[r].get('description', '')}. Project scope: {scope}.")
    open(f"{OUT}/permissions.md", "w").write("\n".join(lines))


def _type(v):
    if v is None: return "null"
    if isinstance(v, bool): return "bool"
    if isinstance(v, int): return "int"
    if isinstance(v, float): return "float"
    if isinstance(v, str):
        if re.match(r"^\d{4}-\d{2}-\d{2}T", v): return "datetime (ISO)"
        if re.match(r"^\d{4}-\d{2}-\d{2}$", v): return "date (ISO)"
        if re.match(r"^[0-9a-f]{8}-[0-9a-f]{4}-", v): return "uuid (str)"
        return "str"
    if isinstance(v, list): return f"list[{_type(v[0]) if v else '…'}]"
    if isinstance(v, dict): return "object"
    return type(v).__name__


PURPOSE = {"companies": "Tenant/company master (name, numbering formats, demand due days, GST, bank details).", "users": "ERP users with role, project scope, password hash/history, MFA, lockout counters.", "roles": "System + custom roles with permission lists.", "projects": "Projects incl. address, RERA, unit counts, `website` sub-document (CMS/SEO/brochure gate/site-visit settings).", "blocks": "Towers/blocks: floors, floor-plan assignments, skip/refuge/podium, construction stages, legacy milestones.", "flats": "Units generated per block: number, floor, type snapshot, areas, price breakup, status, booking link.", "customers": "KYC-sealed customer master (PAN/Aadhaar encrypted + hashed), portal account flags.", "leads": "CRM leads with stage history, follow-ups, activities timeline, assignment.", "bookings": "Agreements: buckets (cash/account), plan snapshot, other charges, revisions, cancellation, drafts.", "demands": "Installment demands raised by the dues engine (one per booking+installment_seq).", "payments": "Receipts: amount in paise, category, mode, clearing status, reversal.", "ledger_rows": "Materialised running ledger per booking (rebuilt on every posting).", "payment_plans": "Payment plan masters with installments and triggers.", "payment_plan_assignments": "Plan ↔ project/tower assignment (default flag).", "construction_stages": "Construction stage master sequence.", "site_visits": "Site-visit bookings (SV numbers, slot, capacity, status, timeline).", "brochure_downloads": "One row per brochure download (sparkline source).", "brochure_tokens": "Signed-token nonces (TTL index) so a download link counts once.", "notifications": "ERP user notifications.", "portal_notifications": "Customer portal notifications (withdrawable).", "audit_logs": "Immutable audit trail (actor, action, entity, before/after, ip, request id).", "documents": "Uploaded files metadata (object-storage key, mime, size, sharing flags).", "construction_photos": "Stage photos with customer visibility.", "service_requests": "Customer service tickets with SLA, notes, attachments, rating.", "idempotency_keys": "Idempotency-Key → cached response for POSTs.", "rate_limits": "Mongo-backed sliding-window counters.", "refresh_tokens": "Rotating refresh tokens (family id, reuse detection).", "counters": "Atomic sequences per FY/kind + round-robin pointer.", "settings": "Key/value system settings (roles_version, seed markers, site settings).", "site_settings": "Public site settings (brand, phone, WhatsApp, offices, trust stats, round-robin).", "enquiries": "Website enquiry submissions (rate-limited, UTM).", "cms_banners": "Home hero banners.", "cms_testimonials": "Testimonials.", "cms_blog_posts": "Blog posts.", "cms_gallery": "Gallery items.", "cms_media": "CMS uploaded media.", "cms_pages": "Legal/static pages.", "portal_sessions": "Customer portal sessions/refresh tokens.", "parking_slots": "Parking inventory & allotment.", "rate_cards": "Rate cards per project/block.", "master_*": "Selection masters (flat types, amenities, banks, charge types, PLC types, document types…)."}


async def collections_md():
    from motor.motor_asyncio import AsyncIOMotorClient
    db = AsyncIOMotorClient(os.environ["MONGO_URL"])[os.environ["DB_NAME"]]
    names = sorted(await db.list_collection_names())
    lines = ["## 4. Data model — collections (generated from the live database)", "", f"{len(names)} collections. Field types are inferred from a representative document; `id` is always a UUID string (Mongo `_id` is never exposed). Money is stored as integer paise (`*_paise`). Dates are ISO strings.", ""]
    for n in names:
        if n.startswith("system."):
            continue
        doc = await db[n].find_one({}, {"_id": 0}) or {}
        idx = await db[n].index_information()
        cnt = await db[n].estimated_document_count()
        purpose = PURPOSE.get(n) or PURPOSE.get("master_*" if n.startswith("master_") else "") or ""
        lines += [f"### `{n}` ({cnt} docs)", "", purpose, "", "| Field | Type | Example / note |", "|---|---|---|"]
        for k, v in list(doc.items())[:40]:
            ex = json.dumps(v, default=str)[:60].replace("|", "\\|") if not isinstance(v, (dict, list)) else (f"{len(v)} keys" if isinstance(v, dict) else f"{len(v)} items")
            if k in ("password_hash", "mfa_secret", "pan_enc", "aadhaar_enc", "token_hash", "account_number_enc"):
                ex = "(secret — never returned)"
            lines.append(f"| `{k}` | {_type(v)} | {ex} |")
        ix = [f"`{', '.join(f'{f}:{d}' for f, d in i['key'])}`" + (" unique" if i.get("unique") else "") + (" partial" if i.get("partialFilterExpression") else "") + (" TTL" if "expireAfterSeconds" in i else "") for nm, i in idx.items() if nm != "_id_"]
        lines += ["", "Indexes: " + (", ".join(ix) if ix else "`_id` only"), ""]
    open(f"{OUT}/collections.md", "w").write("\n".join(lines))
    return len(names)


def errors_md():
    codes = {}
    for root, _, files in os.walk("/app/backend"):
        if "tests" in root or "node_modules" in root:
            continue
        for f in files:
            if f.endswith(".py"):
                for m in re.finditer(r'ApiError\((\d{3}), f?"([^"]*)", "([A-Z_]+)"', open(os.path.join(root, f)).read()):
                    codes.setdefault(m.group(3), (m.group(1), m.group(2), os.path.relpath(os.path.join(root, f), "/app/backend")))
    lines = ["## B. Error code catalogue (generated)", "", "Every error is `{detail, code, request_id}`; HTTP status is the first match in code. `VERSION_CONFLICT` (409) is returned when `version` in the body is stale (optimistic concurrency).", "", "| Code | HTTP | Message (example) | Raised in |", "|---|---|---|---|"]
    for c in sorted(codes):
        st, msg, f = codes[c]
        lines.append(f"| `{c}` | {st} | {msg[:90].replace('|', '/')} | `{f}` |")
    open(f"{OUT}/errors.md", "w").write("\n".join(lines))
    return len(codes)


def enums_md():
    src = {f: open(f"/app/backend/{f}").read() for f in ["routers/bookings.py", "routers/payments.py", "routers/leads.py", "routers/support.py", "routers/visits.py", "routers/flats.py", "routers/construction.py"]}
    found = []
    for f, s in src.items():
        for m in re.finditer(r'(\b[A-Z_]*(?:STATUS|STAGES|SOURCES|MODES|CATEGORIES|TYPES|PRIORIT)[A-Z_]*)\s*=\s*(\[[^\]]+\])', s):
            try:
                vals = json.loads(m.group(2).replace("'", '"'))
                found.append((f, m.group(1), vals))
            except Exception:
                pass
    lines = ["## D. Status & enum tables (generated)", "", "| Constant | File | Values |", "|---|---|---|"]
    for f, name, vals in found:
        if all(isinstance(v, str) for v in vals):
            lines.append(f"| `{name}` | `{f}` | {', '.join(vals)} |")
    open(f"{OUT}/enums.md", "w").write("\n".join(lines))


def tests_md():
    lines = ["### 21.1 Test suites (generated from `/app/backend/tests`)", "", "| File | Tests | Covers |", "|---|---|---|"]
    for f in sorted(os.listdir("/app/backend/tests")):
        if f.startswith("test_") and f.endswith(".py"):
            s = open(f"/app/backend/tests/{f}").read()
            n = len(re.findall(r"^\s*def test_", s, re.M))
            doc = (re.search(r'^"""(.*?)"""', s, re.S) or re.search(r"^# (.*)$", s, re.M))
            lines.append(f"| `{f}` | {n} | {(doc.group(1).strip().split(chr(10))[0] if doc else '—')[:120]} |")
    open(f"{OUT}/tests.md", "w").write("\n".join(lines))


if __name__ == "__main__":
    n_api = api_map()
    permissions_md()
    n_coll = asyncio.run(collections_md())
    n_err = errors_md()
    enums_md()
    tests_md()
    print({"endpoints": n_api, "collections": n_coll, "error_codes": n_err})
