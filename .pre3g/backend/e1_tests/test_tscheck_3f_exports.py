import io, openpyxl
def test_xlsx_numeric_and_pdf(api):
    r = api.get("/reports/v3/collections/export.xlsx", params={"mode":"Cash"}); assert r.status_code == 200
    ws = openpyxl.load_workbook(io.BytesIO(r.content)).active
    rows = list(ws.iter_rows(values_only=True)); tot = [x for x in rows if x[0]=="TOTAL"][0]
    assert isinstance(tot[-1], (int,float))
    assert tot[-1]*100 == api.get("/reports/v3/collections", params={"mode":"Cash"}).json()["totals"]["total_paise"]
    p = api.get("/reports/v3/outstanding/export.pdf"); assert p.status_code == 200 and p.content[:4] == b"%PDF"
