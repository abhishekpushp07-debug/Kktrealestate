/** Step 2 — projects, rate cards (+PLCs, activated before generation so flats are priced by the engine), blocks, parking, website + visit settings, publish. */
import { LAKH, placeholderPdf, placeholderPng, type SeedContext, type SeedFlat } from "./context.js";
import { FLAT_TYPES } from "./masters.js";

export const SGH_SLUG = "shree-ganesh-heights";
export const GGV_SLUG = "ganesh-green-villas";

/** Second Sunday of next month (SGH blackout date). */
export function secondSundayOfNextMonth(today: string): string {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const first = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1));
  const offset = (7 - first.getUTCDay()) % 7; // days to the first Sunday
  const d = new Date(first.getTime() + (offset + 7) * 86_400_000);
  return d.toISOString().slice(0, 10);
}

async function loadFlats(ctx: SeedContext, blockId: string): Promise<Map<string, SeedFlat>> {
  const r = await ctx.get<{ items: SeedFlat[] }>(`/api/v1/flats?block_id=${blockId}&page_size=200&sort=flat_number`);
  return new Map(r.items.map((f) => [f.flat_number, f]));
}

async function createBlock(ctx: SeedContext, project: string, body: Record<string, unknown>): Promise<void> {
  const b = await ctx.post<{ id: string; code: string; name: string }>("/api/v1/blocks", body);
  ctx.project(project).blocks[b.code] = { id: b.id, code: b.code, name: b.name, flats: await loadFlats(ctx, b.id) };
}

