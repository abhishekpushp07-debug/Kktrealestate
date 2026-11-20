"""Q-47 meter: money / date / flat-code cells that wrap onto a second line in a report PDF (text extraction, pypdf).
A wrapped cell is drawn as two fragments; a whole cell is one. Flags fragments that are only part of a money figure,
a date or a flat code. Usage: python tools/pdf_nowrap.py file.pdf [...]  → prints offenders, exit 1 if any."""

import re
import sys

from pypdf import PdfReader

MONEY_OK = re.compile(r"^−?₹(\d{1,3}(,\d{2})*(,\d{3})?|\d{1,3})(\.\d{2})?$")  # a rate may carry paise
BAD = [
    (re.compile(r"₹[\d,]*,$"), "money cut after a comma"),
    (re.compile(r"^\d{1,2} [A-Z][a-z]{2}$"), "date without its year"),
    (re.compile(r"^(19|20)\d{2}$"), "a year alone (date wrapped)"),
    (re.compile(r"·\s*$"), "flat code cut after ·"),
    (re.compile(r"^\s*·"), "flat code continued"),
    (re.compile(r"·\s*\S*…$"), "flat code shortened"),
]


def offenders(path: str) -> list[tuple[int, str, str]]:
    out = []
    for n, page in enumerate(PdfReader(path).pages, start=1):
        frags: list[str] = []
        page.extract_text(visitor_text=lambda t, *_, acc=frags: acc.append(t))
        for f in (x.strip() for x in frags):
            if not f:
                continue
            if f.startswith(("₹", "−₹")) and " " not in f and not MONEY_OK.match(f):
                out.append((n, f, "money not whole"))
            for rx, why in BAD:
                if rx.search(f):
                    out.append((n, f, why))
    return out


if __name__ == "__main__":
    bad = 0
    for p in sys.argv[1:]:
        o = offenders(p)
        bad += len(o)
        print(f"{p}: {len(o)} wrapped cells" + "".join(f"\n  p{n}: {f!r} ({w})" for n, f, w in o[:20]))
    sys.exit(1 if bad else 0)
