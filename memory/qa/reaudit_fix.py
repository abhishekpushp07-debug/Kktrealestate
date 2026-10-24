import asyncio,json,time
from playwright.async_api import async_playwright
B="https://royal-realty-hub-2.preview.emergentagent.com";P="https://royal-realty-hub-2.expo.preview.emergentagent.com";O="/app/memory/qa/reaudit";R={}
async def run():
 async with async_playwright() as p:
  b=await p.chromium.launch()
  ctx=await b.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True);pg=await ctx.new_page();con=[]
  pg.on("console",lambda m: con.append(m.type+": "+m.text[:150]) if m.type in("error","warning") else None)
  await pg.goto(B+"/erp/login");await pg.fill('input[type="email"]',"admin@kkt.in");await pg.fill('input[type="password"]',"Kkt@12345");await pg.click('button[type="submit"]');await pg.wait_for_url("**/erp/dashboard")
  for n,u in [("erp_bookings_list","/erp/bookings"),("erp_payments_list","/erp/payments"),("erp_customer360","/erp/customers/1c179390-185a-44fa-aed2-a34a4a398ada")]:
   reqs=[];h=lambda r: reqs.append(r.url);pg.on("request",h);t=time.time();await pg.goto(B+u,wait_until="commit")
   await pg.wait_for_selector("main :text('BK-'), main h1, main h2",timeout=20000);v=round((time.time()-t)*1000)
   await pg.wait_for_load_state("networkidle");i=round((time.time()-t)*1000);await pg.wait_for_timeout(400)
   R[n+"_390"]={"visible":v,"idle":i,"req":len(reqs),"sw":await pg.evaluate("[document.documentElement.scrollWidth,innerWidth]")};pg.remove_listener("request",h)
   await pg.screenshot(path=f"{O}/{n}_390.png")
  R["con"]=con;await ctx.close()
  for w in (1440,390):
   ctx=await b.new_context(viewport={"width":w,"height":900 if w>400 else 844});pg=await ctx.new_page()
   await pg.goto(B+"/projects/shree-ganesh-heights",wait_until="networkidle")
   R[f"sgh_{w}"]=await pg.evaluate("""(async()=>{for(let y=0;y<document.body.scrollHeight;y+=600){scrollTo(0,y);await new Promise(r=>setTimeout(r,150))}
    const secs=[...document.querySelectorAll('[data-testid]')].map(e=>e.dataset.testid).filter(t=>/galler/i.test(t));
    const g=document.querySelector('[data-testid=project-gallery],[data-testid=gallery],[data-testid*=gallery-grid],section#gallery');
    const imgs=[...document.querySelectorAll('img')];
    return {gtids:[...new Set(secs)].slice(0,20),broken:imgs.filter(i=>i.complete&&i.naturalWidth===0).map(i=>i.src.slice(-70)),total:imgs.length}})()""")
   await pg.wait_for_timeout(1500)
   el=pg.locator("[data-testid*=gallery]").filter(has=pg.locator("img")).first
   try: await el.scroll_into_view_if_needed();await pg.screenshot(path=f"{O}/mkt_SGH_gallery_{w}.png")
   except Exception as e: R[f"sghshot_{w}"]=str(e)[:100]
   await ctx.close()
  ctx=await b.new_context(viewport={"width":390,"height":844},is_mobile=True,has_touch=True);pg=await ctx.new_page()
  await pg.goto(P+"/login");await pg.fill("[data-testid=login-phone-input]","9431012345");await pg.fill("[data-testid=login-password-input]","Buyer@12345");await pg.click("[data-testid=login-submit-button]");await pg.wait_for_selector("[data-testid=home-screen]")
  await pg.screenshot(path=f"{O}/portal_home_390.png",full_page=False)
  await pg.goto(P+"/payments?tab=ledger");await pg.wait_for_selector("[data-testid^=ledger-row-]");await pg.wait_for_timeout(800)
  for _ in range(15): await pg.mouse.wheel(0,800);await pg.wait_for_timeout(150)
  await pg.mouse.move(195,400)
  for _ in range(15): await pg.mouse.wheel(0,800);await pg.wait_for_timeout(150)
  R["ledger_end_390"]=await pg.evaluate("""(()=>{const rows=[...document.querySelectorAll('[data-testid^=ledger-row-]')];const l=rows.at(-1).getBoundingClientRect();const t=document.querySelector('[data-testid=bottom-tab-bar]').getBoundingClientRect();return {lastTop:l.top,lastBottom:l.bottom,tabTop:t.top}})()""")
  await pg.screenshot(path=f"{O}/portal_payments_ledger_end_390.png");await ctx.close();await b.close()
 print(json.dumps(R,indent=1))
asyncio.run(run())
