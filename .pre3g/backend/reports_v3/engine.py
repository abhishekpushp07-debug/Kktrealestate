"""REQ-259…273: generic filter → sort → group → page, filter sentence, exports. Never computes money itself."""

import re
import io
from datetime import date

from services import clock
from services.pdf import fmt_date, inr

MAX_GROUP_LEVELS = 5
MONEY_PERM = "finance.payment.view"


def allowed_columns(spec: dict, user: dict) -> list[dict]:
    """Money columns need the money permission; real-inventory columns (shown as / why masked) need real-status."""
    from services.inventory import can_see_real

    money, real = MONEY_PERM in user["permissions"], can_see_real(user)
    hide = set() if real else set(spec.get("real_only") or [])
    return [c for c in spec["columns"] if (money or c["type"] != "money" or c.get("public")) and c["key"] not in hide]


def visible_columns(spec: dict, user: dict, wanted: list[str] | None) -> list[dict]:
    cols = allowed_columns(spec, user)
    if wanted:
        by = {c["key"]: c for c in cols}
        return [by[k] for k in wanted if k in by] or [c for c in cols if c.get("default")]
    return [c for c in cols if c.get("default")]


def options(spec: dict, rows: list[dict]) -> dict:
    """Multi-select options from the unfiltered rows: {filter: [{value, label, parent}]} for cascading lists."""
    out = {}
    par = {f["key"]: f for f in spec["filters"]}
    for f in spec["filters"]:
        if f["kind"] != "multi":
            continue
        if f.get("options"):
            out[f["key"]] = [{"value": v, "label": l} for v, l in f["options"]]
            continue
        pf = par.get(f.get("parent")) if f.get("parent") else None
        seen = {}
        for r in rows:
            for v in r.get(f["field"]) if isinstance(r.get(f["field"]), list) else [r.get(f["field"])]:
              if v is not None and v not in seen:
                lab = r.get(f.get("label_field", f["field"]))
                seen[v] = {"value": v, "label": str(v if isinstance(lab, list) else lab or "—")}
                if pf:
                    seen[v]["parent"] = r.get(pf["field"])
        out[f["key"]] = sorted(seen.values(), key=lambda o: _natural(o["label"]))
    return out


def _natural(s):
    import re

    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", str(s))]


def _num(v):
    try:
        return int(round(float(v) * 100))
    except (TypeError, ValueError):
        return None


def narrowed(spec: dict, p: dict, ignore=("period",)) -> bool:
    """True when the viewer narrowed the report beyond its default period (a reconciliation bridge no longer applies)."""
    for f in spec["filters"]:
        k = f["key"]
        if k in ignore:
            continue
        if f["kind"] == "date_range" and (p.get(f"{k}_from") or p.get(f"{k}_to")):
            return True
        if f["kind"] == "range" and (p.get(f"{k}_min") not in (None, "") or p.get(f"{k}_max") not in (None, "")):
            return True
        if f["kind"] in ("multi", "min", "only", "bool", "choice") and p.get(k) not in (None, "", [], False):
            return True
    return False


def apply_filters(spec: dict, rows: list[dict], p: dict) -> list[dict]:
    out = rows
    for f in spec["filters"]:
        k, field = f["key"], f.get("field")
        if f.get("pushdown"):
            continue
        if f["kind"] == "multi" and p.get(k):
            want = set(p[k])
            out = [
                r
                for r in out
                if (want & {str(x) for x in r.get(field)} if isinstance(r.get(field), list) else str(r.get(field)) in want)
            ]
        elif f["kind"] == "date_range":
            lo, hi = p.get(f"{k}_from"), p.get(f"{k}_to")
            if lo:
                out = [r for r in out if (r.get(field) or "") >= lo]
            if hi:
                out = [r for r in out if (r.get(field) or "9999") <= hi]
        elif f["kind"] == "range":

            def val(r, field=field):
                return sum(r.get(x) or 0 for x in field) if isinstance(field, tuple) else r.get(field) or 0

            lo, hi = p.get(f"{k}_min"), p.get(f"{k}_max")
            if f.get("type") == "money":
                lo, hi = _num(lo) if lo not in (None, "") else None, _num(hi) if hi not in (None, "") else None
            if lo is not None:
                out = [r for r in out if val(r) >= lo]
            if hi is not None:
                out = [r for r in out if val(r) <= hi]
        elif f["kind"] == "min" and p.get(k) not in (None, ""):
            out = [r for r in out if (r.get(field) or 0) >= float(p[k])]
        elif f["kind"] == "bool" and not p.get(k):
            out = [r for r in out if r.get(field)]
        elif f["kind"] == "only" and p.get(k):
            out = [r for r in out if r.get(field)]
        elif f["kind"] == "choice" and p.get(k) and field:
            out = [r for r in out if str(r.get(field)) == p[k]]
    return out


