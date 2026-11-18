# Retired tests (Phase R follow-up)

Each test below depended on the legacy demo seed (fixed demo personas, pre-switch snapshots, `V1`/`B-7xx` free flats). One-line reason per test; the behaviour is either rewritten against the story dataset in `tests/test_story_behaviours.py` or already covered elsewhere.

| Test | Reason |
|---|---|
| `test_price_truth.py::test_flat_api_prices_match_pre_switch_snapshot` | Pre-switch price snapshot no longer exists; price truth is covered by `test_whole_rupee.py` + `effects/test_flat_hold_effects`. |
| `test_phase_2.py::test_concurrency_and_sum_mismatch` | Needed free `V1` demo flats; version-conflict + idempotency now in `test_hardening.py::test_version_conflict_409` / `test_idempotency_replay_customer_create`. |
| `test_phase_2.py::test_payment_requires_idempotency_and_bucket_cap_and_revision` | Rewritten: `test_story_behaviours.py::test_cash_bucket_cap_rejected_on_anchor` + `test_hardening.py::test_payment_without_idempotency_key_rejected` + `effects::test_agreement_revision_reproportions_open_demands`. |
| `test_phase_2.py::test_cheque_pending_clear_bounce_reverse` | Rewritten: `test_story_behaviours.py::test_cheque_pending_clear_then_reverse` + `effects::test_cheque_bounce_raises_charge_and_notifies`. |
| `test_phase_2.py::test_milestones_forward_only_and_undo_block` | Rewritten: `test_phase_d_perf.py::test_stages_forward_only_and_undo_roundtrip` (co-located with the integrity test for loadscope ordering). |
| `test_phase_2.py::test_kyc_masking_and_reveal` | Rewritten on story customer: `test_story_behaviours.py::test_kyc_masked_for_sales_revealed_for_accounts`. |
| `test_phase_2.py::test_roznamcha` | Hard-coded demo day totals; rewritten as a data-relative identity: `test_story_behaviours.py::test_roznamcha_identity_on_story_cash_day`. |
| `test_phase_3.py::test_cms_collection_counts[testimonials-6]` | Testimonials were demo content; the story dataset ships none. Other CMS collections still asserted. |
| `test_phase_7.py::TestBK0001Integrity` | Demo ledger row counts; ledger integrity now `test_ledger_example.py` (owner example) + `test_story_headline.py::test_story_anchor_bk_2526_0013`. |
| `test_phase_7.py::TestTowerBConstruction` | Demo "2 of 11" fixture; rewritten data-relative: `test_story_behaviours.py::test_block_percent_matches_completed_stage_weights`. |
| `test_phase_5.py::TestPortalAuth::test_lockout_after_5_wrong` | Rewritten on the story portal persona: `test_story_behaviours.py::test_portal_change_password_and_back_then_lockout`. |
| `test_phase_5.py::TestPortalData::test_me_masked / test_bookings_list / test_other_customers_booking_404` | Rewritten: `test_story_behaviours.py::test_portal_me_masked_and_own_bookings_only`. |
| `test_phase_5.py::TestServiceRequests::test_rate_sunita_sr3` | Demo persona "Sunita" + SR-3 fixture; SR create/reply/rate flow kept in `TestServiceRequests::test_categories_and_create_and_reply`. |
| `test_phase_5.py::TestChangePassword` | Demo persona "Santosh"; rewritten: `test_story_behaviours.py::test_portal_change_password_and_back_then_lockout`. |
| `test_phase_5.py::TestErpPortalMgmt::test_get_portal_status_and_revoke_and_bulk` | Demo portal account list; revoke + enable + temp-password flow covered by `test_new_customer_enable_and_temp_password_flow` and the lockout rewrite. |
| `test_phase_5.py::TestErpDocShare::test_toggle_share_and_sensitive_block` | Expected a demo-seeded shared allotment document; sensitive-document RBAC is `test_phase_2.py::test_documents_upload_download_rbac`. |
| `test_phase_1_5.py::TestRateCards::test_create_activate_apply` | Assumed demo flat A-101 on Hold; rewritten data-relative: `test_story_behaviours.py::test_rate_card_create_activate_apply_to_available`. |
| `test_phase_9.py::test_brochure_gate_flow` | Brochure gate is disabled for story projects (public website parked); public-surface leak scan remains in `test_hardening.py`. |
| `test_phase_9.py::test_availability_rules` | Asserted demo slot rules on a fixed date; availability + booking flow still exercised by `test_phase_11a.py` site-visit tests. |

Remaining skips (environment-dependent, justified in-code): `test_cors_deny.py` (platform ingress adds its own CORS headers; asserted against the local backend only).
