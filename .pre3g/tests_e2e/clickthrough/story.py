"""REQ-148 · the owner's 10-step story through the REAL screens (Playwright), on a private test copy.

The browser loads the preview frontend; every /api call is routed to the private backend (own DB), so nothing
lands on the preview demo. Every number asserted comes from a preview the system itself showed on screen.
Standalone (dev): python story.py --base http://127.0.0.1:8031   (backend must run on a throwaway DB)
"""

import argparse
import os
import re
import sys
import time
import uuid
from urllib.parse import urlsplit

import requests
from playwright.sync_api import expect, sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "memory", "qa", "phase3", "clickthrough.md")
BYPASS = os.environ.get("LOGIN_RATE_LIMIT_BYPASS_TOKEN", "kkt-test-bypass-local")


def _front():
    with open(os.path.join(ROOT, "frontend", ".env")) as fh:
        for line in fh:
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL missing")


def inr(v):
    neg, v = v < 0, abs(round(v))
    s = str(v)
    head, tail = s[:-3], s[-3:]
    while len(head) > 2:
        tail, head = head[-2:] + "," + tail, head[:-2]
    return ("−" if neg else "") + "₹" + (head + "," + tail if head else tail)


def rupees(text):
    m = re.search(
        r"(-?)₹\s?(-?[\d,]+(?:\.\d+)?)\s*(Cr|L)?\b", text.replace("\u2212", "-")
    )
    assert m, f"no amount in {text!r}"
    v = float(m.group(2).replace(",", "")) * {"Cr": 1e7, "L": 1e5}.get(m.group(3), 1)
    return round(-v if m.group(1) else v, 2)


class Api:
    def __init__(self, base, password):
        self.base = base.rstrip("/") + "/api"
        self.s = requests.Session()
        self.s.headers["X-Rate-Limit-Bypass"] = BYPASS
        r = self.s.post(
            self.base + "/auth/login",
            json={"email": "admin@kkt.in", "password": password},
        )
        assert r.status_code == 200, r.text
        self.s.headers["Authorization"] = f"Bearer {r.json()['access_token']}"

    def get(self, path, **params):
        r = self.s.get(self.base + path, params=params or None, timeout=60)
        assert r.status_code == 200, (path, r.status_code, r.text[:300])
        return r.json()

    def today(self):
        from datetime import datetime, timedelta, timezone

        return (
            self.get("/health").get("business_day")
            or datetime.now(timezone(timedelta(hours=5, minutes=30))).date().isoformat()
        )

    def patch(self, path, body):
        r = self.s.patch(
            self.base + path,
            json=body,
            headers={"Idempotency-Key": uuid.uuid4().hex},
            timeout=60,
        )
        assert r.status_code == 200, (path, r.status_code, r.text[:300])
        return r.json()


