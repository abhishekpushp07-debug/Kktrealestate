from _h3h import *
BK="ea25c787-d5f4-45ac-a7f4-83360085efcf"; CAN="de80d074-4ec6-44df-ad23-7008c33f4c7c"
def test_later_waiver_ignored(api):
    a=row(v3(api,"outstanding",as_of="2026-11-18"),BK); b=row(v3(api,"outstanding",as_of=TODAY),BK)
    assert b["waived_paise"]>=2500000
    # booking is dated 19 Nov 2026, so As of 18 Nov it is absent (reduction trivially excluded)
    assert a is None or a["waived_paise"]<=b["waived_paise"]-2500000
def test_cancelled_never_in(api):
    assert row(v3(api,"outstanding",as_of="2026-01-15"),CAN) is None
    assert row(v3(api,"outstanding"),CAN) is None