export async function seedProjects(ctx: SeedContext): Promise<void> {
  ctx.log("projects: SGH (towers A/B/C) and GGV (villa blocks P/Q), rate cards, parking, website and visit settings");
  const amenity = (names: readonly string[]) => names.map((n) => ctx.ids[`amenity:${n}`]!);
  const allAmenities = Object.keys(ctx.ids)
    .filter((k) => k.startsWith("amenity:"))
    .map((k) => ctx.ids[k]!);
  const sales = ctx.staffUser("sales@sgb.in");
  const projectsAdmin = ctx.staffUser("projects@sgb.in");

  const sgh = await ctx.post<{ id: string; name: string }>("/api/v1/projects", {
    name: "Shree Ganesh Heights",
    code: "SGH",
    project_type: "RESIDENTIAL",
    status: "UNDER_CONSTRUCTION",
    description:
      "Three elegant towers of 2 and 3 BHK homes on Bailey Road – Patna's most connected address, minutes from the airport, AIIMS and the new Marine Drive.",
    address: {
      line1: "Plot 14, Bailey Road",
      locality: "Raja Bazar",
      city: "Patna",
      state: "Bihar",
      pincode: "800014",
    },
    rera_number: "BRERAP00123-1/23",
    launch_date: ctx.D(420),
    possession_date: ctx.future(730),
    land_area_sqft: 261_360,
    latitude: 25.6093,
    longitude: 85.0786,
    landmarks: [
      { name: "Patna Airport", distance_km: 4.2 },
      { name: "AIIMS Patna", distance_km: 6.5 },
      { name: "Patna Junction", distance_km: 7.1 },
      { name: "DAV Public School", distance_km: 1.4 },
      { name: "Jagat Mall", distance_km: 2.3 },
    ],
    approvals: [
      { name: "RERA", number: "BRERAP00123-1/23", status: "RECEIVED" },
      { name: "Building plan (PMC)", number: "PMC/BP/2024/1187", status: "RECEIVED" },
      { name: "Fire NOC", number: "FS/PAT/2024/0412", status: "RECEIVED" },
      { name: "Environment clearance", number: "SEIAA/BR/2024/093", status: "APPLIED" },
    ],
    escrow_bank_account_id: ctx.ids["bank:HDFC"],
    amenity_ids: allAmenities,
    team: [
      { user_id: sales.id, role_label: "Sales lead" },
      { user_id: projectsAdmin.id, role_label: "Project admin" },
    ],
  });
  ctx.projects["SGH"] = {
    id: sgh.id,
    code: "SGH",
    slug: SGH_SLUG,
    name: sgh.name,
    blocks: {},
    parking: new Map(),
    brochureDocId: null,
  };

  const ggv = await ctx.post<{ id: string; name: string }>("/api/v1/projects", {
    name: "Ganesh Green Villas",
    code: "GGV",
    project_type: "RESIDENTIAL",
    status: "READY",
    description:
      "Fourteen independent 4 BHK villas around a private park in Danapur – premium block P is ready for possession, garden block Q is in finishing.",
    address: {
      line1: "Khagaul Road",
      locality: "Danapur Cantonment",
      city: "Patna",
      state: "Bihar",
      pincode: "801503",
    },
    rera_number: "BRERAP00087-2/22",
    launch_date: ctx.D(900),
    possession_date: ctx.future(90),
    land_area_sqft: 174_240,
    latitude: 25.5891,
    longitude: 85.0462,
    landmarks: [
      { name: "Danapur Station", distance_km: 2.8 },
      { name: "Patna Airport", distance_km: 7.5 },
      { name: "Saguna More", distance_km: 3.1 },
    ],
    approvals: [
      { name: "RERA", number: "BRERAP00087-2/22", status: "RECEIVED" },
      { name: "Layout approval", number: "DNP/LA/2022/221", status: "RECEIVED" },
    ],
    escrow_bank_account_id: ctx.ids["bank:SBI"],
    amenity_ids: amenity([
      "Clubhouse",
      "Landscaped Gardens",
      "24×7 Security",
      "Power Backup",
      "Rainwater Harvesting",
      "Jogging Track",
      "Temple",
    ]),
    team: [{ user_id: sales.id, role_label: "Sales lead" }],
  });
  ctx.projects["GGV"] = {
    id: ggv.id,
    code: "GGV",
    slug: GGV_SLUG,
    name: ggv.name,
    blocks: {},
    parking: new Map(),
    brochureDocId: null,
  };

  // Project Admin is scoped to SGH only (docs/SEED.md logins)
  await ctx.call("PUT", `/api/v1/users/${projectsAdmin.id}/scope`, {
    token: ctx.token("admin"),
    body: { version: projectsAdmin.version, all_projects: false, project_ids: [sgh.id] },
  });

  // rate cards: created and ACTIVATED before the blocks exist so every generated flat is priced by the pricing engine (SPEC §4 step 5)
  const ft = (k: keyof typeof FLAT_TYPES) => ctx.ids[`flatType:${k}`]!;
  const sghCard = await ctx.post<{ id: string; version: number }>("/api/v1/rate-cards", {
    project_id: sgh.id,
    name: "SGH-2025",
    effective_from: ctx.fy.start,
    rates: (["A2", "B2", "A3", "B3"] as const).map((k) => ({
      flat_type_id: ft(k),
      rate_per_sqft_paise: FLAT_TYPES[k].rate,
    })),
    plc_rules: [
      {
        plc_type_id: ctx.ids["plc:FLOOR_RISE"],
        calc_mode: "FLOOR_RISE",
        value: 2_500,
        applies_to: "ALL",
        sort_order: 1,
      },
      { plc_type_id: ctx.ids["plc:CORNER"], calc_mode: "PER_SQFT", value: 10_000, applies_to: "CORNER", sort_order: 2 },
      {
        plc_type_id: ctx.ids["plc:TOP_FLOOR"],
        calc_mode: "FIXED",
        value: 150_000_00,
        applies_to: "FLOORS_GTE",
        floors_gte: 15,
        sort_order: 3,
      },
    ],
  });
  await ctx.post(`/api/v1/rate-cards/${sghCard.id}/activate`, { version: sghCard.version });
  ctx.ids["rateCard:SGH"] = sghCard.id;
  const ggvCard = await ctx.post<{ id: string; version: number }>("/api/v1/rate-cards", {
    project_id: ggv.id,
    name: "GGV-2025",
    effective_from: ctx.fy.start,
    rates: [{ flat_type_id: ft("VILLA"), lump_sum_paise: 100 * LAKH }],
    plc_rules: [
      {
        plc_type_id: ctx.ids["plc:PARK_FACING"],
        calc_mode: "PER_SQFT",
        value: 15_000,
        applies_to: "FACING_IN",
        facings: ["Park"],
        sort_order: 1,
      },
    ],
  });
  await ctx.post(`/api/v1/rate-cards/${ggvCard.id}/activate`, { version: ggvCard.version });
  ctx.ids["rateCard:GGV"] = ggvCard.id;

  // blocks (flats generated atomically on creation)
  const tower = ctx.ids["blockType:TOWER"]!;
  const villa = ctx.ids["blockType:VILLA"]!;
  const fp4 = ctx.ids["template:FP4"]!;
  const fp4p = ctx.ids["template:FP4P"]!;
  const fpVilla = ctx.ids["template:VILLA"]!;
  for (const [code, name, sort] of [
    ["A", "Tower A", 1],
    ["B", "Tower B", 2],
  ] as const) {
    await createBlock(ctx, "SGH", {
      project_id: sgh.id,
      block_type_id: tower,
      name,
      code,
      floors: 8,
      floor_start: 1,
      ground_floor_label: "G",
      floor_plans: [{ from_floor: 1, to_floor: 8, floor_plan_template_id: fp4 }],
      numbering_pattern: "{block}-{floor}{pos2}",
      status: "UNDER_CONSTRUCTION",
      sort_order: sort,
    });
  }
  await createBlock(ctx, "SGH", {
    project_id: sgh.id,
    block_type_id: tower,
    name: "Tower C",
    code: "C",
    floors: 15,
    floor_start: 1,
    ground_floor_label: "G",
    skip_floors: [13],
    refuge_floors: [7],
    podium_floors: [],
    floor_plans: [
      { from_floor: 1, to_floor: 5, floor_plan_template_id: fp4 },
      { from_floor: 6, to_floor: 15, floor_plan_template_id: fp4p },
    ],
    numbering_pattern: "{block}-{floor}{pos2}",
    status: "UNDER_CONSTRUCTION",
    sort_order: 3,
  });
  await createBlock(ctx, "GGV", {
    project_id: ggv.id,
    block_type_id: villa,
    name: "Block P – Premium Villas",
    code: "P",
    floors: 6,
    floor_start: 1,
    floor_plans: [{ from_floor: 1, to_floor: 6, floor_plan_template_id: fpVilla }],
    numbering_pattern: "{block}{seq}",
    status: "READY",
    sort_order: 1,
  });
  await createBlock(ctx, "GGV", {
    project_id: ggv.id,
    block_type_id: villa,
    name: "Block Q – Garden Villas",
    code: "Q",
    floors: 8,
    floor_start: 1,
    floor_plans: [{ from_floor: 1, to_floor: 8, floor_plan_template_id: fpVilla }],
    numbering_pattern: "{block}{seq}",
    status: "UNDER_CONSTRUCTION",
    sort_order: 2,
  });

  // parking (SGH): 40 covered B1-01…B1-40, 20 open S-01…S-20
  await ctx.post(`/api/v1/projects/${sgh.id}/parking/bulk-generate`, {
    project_id: sgh.id,
    prefix: "B1-",
    from_number: 1,
    to_number: 40,
    pad: 2,
    slot_type: "COVERED",
    level: "B1",
    price_paise: 3 * LAKH,
  });
  await ctx.post(`/api/v1/projects/${sgh.id}/parking/bulk-generate`, {
    project_id: sgh.id,
    prefix: "S-",
    from_number: 1,
    to_number: 20,
    pad: 2,
    slot_type: "OPEN",
    level: "Surface",
    price_paise: 150_000_00,
  });
  const parking = await ctx.get<{ items: { id: string; number: string }[] }>(
    `/api/v1/projects/${sgh.id}/parking?page_size=100&sort=number`,
  );
  for (const s of parking.items) ctx.projects["SGH"]!.parking.set(s.number, s.id);

  // website media: hero images + brochure PDFs (documents module → real storage keys and webp variants)
  const brochureType = ctx.ids["docType:BROCHURE"]!;
  const sghHeroes: string[] = [];
  for (const [i, caption] of [
    "Shree Ganesh Heights",
    "Tower A – Bailey Road",
    "Clubhouse & Pool",
    "Landscaped Podium",
  ].entries()) {
    sghHeroes.push(
      await ctx.uploadDocument(
        { entity_type: "PROJECT", entity_id: sgh.id, title: caption },
        {
          name: `sgh-hero-${i + 1}.png`,
          data: await placeholderPng(caption, "Shree Ganesh Heights · Bailey Road, Patna"),
          type: "image/png",
        },
      ),
    );
  }
  const sghBrochure = await ctx.uploadDocument(
    { entity_type: "PROJECT", entity_id: sgh.id, title: "SGH brochure", document_type_id: brochureType },
    {
      name: "shree-ganesh-heights-brochure.pdf",
      data: await placeholderPdf("Shree Ganesh Heights – e-brochure", [
        "Three towers of 2 & 3 BHK homes on Bailey Road, Patna.",
        "RERA BRERAP00123-1/23.",
        "Configurations: 2BHK-A 1050 sq ft, 2BHK-B 1130 sq ft, 3BHK-A 1520 sq ft, 3BHK-B 1700 sq ft.",
        "Amenities: clubhouse, pool, gym, gardens, EV charging and more.",
      ]),
      type: "application/pdf",
    },
  );
  ctx.projects["SGH"]!.brochureDocId = sghBrochure;
  const ggvHeroes: string[] = [];
  for (const [i, caption] of ["Ganesh Green Villas", "Premium Villa P1"].entries()) {
    ggvHeroes.push(
      await ctx.uploadDocument(
        { entity_type: "PROJECT", entity_id: ggv.id, title: caption },
        {
          name: `ggv-hero-${i + 1}.png`,
          data: await placeholderPng(caption, "Ganesh Green Villas · Danapur, Patna"),
          type: "image/png",
        },
      ),
    );
  }
  const ggvBrochure = await ctx.uploadDocument(
    { entity_type: "PROJECT", entity_id: ggv.id, title: "GGV brochure", document_type_id: brochureType },
    {
      name: "ganesh-green-villas-brochure.pdf",
      data: await placeholderPdf("Ganesh Green Villas – e-brochure", [
        "Fourteen independent 4 BHK villas around a private park in Danapur.",
        "RERA BRERAP00087-2/22.",
        "Villa: 3000 sq ft super built-up on a 2,400 sq ft plot.",
        "Price on request.",
      ]),
      type: "application/pdf",
    },
  );
  ctx.projects["GGV"]!.brochureDocId = ggvBrochure;

  // website settings (publish needs hero + description + location)
  const sghWeb = await ctx.versionOf(`/api/v1/projects/${sgh.id}/website`);
  await ctx.patch(`/api/v1/projects/${sgh.id}/website`, {
    version: sghWeb,
    slug: SGH_SLUG,
    is_published: true,
    show_prices: true,
    show_availability: true,
    show_progress: true,
    hero_document_ids: sghHeroes,
    brochure_document_id: sghBrochure,
    highlights: [
      "RERA registered – BRERAP00123-1/23",
      "4 km from Patna Airport",
      "Vastu-compliant 2 & 3 BHK layouts",
      "Earthquake-resistant RCC frame",
      "70% open landscaped area",
      "Possession Dec 2028",
    ],
    video_urls: ["https://www.youtube.com/watch?v=sgh-walkthrough"],
    tour_urls: ["https://my.matterport.com/show/?m=sgh-3bhk-a"],
    map_embed_url: "https://www.google.com/maps/embed?pb=sgh-bailey-road",
    faqs: [
      {
        q: "Is Shree Ganesh Heights RERA registered?",
        a: "Yes – Bihar RERA registration BRERAP00123-1/23 covers all three towers.",
      },
      {
        q: "What are the configurations available?",
        a: "2 BHK (1050 and 1130 sq ft) and 3 BHK (1520 and 1700 sq ft) apartments across Towers A, B and C.",
      },
      {
        q: "When is possession?",
        a: "Tower A is scheduled for December 2028; Towers B and C follow within six months.",
      },
      {
        q: "Do you offer construction-linked payment plans?",
        a: "Yes – our Standard CLP, Down Payment and Flexi plans are available on every tower.",
      },
      {
        q: "Is home-loan assistance available?",
        a: "The project is approved by HDFC, SBI and Bank of India; our team helps with the paperwork.",
      },
      {
        q: "Is covered car parking included?",
        a: "Covered basement parking is allotted at booking at ₹3,00,000 per slot; open parking is also available.",
      },
    ],
    seo: {
      title: "Shree Ganesh Heights – 2 & 3 BHK flats on Bailey Road, Patna",
      description:
        "RERA-registered 2 and 3 BHK apartments by Shree Ganesh Builders on Bailey Road, Patna. Clubhouse, pool, EV charging.",
    },
  });
  const ggvWeb = await ctx.versionOf(`/api/v1/projects/${ggv.id}/website`);
  await ctx.patch(`/api/v1/projects/${ggv.id}/website`, {
    version: ggvWeb,
    slug: GGV_SLUG,
    is_published: true,
    show_prices: false,
    show_availability: true,
    show_progress: false,
    hero_document_ids: ggvHeroes,
    brochure_document_id: ggvBrochure,
    highlights: [
      "Ready-to-move premium villas (Block P)",
      "Private park and jogging track",
      "Gated community with 24×7 security",
      "Rainwater harvesting and solar street lights",
    ],
    map_embed_url: "https://www.google.com/maps/embed?pb=ggv-danapur",
    faqs: [
      {
        q: "Are the villas ready for possession?",
        a: "Block P (Premium Villas) has completed every construction stage and handovers are under way; Block Q is in finishing.",
      },
      { q: "What is the plot size?", a: "Each villa sits on a 2,400 sq ft plot with 3,000 sq ft super built-up area." },
      {
        q: "Is the price negotiable?",
        a: "Villas are priced on request – book a private site visit and our team will share the current rate card.",
      },
      {
        q: "Can I customise interiors?",
        a: "Yes, for Block Q villas interior customisation is possible until the flooring stage.",
      },
    ],
    seo: {
      title: "Ganesh Green Villas – 4 BHK villas in Danapur, Patna",
      description: "Independent 4 BHK villas around a private park in Danapur by Shree Ganesh Builders.",
    },
  });

  // site-visit settings
  const sghVisit = await ctx.versionOf(`/api/v1/projects/${sgh.id}/visit-settings`);
  await ctx.patch(`/api/v1/projects/${sgh.id}/visit-settings`, {
    version: sghVisit,
    settings: {
      enabled: true,
      visit_days: [1, 2, 3, 4, 5, 6],
      start_time: "10:00",
      end_time: "17:00",
      slot_minutes: 60,
      seats_per_slot: 3,
      min_lead_hours: 12,
      max_days_ahead: 30,
      blackout_dates: [secondSundayOfNextMonth(ctx.today)],
      site_office_address: "SGH site office, Plot 14, Bailey Road, Raja Bazar, Patna 800014",
      maps_link: "https://maps.google.com/?q=Shree+Ganesh+Heights+Bailey+Road+Patna",
      instructions:
        "Carry a photo ID. Parking is available at the site office; our executive will meet you at the gate.",
    },
  });
  const ggvVisit = await ctx.versionOf(`/api/v1/projects/${ggv.id}/visit-settings`);
  await ctx.patch(`/api/v1/projects/${ggv.id}/visit-settings`, {
    version: ggvVisit,
    settings: {
      enabled: true,
      visit_days: [0, 1, 2, 3, 4, 5, 6],
      start_time: "10:00",
      end_time: "16:00",
      slot_minutes: 60,
      seats_per_slot: 2,
      min_lead_hours: 24,
      max_days_ahead: 21,
      blackout_dates: [],
      site_office_address: "GGV sales lounge, Khagaul Road, Danapur, Patna 801503",
      maps_link: "https://maps.google.com/?q=Ganesh+Green+Villas+Danapur",
      instructions: "Villa visits are guided; please arrive 10 minutes before your slot.",
    },
  });
}