class Story:
    def __init__(self, page, api, log):
        self.p, self.api, self.log = page, api, log
        self.tag = uuid.uuid4().hex[:4].upper()
        self.front = _front()

    def go(self, path, ready):
        self.p.goto(self.front + path)
        self.p.wait_for_selector(f"[data-testid='{ready}']", timeout=40000)

    def tid(self, t):
        return self.p.get_by_test_id(t)

    def combo(self, test_id, value):
        self.tid(test_id).click()
        self.tid(f"{test_id}-option-{value}").click()

    def pick(self, test_id, value):  # REQ-215 Elite dropdown (replaced the browser <select>)
        self.tid(f"{test_id}-trigger").click()
        self.tid(f"{test_id}-opt-{value}").click()

    def next_step(self, label_slug):
        btn = self.tid(f"next-step-{label_slug}")
        expect(btn).to_be_visible(timeout=15000)
        return btn

    def step(self, n, title, fn):
        t0 = time.time()
        facts = fn()
        self.log.append((n, title, "PASS", round(time.time() - t0, 1), facts))

    # ---------------------------------------------------------------- 1 · masters
    def masters(self):
        api, tag = self.api, self.tag
        room = api.get("/master/room-types", page_size=50)["items"][0]
        sbu = next(
            a
            for a in api.get("/master/area-types", page_size=50)["items"]
            if a["code"] == "SUPER_BUILTUP"
        )
        self.go("/masters/m/flat-types", "master-page")
        self.tid("master-new-btn").click()
        self.tid("ft-name-input").fill(f"E2E 2BHK {tag}")
        self.tid("ft-code-input").fill(f"E2E{tag}")
        self.tid("ft-bhk-input").fill("2")
        self.tid("ft-saleable-input").fill("1000")
        self.tid("ft-rate-input").fill("4500")
        self.combo("ft-room-0-type", room["id"])
        self.tid("ft-room-0-length").fill("12")
        self.tid("ft-room-0-width").fill("10")
        self.combo("ft-area-0-type", sbu["id"])
        self.tid("ft-area-0-value").fill("1000")
        indicative = rupees(self.tid("ft-indicative-price").inner_text())
        self.tid("ft-form-submit").click()
        expect(self.tid("flat-type-form-sheet")).to_be_hidden(timeout=15000)
        ft = next(
            t
            for t in api.get("/master/flat-types", page_size=200)["items"]
            if t["code"] == f"E2E{tag}"
        )
        assert ft["base_rate_per_sqft"] * 1000 == indicative, (ft, indicative)
        self.ft = ft
        self.go("/masters/m/charge-types", "master-page")
        self.tid("master-new-btn").click()
        self.tid("master-field-name").fill(f"E2E Club {tag}")
        self.tid("master-field-code").fill(f"CLUB{tag}")
        self.pick("master-field-calc_type", "fixed")
        self.tid("master-field-default_value").fill("25000")
        self.pick("master-field-default_demand_timing", "manual")
        self.tid("master-form-submit").click()
        expect(self.tid("master-form-sheet")).to_be_hidden(timeout=15000)
        ch = next(
            c
            for c in api.get("/master/charge-types", page_size=200)["items"]
            if c["code"] == f"CLUB{tag}"
        )
        self.ch = ch
        return f"flat type {ft['code']} (screen indicative {inr(indicative)}) · charge head {ch['code']}"

    # ---------------------------------------------------------------- 2 · project
    def project(self):
        self.go("/projects?new=1", "project-dialog")
        self.tid("project-name").fill(f"E2E Project {self.tag}")
        self.tid("project-code").fill(f"E2E{self.tag}")
        self.tid("project-city").fill("Pune")
        self.tid("project-save").click()
        self.p.wait_for_url(
            re.compile(r"/projects/[^/?]+\?tab=structure"), timeout=20000
        )
        self.pid = urlsplit(self.p.url).path.rsplit("/", 1)[1]
        pr = self.api.get(f"/projects/{self.pid}")
        assert pr["code"] == f"E2E{self.tag}", pr
        web = self.api.get(
            f"/cms/projects/{self.pid}/website"
        )  # no ERP screen mounts the visit-slot settings
        w = {
            **(web.get("website") or {}),
            "site_visits": {
                **((web.get("website") or {}).get("site_visits") or {}),
                "enabled": True,
                "min_lead_hours": 0,
            },
        }
        self.api.patch(
            f"/cms/projects/{self.pid}/website", {**w, "version": web["version"]}
        )
        return f"project {pr['code']} ({pr['name']}) · visit slots switched on via API (no ERP screen for it)"

    # ---------------------------------------------------------------- 3 · tower from template
    def tower(self):
        tpl = next(
            t
            for t in self.api.get("/tower-templates")["items"]
            if t["name"] == "G+7 like SGH Tower A"
        )
        self.tid("structure-add-tower").click()
        self.tid("tower-name").fill("Tower E2E")
        self.tid("tower-code").fill("E")
        self.pick("tower-template", tpl["id"])
        self.tid("tower-save").click()
        toast = self.p.locator("[data-sonner-toast]", has_text="Tower E2E:").first
        expect(toast).to_be_visible(timeout=30000)
        said = toast.inner_text()
        floors, flats = (
            int(x) for x in re.search(r"(\d+) floors, (\d+) flats", said).groups()
        )
        if self.tid("tower-warnings-ok").count():
            self.tid("tower-warnings-ok").click()
        expect(self.tid("structure-tower-E")).to_be_visible(timeout=20000)
        blk = next(
            b
            for b in self.api.get("/blocks", project_id=self.pid)["items"]
            if b["code"] == "E"
        )
        self.blid = blk["id"]
        made = self.api.get("/flats", block_id=self.blid, page_size=200)["items"]
        assert len(made) == flats, (len(made), said)
        plans = self.api.get(f"/projects/{self.pid}/blocks/{self.blid}/payment-plans")[
            "items"
        ]
        assert plans, "template attached no payment plan"
        self.flats = sorted(made, key=lambda f: f["flat_number"])
        return f"screen said “{said.strip().splitlines()[0]}” → {floors} floors, {len(made)} flats, {len(plans)} plan(s)"

    # ---------------------------------------------------------------- 4 · flats (pricing sheet)
    def pricing_sheet(self):
        f = self.flats[0]
        self.go(f"/projects/{self.pid}?tab=structure", "structure-tab")
        self.tid(f"flat-chip-{f['flat_number']}").first.click()
        expect(self.tid("flat-pricing-sheet")).to_be_visible(timeout=20000)
        self.combo("flat-pricing-type", self.ft["id"])
        if self.tid("flat-pricing-review").count():
            self.tid("flat-keep-values").click()
        self.tid("flat-pricing-saleable").fill("1000")
        if self.tid("flat-pricing-rate").count() == 0:
            self.combo("flat-pricing-mode", "rate")
        self.tid("flat-pricing-rate").fill("4500")
        computed = rupees(self.tid("flat-pricing-computed").inner_text())
        expect(self.tid("flat-pricing-save")).to_be_enabled()
        self.tid("flat-pricing-save").click()
        expect(
            self.p.locator("[data-sonner-toast]", has_text="Pricing saved").first
        ).to_be_visible(timeout=20000)
        for _ in range(30):
            fl = self.api.get(f"/flats/{f['id']}")
            if (fl.get("price_paise") or 0) == round(computed * 100):
                break
            time.sleep(0.5)
        assert (
            fl["price_paise"] == round(computed * 100)
            and fl["flat_type_id"] == self.ft["id"]
        ), (fl.get("price_paise"), computed)
        fl["price"] = fl["price_paise"] / 100
        self.flat = fl
        return f"{fl['flat_number']} · sheet preview {inr(computed)} == saved price"

    # ---------------------------------------------------------------- 5 · pricing (drawer shows the live price)
    def pricing(self):
        expect(self.tid("flat-drawer-price").first).to_contain_text("₹", timeout=10000)
        drawer_price = rupees(self.tid("flat-drawer-price").first.inner_text())
        assert drawer_price == self.flat["price"], (drawer_price, self.flat["price"])
        assert self.flat["status"] == "Available", self.flat["status"]
        return f"drawer price {inr(drawer_price)} · status Available"

    # ---------------------------------------------------------------- 6 · lead
    def lead(self):
        self.go("/leads", "leads-page")
        self.tid("new-lead-btn").click()
        self.phone = f"+9197{int(uuid.uuid4().hex[:7], 16) % 10**8:08d}"
        self.tid("lead-name").fill(f"E2E Buyer {self.tag}")
        self.tid("lead-phone").fill(self.phone)
        self.tid("lead-project-trigger").click()
        self.tid(f"lead-project-opt-{self.pid}").click()
        self.tid("lead-submit").click()
        self.next_step("book-site-visit").click()
        leads = self.api.get("/leads", search=self.phone)["items"]
        assert len(leads) == 1, leads
        self.lead_doc = leads[0]
        return (
            f"lead {self.lead_doc['lead_number']} · next step “Book site visit” offered"
        )

    # ---------------------------------------------------------------- 7 · site visit
    def visit(self):
        expect(self.tid("visit-create-dialog")).to_be_visible(timeout=20000)
        expect(self.tid("visit-form-phone")).to_have_value(self.phone, timeout=15000)
        slot = self.tid("slot-picker").locator("button[data-testid^='slot-']").first
        slot.wait_for(timeout=20000)
        date = slot.get_attribute("data-testid")[5:15]
        slot.click()
        self.tid("visit-form-submit").click()
        expect(self.tid("visit-create-dialog")).to_be_hidden(timeout=15000)
        v = self.api.get("/site-visits", lead_id=self.lead_doc["id"])["items"]
        assert len(v) == 1 and v[0]["date"] == date, v
        self.go(
            f"/leads?tab=visits&view=list&date={date}&project_id={self.pid}",
            "visits-tab",
        )
        done = self.tid(f"visit-complete-{v[0]['visit_number']}")
        expect(done).to_be_enabled(timeout=15000)
        self.p.wait_for_load_state("networkidle")
        done.click()
        expect(self.tid("visit-action-dialog")).to_be_visible(timeout=15000)  # Part 2: outcome is required
        self.tid("visit-outcome").fill("Interested")
        self.tid("visit-action-submit").click()
        expect(
            self.p.locator("[data-sonner-toast]", has_text="Marked complete").first
        ).to_be_visible(timeout=15000)
        st = self.api.get("/site-visits", lead_id=self.lead_doc["id"])["items"][0][
            "status"
        ]
        assert st == "Completed", st
        outcome = "outcome “Interested” typed in the Complete dialog → Completed"
        return f"visit {v[0]['visit_number']} booked for {date} {v[0]['slot_start']} from the picked slot · {outcome}"

    # ---------------------------------------------------------------- 8 · booking (3-step wizard)
    def booking(self):
        self.go("/leads?tab=list", "leads-search")
        self.tid("leads-search").fill(self.phone)
        self.tid(f"lead-row-{self.lead_doc['lead_number']}").first.click()
        self.tid("lead-convert-btn").click()
        self.p.wait_for_url(re.compile(r"/customers/[^/?]+$"), timeout=20000)
        cid = urlsplit(self.p.url).path.rsplit("/", 1)[1]
        self.go(
            f"/bookings/new?flat={self.flat['id']}&customer_id={cid}", "booking-wizard"
        )
        expect(self.tid("wiz-customer-selected")).to_be_visible(timeout=20000)
        self.tid("wiz-next").click()
        expect(self.tid("wiz-price-plan")).to_be_visible()
        self.tid("wiz-cash").fill("40")
        list_price = rupees(self.tid("wiz-list-price").inner_text())
        self.tid("wiz-discount").fill("10000")  # REQ-235…241: discount given at booking, with its reason
        expect(self.tid("wiz-discount-given")).to_contain_text("10,000", timeout=15000)
        self.tid("wiz-discount-reason").fill("Festival offer")
        expect(self.tid("breakdown-total-final")).to_contain_text("₹", timeout=20000)
        base_final = rupees(self.tid("breakdown-total-final").inner_text())
        self.combo("breakdown-add-head", self.ch["id"])
        expect(self.tid("breakdown-line-name-0")).to_have_value(
            self.ch["name"], timeout=15000
        )
        for _ in range(30):
            total_final = rupees(self.tid("breakdown-total-final").inner_text())
            if total_final != base_final:
                break
            self.p.wait_for_timeout(300)
        assert total_final > base_final, (base_final, total_final)
        assert rupees(self.tid("wiz-grand-total").inner_text()) == total_final
        agreement = float(self.tid("wiz-total").input_value().replace(",", ""))
        self.tid("wiz-next").click()
        self.tid("wiz-confirm").click()
        self.p.wait_for_url(re.compile(r"/bookings/[0-9a-f-]{20,}"), timeout=30000)
        self.bid = urlsplit(self.p.url).path.rsplit("/", 1)[1]
        b = self.api.get(f"/bookings/{self.bid}")
        assert b["agreement_value_paise"] == round(agreement * 100), (
            b["agreement_value_paise"],
            agreement,
        )
        assert round(b["pricing"]["total_final_value"], 2) == total_final, (
            b["pricing"],
            total_final,
        )
        assert any(c["name"] == self.ch["name"] for c in b["pricing"]["charges"]), b[
            "pricing"
        ]["charges"]
        assert b["cash_agreed"] == round(agreement * 0.4), (b["cash_agreed"], agreement)
        disc = b["discount"]
        assert disc["amount_paise"] == 1000000 and disc["reason"] == "Festival offer", disc
        assert disc["list_paise"] == round(list_price * 100) == b["agreement_value_paise"] + 1000000, (disc, list_price)
        self.next_step("record-booking-amount")
        self.booking_number = b["booking_number"]
        self.s0 = b["summary"]
        return (
            f"{b['booking_number']} · agreement {inr(agreement)} + new head {self.ch['code']} · screen total final {inr(total_final)} == booked · "
            f"cash 40 % · discount ₹10,000 (list {inr(list_price)}, reason typed) · "
            f"bills at booking {inr(b['summary']['total_bill_raised_paise'] / 100)}"
        )

    # ---------------------------------------------------------------- 9 · stage complete → bills raised
    def stage(self):
        b = self.api.get(f"/bookings/{self.bid}")
        trig = {
            i["trigger_stage_id"]
            for i in b["payment_plan_snapshot"]["installments"]
            if i["trigger_type"] == "ON_STAGE"
        }
        stages = self.api.get(f"/blocks/{self.blid}/construction")["stages"]
        target = min(
            (s for s in stages if s["stage_id"] in trig and s["status"] != "Completed"),
            key=lambda s: s["seq"],
        )
        self.go("/construction", "construction-update-page")
        self.pick("cu-project", self.pid)
        self.pick("cu-tower", self.blid)
        self.pick("cs-stage-select", target["stage_id"])
        self.tid("cs-mark-btn").click()
        row = self.tid(f"cs-preview-{self.booking_number}")
        expect(row).to_be_visible(timeout=20000)
        preview_total = rupees(
            self.tid(f"cs-preview-total-{self.booking_number}").inner_text()
        )
        split = re.findall(
            r"₹[\d,]+", row.locator("span.tabular span.block").inner_text()
        )
        preview_bill, preview_gst = rupees(split[0]), rupees(split[1])
        assert preview_bill + preview_gst == preview_total, (
            preview_bill,
            preview_gst,
            preview_total,
        )
        before = b["summary"]["total_bill_raised_paise"]
        bills0 = {
            d["id"] for d in self.api.get(f"/reports/statement/{self.bid}")["demands"]
        }
        gst0 = sum(
            l.get("demanded_paise") or 0
            for l in b.get("other_charges") or []
            if l.get("demand_at") == "stage"
        )
        self.tid("cs-confirm-btn").click()
        btn = self.next_step("print-bill-letters")
        b2 = self.api.get(f"/bookings/{self.bid}")
        new = [
            d
            for d in self.api.get(f"/reports/statement/{self.bid}")["demands"]
            if d["id"] not in bills0
        ]
        assert len(new) == 1 and new[0]["total_demand_paise"] == round(
            preview_bill * 100
        ), (new, preview_bill)
        gst = (
            sum(
                l.get("demanded_paise") or 0
                for l in b2.get("other_charges") or []
                if l.get("demand_at") == "stage"
            )
            - gst0
        )
        after = b2["summary"]["total_bill_raised_paise"]
        assert gst == round(preview_gst * 100), (gst, preview_gst)
        assert after - before == round(preview_total * 100), (
            before,
            after,
            preview_total,
        )
        return (
            f"stage “{target['name']}” · screen preview {inr(preview_total)} = instalment {inr(preview_bill)} + "
            f"GST {inr(preview_gst)} == posted (bill {new[0]['demand_number']} + GST share) · "
            f"next step “{btn.inner_text().strip()}”"
        )

    # ---------------------------------------------------------------- 10 · payment (5-field sheet, auto adjustment)
    def payment(self):
        cash = next(
            m
            for m in self.api.get("/master/payment-modes")["items"]
            if m["code"] == "CASH"
        )
        before = self.api.get(f"/bookings/{self.bid}")["summary"]
        self.go(f"/bookings/{self.bid}?pay=1", "post-payment-sheet")
        self.tid("pp-mode-trigger").click()
        self.tid(f"pp-mode-opt-{cash['id']}").click()
        lst = self.tid("pp-allocation-list")
        expect(lst).to_be_visible(timeout=20000)
        amount = float(self.tid("pp-amount").input_value().replace(",", ""))
        assert amount > 0, "sheet suggested no amount"
        shown = [rupees(t) for t in lst.locator("li b").all_inner_texts()]
        assert round(sum(shown), 2) == amount, (shown, amount)
        self.tid("pp-submit").click()
        expect(self.tid("pp-success")).to_be_visible(timeout=20000)
        self.receipt = self.tid("pp-receipt-number").inner_text().strip()
        self.next_step("print-share-receipt")
        pays = [
            p
            for p in self.api.get("/payments", booking_id=self.bid, page_size=50)[
                "items"
            ]
            if p["receipt_number"] == self.receipt
        ]
        assert len(pays) == 1 and pays[0]["amount_paise"] == round(amount * 100), pays
        self.pay = pays[0]
        after = self.api.get(f"/bookings/{self.bid}")["summary"]
        assert after["total_received_paise"] - before["total_received_paise"] == round(
            amount * 100
        )
        assert before["outstanding_paise"] - after["outstanding_paise"] == round(
            amount * 100
        )
        self.amount = amount
        return f"{self.receipt} · {inr(amount)} cash · auto adjustment preview {len(shown)} line(s) sum == amount"

    # ---------------------------------------------------------------- 11 · reversal
    def reversal(self):
        self.go(f"/bookings/{self.bid}?tab=bills", "booking-payments-table")
        self.p.once("dialog", lambda d: d.accept("E2E click-through reversal"))
        self.tid(f"reverse-{self.pay['id']}").click()
        expect(
            self.p.locator("[data-sonner-toast]", has_text="Payment reversed").first
        ).to_be_visible(timeout=20000)
        p = next(
            x
            for x in self.api.get("/payments", booking_id=self.bid, page_size=50)[
                "items"
            ]
            if x["id"] == self.pay["id"]
        )
        assert p["status"] == "Reversed", p["status"]
        s = self.api.get(f"/bookings/{self.bid}")["summary"]
        assert s["total_received_paise"] == self.s0["total_received_paise"], s
        self.s_end = s
        return f"{self.receipt} reversed · booking received back to {inr(s['total_received_paise'] / 100)}"

    # ---------------------------------------------------------------- 12 · reports
    def reports(self):
        today = self.api.today()
        out_expect = self.s_end["outstanding_paise"] / 100
        self.go(f"/reports/outstanding-v2?project_id={self.pid}", "report-totals")
        out_ui = self.tid("report-totals").inner_text()
        assert f"{inr(out_expect)}".replace(",", "") in out_ui.replace(",", ""), (
            out_ui,
            out_expect,
        )
        self.go(
            f"/reports/collections-v2?project_id={self.pid}&from_date={today}&to_date={today}",
            "reports-page",
        )
        expect(self.tid("report-totals")).to_be_visible(timeout=20000)
        heads = [
            h.strip().upper()
            for h in self.tid("report-table").locator("thead th").all_inner_texts()
        ]
        tot = dict(
            zip(
                heads,
                [
                    c.strip()
                    for c in self.tid("report-totals").locator("td").all_inner_texts()
                ],
            )
        )
        rev_col = next(h for h in heads if h.startswith("REVERSALS"))
        assert (
            tot["RECEIPTS"] == "2"
            and rupees(tot[rev_col]) == -self.amount
            and rupees(tot["NET RECEIVED"]) == 0
        ), tot
        self.go(f"/roznamcha?date={today}", "roznamcha-page")
        rec = self.tid(f"rozn-receipt-{self.receipt}")
        rev = self.tid(f"rozn-reversal-{self.receipt}")
        expect(rec).to_be_visible(timeout=20000)
        expect(rev).to_be_visible(timeout=20000)
        assert (
            rupees(rec.inner_text()) == self.amount
            and abs(rupees(rev.inner_text())) == self.amount
        )
        return (
            f"Outstanding total shows {inr(out_expect)} (= booking outstanding) · Collections today: 2 rows, "
            f"reversals −{inr(self.amount)}, net ₹0 · "
            f"Roznamcha: receipt +{inr(self.amount)} and reversal −{inr(self.amount)}"
        )

    # ---------------------------------------------------------------- 13 · waiver (owner request = self-approved)
    def waiver(self):
        before = self.api.get(f"/bookings/{self.bid}")["summary"]
        self.go(f"/bookings/{self.bid}?tab=bills", "waivers-panel")
        self.tid("give-waiver-btn").click()
        expect(self.tid("waiver-sheet")).to_be_visible(timeout=15000)
        self.tid("waiver-target-trigger").click()
        self.tid("waiver-target-opt-share:Account").click()
        self.tid("waiver-amount").fill("1000")
        self.tid("waiver-reason").fill("Delay compensation")
        self.tid("waiver-submit").click()
        w = None
        for _ in range(40):
            items = self.api.get("/waivers", booking_id=self.bid)["items"]
            if items:
                w = items[0]
                break
            self.p.wait_for_timeout(300)
        assert w and w["status"] == "Approved" and w["self_approved"] and w["cn_number"], w
        expect(self.tid(f"waiver-row-{w['waiver_number']}")).to_be_visible(timeout=20000)
        expect(self.tid(f"waiver-cn-{w['waiver_number']}")).to_be_visible()
        credit = sum(e["amount_paise"] for e in w["entries"])
        after = self.api.get(f"/bookings/{self.bid}")["summary"]
        assert after["total_received_paise"] == before["total_received_paise"], (before, after)
        assert before["outstanding_paise"] - after["outstanding_paise"] == credit, (before, after, credit)
        self.waiver_doc = w
        return (
            f"{w['waiver_number']} · {w['cn_number']} self-approved · ₹1,000 Account share + GST credit = "
            f"{inr(credit / 100)} off outstanding · received unchanged"
        )

    # ---------------------------------------------------------------- 14 · discount + waiver registers
    def registers(self):
        today = self.api.today()
        self.go(f"/reports/discount-register?from_date={today}&to_date={today}", "reports-page")
        expect(self.tid("report-table")).to_contain_text(self.booking_number, timeout=20000)
        self.go(f"/reports/waiver-register?from_date={today}&to_date={today}", "reports-page")
        expect(self.tid("report-table")).to_contain_text(self.waiver_doc["waiver_number"], timeout=20000)
        expect(self.tid("report-table")).to_contain_text(self.waiver_doc["cn_number"])
        return f"Discount Register lists {self.booking_number} · Waiver Register lists {self.waiver_doc['waiver_number']} / {self.waiver_doc['cn_number']}"

    def run(self):
        steps = [
            ("Masters: new Flat Type + Charge Head", self.masters),
            ("Project", self.project),
            ("Tower from template", self.tower),
            ("Flats: pricing sheet", self.pricing_sheet),
            ("Pricing", self.pricing),
            ("Lead", self.lead),
            ("Site visit", self.visit),
            ("Booking: 3-step wizard", self.booking),
            ("Stage complete → bills raised", self.stage),
            ("Payment: 5-field sheet, auto adjustment", self.payment),
            ("Reversal", self.reversal),
            ("Reports: Outstanding, Collections, Roznamcha", self.reports),
            ("Waiver: Give waiver sheet → self-approved credit note", self.waiver),
            ("Reports: Discount + Waiver registers", self.registers),
        ]
        for i, (title, fn) in enumerate(steps, 1):
            try:
                self.step(i, title, fn)
            except Exception as e:
                shot = f"/tmp/clickthrough_step{i}.png"
                self.p.screenshot(path=shot, full_page=False)
                self.log.append(
                    (
                        i,
                        title,
                        "FAIL",
                        0,
                        f"{type(e).__name__}: {str(e)[:400]} (screenshot {shot})",
                    )
                )
                raise