def totals(spec: dict, rows: list[dict]) -> dict:
    t = {k: sum(r.get(k) or 0 for r in rows) for k in spec["totals"]}
    return t | spec["derived"](t, rows) if spec.get("derived") else t


def sort_rows(rows: list[dict], key: str | None, desc: bool, then: str | None = None) -> list[dict]:
    if not key:
        return rows
    if then:
        rows = sort_rows(rows, then, desc)
    blank = [r for r in rows if r.get(key) in (None, "")]
    full = [r for r in rows if r.get(key) not in (None, "")]
    return sorted(full, key=lambda r: _natural(r[key]) if isinstance(r[key], str) else r[key], reverse=desc) + blank


def group_tree(spec: dict, rows: list[dict], levels: list[str], depth: int = 0) -> list[dict]:
    """REQ-265: nested groups (≤5 levels) with subtotals at each level; the leaf level keeps its rows."""
    by = {g["key"]: g for g in spec["groups"]}
    g = by[levels[0]]
    buckets: dict = {}
    for r in rows:
        buckets.setdefault(str(r.get(g["field"]) or "—"), []).append(r)
    out = []
    for label in sorted(buckets, key=_natural):
        rs = buckets[label]
        node = {"level": g["key"], "label": label, "count": len(rs), "totals": totals(spec, rs), "depth": depth}
        node |= {"children": group_tree(spec, rs, levels[1:], depth + 1)} if levels[1:] else {"rows": rs}
        out.append(node)
    return out


def sentence(spec: dict, p: dict, opts: dict, n: int, as_of: date | None) -> str:
    """REQ-264: '21 bookings · SGH, GGV · overdue 30+ days · as of 18 Nov 2026'."""
    one, many = spec["unit"]
    bits = [f"{n:,} {one if n == 1 else many}"]
    for f in spec["filters"]:
        k = f["key"]
        if f["kind"] == "multi" and p.get(k):
            lab = {str(o["value"]): o["label"] for o in opts.get(k, [])}
            names = [lab.get(v, v) for v in p[k]]
            bits.append(", ".join(names[:3]) + (f" +{len(names) - 3}" if len(names) > 3 else ""))
        elif f["kind"] == "date_range" and (p.get(f"{k}_from") or p.get(f"{k}_to")):
            bits.append(f"{f['label'].lower()} {fmt_date(p.get(f'{k}_from')) or '…'} – {fmt_date(p.get(f'{k}_to')) or '…'}")
        elif f["kind"] == "range" and (p.get(f"{k}_min") or p.get(f"{k}_max")):
            lo, hi = p.get(f"{k}_min"), p.get(f"{k}_max")
            fm = (lambda v: inr(_num(v))) if f.get("type") == "money" else str
            bits.append(f"{f['label'].lower()} {fm(lo) if lo else '0'} – {fm(hi) if hi else 'any'}")
        elif f["kind"] == "min" and p.get(k):
            bits.append(f.get("sentence", f"{f['label'].lower()} {{v}}").format(v=p[k]))
        elif f["kind"] in ("bool", "only") and p.get(k):
            bits.append(f["label"].lower())
        elif f["kind"] == "choice" and p.get(k):
            bits.append(f"{f['label'].lower()}: {dict(f['options']).get(p[k], p[k]).lower()}")
    if as_of:
        bits.append(f"as of {fmt_date(as_of.isoformat())}")
    return " · ".join(bits)


def _cell(c: dict, v):
    if v is None or v == "":
        return "—" if c["type"] != "money" else inr(0)
    if c["type"] == "money":
        v = round(v)
        return f"−{inr(-v)}" if v < 0 else inr(v)
    if isinstance(v, list):
        return ", ".join(map(str, v))
    if c["type"] == "date":
        return fmt_date(v)
    if c["type"] == "pct":
        return f"{v}%"
    return str(v)


