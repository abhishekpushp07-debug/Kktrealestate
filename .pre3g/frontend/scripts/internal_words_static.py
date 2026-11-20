"""Static half of the internal-words check (REQ-130): user-visible strings in the frontend source (JSX text, labels,
titles, toasts, placeholders, empty states, dialogs) must not say "demand" or "paise". Catches sheets / dialogs /
empty states the rendered scan never opens. Exit 1 on any hit."""

import pathlib
import re
import sys

SRC = pathlib.Path(__file__).resolve().parents[1] / "src"
WORD = re.compile(r"\b(demand(?:s|ed|ing)?|paise)\b(?! draft)(?![\"']?\s*:)", re.I)
# visible text: JSX text between tags, or a string literal given to a visible prop / toast / title / label
VISIBLE = [
    re.compile(r">([^<>{}]*)<"),
    re.compile(
        r"\b(?:label|title|placeholder|hint|description|purpose|empty|aria-label|tooltip|subtitle|caption)\s*[:=]\s*\{?\s*[\"'`]([^\"'`]*)[\"'`]"
    ),
    re.compile(r"toast\.(?:success|error|info|warning)\(\s*[\"'`]([^\"'`]*)[\"'`]"),
]
LINE_TEXT = re.compile(r"^\s*([A-Z][^<>{}=;]*[a-z][^<>{}=;]*)$")  # a bare JSX text line


def hits():
    out = []
    for f in sorted(SRC.rglob("*.js*")):
        if "components/ui/" in str(f) or f.name.endswith(".test.js"):
            continue
        for n, line in enumerate(f.read_text().splitlines(), 1):
            if line.strip().startswith(("//", "*", "/*", "import ")):
                continue
            texts = [m.group(1) for rx in VISIBLE for m in rx.finditer(line)]
            m = LINE_TEXT.match(line)
            if m and not re.search(r"[()\[\]]|=>|&&|\|\|", line):
                texts.append(m.group(1))
            for t in texts:
                if WORD.search(t):
                    out.append(f"{f.relative_to(SRC)}:{n}: {t.strip()[:90]}")
    return out


if __name__ == "__main__":
    h = hits()
    print(f"{len(h)} source hits")
    print("\n".join(h))
    sys.exit(1 if h else 0)
