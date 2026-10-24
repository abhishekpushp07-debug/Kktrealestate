"""Phase 3 seed: website CMS content. Idempotent."""
import logging
from datetime import date, timedelta

from db import db
from routers.cms import DEFAULT_SITE
from utils import base_doc

logger = logging.getLogger("kkt.seed3")
U = "https://images.unsplash.com/photo-{}?auto=format&fit=crop&w={}&q=80"
IMG = {
    "tower1": U.format("1545324418-cc1a3fa10c00", 1800), "tower2": U.format("1460317442991-0ec209397118", 1800), "tower3": U.format("1486406146926-c627a92ad1ab", 1800),
    "villa1": U.format("1613490493576-7fde63acd811", 1800), "villa2": U.format("1600596542815-ffad4c1539a9", 1800), "villa3": U.format("1512917774080-9991f1c4c750", 1800),
    "int1": U.format("1600585154340-be6161a56a0c", 1400), "int2": U.format("1600607687939-ce8a6c25118c", 1400), "int3": U.format("1600566753086-00f18fb6b3ea", 1400), "int4": U.format("1600210492486-724fe5c67fb0", 1400), "int5": U.format("1600573472592-401b489a3cdc", 1400),
    "pool": U.format("1574362848149-11496d93a7c7", 1400), "gym": U.format("1571902943202-507ec2618e8f", 1400), "garden": U.format("1560518883-ce09059eeffa", 1400),
    "cons1": U.format("1503387762-592deb58ef4e", 1400), "cons2": U.format("1541888946425-d81bb19240f5", 1400), "event": U.format("1511795409834-ef04bbd61622", 1400), "lobby": U.format("1600047509807-ba8f99d2cdde", 1400),
    "man1": U.format("1507003211169-0a1dd7228f2d", 600), "woman1": U.format("1494790108377-be9c29b29330", 600), "man2": U.format("1472099645785-5658abf4ff4e", 600),
    "blog1": U.format("1560520653-9e0e4c89eb11", 1400), "blog2": U.format("1582407947304-fd86f028f716", 1400), "blog3": U.format("1448630360428-65456885c650", 1400), "blog4": U.format("1523217582562-09d0def993a6", 1400),
}
YT = ["https://www.youtube.com/embed/ScMzIvxBSi4", "https://www.youtube.com/embed/aqz-KE-bpKQ"]
TOUR = "https://www.youtube.com/embed/1La4QzGeaaQ"