def _flat(tree: list[dict], cols: list[dict]):
    """Group tree → export lines: ('group', depth, label, count, totals) then rows, depth-first."""
    for g in tree:
        yield ("group", g)
        if "children" in g:
            yield from _flat(g["children"], cols)
        else:
            for r in g["rows"]:
                yield ("row", r)


INR_FMT = '[>=10000000]"₹"##\\,##\\,##\\,##0;[>=100000]"₹"##\\,##\\,##0;"₹"#,##0'


def to_xlsx(spec: dict, cols: list[dict], lines: list, tot: dict, head: list[str]) -> bytes:
    """REQ-267: numbers as numbers, ₹ format, filter sentence on top, totals row, frozen header."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill

    wb = Workbook()
    ws = wb.active
    ws.title = re.sub(r"[\\/*?:\[\]]", "-", spec["title"])[:30]
    for i, h in enumerate(head, start=1):
        ws.cell(row=i, column=1, value=h).font = Font(bold=i == 1, size=14 if i == 1 else 10)
    r0 = len(head) + 2
    for j, c in enumerate(cols, start=1):
        cell = ws.cell(row=r0, column=j, value=c["label"])
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="1F2A44")
        ws.column_dimensions[cell.column_letter].width = max(10, int(c.get("width", 12) * 1.3))
    ws.freeze_panes = ws.cell(row=r0 + 1, column=2)
    r = r0 + 1

    def put(row, values, bold=False, indent=0):
        for j, c in enumerate(cols, start=1):
            v = values.get(c["key"])
            if c["type"] == "money":
                cell = ws.cell(row=row, column=j, value=(v or 0) / 100)
                cell.number_format = INR_FMT
            elif c["type"] == "date" and v and str(v)[:4].isdigit():
                cell = ws.cell(row=row, column=j, value=date.fromisoformat(v[:10]))
                cell.number_format = "dd mmm yyyy"
            else:
                cell = ws.cell(row=row, column=j, value=", ".join(map(str, v)) if isinstance(v, list) else v)
            cell.font = Font(bold=bold)
            if j == 1 and indent:
                cell.alignment = Alignment(indent=indent)

    for kind, x in lines:
        if kind == "group":
            put(r, {**x["totals"], cols[0]["key"]: f"{x['label']} ({x['count']})"}, bold=True, indent=x["depth"])
        else:
            put(r, x)
        r += 1
    put(r, {**tot, cols[0]["key"]: "TOTAL"}, bold=True)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


async def to_pdf(spec: dict, cols: list[dict], lines: list, tot: dict, head: list[str], company: dict) -> bytes:
    """REQ-267: letterhead, landscape when > 7 columns, columns sized by their declared widths."""
    from services import pdf as _pdf

    d = _pdf.BrandedDoc(spec["title"], company, landscape_mode=len(cols) > 7)
    for h in head[1:]:
        d.small(h)
    d.spacer(2)
    rows = []
    for kind, x in lines:
        if kind == "group":
            lab = "  " * x["depth"] + f"<b>{x['label']} ({x['count']})</b>"
            rows.append([lab] + [f"<b>{_cell(c, x['totals'][c['key']])}</b>" if c["key"] in x["totals"] else "" for c in cols[1:]])
        else:
            rows.append([_cell(c, x.get(c["key"])) for c in cols])
    import re

    tot_cells = ["TOTAL"] + [_cell(c, tot[c["key"]]) if c["key"] in tot else "" for c in cols[1:]]

    def need(i, c):  # widest unbreakable value in the column (money/codes never wrap) vs the header's longest word
        vals = [re.sub(r"<[^>]+>", "", str(r[i])) for r in rows[:400]] + [tot_cells[i]]
        parts = [p for v in vals for p in (v.split(" · ") if c["type"] == "code" else [v])]
        longest = max((len(v) for v in parts), default=4) if c["type"] in ("money", "date", "code") else 0
        words = max(len(w) for w in c["label"].split())
        floor = {"text": c.get("width", 12) * 0.6, "status": 11}.get(c["type"], 6)
        return max(longest * 1.15 + 1, words + 1, floor)

    d.table(
        [c["label"] for c in cols],
        rows,
        widths=[need(i, c) for i, c in enumerate(cols)],
        align_right=[i for i, c in enumerate(cols) if c["type"] == "money"],
        totals=tot_cells,
    )
    return d.build()


def parse_date(s: str | None) -> date:
    return date.fromisoformat(s) if s else clock.today()
