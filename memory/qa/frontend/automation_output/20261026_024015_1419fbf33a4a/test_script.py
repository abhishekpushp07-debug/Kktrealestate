async def run_test(page, output_dir, page_url):

    SCREEN_DIR = "/app/memory/qa/frontend"

    page.on("console", lambda msg: print(f"CONSOLE[{msg.type}]: {msg.text}") if msg.type == "error" else None)
    await page.set_viewport_size({"width": 1920, "height": 1080})

    try:
        # Login
        await page.wait_for_selector('input[type="email"]', timeout=15000)
        await page.fill('input[type="email"]', 'admin@kkt.in')
        await page.fill('input[type="password"]', 'Kkt@12345')
        await page.click('button[type="submit"]')
        await page.wait_for_url("**/dashboard**", timeout=15000)
        print("STEP1 OK logged in")

        # Go directly to projects
        await page.goto("https://royal-realty-hub-2.preview.emergentagent.com/projects")
        await page.wait_for_load_state("networkidle")
        await page.wait_for_timeout(1000)

        # Click SGH link (anchor to its workspace)
        await page.locator('a:has-text("Shree Ganesh Heights")').first.click()
        await page.wait_for_load_state("networkidle")
        await page.wait_for_timeout(1000)

        # Towers tab is already on; click into Tower A card header link
        # Tower cards may be <a> or clickable div. Try clicking its name link
        tower_a_link = page.locator('a:has-text("Tower A"), [role="link"]:has-text("Tower A")').first
        try:
            await tower_a_link.click(timeout=3000)
        except:
            # Click the card itself
            await page.locator('text=Tower A').first.click()
        await page.wait_for_load_state("networkidle")
        await page.wait_for_timeout(1500)
        url_now = page.url
        print(f"STEP2 URL: {url_now}")
        await page.screenshot(path=f"/app/memory/qa/frontend/automation_output/20261026_024015_1419fbf33a4a/e7_undo_fix_01_tower_opened.jpeg", type="jpeg", quality=40, full_page=False)

        # If not on a block page, try clicking "Update stage" neighbour or use data-testid
        # Try to find flat cells
        cell_count = await page.locator('.cell, [data-testid^="flat-cell"], [data-testid^="unit-cell"]').count()
        print(f"Cells found: {cell_count}")

        if cell_count == 0:
            # Try clicking on the "Tower A" title as a link via href
            hrefs = await page.evaluate("""() => Array.from(document.querySelectorAll('a')).map(a => a.href).filter(h => /block|tower/i.test(h)).slice(0,10)""")
            print("Possible links:", hrefs)
            if hrefs:
                await page.goto(hrefs[0])
                await page.wait_for_load_state("networkidle")
                await page.wait_for_timeout(1500)
                cell_count = await page.locator('.cell').count()
                print(f"After direct nav, cells: {cell_count}")

        await page.screenshot(path=f"/app/memory/qa/frontend/automation_output/20261026_024015_1419fbf33a4a/e7_undo_fix_02_block_grid.jpeg", type="jpeg", quality=40, full_page=False)

        # Click an Available cell
        avail = page.locator('[title*="Available" i]').first
        if await avail.count() == 0:
            avail = page.locator('.cell').first
        await avail.click()
        await page.wait_for_selector('[data-testid="flat-drawer"]', timeout=5000)
        print("STEP3 OK drawer open")
        await page.wait_for_timeout(600)
        await page.screenshot(path=f"/app/memory/qa/frontend/automation_output/20261026_024015_1419fbf33a4a/e7_undo_fix_03_drawer.jpeg", type="jpeg", quality=40, full_page=False)

        # Determine action: pick a Mark button
        for label in ["Mark Hold", "Mark Available", "Mark Blocked"]:
            btn = page.get_by_role("button", name=label, exact=True)
            if await btn.count() > 0 and await btn.first.is_visible():
                await btn.first.click()
                print(f"STEP4 clicked {label}")
                break

        # Wait for toast
        await page.wait_for_selector('[data-sonner-toast]', timeout=5000)
        await page.wait_for_timeout(500)
        print("STEP5 toast appeared")
        await page.screenshot(path=f"/app/memory/qa/frontend/automation_output/20261026_024015_1419fbf33a4a/e7_undo_fix_04_toast.jpeg", type="jpeg", quality=40, full_page=False)

        # Introspect toast
        info = await page.evaluate("""() => {
            const toaster = document.querySelector('[data-sonner-toaster]');
            const toast = document.querySelector('[data-sonner-toast]');
            return {
                position: toaster?.getAttribute('data-position'),
                z: toaster ? getComputedStyle(toaster).zIndex : null,
                pe: toaster ? getComputedStyle(toaster).pointerEvents : null,
                toast_pe: toast ? getComputedStyle(toast).pointerEvents : null,
                html: toast?.outerHTML.slice(0, 400)
            };
        }""")
        print("Toast info:", info)

        # Find Undo button
        undo = page.locator('[data-sonner-toast] button:has-text("Undo"), [data-sonner-toast] [data-button]:has-text("Undo")').first
        await undo.wait_for(state="visible", timeout=3000)
        box = await undo.bounding_box()
        print(f"Undo bbox: {box}")
        assert box, "Undo button has no bbox"

        # Real mouse click
        await page.mouse.move(box["x"]+box["width"]/2, box["y"]+box["height"]/2)
        await page.mouse.click(box["x"]+box["width"]/2, box["y"]+box["height"]/2)
        print("STEP6 real mouse clicked Undo")
        await page.wait_for_timeout(1500)
        await page.screenshot(path=f"/app/memory/qa/frontend/automation_output/20261026_024015_1419fbf33a4a/e7_undo_fix_05_after_undo.jpeg", type="jpeg", quality=40, full_page=False)

        toasts_txt = await page.evaluate("""() => Array.from(document.querySelectorAll('[data-sonner-toast]')).map(t => t.innerText).join(' || ')""")
        print(f"Toasts after undo: {toasts_txt}")
        drawer_open = await page.locator('[data-testid="flat-drawer"]').is_visible()
        print(f"Drawer still open: {drawer_open}")

        revert_ok = any(k in toasts_txt.lower() for k in ["back to", "undone", "reverted", "available", "hold"])
        if drawer_open and revert_ok:
            print("PART A PASS: Undo button clickable via real mouse; drawer still open; revert toast fired")
        else:
            print(f"PART A ISSUE: drawer_open={drawer_open}, revert_ok={revert_ok}")

        # Close drawer
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(500)

        # ---------- PART B: Post payment sheet ----------
        await page.goto("https://royal-realty-hub-2.preview.emergentagent.com/bookings")
        await page.wait_for_load_state("networkidle")
        await page.wait_for_timeout(800)
        await page.locator('a[href*="/bookings/"]').first.click()
        await page.wait_for_load_state("networkidle")
        await page.wait_for_timeout(1000)

        post_btn = page.get_by_role("button", name="Post payment", exact=False)
        try:
            await post_btn.first.click(timeout=4000)
        except:
            try:
                await page.get_by_text("Post payment", exact=False).first.click()
            except Exception as e:
                print(f"No Post payment btn: {e}")

        await page.wait_for_timeout(1200)
        sheet_visible = await page.locator('[data-testid="post-payment-sheet"], [role="dialog"]').count()
        print(f"Sheet open: {sheet_visible}")
        await page.screenshot(path=f"/app/memory/qa/frontend/automation_output/20261026_024015_1419fbf33a4a/e7_undo_fix_06_postpay_open.jpeg", type="jpeg", quality=40, full_page=False)

        if sheet_visible:
            # Submit without filling to trigger validation error toast
            submit_btn = page.locator('[data-testid="post-payment-sheet"] button, [role="dialog"] button').filter(has_text="Post").last
            try:
                await submit_btn.click(timeout=3000)
            except Exception as e:
                print(f"submit click err: {e}")
            await page.wait_for_timeout(1500)
            t_count = await page.locator('[data-sonner-toast]').count()
            print(f"Toasts after submit: {t_count}")
            await page.screenshot(path=f"/app/memory/qa/frontend/automation_output/20261026_024015_1419fbf33a4a/e7_undo_fix_07_postpay_toast.jpeg", type="jpeg", quality=40, full_page=False)

            if t_count > 0:
                # Try clicking close X with real mouse
                close_btn = page.locator('[data-sonner-toast] [data-close-button]').first
                try:
                    await close_btn.wait_for(state="visible", timeout=2000)
                    box = await close_btn.bounding_box()
                    print(f"Close X bbox: {box}")
                    if box:
                        await page.mouse.click(box["x"]+box["width"]/2, box["y"]+box["height"]/2)
                        await page.wait_for_timeout(800)
                        rem = await page.locator('[data-sonner-toast]').count()
                        print(f"After X click, remaining: {rem}")
                        if rem < t_count:
                            print("PART B PASS: Toast X clickable above sheet")
                        else:
                            print("PART B PARTIAL: X did not dismiss (may auto-fade)")
                except Exception as e:
                    print(f"PART B X error: {e}")
            else:
                print("PART B SKIP: no toast produced from empty submit")

        await page.screenshot(path=f"/app/memory/qa/frontend/automation_output/20261026_024015_1419fbf33a4a/e7_undo_fix_08_final.jpeg", type="jpeg", quality=40, full_page=False)

    except Exception as e:
        import traceback
        print(f"TEST ERROR: {e}")
        traceback.print_exc()
        await page.screenshot(path=f"/app/memory/qa/frontend/automation_output/20261026_024015_1419fbf33a4a/e7_undo_fix_ERROR.jpeg", type="jpeg", quality=40, full_page=False)