async def seed_phase3():
    if await db.settings.find_one({"key": "seed_phase3_done"}):
        return
    company = await db.companies.find_one({}, {"_id": 0})
    if not company:
        return
    cid = company["id"]
    logger.info("Applying Phase 3 seed...")
    sgh = await db.projects.find_one({"code": "SGH"}, {"_id": 0})
    ggv = await db.projects.find_one({"code": "GGV"}, {"_id": 0})
    site = {**DEFAULT_SITE, "brand_name": "Shree Ganesh Builders", "tagline": "Crafting landmark homes in Patna since 1998", "phone": "+916122234567", "whatsapp": "+919430012345", "email": "sales@shreeganeshbuilders.in",
            "offices": [{"name": "Corporate Office", "address": "3rd Floor, Ganesh Tower, Boring Road, Patna 800001", "map_embed_url": "https://www.google.com/maps?q=Boring+Road+Patna&output=embed"}, {"name": "SGH Site Office", "address": "Bailey Road, Near Saguna More, Patna 801503", "map_embed_url": "https://www.google.com/maps?q=Saguna+More+Patna&output=embed"}],
            "social": {"facebook": "https://facebook.com/shreeganeshbuilders", "instagram": "https://instagram.com/shreeganeshbuilders", "youtube": "https://youtube.com/@shreeganeshbuilders", "linkedin": "https://linkedin.com/company/shreeganeshbuilders"},
            "trust_stats": [{"label": "Years of trust", "value": "27+"}, {"label": "Projects delivered", "value": "14"}, {"label": "Happy families", "value": "2,400+"}, {"label": "Sq. ft. delivered", "value": "3.2 Mn"}],
            "footer_text": "Shree Ganesh Builders Pvt. Ltd. is a RERA-registered real estate developer headquartered in Patna, Bihar.",
            "rera_disclaimer": "All projects are registered under the Bihar Real Estate Regulatory Authority (BRERA). Images, plans and specifications are indicative and subject to change as per approvals. Prices shown are indicative starting prices exclusive of taxes, registration and other charges. This website is for information only and does not constitute an offer or contract.",
            "seo_title": "Shree Ganesh Builders — Premium Apartments & Villas in Patna", "seo_description": "RERA-registered builder in Patna. Explore Shree Ganesh Heights (2 & 3 BHK) and Ganesh Green Villas (4 BHK duplex villas). Enquire for site visits.",
            "og_image_url": IMG["tower1"], "round_robin_assignment": True, "site_live": True,
            "home": {"value_props": [{"title": "RERA-registered, always", "text": "Every project is registered with BRERA and built to approved plans — no surprises.", "icon": "ShieldCheck"}, {"title": "On-time, every time", "text": "14 projects delivered with an average of 45 days ahead of the promised possession date.", "icon": "Clock"}, {"title": "Transparent pricing", "text": "Construction-linked payment plans with a live ledger you can see at any time.", "icon": "Receipt"}, {"title": "Thoughtful design", "text": "Vastu-aligned layouts, cross ventilation and 70% open space in every project.", "icon": "Compass"}],
                     "featured_project_ids": [sgh["id"], ggv["id"]], "walkthrough_video_url": YT[0], "sections": {"testimonials": True, "blog": True, "video": True, "trust": True}}}
    if not await db.site_settings.find_one({"company_id": cid}):
        await db.site_settings.insert_one({**base_doc(None, cid), **site})
    else:
        await db.site_settings.update_one({"company_id": cid}, {"$set": site})

    def doc(extra):
        return {**base_doc(None, cid), "is_active": True, **extra}

    if await db.cms_banners.count_documents({}) == 0:
        await db.cms_banners.insert_many([
            doc({"order": 1, "image_url": IMG["tower1"], "headline": "Homes that rise with Patna", "subheadline": "Shree Ganesh Heights — 2 & 3 BHK residences on Bailey Road with 32 amenities and a 60% completed Tower A.", "cta_label": "Explore Shree Ganesh Heights", "cta_link": "/projects/shree-ganesh-heights", "cta2_label": "Book a site visit", "cta2_link": "/contact", "from_date": None, "to_date": None}),
            doc({"order": 2, "image_url": IMG["villa1"], "headline": "Your own garden, your own sky", "subheadline": "Ganesh Green Villas — gated community of 4 BHK duplex villas with private gardens.", "cta_label": "Discover the villas", "cta_link": "/projects/ganesh-green-villas", "cta2_label": "Enquire now", "cta2_link": "/contact", "from_date": None, "to_date": None}),
            doc({"order": 3, "image_url": IMG["int1"], "headline": "27 years. 2,400 families. One promise.", "subheadline": "RERA-registered, construction-linked and delivered on time — the Shree Ganesh way.", "cta_label": "Our story", "cta_link": "/about", "cta2_label": "Read the blog", "cta2_link": "/blog", "from_date": None, "to_date": None}),
        ])
    if await db.cms_testimonials.count_documents({}) == 0:
        custs = await db.customers.find({}, {"_id": 0, "full_name": 1, "salutation": 1}).limit(6).to_list(6)
        quotes = ["The ledger is so transparent — I could see every demand and receipt online. Booking was effortless.", "Site visits were honest about timelines. Tower A is ahead of schedule and the finish quality is excellent.",
                  "We chose the villas for the gardens. The sample villa matched the brochure down to the tiles.", "Documentation and RERA paperwork were handled end-to-end. Zero running around.",
                  "The 3 BHK layout has wonderful cross-ventilation. Our parents love the park-facing balcony.", "Our second home with Shree Ganesh — that says it all."]
        items = []
        for i, c in enumerate(custs):
            p = sgh if i % 3 else ggv
            items.append(doc({"order": i + 1, "name": f"{c.get('salutation') or ''} {c['full_name']}".strip(), "designation": f"{'4 BHK Villa' if p is ggv else '3 BHK' if i % 2 else '2 BHK'}, {p['name']}", "photo_url": IMG["man1" if i % 2 == 0 else "woman1"], "quote": quotes[i], "rating": 5 if i % 3 else 4, "project_id": p["id"], "project_name": p["name"]}))
        await db.cms_testimonials.insert_many(items)
    if await db.cms_gallery.count_documents({}) == 0:
        g = [(sgh, "Exterior", "tower1", "Tower A & B elevation at dusk"), (sgh, "Exterior", "tower2", "Entrance plaza and drop-off"), (sgh, "Exterior", "tower3", "View from Bailey Road"), (sgh, "Interior", "int1", "3 BHK living room — sample flat"), (sgh, "Interior", "int2", "Master bedroom with park view"),
             (sgh, "Interior", "int3", "Modular kitchen — 2 BHK"), (sgh, "Amenities", "pool", "Infinity-edge swimming pool"), (sgh, "Amenities", "gym", "Fully equipped gymnasium"), (sgh, "Amenities", "lobby", "Double-height entrance lobby"), (sgh, "Construction", "cons1", "Tower A — 7th floor slab"), (sgh, "Construction", "cons2", "Tower C — foundation work"), (sgh, "Events", "event", "Bhoomi pujan ceremony"),
             (ggv, "Exterior", "villa1", "Villa V2 — front elevation"), (ggv, "Exterior", "villa2", "Tree-lined villa avenue"), (ggv, "Exterior", "villa3", "Premium Block P villa"), (ggv, "Interior", "int4", "Villa living room"), (ggv, "Interior", "int5", "Villa dining & kitchen"), (ggv, "Amenities", "garden", "Central landscaped garden")]
        await db.cms_gallery.insert_many([doc({"order": i + 1, "project_id": p["id"], "category": cat, "image_url": IMG[k], "caption": cap}) for i, (p, cat, k, cap) in enumerate(g)])
    if await db.cms_people.count_documents({}) == 0:
        await db.cms_people.insert_many([doc({"order": 1, "name": "Rajesh Kumar", "designation": "Founder & Managing Director", "photo_url": IMG["man1"], "bio": "Civil engineer from NIT Patna, Rajesh founded Shree Ganesh Builders in 1998 and has personally overseen every project since."}),
                                         doc({"order": 2, "name": "Anita Kumar", "designation": "Director — Design & Customer Experience", "photo_url": IMG["woman1"], "bio": "Architect (SPA Delhi). Anita leads design, sample flats and the customer journey from enquiry to handover."}),
                                         doc({"order": 3, "name": "Sanjay Prasad", "designation": "Chief Financial Officer", "photo_url": IMG["man2"], "bio": "Chartered accountant with 20 years in real estate finance; architect of our transparent construction-linked ledger."})])
    if await db.cms_pages.count_documents({}) == 0:
        await db.cms_pages.insert_many([
            doc({"slug": "about", "title": "About Shree Ganesh Builders", "body": "## Our story\n\nFounded in 1998 by Rajesh Kumar, Shree Ganesh Builders began with a single six-flat building in Kankarbagh. Twenty-seven years and fourteen projects later, we remain a family-run company with one promise: **homes delivered on time, exactly as shown**.\n\n## Vision\n\nTo be Bihar's most trusted developer — measured not by square feet sold but by families who recommend us.\n\n## Mission\n\n- Build RERA-compliant, Vastu-aligned homes with 70% open space\n- Keep every rupee transparent with construction-linked payment plans\n- Hand over ahead of schedule, with a 5-year structural warranty\n\n## Certifications\n\n- BRERA registered developer\n- ISO 9001:2015 certified processes\n- CREDAI Bihar member since 2006\n- IGBC pre-certified Gold (Shree Ganesh Heights)",
                 "sections": {"milestones": [{"year": "1998", "text": "Company founded; first project Ganesh Niwas (6 flats)"}, {"year": "2006", "text": "Joined CREDAI Bihar; 5 projects delivered"}, {"year": "2014", "text": "Ganesh Residency — first 100-unit project, delivered 2 months early"}, {"year": "2019", "text": "Crossed 2,000 happy families"}, {"year": "2025", "text": "Launched Shree Ganesh Heights (Bailey Road)"}, {"year": "2026", "text": "Launched Ganesh Green Villas"}]}}),
            doc({"slug": "privacy", "title": "Privacy Policy", "body": "## Privacy Policy\n\nWe collect only the information you submit through enquiry forms (name, phone, email, message) to respond to your enquiry. We do not sell or share your data with third parties except as required by law. You may request deletion of your data by writing to privacy@shreeganeshbuilders.in.\n\nThis website uses cookies only for analytics and session continuity. By using the website you consent to this policy.", "sections": {}}),
            doc({"slug": "disclaimer", "title": "Disclaimer", "body": "## Disclaimer\n\n" + site["rera_disclaimer"] + "\n\nProject RERA numbers: Shree Ganesh Heights — BRERAP00123; Ganesh Green Villas — BRERAP00188. Visit rera.bihar.gov.in for details.", "sections": {}}),
        ])
    if await db.cms_posts.count_documents({}) == 0:
        today = date.today()
        posts = [
            ("Tower A reaches 60%: what construction-linked payments mean for you", "sgh-tower-a-60-percent", "blog1", ["Shree Ganesh Heights", "Construction update"],
             "Tower A at Shree Ganesh Heights has crossed the **60% construction milestone** — brickwork is complete up to the 8th floor and plastering begins next month.\n\n## Why milestones matter\n\nEvery booking at Shree Ganesh Heights is on a construction-linked plan (CLP). Instead of paying large sums upfront, home-buyers pay as the building grows: 10% on booking, 15% at plinth, 25% at the first slab and so on until possession. When a milestone is certified by our engineers, a demand letter is issued and the amount becomes due within 15 days.\n\n## What happened this quarter\n\n- Brickwork completed on floors 1–8\n- Lift shafts and fire staircases cast up to the terrace\n- Sample 3 BHK flat opened for visits on the 3rd floor\n\n## What's next\n\nInternal plastering and electrical conduiting start in November, taking Tower A to the 75% milestone by early next year. Tower B follows roughly a quarter behind.\n\nBuyers can view their complete payment ledger — demands, receipts and dues per bucket — at any time by asking their relationship manager. Transparency is not a feature; it is how we work.\n\nTo visit the site, book a slot through the enquiry form or call our Bailey Road site office."),
            ("Buying a home in Patna in 2026: a RERA checklist", "rera-checklist-patna-2026", "blog2", ["RERA", "Buying guide"],
             "Bihar's Real Estate Regulatory Authority (BRERA) has changed how homes are sold in Patna. Here is the checklist we recommend to every family before they book — with any builder.\n\n## 1. Verify the RERA number\n\nEvery project must display its registration number. Search it on rera.bihar.gov.in and compare the approved plan, the promised possession date and the list of promoters.\n\n## 2. Read the agreement for sale\n\nRERA mandates a model agreement. Look for the carpet area (not super built-up), the payment schedule and the penalty clause for delays — it applies to both sides.\n\n## 3. Check the escrow account\n\n70% of your money must go into a project-specific escrow account used only for construction. Ask for the bank and account details; they should also appear on your demand letters.\n\n## 4. Understand the two buckets\n\nMost agreements split the price into an *account* component (bank transfer, loan disbursement) and other agreed components. Make sure the split is written down and that receipts are issued for every payment, with the running due shown.\n\n## 5. Visit the site, not just the sample flat\n\nWalk the actual tower. Look at the quality of brickwork, the lift provisions and the water-proofing on terraces.\n\nAt Shree Ganesh Builders we welcome this scrutiny — it is the reason our buyers come back for a second home."),
            ("Why Bailey Road is Patna's next residential hub", "bailey-road-residential-hub", "blog3", ["Patna", "Location"],
             "Ten years ago Bailey Road west of Saguna More was farmland. Today it hosts the AIIMS campus, the Patna Metro's Line 1 alignment, three international schools and some of the city's most sought-after residential addresses.\n\n## Connectivity\n\n- 12 minutes to Patna Junction via the elevated corridor\n- 20 minutes to Jay Prakash Narayan Airport\n- Metro station (Saguna More) planned 600 m from Shree Ganesh Heights\n\n## Social infrastructure\n\nAIIMS Patna, DAV Public School, Big Bazaar and the new Patliputra Sports Complex are all within 3 km. The upcoming JP Ganga Path extension will link the area to the riverfront.\n\n## Appreciation\n\nLand prices along Bailey Road have appreciated roughly 11% a year over the past five years — the highest among Patna's residential corridors — while remaining 30–40% below Boring Road and Fraser Road.\n\n## What this means for buyers\n\nA 2 BHK bought today at Shree Ganesh Heights is both a home close to the city's new institutional heart and a sound long-term asset. Our site office is open every day from 10 am to 7 pm."),
            ("Villa living in Patna: inside Ganesh Green Villas", "inside-ganesh-green-villas", "blog4", ["Ganesh Green Villas", "Design"],
             "Ganesh Green Villas is our first gated villa community — 18 independent 4 BHK duplex villas on a 3.5-acre plot off the Danapur–Khagaul road, with a central landscaped garden and a clubhouse.\n\n## Designed for families\n\nEach villa has a private front garden, a double-height living room, four bedrooms (two with balconies), a study and a terrace. Rooms are Vastu-aligned and every villa gets natural light from three sides.\n\n## Premium Block P\n\nSix premium villas on the garden edge come with larger plots, a home-lift provision and a covered car porch for two cars. Block P is complete and ready for possession.\n\n## Community\n\nA 24×7 gated entry, a clubhouse with gym and indoor games, a children's play lawn and a walking trail that loops the whole community.\n\n## Pricing\n\nVilla prices are shared on request because every villa differs in plot size and facing. Fill the enquiry form and our team will share the price sheet and arrange a visit."),
        ]
        await db.cms_posts.insert_many([doc({"title": t, "slug": s, "cover_url": IMG[c], "excerpt": body.split("\n\n")[0].replace("**", "")[:220], "body": body, "tags": tags, "author": "Shree Ganesh Builders", "status": "Published", "publish_at": (today - timedelta(days=7 * (i + 1))).isoformat() + "T09:00:00+00:00", "seo_title": t, "seo_description": body.split("\n\n")[0].replace("**", "")[:155]}) for i, (t, s, c, tags, body) in enumerate(posts)])
        await db.cms_posts.insert_one(doc({"title": "Draft: Diwali offers 2026", "slug": "draft-diwali-offers-2026", "cover_url": IMG["event"], "excerpt": "Internal draft — not published.", "body": "Coming soon.", "tags": ["Offers"], "author": "Marketing", "status": "Draft", "publish_at": None}))

    faqs_sgh = [{"question": "What is the payment plan?", "answer": "Construction-linked: 10% on booking and the balance in stages up to possession; demand letters are issued within 15 days of each certified milestone."}, {"question": "Is the project RERA registered?", "answer": "Yes — BRERAP00123. Approved plans and the possession date are on the BRERA portal."}, {"question": "Which banks have approved the project?", "answer": "SBI, HDFC, LIC HFL and Bank of Baroda offer home loans for Shree Ganesh Heights."}, {"question": "When is possession?", "answer": "Tower A: December 2027; Towers B & C: December 2028 (as per RERA)."}]
    faqs_ggv = [{"question": "Are the villas freehold?", "answer": "Yes, each villa is sold with a freehold plot and registered sale deed."}, {"question": "Why are prices on request?", "answer": "Villas differ in plot size, facing and block; we share a plot-wise price sheet after understanding your needs."}, {"question": "Is Block P ready to move in?", "answer": "Yes. Block P is complete; the remaining villas are at the plaster stage."}]
    await db.projects.update_one({"id": sgh["id"]}, {"$set": {"website": {"is_published": True, "slug": "shree-ganesh-heights", "show_prices": True, "show_availability": True, "show_construction_progress": True, "starting_price_override": None, "hero_images": [IMG["tower1"], IMG["tower2"], IMG["int1"], IMG["pool"]],
        "highlights": ["Three towers, 2 & 3 BHK, 70% open space", "600 m from the proposed Saguna More metro station", "Infinity pool, gym, clubhouse and 32 amenities", "IGBC Gold pre-certified; rain-water harvesting", "Tower A 60% complete — ahead of RERA schedule"], "video_urls": YT, "virtual_tour_urls": [TOUR], "map_embed_url": "https://www.google.com/maps?q=Saguna+More+Bailey+Road+Patna&output=embed", "brochure_document_id": None, "faqs": faqs_sgh,
        "seo_title": "Shree Ganesh Heights — 2 & 3 BHK flats on Bailey Road, Patna", "seo_description": "RERA-registered 2 & 3 BHK apartments near Saguna More, Patna. Live availability, floor plans, amenities and construction progress.", "public_description": sgh.get("description")}}})
    await db.projects.update_one({"id": ggv["id"]}, {"$set": {"website": {"is_published": True, "slug": "ganesh-green-villas", "show_prices": False, "show_availability": True, "show_construction_progress": False, "starting_price_override": None, "hero_images": [IMG["villa1"], IMG["villa2"], IMG["int4"], IMG["garden"]],
        "highlights": ["18 independent 4 BHK duplex villas on 3.5 acres", "Private gardens, double-height living rooms", "Premium Block P ready for possession", "Clubhouse, gym, walking trail, 24×7 gated security"], "video_urls": [YT[1]], "virtual_tour_urls": [TOUR], "map_embed_url": "https://www.google.com/maps?q=Danapur+Khagaul+Road+Patna&output=embed", "brochure_document_id": None, "faqs": faqs_ggv,
        "seo_title": "Ganesh Green Villas — 4 BHK duplex villas in Patna", "seo_description": "Gated community of 4 BHK duplex villas with private gardens near Danapur, Patna. Price on request.", "public_description": ggv.get("description")}}})
    await db.settings.update_one({"key": "seed_phase3_done"}, {"$set": {"value": True}}, upsert=True)
    logger.info("Phase 3 seed complete")


async def seed_marketing_user():
    company = await db.companies.find_one({}, {"_id": 0, "id": 1})
    if not company:
        return
    cid = company["id"]
    if not await db.users.find_one({"email": "marketing@kkt.in"}):
        from routers.auth import hash_password
        role = await db.roles.find_one({"name": "Marketing"}, {"_id": 0, "id": 1})
        if role:
            await db.users.insert_one({**base_doc(None, cid), "name": "Priya Marketing", "email": "marketing@kkt.in", "phone": None, "role_id": role["id"], "project_scope": [], "password_hash": hash_password("Kkt@12345"), "failed_attempts": 0, "locked_until": None, "must_change_password": False})
