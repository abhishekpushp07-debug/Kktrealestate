"""Phase K.16: CSV formula neutralisation."""
from utils import csv_safe, to_csv


def test_csv_safe_prefixes_dangerous_cells():
    assert csv_safe("=SUM(A1)") == "'=SUM(A1)"
    assert csv_safe("+1") == "'+1" and csv_safe("-1") == "'-1" and csv_safe("@cmd") == "'@cmd"
    assert csv_safe("Shri Ram") == "Shri Ram" and csv_safe(12) == 12 and csv_safe(None) is None


def test_to_csv_neutralises_formulas():
    out = to_csv([{"name": "=HYPERLINK(\"http://x\")", "amount": 5}])
    assert "'=HYPERLINK" in out and "\n" in out
