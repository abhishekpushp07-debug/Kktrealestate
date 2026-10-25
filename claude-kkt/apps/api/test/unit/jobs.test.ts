import { describe, expect, it } from "vitest";
import { JOB_SCHEDULES, jobHandler, registerJob, registeredJobs } from "../../src/jobs/index.js";

describe("job registry", () => {
  it("has the five IST schedules (incl. the hourly SLA check) and a no-op placeholder for unregistered jobs", async () => {
    expect(JOB_SCHEDULES.map((s) => `${s.name}@${s.cron}`)).toEqual(["DAILY_DUES@30 0 * * *", "NIGHTLY_INTEGRITY@45 0 * * *", "OVERDUE_NOTIFICATIONS@15 1 * * *", "VISIT_OUTCOME_NUDGE@0 9 * * *", "SLA_BREACH_CHECK@5 * * * *"]);
    expect(JOB_SCHEDULES.every((s) => s.tz === "Asia/Kolkata")).toBe(true);
    const log = { info: () => undefined } as unknown as Parameters<ReturnType<typeof jobHandler>>[0]["log"];
    const result = await jobHandler("DAILY_DUES")({ db: {} as never, log, data: {} });
    expect(result).toEqual({ implemented: false });
    registerJob("DAILY_DUES", async () => ({ raised: 3 }));
    expect(registeredJobs()).toContain("DAILY_DUES");
    expect(await jobHandler("DAILY_DUES")({ db: {} as never, log, data: {} })).toEqual({ raised: 3 });
  });
});
