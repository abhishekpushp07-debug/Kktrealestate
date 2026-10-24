import asyncio, json, time, gzip, re
from playwright.async_api import async_playwright
B="https://royal-realty-hub-2.preview.emergentagent.com"; P="https://royal-realty-hub-2.expo.preview.emergentagent.com"
OUT="/app/memory/qa/reaudit"
THIRD=("emergent.sh","emergentagent.com/__emergent","cdn-cgi","posthog","cloudflare","googletagmanager")
ERP=[("erp_dashboard","/erp/dashboard","[data-testid=w-ageing], main h1"),("erp_projects","/erp/projects","main"),
("erp_towerA_inventory","/erp/blocks/05b195d4-402f-4f24-954e-988c9a7ec872","main"),("erp_bookings_list","/erp/bookings","table"),
("erp_booking_BK0001_ledger","/erp/bookings/473d1218-3478-42f9-bb10-3de2ccdae62f","main"),("erp_payments_list","/erp/payments","table"),
("erp_report_outstanding","/erp/reports/outstanding","main"),("erp_customer360","/erp/customers/1c179390-185a-44fa-aed2-a34a4a398ada","main")]
MKT=[("mkt_home","/"),("mkt_projects","/projects"),("mkt_project_SGH","/projects/shree-ganesh-heights"),("mkt_contact","/contact")]
R={}
def attach(page,st):
    page.on("console",lambda m: st["con"].append(f"{m.type}: {m.text[:200]}") if m.type in("error","warning") else None)
    page.on("pageerror",lambda e: st["con"].append(f"pageerror: {str(e)[:200]}"))
    page.on("request",lambda r: st["req"].append(r.url))
async def size(resp):
    try: b=await resp.body(); return len(b)
    except Exception: return 0
async def measure(page,st,url,sel,name,label,action=None):
    st["req"].clear(); st["con"].clear(); t0=time.time(); vis=None
    if url: await page.goto(url,wait_until="commit",timeout=60000)
    if action: await action()
    try: await page.wait_for_selector(sel,state="visible",timeout=20000); vis=round((time.time()-t0)*1000)
    except Exception: pass
    try: await page.wait_for_load_state("networkidle",timeout=30000)
    except Exception: pass
    idle=round((time.time()-t0)*1000); await page.wait_for_timeout(500)
    sw=await page.evaluate("[document.documentElement.scrollWidth,document.body.scrollWidth,innerWidth]")
    await page.screenshot(path=f"{OUT}/{name}_{label}.png")
    R[f"{name}_{label}"]={"visible":vis,"idle":idle,"requests":len(st["req"]),"sw":sw,"overflow":max(sw[:2])>sw[2]+1,"console":list(st["con"])}
