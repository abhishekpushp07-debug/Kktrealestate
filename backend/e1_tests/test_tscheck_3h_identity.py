import pytest
from _h3h import BANK, CHEQUE, NEFT, TODAY, row, sfx, v3  # noqa: F401
@pytest.mark.parametrize("f,t",[("2026-11-01",TODAY),("2026-10-01","2026-10-31"),("2026-04-01",TODAY)])
def test_bankwise_plus_cash(api,f,t):
    c=v3(api,"collections",period_from=f,period_to=t); b=v3(api,"bank-receipts",period_from=f,period_to=t)
    assert c["totals"]["total_paise"]==b["totals"]["total_paise"]+c["totals"]["cash_mode_paise"]
    assert any(l["key"]=="identity" and "Bank-wise" in l["text"] for l in c["lines"])
    assert not any("Unexplained" in l["text"] for l in c["lines"]+b["lines"])
