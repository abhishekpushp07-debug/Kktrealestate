from _h3h import BANK, CHEQUE, NEFT, TODAY, row, sfx, v3  # noqa: F401
def test_refunds_line_and_forfeit(api):
    c=v3(api,"collections",period_from="2026-02-01",period_to="2026-02-28")
    assert c["totals"]["refunds_paid_paise"]>=28192800+14096400
    l=[x for x in c["lines"] if x["key"]=="refunds"][0]; assert "Refunds paid out −₹" in l["text"]
    from urllib.parse import urlparse,parse_qsl
    u=urlparse(l["link"]); d=v3(api,u.path.split("/")[-1],**dict(parse_qsl(u.query)))
    r=[x for x in d["rows"] if x["booking_number"]=="BK-2526-3428"][0]; assert r["refund_paid_paise"]==42289200 and r["forfeiture_paise"]>0
    jan=v3(api,"collections",period_from="2025-04-01",period_to="2026-01-31")
    assert any(x.get("booking_number")=="BK-2526-3428" for x in jan["rows"]) or jan["count"]>500
