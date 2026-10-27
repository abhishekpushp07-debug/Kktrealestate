"""CORS allow-list parsing: explicit origins plus single-level wildcard hosts (https://*.example.com). Never '*'. Deny by default."""
import re

_HOST_WILDCARD = re.compile(r"^(https?)://\*\.((?:[a-z0-9-]+\.)+[a-z]{2,})$", re.IGNORECASE)


def parse_cors_origins(raw: str | None) -> tuple[list[str], str | None]:
    """Returns (explicit_origins, origin_regex). A bare '*' is ignored; '<scheme>://*.<domain>' becomes a strict one-label regex;
    any other wildcard form is ignored (fail closed)."""
    explicit, patterns = [], []
    for part in (raw or "").split(","):
        o = part.strip().rstrip("/")
        if not o or o == "*":
            continue
        if "*" in o:
            m = _HOST_WILDCARD.match(o)
            if m:
                patterns.append(rf"{m.group(1).lower()}://[a-z0-9-]+\.{re.escape(m.group(2).lower())}")
            continue
        explicit.append(o)
    regex = "^(?:" + "|".join(patterns) + ")$" if patterns else None
    return explicit, regex


def origin_allowed(origin: str, explicit: list[str], regex: str | None) -> bool:
    return origin in explicit or bool(regex and re.fullmatch(regex, origin))