def route_to(base):
    def handle(route):
        u = urlsplit(route.request.url)
        h = {
            k: v
            for k, v in route.request.headers.items()
            if k.lower() not in ("host", "content-length")
        }
        h["x-rate-limit-bypass"] = BYPASS
        cookie = route.request.header_value("cookie")
        if cookie:
            h["cookie"] = cookie
        resp = route.fetch(
            url=base.rstrip("/") + u.path + (f"?{u.query}" if u.query else ""),
            headers=h,
            timeout=90000,
        )
        route.fulfill(response=resp)

    return handle


def write_log(log, base, ok, seconds):
    lines = [
        "# Phase 3 · click-through (REQ-148, JRN-77)",
        "",
        (
            f"Result: **{'PASS' if ok else 'FAIL'}** · {sum(1 for r in log if r[2] == 'PASS')}/{len(log)} steps · {seconds:.0f} s · "
            f"private backend {base} (own DB, dropped after the run; preview demo untouched)"
        ),
        "",
        "Run: `cd /app/tests_e2e/clickthrough && python -m pytest -q` (see README; never alongside the backend pytest)",
        "",
        "| # | Step | Result | s | What the screen showed / asserted |",
        "|---|---|---|---|---|",
    ]
    lines += [
        f"| {n} | {t} | {r} | {s} | {' '.join(str(f).split())} |"
        for n, t, r, s, f in log
    ]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as fh:
        fh.write("\n".join(lines) + "\n")


def run(base, password):
    api, log, t0, ok = Api(base, password), [], time.time(), False
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        ctx = br.new_context(viewport={"width": 1440, "height": 900})
        ctx.route("**/api/**", route_to(base))
        page = ctx.new_page()
        page.set_default_timeout(20000)
        try:
            page.goto(_front() + "/login")
            page.fill("input[type=email]", "admin@kkt.in")
            page.fill("input[type=password]", password)
            page.keyboard.press("Enter")
            page.wait_for_selector("[data-testid='home-grid']", timeout=60000)
            Story(page, api, log).run()
            ok = True
        finally:
            write_log(log, base, ok, time.time() - t0)
            br.close()
    return log


if __name__ == "__main__":
    a = argparse.ArgumentParser()
    a.add_argument("--base", required=True)
    args = a.parse_args()
    sys.path.insert(0, os.path.join(ROOT, "backend"))
    from dotenv import load_dotenv

    load_dotenv(os.path.join(ROOT, "backend", ".env"))
    for r in run(args.base, os.environ["DEMO_PASSWORD"]):
        print(r)