async def run():
  async with async_playwright() as p:
    b=await p.chromium.launch()
    for w in (1440,390):
      L=str(w); vp={"width":w,"height":900 if w>400 else 844}
      mob=dict(is_mobile=True,has_touch=True) if w==390 else {}
      # cold ERP login with bytes
      ctx=await b.new_context(viewport=vp,**mob); page=await ctx.new_page(); st={"con":[],"req":[]}; attach(page,st)
      js=[]
      async def onresp(r):
        if r.request.resource_type=="script": js.append((r.url,await size(r),r.headers.get("content-encoding"),r.headers.get("content-length")))
      page.on("response",lambda r: asyncio.ensure_future(onresp(r)))
      await measure(page,st,B+"/erp/login","input[type=email]","erp_login",L)
      await page.wait_for_timeout(1500); R[f"erp_login_js_{L}"]=js[:]
      await page.fill('input[type="email"]',"admin@kkt.in"); await page.fill('input[type="password"]',"Kkt@12345")
      await page.click('button[type="submit"]'); await page.wait_for_url("**/erp/dashboard",timeout=30000)
      for n,u,s in ERP:
        await measure(page,st,B+u,s,n,L)
        if n=="erp_dashboard":
          R[f"ageing_{L}"]=await page.evaluate("(()=>{const e=document.querySelector('[data-testid=w-ageing]');return e?e.innerText.slice(0,400):null})()")
        if n=="erp_towerA_inventory":
          R[f"towerhdr_{L}"]=await page.evaluate("document.body.innerText.includes('{block}')||document.body.innerText.includes('{floor}')")
        if n=="erp_booking_BK0001_ledger":
          try:
            await page.locator("[data-testid=booking-tab-ledger]").click(timeout=8000); await page.wait_for_timeout(1200)
            sw=await page.evaluate("[document.documentElement.scrollWidth,innerWidth]"); R[f"ledger_tab_sw_{L}"]=sw
            await page.screenshot(path=f"{OUT}/erp_booking_BK0001_ledger_{L}.png")
          except Exception as e: R[f"ledger_tab_{L}"]=str(e)[:100]
      # wizard
      async def wiz():
        try: await page.locator('[data-testid="wiz-discard"]').click(timeout=2500)
        except Exception: pass
      await measure(page,st,B+"/erp/bookings/new","[data-testid=wiz-project]","erp_wizard_step1",L,wiz)
      wz={}
      try:
        await page.locator('[data-testid="wiz-project"]').click(timeout=8000); await page.locator('[data-testid^="wiz-project-option-"]').first.click(timeout=8000)
        await page.locator('[data-testid="wiz-block"]').click(timeout=8000); await page.locator('[data-testid^="wiz-block-option-"]').first.click(timeout=8000)
        await page.locator('[data-testid="wiz-next"]').click(timeout=8000); await page.wait_for_selector('[data-testid="wiz-grid"]',timeout=15000); wz["step2"]=True
        await page.wait_for_timeout(800); wz["sw2"]=await page.evaluate("[document.documentElement.scrollWidth,innerWidth]")
        await page.screenshot(path=f"{OUT}/erp_wizard_step2_{L}.png")
        btn=page.locator('[data-testid^="wiz-flat-"]:not([disabled]):not([data-testid=wiz-flat-search])').first
        wz["flat"]=await btn.get_attribute("data-testid"); await btn.scroll_into_view_if_needed(); await btn.click(timeout=8000)
        nx=page.locator('[data-testid="wiz-next"]'); await nx.scroll_into_view_if_needed(); await nx.click(timeout=8000)
        await page.wait_for_selector('[data-testid="wiz-customer-search"]',timeout=10000); wz["step3"]=True
        await page.wait_for_timeout(600); wz["sw3"]=await page.evaluate("[document.documentElement.scrollWidth,innerWidth]")
        await page.screenshot(path=f"{OUT}/erp_wizard_step3_{L}.png")
      except Exception as e: wz["err"]=str(e)[:200]; await page.screenshot(path=f"{OUT}/erp_wizard_fail_{L}.png")
      R[f"wizard_{L}"]=wz; R[f"wizard_console_{L}"]=list(st["con"])
      # leave wizard without submitting
      await ctx.close()
      # marketing
      for warm in (False,True):
        ctx=await b.new_context(viewport=vp,**mob)
        for n,u in MKT:
          page=await ctx.new_page(); st={"con":[],"req":[]}; attach(page,st); tot=[0]
          async def onr(r):
            tot[0]+=await size(r)
          page.on("response",lambda r: asyncio.ensure_future(onr(r)))
          await measure(page,st,B+u,"h1",n+("_warm" if warm else ""),L)
          if n=="mkt_home" and not warm:
            await page.evaluate("window.scrollTo(0,document.body.scrollHeight)"); await page.wait_for_timeout(2500)
            R[f"home_weight_{L}"]=tot[0]; R[f"home_reqs_full_{L}"]=len(st["req"])
            R[f"home_yt_{L}"]=[x for x in st["req"] if re.search(r"base\.js|www-embed-player|youtube",x)]
            R[f"home_dom_{L}"]=await page.evaluate("""(()=>{const fr=[...document.querySelectorAll('iframe')].map(f=>f.src);
              const vid=[...document.querySelectorAll('[data-testid*=video],[class*=video]')].slice(0,3).map(e=>({tid:e.dataset.testid,img:!!e.querySelector('img'),bg:getComputedStyle(e).backgroundImage.slice(0,80)}));
              const fixed=[...document.querySelectorAll('body *')].filter(e=>{const s=getComputedStyle(e);return s.position==='fixed'&&e.getBoundingClientRect().bottom>=innerHeight-2&&e.offsetHeight<200}).map(e=>{const r=e.getBoundingClientRect();return {tid:e.dataset.testid,l:r.left,r:r.right,w:e.scrollWidth,cw:e.clientWidth}});
              const q=[...document.querySelectorAll('section')].filter(s=>/why/i.test(s.innerText.slice(0,200))).map(s=>({qmarks:(s.innerText.match(/^\\?$/gm)||[]).length,svgs:s.querySelectorAll('svg').length}));
              return {iframes:fr,vid,fixed,why:q,text:document.body.innerText.slice(0,100)}})()""")
            R[f"home_console_full_{L}"]=list(st["con"])
          if n=="mkt_project_SGH" and not warm:
            await page.evaluate("window.scrollTo(0,document.body.scrollHeight)"); await page.wait_for_timeout(2500)
            R[f"sgh_gallery_{L}"]=await page.evaluate("""(()=>{const g=document.querySelector('[data-testid*=gallery]')||[...document.querySelectorAll('section')].find(s=>/gallery/i.test(s.innerText.slice(0,120)));
              if(!g)return 'no gallery found';const imgs=[...g.querySelectorAll('img')];return {tid:g.dataset.testid,imgs:imgs.length,broken:imgs.filter(i=>i.complete&&i.naturalWidth===0).map(i=>i.src.slice(-60)),notloaded:imgs.filter(i=>!i.complete).length}})()""")
            await page.screenshot(path=f"{OUT}/mkt_project_SGH_full_{L}.png",full_page=True)
          await page.close()
        await ctx.close()
      # portal
      ctx=await b.new_context(viewport=vp,**mob); page=await ctx.new_page(); st={"con":[],"req":[]}; attach(page,st)
      await measure(page,st,P+"/login","[data-testid=login-phone-input]","portal_login",L)
      await page.fill("[data-testid=login-phone-input]","9431012345"); await page.fill("[data-testid=login-password-input]","Buyer@12345")
      async def sub(): await page.click("[data-testid=login-submit-button]")
      await measure(page,st,None,"[data-testid=home-screen]","portal_home",L,sub)
      R[f"portal_shell_{L}"]=await page.evaluate("""(()=>{const v=e=>{const x=document.querySelector(`[data-testid=${e}]`);if(!x)return null;const r=x.getBoundingClientRect();return r.width>0&&r.height>0};
        const tb=document.querySelector('[data-testid=bottom-tab-bar]');const labels=tb?[...tb.querySelectorAll('div,span')].filter(e=>e.children.length===0&&e.innerText.trim()).map(e=>({t:e.innerText,clip:e.scrollWidth>e.clientWidth+1})):[];
        const clipped=[...document.querySelectorAll('[data-testid=home-screen] div')].filter(e=>e.children.length===0&&e.innerText&&e.scrollWidth>e.clientWidth+1&&getComputedStyle(e).overflow!=='visible').map(e=>e.innerText.slice(0,40)).slice(0,15);
        return {sidebar:v('sidebar-nav'),tabbar:v('bottom-tab-bar'),labels,clipped}})()""")
      for n,u,s in [("portal_payments_ledger","/payments?tab=ledger","[data-testid=payments-screen]"),("portal_construction","/construction","[data-testid=construction-screen]"),("portal_requests","/requests","[data-testid=requests-screen]")]:
        await measure(page,st,P+u,s,n,L)
        if n=="portal_payments_ledger":
          await page.wait_for_timeout(1000)
          R[f"ledger_last_{L}"]=await page.evaluate("""(()=>{const rows=[...document.querySelectorAll('[data-testid^=ledger-row-]')];if(!rows.length)return 'no rows';const last=rows[rows.length-1];last.scrollIntoView({block:'end'});
            const r=last.getBoundingClientRect();const tb=document.querySelector('[data-testid=bottom-tab-bar]');const tr=tb?tb.getBoundingClientRect():null;
            const el=document.elementFromPoint(r.left+10,r.top+r.height/2);return {rows:rows.length,bottom:r.bottom,vh:innerHeight,tabTop:tr&&tr.height?tr.top:null,hitInside:last.contains(el)}})()""")
          await page.screenshot(path=f"{OUT}/portal_payments_ledger_end_{L}.png")
      await ctx.close()
    await b.close()
  json.dump(R,open(f"{OUT}/results.json","w"),indent=1)
asyncio.run(run())
