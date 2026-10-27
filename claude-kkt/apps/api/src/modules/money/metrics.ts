/** Prometheus metrics of the money module (registered on the shared registry, lib/metrics.ts; catalogue in docs/OBSERVABILITY.md). */
import client from "prom-client";
import { registry } from "../../lib/metrics.js";

/**
 * Bookings the auto-dues engine could not process (DAILY_DUES, DUES_CATCHUP, admin run), by error code. Each failing booking is
 * isolated — its transaction rolls back and the run goes on — so this counter (and the job result's `failures`) is how a poison booking
 * is noticed: alert on `increase(kkt_dues_booking_failures_total[1d]) > 0`.
 */
export const duesBookingFailures = new client.Counter({
  name: "kkt_dues_booking_failures_total",
  help: "Bookings whose auto-dues unit of work failed (isolated per booking; the run continued), by error code.",
  labelNames: ["code"] as const,
  registers: [registry],
});
