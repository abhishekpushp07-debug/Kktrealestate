async def run_test(page, output_dir, page_url):

    SCREEN_DIR = "/app/memory/qa/frontend"
    await page.set_viewport_size({"width": 1920, "height": 1080})

    try:
        await page.wait_for_selector('input[type="email"]', timeout=15000)
        await page.fill('input[type="email"]', 'admin@kkt.in')
        await page.fill('input[type="password"]', 'Kkt@12345')
        await page.click('button[type="submit"]')
        await page.wait_for_url("**/dashboard**", timeout=15000)

        # Go directly to Tower A block
        await page.goto("https://royal-realty-hub-2.preview.emergentagent.com/blocks/4e99bd2c-25eb-45b8-91a5-501b4a5295c2")
        await page.wait_for_load_state("networkidle")
        await page.wait_for_timeout(1500)
        print("STEP1 OK on Tower A")
        await page.screenshot(path=f"/app/memory/qa/frontend/automation_output/20261026_024123_f482b2a6b783/e7_undo_fix_01_tower_a.jpeg", type="jpeg", quality=40, full_page=False)

        # Click an available flat - try A-801
        await page.get_by_text("A-801", exact=True).first.click()
        await page.wait_for_selector('[data-testid="flat-drawer"]', timeout=5000)
        await page.wait_for_timeout(600)
        print("STEP2 OK drawer open for A-801")
        drawer_text = await page.locator('[data-testid="flat-drawer"]').inner_text()
        print(f"Drawer text (first 400): {drawer_text[:400]}")
        await page.screenshot(path=f"/app/memory/qa/frontend/automation_output/20261026_024123_f482b2a6b783/e7_undo_fix_02_drawer_A801.jpeg", type="jpeg", quality=40, full_page=False)

        # Click "Mark Hold"
        mark_hold = page.get_by_role("button", name="Mark Hold", exact=True)
        if await mark_hold.count() == 0:
            # Maybe just "Hold"
            mark_hold = page.locator('[data-testid="flat-drawer"] button').filter(has_text="Hold").first
        await mark_hold.first.click()
        print("STEP3 OK clicked Mark Hold")

        await page.wait_for_selector('[data-sonner-toast]', timeout=5000)
        await page.wait_for_timeout(600)
        print("STEP4 OK toast appeared")
        await page.screenshot(path=f"/app/memory/qa/frontend/automation_output/20261026_024123_f482b2a6b783/e7_undo_fix_03_toast_hold.jpeg", type="jpeg", quality=40, full_page=False)

        # Introspect toast position & z-index
        info = await page.evaluate("""() => {
            const toaster = document.querySelector('[data-sonner-toaster]');
            const toast = document.querySelector('[data-sonner-toast]');
            const overlay = document.querySelector('[data-radix-dialog-overlay], [data-state="open"][role="dialog"]');
            return {
                toaster_position: toaster?.getAttribute('data-position'),
                toaster_z: toaster ? getComputedStyle(toaster).zIndex : null,
                toaster_pe: toaster ? getComputedStyle(toaster).pointerEvents : null,
                toast_pe: toast ? getComputedStyle(toast).pointerEvents : null,
                toast_text: toast?.innerText?.slice(0,150),
                bbox: (() => { const b = toast?.getBoundingClientRect(); return b ? {x:b.x,y:b.y,w:b.width,h:b.height,bottom:b.bottom,right:b.right} : null; })(),
                viewport: {w: window.innerWidth, h: window.innerHeight}
            };
        }""")
        print(f"TOASTER INFO: {info}")

        # Find Undo button
        undo = page.locator('[data-sonner-toast] button:has-text("Undo"), [data-sonner-toast] [data-button]:has-text("Undo")').first
        await undo.wait_for(state="visible", timeout=3000)
        box = await undo.bounding_box()
        print(f"Undo bbox: {box}")

        # Real mouse click (NOT JS click)
        cx = box["x"] + box["width"]/2
        cy = box["y"] + box["height"]/2
        await page.mouse.move(cx, cy)
        await page.wait_for_timeout(100)
        await page.mouse.click(cx, cy)
        print(f"STEP5 OK: Real mouse click at ({cx:.0f},{cy:.0f}) on Undo")

        await page.wait_for_timeout(1800)
        await page.screenshot(path=f"/app/memory/qa/frontend/automation_output/20261026_024123_f482b2a6b783/e7_undo_fix_04_after_undo.jpeg", type="jpeg", quality=40, full_page=False)

        toasts_after = await page.evaluate("""() => Array.from(document.querySelectorAll('[data-sonner-toast]')).map(t => t.innerText).join(' || ')""")
        drawer_still = await page.locator('[data-testid="flat-drawer"]').is_visible()
        drawer_text_after = await page.locator('[data-testid="flat-drawer"]').inner_text() if drawer_still else ""
        print(f"Toasts after Undo: {toasts_after!r}")
        print(f"Drawer still visible: {drawer_still}")
        print(f"Drawer text after (first 300): {drawer_text_after[:300]}")

        part_a_pass = drawer_still and ("available" in toasts_after.lower() or "back to" in toasts_after.lower() or "undone" in toasts_after.lower())
        if part_a_pass:
            print("### PART A PASS: Undo clickable by real mouse while drawer open; status reverted; drawer still open")
        else:
            print(f"### PART A ISSUE: drawer={drawer_still}, toasts={toasts_after}")

        # Close drawer
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(600)

        # ---------- PART B: Post payment sheet toast ----------
        await page.goto("https://royal-realty-hub-2.preview.emergentagent.com/bookings")
        await page.wait_for_load_state("networkidle")
        await page.wait_for_timeout(1200)
        # Click first booking row
        booking_links = page.locator('a[href*="/bookings/"]')
        bcount = await booking_links.count()
        print(f"Booking links: {bcount}")
        if bcount > 0:
            await booking_links.first.click()
            await page.wait_for_load_state("networkidle")
            await page.wait_for_timeout(1500)
            await page.screenshot(path=f"/app/memory/qa/frontend/automation_output/20261026_024123_f482b2a6b783/e7_undo_fix_05_booking_detail.jpeg", type="jpeg", quality=40, full_page=False)

            pp_btn = page.get_by_role("button", name="Post payment")
            if await pp_btn.count() > 0:
                await pp_btn.first.click()
                await page.wait_for_timeout(1500)
                sheet = page.locator('[data-testid="post-payment-sheet"]')
                if await sheet.count() == 0:
                    sheet = page.locator('[role="dialog"]').last
                vis = await sheet.is_visible()
                print(f"Post-payment sheet visible: {vis}")
                await page.screenshot(path=f"/app/memory/qa/frontend/automation_output/20261026_024123_f482b2a6b783/e7_undo_fix_06_postpay_sheet.jpeg", type="jpeg", quality=40, full_page=False)

                if vis:
                    # Try to click Post without filling → should fire validation toast
                    post_submit = sheet.locator('button').filter(has_text="Post payment")
                    if await post_submit.count() == 0:
                        post_submit = sheet.locator('button[type="submit"]')
                    if await post_submit.count() == 0:
                        post_submit = sheet.locator('button').filter(has_text="Post")

                    try:
                        await post_submit.last.click(timeout=3000)
                        print("Clicked Post submit")
                    except Exception as e:
                        print(f"submit err: {e}")
                    await page.wait_for_timeout(1500)

                    t_count = await page.locator('[data-sonner-toast]').count()
                    print(f"Toasts after submit: {t_count}")
                    await page.screenshot(path=f"/app/memory/qa/frontend/automation_output/20261026_024123_f482b2a6b783/e7_undo_fix_07_postpay_toast.jpeg", type="jpeg", quality=40, full_page=False)

                    # Introspect
                    info2 = await page.evaluate("""() => {
                        const toaster = document.querySelector('[data-sonner-toaster]');
                        const toast = document.querySelector('[data-sonner-toast]');
                        return {
                            z: toaster ? getComputedStyle(toaster).zIndex : null,
                            pe: toaster ? getComputedStyle(toaster).pointerEvents : null,
                            position: toaster?.getAttribute('data-position'),
                            toast_pe: toast ? getComputedStyle(toast).pointerEvents : null,
                            toast_text: toast?.innerText?.slice(0,200)
                        };
                    }""")
                    print(f"Post-pay toast info: {info2}")

                    if t_count > 0:
                        close_x = page.locator('[data-sonner-toast] [data-close-button]').first
                        if await close_x.count() > 0:
                            try:
                                await close_x.wait_for(state="visible", timeout=2000)
                                b = await close_x.bounding_box()
                                print(f"Close X bbox: {b}")
                                if b:
                                    await page.mouse.click(b["x"]+b["width"]/2, b["y"]+b["height"]/2)
                                    await page.wait_for_timeout(900)
                                    rem = await page.locator('[data-sonner-toast]').count()
                                    print(f"Remaining toasts: {rem}")
                                    if rem < t_count:
                                        print("### PART B PASS: Close X is clickable via real mouse while sheet open")
                                    else:
                                        print("### PART B WARN: X click did not dismiss")
                            except Exception as e:
                                print(f"X click err: {e}")
                        else:
                            print("### PART B WARN: No close button data-close-button found")
                    else:
                        print("### PART B SKIP: No validation toast fired")

                    await page.screenshot(path=f"/app/memory/qa/frontend/automation_output/20261026_024123_f482b2a6b783/e7_undo_fix_08_final.jpeg", type="jpeg", quality=40, full_page=False)
            else:
                print("### PART B SKIP: No Post payment button on this booking")

        print("=== TEST COMPLETE ===")

    except Exception as e:
        import traceback
        traceback.print_exc()
        await page.screenshot(path=f"/app/memory/qa/frontend/automation_output/20261026_024123_f482b2a6b783/e7_undo_fix_ERROR.jpeg", type="jpeg", quality=40, full_page=False)

