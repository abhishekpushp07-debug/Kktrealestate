# Retest of iteration-41 findings (chunk 3-2), iteration 42. Read-only UI checks via browser_automation, admin, 1440 and 390.
IDs used: booking BK-2526-2330 0d96d3c9-c2d7-4902-a800-8bc150a1f22a (revise dialog opened, not submitted),
booking BK-2526-2352 19b7ea3a-0a8a-4ee4-b701-020b96abe128 + bill 96aea272-613d-403f-878b-9949ced72343 (pp preview, print),
flat A-101 eaf1dfc6-fa8d-4ce8-b0fe-aab507bdb16c + customer c21a065a-0d70-4303-8305-d405b991f1b3 (wizard opened at step 2, not booked).

Checks:
1. Visit /reports/{upcoming-dues,demand-vs-collection,construction-progress,data-quality}, /settings, /settings/catalogues, /demands*, /documents and all /masters/* routes.
   Regex-scan main innerText for /demand\w*/i, UPPER_SNAKE and snake_case.
2. Check that md-account, rev-account and wiz-account are type=text and show the ₹ prefix with 1,23,456 grouping.
3. Type 1923456. Put the caret after the 1st comma and press Backspace: expect 1,23,456 with caret 1.
   Put the caret before the comma and press Delete: expect 1,93,456 with caret 3.
4. Open a tower or stage template, then Edit: master-change-note and master-change-used-in are present.
5. Run the pp allocation preview (mode Cash), the Documents sent buttons, the Display footer of tower-sales-total, and the 38vh masters side list at 390.
6. Spot-checks:
   - pp-inst-bank "PNB" offers "Save to Banks". Not clicked.
   - The booking Activity tab shows each receipt once.
