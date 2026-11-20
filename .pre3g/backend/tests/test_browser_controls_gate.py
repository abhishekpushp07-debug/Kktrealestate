"""REQ-215 gate: the active UI uses Elite controls only — no browser <select> and no browser date / time pickers.
The Elite controls themselves (DateInput, EliteInputs) and the shadcn primitives are the only allowed homes."""

import pathlib
import re

SRC = pathlib.Path(__file__).resolve().parents[2] / "frontend" / "src"
ALLOWED = {"components/common/DateInput.jsx", "components/common/EliteInputs.jsx"}
BAD = re.compile(r'<select[\s>]|type=["\'](date|datetime-local|time|month|week)["\']')


def offenders() -> list[str]:
    out = []
    for p in SRC.rglob("*.js*"):
        rel = p.relative_to(SRC).as_posix()
        if rel.startswith("components/ui/") or rel in ALLOWED:
            continue
        for n, line in enumerate(p.read_text(errors="ignore").splitlines(), 1):
            code = line.split("//")[0]
            if BAD.search(code) and not code.lstrip().startswith(("*", "/*")):
                out.append(f"{rel}:{n}: {line.strip()[:100]}")
    return out


def test_no_browser_controls_in_active_ui():
    bad = offenders()
    assert not bad, "Use NativeSelect / Select / DateInput / TimeInput / DateTimeInput instead:\n" + "\n".join(bad)


def test_legacy_plan_forms_retired():
    assert not (SRC / "components/project/LegacyPlanForms.jsx").exists()
    assert "LegacyPlanForms" not in (SRC / "components/common/QuickCreate.jsx").read_text()


if __name__ == "__main__":
    print("\n".join(offenders()) or "browser-control scan: 0 offenders")


SELF_EXPLAINING = re.compile(r"!?(busy|saving|loading|pending|submitting|working|isPending|uploading)\w*")
DISABLED_WITHOUT_REASON_CEILING = 0  # REQ-216: every disabled Button carries why= or a WhyDisabled wrapper


def disabled_without_reason() -> list[str]:
    out = []
    for p in SRC.rglob("*.jsx"):
        rel = p.relative_to(SRC).as_posix()
        if rel.startswith("components/ui/"):
            continue
        s = p.read_text(errors="ignore")
        for m in re.finditer(r"<Button\b[^>]*?disabled=\{([^}]*)\}", s, re.S):
            if (
                "why={" in m.group(0)
                or SELF_EXPLAINING.fullmatch(m.group(1).strip())
                or "WhyDisabled" in s[max(0, m.start() - 300) : m.start()]
            ):
                continue
            out.append(f"{rel}:{s.count(chr(10), 0, m.start()) + 1}")
    return out


def test_disabled_buttons_without_reason_only_go_down():
    bad = disabled_without_reason()
    assert len(bad) <= DISABLED_WITHOUT_REASON_CEILING, "\n".join(bad)
