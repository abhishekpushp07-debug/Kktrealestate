/** Step 9 — website CMS: site settings, banners, home sections, testimonials (seeded customers), gallery, posts, pages, people. */
import { placeholderPng, type SeedContext } from "./context.js";

export async function seedCms(ctx: SeedContext): Promise<void> {
  ctx.log("cms: site settings, 3 banners, 5 home sections, 6 testimonials, 18 gallery images, 4+1 posts, 3 pages, 3 people");
  const sgh = ctx.project("SGH");
  const ggv = ctx.project("GGV");
  const mk = "marketing" as const;
  const site = await ctx.get<{ version: number }>("/api/v1/cms/site", mk);
  const logo = await ctx.uploadMedia("SGB logo", { name: "sgb-logo.png", data: await placeholderPng("SGB", "Shree Ganesh Builders", 800, 800), type: "image/png" });
  await ctx.patch("/api/v1/cms/site", {
    version: site.version,
    brand: { name: "Shree Ganesh Builders", tagline: "Building homes, building trust – since 2013", logo_document_id: logo },
    contacts: { phone: "6122200000", whatsapp: "9876500000", email: "info@sgb.in" },
    offices: [
      { name: "Head office", address: "SGB House, Boring Road, Sri Krishna Puri, Patna 800001", phone: "6122200000", maps_link: "https://maps.google.com/?q=SGB+House+Boring+Road+Patna" },
      { name: "SGH site office", address: "Plot 14, Bailey Road, Raja Bazar, Patna 800014", phone: "9876500001", maps_link: "https://maps.google.com/?q=Shree+Ganesh+Heights+Bailey+Road+Patna" },
    ],
    social: { facebook: "https://www.facebook.com/shreeganeshbuilders", instagram: "https://www.instagram.com/sgb.patna", youtube: "https://www.youtube.com/@shreeganeshbuilders", linkedin: "https://www.linkedin.com/company/shree-ganesh-builders" },
    trust_stats: [{ label: "Years", value: "12" }, { label: "Projects", value: "9" }, { label: "Families", value: "1,400" }, { label: "Sq ft delivered", value: "2.1 M" }],
    value_props: [
      { title: "On-time delivery", body: "Every project since 2013 handed over on or before the RERA date.", icon: "clock" },
      { title: "Transparent pricing", body: "Rate cards and PLCs published; no hidden charges at possession.", icon: "badge-check" },
      { title: "Lifetime care", body: "Dedicated service desk for every buyer, from booking to beyond possession.", icon: "heart-handshake" },
    ],
    disclaimer: "All images are artistic impressions. Areas are approximate super built-up areas. Prices are subject to change without notice; please verify with the sales team. RERA: BRERAP00123-1/23 (SGH), BRERAP00087-2/22 (GGV).",
    seo_defaults: { title: "Shree Ganesh Builders – Homes in Patna", description: "RERA-registered apartments and villas in Patna by Shree Ganesh Builders." },
    analytics: { ga_id: "G-SGBDEMO01" }, site_live: true, portal_url: "https://my.sgb.in", erp_url: "https://erp.sgb.in",
    featured_project_ids: [sgh.id, ggv.id], walkthrough_video_url: "https://www.youtube.com/watch?v=sgb-walkthrough",
  }, mk);

  // banners
  for (const [i, [title, subtitle, cta, url, caption]] of [
    ["Festive offer on Tower C", "Book before Diwali and get club membership free", "Enquire now", "/contact", "Shree Ganesh Heights"],
    ["Premium villas – ready to move", "Block P of Ganesh Green Villas is handing over now", "Book a visit", `/projects/${ggv.slug}#visit`, "Ganesh Green Villas"],
    ["2 BHK from ₹55 L", "Vastu-compliant homes on Bailey Road with 70 % open area", "See homes", `/projects/${sgh.slug}`, "2 BHK from ₹55 L"],
  ].entries()) {
    const doc = await ctx.uploadMedia(title!, { name: `banner-${i + 1}.png`, data: await placeholderPng(caption!, subtitle!, 1920, 900), type: "image/png" });
    await ctx.post("/api/v1/cms/banners", { title, subtitle, cta_label: cta, cta_url: url, document_id: doc, sort_order: i + 1, is_active: true }, mk);
  }

  // home sections (keys the website reads: featured, walkthrough; plus value props, testimonials and latest posts)
  const sections = [
    ["featured", "Featured projects", { subtitle: "Homes on Bailey Road and villas in Danapur", limit: 2 }],
    ["walkthrough", "Take the walkthrough", { subtitle: "Three minutes inside Shree Ganesh Heights", video_url: "https://www.youtube.com/watch?v=sgb-walkthrough" }],
    ["value_props", "Why Shree Ganesh Builders", { items: ["On-time delivery", "Transparent pricing", "Lifetime care"] }],
    ["testimonials", "What our families say", { limit: 6 }],
    ["latest_posts", "From the blog", { limit: 3 }],
  ] as const;
  for (const [i, [key, title, body]] of sections.entries()) await ctx.post("/api/v1/cms/home-sections", { key, title, body, sort_order: i + 1, is_active: true }, mk);

  // testimonials tied to seeded customers
  const testimonials: [string, string, string, number][] = [
    ["9876543210", "GGV", "We moved into villa P1 exactly on the promised date. Every rupee we paid is visible in the portal ledger – that transparency is rare.", 5],
    ["9876543211", "SGH", "The construction-linked plan made the purchase easy on our finances, and the site team shares photos after every slab.", 5],
    ["9876543217", "GGV", "As an architect I am particular about finish quality; the P3 villa exceeded my expectations.", 5],
    ["9876543218", "GGV", "The bank loan disbursement was reconciled in the portal the same day. Professional accounts team.", 4],
    ["9876543213", "SGH", "Site visits were easy to book online and the executive was always on time.", 4],
    ["9876543214", "SGH", "They revised our agreement when the loan was sanctioned higher, without any hassle.", 5],
  ];
  for (const [i, [phone, project, quote, rating]] of testimonials.entries()) {
    const c = ctx.customer(phone);
    await ctx.post("/api/v1/cms/testimonials", { customer_id: c.id, name: c.name, project_id: ctx.project(project).id, quote, rating, is_published: true, sort_order: i + 1 }, mk);
  }

  // gallery: 9 images per project
  const galleryCaptions: [string, string][] = [["Exteriors", "Tower elevation"], ["Exteriors", "Entrance plaza"], ["Exteriors", "Aerial view"], ["Interiors", "Living room"], ["Interiors", "Master bedroom"], ["Interiors", "Modular kitchen"], ["Amenities", "Clubhouse"], ["Amenities", "Swimming pool"], ["Amenities", "Children's play area"]];
  let g = 0;
  for (const p of [sgh, ggv]) {
    for (const [category, caption] of galleryCaptions) {
      g += 1;
      const doc = await ctx.uploadMedia(`${p.name} – ${caption}`, { name: `gallery-${p.code.toLowerCase()}-${g}.png`, data: await placeholderPng(caption, `${p.name} · ${category}`), type: "image/png" });
      await ctx.post("/api/v1/cms/gallery", { project_id: p.id, document_id: doc, caption: `${p.name} – ${caption}`, category, sort_order: g, is_published: true }, mk);
    }
  }
  ctx.counts["gallery"] = g;

  // blog posts: 4 published + 1 draft
  const posts: [string, string, string, string, string[], boolean][] = [
    ["Why Bailey Road is Patna's next growth corridor", "why-bailey-road", "Connectivity, schools, hospitals and the new Marine Drive are pulling families to Bailey Road.", "# Why Bailey Road\n\nBailey Road connects the airport, AIIMS and Danapur in under twenty minutes. With the metro corridor and the Marine Drive extension, property prices have risen 18 % in two years.\n\n## What this means for buyers\n\nEarly buyers at **Shree Ganesh Heights** lock in today's rate card with construction-linked payments.", ["patna", "investment"], true],
    ["Understanding construction-linked payment plans", "construction-linked-payment-plans", "Pay as the building rises – how CLP keeps your money safe.", "# Construction-linked plans\n\nUnder a CLP you pay a small booking amount and the rest in tranches tied to physical milestones – excavation, slabs, brickwork, flooring and possession.\n\n- Your bank disburses the loan tranche by tranche.\n- Every demand carries the stage photo in your portal.\n- No construction, no payment.", ["finance", "guide"], true],
    ["Tower A reaches the third slab", "tower-a-third-slab", "Construction update from Shree Ganesh Heights.", "# Third slab cast\n\nTower A's third slab was cast this month, on schedule. Brickwork for the lower floors begins next week and the fourth slab is planned for 2 November.", ["construction-update", "sgh"], true],
    ["Vastu tips for your new home", "vastu-tips-new-home", "Simple Vastu principles our architects follow in every layout.", "# Vastu basics\n\nEast-facing entrances, kitchens in the south-east and bedrooms in the south-west – our 3BHK-A layout follows all three.", ["lifestyle"], true],
    ["Ganesh Green Villas: block Q handover plan", "ggv-block-q-handover", "Draft – timelines for the garden villas.", "# Block Q handover\n\n_Draft – to be reviewed by the project team before publishing._", ["ggv"], false],
  ];
  for (const [title, slug, excerpt, body, tags, published] of posts) {
    await ctx.post("/api/v1/cms/posts", { title, slug, excerpt, body_md: body, tags, status: published ? "PUBLISHED" : "DRAFT", seo: { title: title.slice(0, 70), description: excerpt } }, mk);
  }
  ctx.counts["posts_published"] = 4;
  ctx.counts["posts_draft"] = 1;

  // legal / static pages
  const pages: [string, string, string][] = [
    ["about", "About Shree Ganesh Builders", "# Our story\n\nFounded in Patna in 2013 by Suresh Agarwal, Shree Ganesh Builders has delivered nine projects and 1,400 homes across Bihar.\n\n## Timeline\n\n- **2013** – Ganesh Residency, Kankarbagh (120 flats)\n- **2017** – Ganesh Enclave, Patliputra\n- **2022** – Ganesh Green Villas, Danapur\n- **2024** – Shree Ganesh Heights, Bailey Road\n\n## Leadership\n\nAn owner-led team of engineers, architects and accountants who answer to every buyer."],
    ["privacy", "Privacy policy", "# Privacy policy\n\nWe collect your name, phone and email only to respond to your enquiry or site-visit request. KYC documents are encrypted at rest and shared only with the registering authority and your lender with your consent. You may ask for erasure of your personal data at any time by writing to info@sgb.in."],
    ["disclaimer", "Disclaimer", "# Disclaimer\n\nThe content of this website is for information only and does not constitute an offer or contract. Images are artistic impressions; areas, specifications and prices are indicative and subject to change. RERA registrations: BRERAP00123-1/23 (Shree Ganesh Heights), BRERAP00087-2/22 (Ganesh Green Villas)."],
  ];
  for (const [slug, title, body] of pages) await ctx.post("/api/v1/cms/pages", { slug, title, body_md: body, is_published: true, seo: { title, description: `${title} – Shree Ganesh Builders` } }, mk);

  // people
  const people: [string, string, string][] = [
    ["Suresh Agarwal", "Managing Director", "Founder of Shree Ganesh Builders; 25 years in Bihar real estate."],
    ["Rohit Kumar", "Head of Projects", "Civil engineer (NIT Patna) who has delivered every SGB tower on time."],
    ["Nisha Singh", "Head of Marketing", "Runs the website, campaigns and the buyer community."],
  ];
  for (const [i, [name, title, bio]] of people.entries()) {
    const photo = await ctx.uploadMedia(name, { name: `person-${i + 1}.png`, data: await placeholderPng(name, title, 800, 800), type: "image/png" });
    await ctx.post("/api/v1/cms/people", { name, title, bio, photo_document_id: photo, sort_order: i + 1, is_published: true }, mk);
  }
}
