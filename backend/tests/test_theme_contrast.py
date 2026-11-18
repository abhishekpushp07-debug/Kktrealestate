"""REQ-76/174: every text/graphic token pair passes WCAG AA in BOTH themes (Night and Day) — computed from the one token file."""

import os
import re

import pytest

TOKENS = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "src", "styles", "tokens.css")
AVATAR = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "src", "components", "v2", "CustomerBits.jsx")


def _avatar_pairs():
    """Initials avatars (booking header, Customer 360 badges) — (text, background) from the PALETTE in CustomerBits."""
    src = open(AVATAR).read()
    body = re.search(r"const PALETTE = \[(.*?)\n\];", src, re.S).group(1)
    return [(fg, bg, 4.5) for bg, fg in re.findall(r'\["var\(--([a-z0-9-]+)\)", "var\(--([a-z0-9-]+)\)"\]', body)]


TEXT_ON = ["canvas", "surface", "surface-2", "sidebar"]
PAIRS = (
    # (foreground, background, minimum)  4.5 = body text, 3.0 = large text / chart marks / icons
    [(f, b, 4.5) for f in ("text-1", "text-2", "text-3") for b in TEXT_ON + ["accent-soft"]]
    + [(f, b, 4.5) for f in ("accent", "due", "advance", "warn", "info") for b in ("canvas", "surface", "surface-2")]
    + [
        ("due", "due-soft", 4.5),
        ("advance", "advance-soft", 4.5),
        ("warn", "warn-soft", 4.5),
        ("info", "info-soft", 4.5),
    ]
    + [("accent", "accent-soft", 4.5), ("accent-fg", "accent", 4.5), ("primary-fg", "primary-bg", 4.5)]
    + [("surface", "text-1", 4.5), ("canvas", "text-1", 4.5), ("surface", "ink-3", 4.5)]  # text-white on bg-ink-*
    + [("surface", c, 4.5) for c in ("due", "advance")]  # text-white on bg-brick / bg-sage
    + [(c, "surface", 3.0) for c in ("chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "chart-axis")]
    + _avatar_pairs()
    # project Inventory grid flat chips (UNIT_COLORS background, InventoryGrid text)
    + [("canvas", bg, 4.5) for bg in ("advance", "warn", "info", "accent")]
    + [("text-1", "line", 4.5)]
)


def test_avatar_palette_is_covered():
    assert len(_avatar_pairs()) == 8


def _blocks():
    css = open(TOKENS).read()
    day = re.search(r":root\[data-theme=\"light\"\]\s*\{(.*?)\n\}", css, re.S).group(1)
    night = re.search(r":root\[data-theme=\"night\"\]\s*\{(.*?)\n\}", css, re.S).group(1)
    parse = lambda b: dict(re.findall(r"--([a-z0-9-]+):\s*([^;]+);", re.sub(r"/\*.*?\*/", "", b, flags=re.S)))
    return {"day": parse(day), "night": parse(night)}


def _rgb(v, t, depth=0):
    v = v.strip()
    assert depth < 12, v
    if m := re.fullmatch(r"var\(--([a-z0-9-]+)\)", v):
        return _rgb(t[m.group(1)], t, depth + 1)
    if m := re.fullmatch(r"#([0-9a-fA-F]{6})", v):
        h = m.group(1)
        return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))
    if m := re.fullmatch(r"color-mix\(in srgb,\s*(.+?)\s+(\d+)%,\s*(.+)\)", v):
        a, p, b = _rgb(m.group(1), t, depth + 1), int(m.group(2)) / 100, _rgb(m.group(3), t, depth + 1)
        return tuple(round(x * p + y * (1 - p)) for x, y in zip(a, b))
    raise AssertionError(f"unparseable token value {v!r}")


def _lum(c):
    ch = [x / 255 for x in c]
    ch = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in ch]
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]


def ratio(a, b):
    la, lb = sorted((_lum(a), _lum(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


@pytest.mark.parametrize("theme", ["day", "night"])
def test_token_pairs_meet_wcag_aa(theme):
    t = _blocks()[theme]
    fails = []
    for f, b, need in PAIRS:
        r = ratio(_rgb(t[f], t), _rgb(t[b], t))
        if r < need:
            fails.append(f"{f} on {b}: {r:.2f} < {need}")
    assert not fails, f"{theme}: " + "; ".join(fails)
