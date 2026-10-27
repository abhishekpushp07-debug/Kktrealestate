/** The only places the demo seed writes SQL directly instead of calling an endpoint (each is explained where it happens). */
export const SEED_FALLBACKS = [
  "brochure_downloads: back-dated download rows (+ project download counters) for the 30-day sparkline — the public endpoint records only 'now' (seed/leads.ts)",
  "site_visits: finished visits are booked at future slots, marked COMPLETED / NO_SHOW / CANCELLED through the API, then their visit_date is moved into the past — the scheduler never books past slots (seed/visits.ts)",
] as const;
