import re, pytest
from _h3h import *
@pytest.mark.parametrize("k,f",[("outstanding","outstanding_paise"),("collections","total_paise")])
@pytest.mark.parametrize("g",["project","tower","floor","flat","booking"])
def test_group_subtotals(api,k,f,g):
    d=v3(api,k,group=g); assert sum(x["totals"].get(f,0) for x in d["groups"] if x["level"]==g)==d["totals"][f]
def test_pdf_a4_landscape(api):
    r=api.get("/reports/v3/outstanding/export.pdf",params={"as_of":"2026-10-31"}); assert r.status_code==200 and r.content[:4]==b"%PDF"
    assert {m.split()[2:] for m in []}=={} or set(re.findall(rb"/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)",r.content))=={(b"841.8898",b"595.2756")}
def test_register_and_uniqueness(api):
    d=v3(api,"booking-register"); t=[l["text"] for l in d["lines"]]
    assert re.match(r"\d+ live",t[0]) and re.match(r"\d+ cancelled",t[1])
    u=api.get("/admin/ops").json()["uniqueness"]; assert len(u)==5 and all(x["status"]=="applied" for x in u)
