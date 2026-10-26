async def run_test(page, output_dir, page_url):

    SCREEN_DIR = "/app/memory/qa/frontend"
    await page.set_viewport_size({"width": 1920, "height": 1080})

    try:
        # Login as accounts
        await page.wait_for_selector('input[type="email"]', timeout=15000)
        await page.fill('input[type="email"]', 'accounts@kkt.in')
        await page.fill('input[type="password"]', 'Kkt@12345')
        await page.click('button[type="submit"]')
        await page.wait_for_url("**/dashboard**", timeout=15000)
        print("Logged in as accounts")

        await page.goto("https://royal-realty-hub-2.preview.emergentagent.com/bookings")
        await page.wait_for_load_state("networkidle")
        await page.wait_for_timeout(1200)
        await page.screenshot(path=f"/app/memory/qa/frontend/automation_output/20261026_024228_4d508448171f/e7_undo_fix_09_bookings_accounts.jpeg", type="jpeg", quality=40, full_page=False)

        # Click first booking
        await page.locator('a[href*="/bookings/"]').first.click()
        await page.wait_for_load_state("networkidle")
        await page.wait_for_timeout(1500)
        await page.screenshot(path=f"/app/memory/qa/frontend/automation_output/20261026_024228_4d508448171f/e7_undo_fix_10_booking_detail_accounts.jpeg", type="jpeg", quality=40, full_page=False)

        # Look for Post payment
        pp = page.get_by_role("button", name="Post payment")
        pp_count = await pp.count()
        print(f"Post payment buttons: {pp_count}")
        if pp_count == 0:
            # Look for a different variant
            pp = page.locator('button').filter(has_text="Post payment")
            pp_count = await pp.count()
            print(f"Alt Post payment: {pp_count}")

        if pp_count > 0:
            await pp.first.click()
            await page.wait_for_timeout(1500)
            sheet = page.locator('[data-testid="post-payment-sheet"]')
            sheet_count = await sheet.count()
            if sheet_count == 0:
                sheet = page.locator('[role="dialog"]').last
            vis = await sheet.is_visible()
            print(f"Sheet visible: {vis}")
            await page.screenshot(path=f"/app/memory/qa/frontend/automation_output/20261026_024228_4d508448171f/e7_undo_fix_11_postpay_sheet.jpeg", type="jpeg", quality=40, full_page=False)

            if vis:
                # Try to submit empty / wrong to trigger validation toast
                submit = sheet.locator('button[type="submit"]')
                if await submit.count() == 0:
                    submit = sheet.locator('button').filter(has_text="Post")
                try:
                    await submit.last.click(timeout=3000)
                except Exception as e:
                    print(f"submit click err: {e}")
                await page.wait_for_timeout(1800)

                tc = await page.locator('[data-sonner-toast]').count()
                print(f"Toasts after submit: {tc}")
                info = await page.evaluate("""() => {
                    const t = document.querySelector('[data-sonner-toaster]');
                    const toast = document.querySelector('[data-sonner-toast]');
                    const b = toast?.getBoundingClientRect();
                    return {
                        z: t ? getComputedStyle(t).zIndex : null,
                        pe: t ? getComputedStyle(t).pointerEvents : null,
                        toast_pe: toast ? getComputedStyle(toast).pointerEvents : null,
                        toast_text: toast?.innerText?.slice(0,200),
                        bbox: b ? {x:b.x,y:b.y,w:b.width,h:b.height} : null
                    };
                }""")
                print(f"Toast info: {info}")
                await page.screenshot(path=f"/app/memory/qa/frontend/automation_output/20261026_024228_4d508448171f/e7_undo_fix_12_postpay_toast.jpeg", type="jpeg", quality=40, full_page=False)

                if tc > 0:
                    close_x = page.locator('[data-sonner-toast] [data-close-button]').first
                    if await close_x.count() == 0:
                        close_x = page.locator('[data-sonner-toast] button[aria-label*="Close" i]').first
                    if await close_x.count() > 0:
                        try:
                            await close_x.wait_for(state="visible", timeout=2000)
                            b = await close_x.bounding_box()
                            print(f"Close X bbox: {b}")
                            if b:
                                await page.mouse.move(b["x"]+b["width"]/2, b["y"]+b["height"]/2)
                                await page.mouse.click(b["x"]+b["width"]/2, b["y"]+b["height"]/2)
                                await page.wait_for_timeout(900)
                                rem = await page.locator('[data-sonner-toast]').count()
                                print(f"Remaining toasts after X: {rem}")
                                if rem < tc:
                                    print("### PART B PASS: Toast close-X dismissed toast via real mouse click above the sheet")
                                else:
                                    print("### PART B WARN: Click did not dismiss")
                            await page.screenshot(path=f"/app/memory/qa/frontend/automation_output/20261026_024228_4d508448171f/e7_undo_fix_13_after_x.jpeg", type="jpeg", quality=40, full_page=False)
                        except Exception as e:
                            print(f"X err: {e}")
                    else:
                        print("No close X button found")

    except Exception as e:
        import traceback
        traceback.print_exc()
        await page.screenshot(path=f"/app/memory/qa/frontend/automation_output/20261026_024228_4d508448171f/e7_undo_fix_ERROR_B.jpeg", type="jpeg", quality=40, full_page=False)

    import os
    files = sorted([f for f in os.listdir(SCREEN_DIR) if f.startswith("e7_undo_fix")])
    print(f"\nFinal screenshots in {SCREEN_DIR}: {files}")

