# Part II — Data model

{{include:collections.md}}

### 4.1 Core entity relationships

```flow
Company -> Project (website, RERA, unit counts) -> Block / Tower (floor plan assignments, construction stages) -> Flat (type snapshot, price breakup, status) -> Booking (buckets, plan snapshot, other charges) -> Demand (per installment) -> Payment (receipt) -> Ledger row (running balance)
```

```flow
Lead (source, stage, activities) -> Site visit (slot, capacity) -> Customer (sealed KYC, portal account) -> Booking -> Service request / Documents / Photos / Notifications
```

Masters referenced by id and snapshotted into the dependent document at write time: flat types, floor-plan templates, PLC types, charge types, amenities, banks, document types, construction stage masters, payment plans. Snapshots (`flat_type_snapshot`, `payment_plan_snapshot`, `construction_stages` copied into the block) make history immutable even when a master changes later.

### 4.2 State machines

**Flat**

```state
Available -> Hold : sales places a hold (expires automatically after hold_hours)
Hold -> Available : hold released or expired
Available -> Booked : booking confirmed (atomic find_one_and_update on status ∈ {Available, Hold})
Hold -> Booked : same precondition
Booked -> Sold : handover recorded on the booking
Booked -> Available : booking cancelled (refund computed)
Available -> Blocked : admin blocks the unit (not sellable)
Blocked -> Available : unblock
```

**Booking**

```state
Draft -> Active : wizard confirm (flat lock + agreement + plan snapshot + catch-up demands)
Active -> Cancelled : cancellation with refund ≤ paid (REFUND_EXCEEDS_PAID)
Active -> Completed : handover; flat → Sold
```

**Demand**

```state
Open -> Partially paid : cleared payment allocated below total
Open -> Overdue : due_date < today and unpaid (hourly sweep)
Partially paid -> Paid : paid_paise ≥ total_demand_paise
Open -> Voided : stage undo / integrity repair (unpaid only)
```

**Payment**

```state
Pending -> Cleared : cheque/DD cleared (clearing endpoint); CASH/UPI/NEFT_RTGS/LOAN_DISBURSEMENT clear immediately
Pending -> Bounced : cheque returned; ledger unaffected
Cleared -> Reversed : reversal with reason; ledger row REVERSAL appended
```

**Lead**

```state
New -> Contacted : first follow-up logged
Contacted -> Site Visit Scheduled : visit booked (also New → Site Visit Scheduled)
Site Visit Scheduled -> Site Visit Done : visit marked Completed
Site Visit Scheduled -> previous stage : only upcoming visit cancelled (auto-revert)
Site Visit Done -> Negotiation : manual
Negotiation -> Converted : convert to customer (+ optional booking)
any -> Lost : with lost_reason
```

**Service request**

```state
Open -> In Progress : assigned / first internal note
In Progress -> Resolved : resolution posted (SLA stop)
Resolved -> Closed : customer rates or 7-day auto-close
Resolved -> Open : customer reopens within window (CANNOT_REOPEN after close)
```

**Site visit**

```state
Confirmed -> Rescheduled : ERP reschedule (capacity re-checked, counts as confirmed)
Confirmed -> Completed : outcome; lead → Site Visit Done
Confirmed -> No-show : outcome; activity logged
Confirmed -> Cancelled : visitor (signed link) or ERP with reason
Cancelled -> Confirmed : ERP re-confirm (capacity re-checked)
```

**Construction stage (per block)**

```state
Pending -> Completed : set current stage (jump-ahead completes all earlier stages with the same date)
Completed -> Pending : undo last completed stage — blocked if any demand it raised has a payment (UNDO_BLOCKED_BY_PAYMENTS)
```
