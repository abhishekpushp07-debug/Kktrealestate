"""Money is stored as integer paise (`*_paise`). API exposes rupees (2 dp) alongside."""

from decimal import ROUND_HALF_UP, Decimal


def to_paise(rupees: float | str | None) -> int:
    if rupees is None:
        return 0
    return int((Decimal(str(rupees)) * 100).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def to_rupees(paise: int | None) -> float:
    return round((paise or 0) / 100, 2)


def rupees_whole(paise: int) -> int:
    """System-generated amounts are whole rupees (R0b): round to the nearest ₹1; totals stay exact because the last line absorbs the remainder."""
    return int((Decimal(int(paise)) / 100).quantize(Decimal(1), rounding=ROUND_HALF_UP)) * 100


def pct_of(paise: int, percent: float) -> int:
    """Whole-rupee share. pct_of(x, 100) == x so cumulative-difference schedules telescope exactly."""
    if float(percent) >= 100:
        return int(paise)
    return rupees_whole(Decimal(paise) * Decimal(str(percent)) / 100)


_LEGACY = (
    ("udhar", "bill_raised"),
    ("jama", "received"),
)  # legacy key stems → English (one-release compatibility aliases)


_PLAN: dict[tuple, tuple] = {}


def _plan(d: dict) -> tuple:
    """3I: rows share key sets — find the legacy-stem keys once per key set, not per row."""
    keys = tuple(d)
    plan = _PLAN.get(keys)
    if plan is None:
        plan = tuple((k, k.replace(o, n)) for k in keys for o, n in _LEGACY if o in k)
        if len(_PLAN) < 4096:
            _PLAN[keys] = plan
    return plan


def _english_aliases(d: dict) -> dict:
    """Legacy ledger keys (udhar_*/jama_*) stay for one release; English twins (bill_raised_*/received_*) are added, plus the signed
    balance (received − bill raised) and its status whenever both totals are present (see definitions.two_sided)."""
    extra = {}
    for k, nk in _plan(d):
        if isinstance(d[k], int):
            extra[nk] = d[k]
    tu, tj = d.get("total_udhar_paise", d.get("udhar_paise")), d.get("total_jama_paise", d.get("jama_paise"))
    if isinstance(d.get("total_jama_paise"), int) and d.get("waived_paise"):  # REQ-253: Jama = received + waived
        extra["total_received_paise"] = d["total_jama_paise"] - d["waived_paise"]
    if isinstance(tu, int) and isinstance(tj, int) and "seq" not in d:
        bal = tj - tu
        extra["balance_signed_paise"] = bal
        extra["balance_status"] = "due" if bal < 0 else "advance" if bal > 0 else "settled"
    return extra


def present_money(obj, twins: bool = True):
    """Recursively add rupee twins for every *_paise key (amount_paise -> amount) and English ledger aliases.
    twins=False (3I, in-process report providers): aliases only — the engine reads the *_paise keys."""
    if isinstance(obj, list):
        return [present_money(x, twins) for x in obj]
    if isinstance(obj, dict):
        if not twins and not _plan(
            obj
        ):  # 3I fast path: no legacy-stem key ⇒ no alias, copy and recurse only into containers
            out = dict(obj)
            for k, v in out.items():
                if type(v) in (dict, list):
                    out[k] = present_money(v, False)
            return out
        src = {**obj, **_english_aliases(obj)}
        out = {}
        for k, v in src.items():
            out[k] = present_money(v, twins) if isinstance(v, (dict, list)) else v
            if twins and k.endswith("_paise") and isinstance(v, int):
                out[k[:-6]] = to_rupees(v)
        return out
    return obj


_ONES = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
]
_TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]


def _two(n: int) -> str:
    if n < 20:
        return _ONES[n]
    return (_TENS[n // 10] + (" " + _ONES[n % 10] if n % 10 else "")).strip()


def _three(n: int) -> str:
    h, r = divmod(n, 100)
    parts = []
    if h:
        parts.append(_ONES[h] + " Hundred")
    if r:
        parts.append(_two(r))
    return " ".join(parts)


def amount_in_words(paise: int) -> str:
    """Indian system: Rupees Twelve Lakh Fifty Thousand Only."""
    rupees, p = divmod(abs(int(paise or 0)), 100)
    if rupees == 0 and p == 0:
        return "Rupees Zero Only"
    parts = []
    crore, rest = divmod(rupees, 10_000_000)
    lakh, rest = divmod(rest, 100_000)
    thousand, rest = divmod(rest, 1000)
    if crore:
        parts.append(f"{_three(crore) if crore >= 100 else _two(crore)} Crore")
    if lakh:
        parts.append(f"{_two(lakh)} Lakh")
    if thousand:
        parts.append(f"{_two(thousand)} Thousand")
    if rest:
        parts.append(_three(rest))
    words = "Rupees " + " ".join(parts) if parts else "Rupees"
    if p:
        words += f" and {_two(p)} Paise"
    return words.strip() + " Only"


def inr(paise: int) -> str:
    """₹12,50,000 style formatting."""
    neg = paise < 0
    r = abs(paise) // 100
    s = str(r)
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        s = ",".join(groups) + "," + tail
    return ("-" if neg else "") + "₹" + s
