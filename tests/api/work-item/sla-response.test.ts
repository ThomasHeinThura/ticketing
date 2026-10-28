import { describe, expect, it } from "vitest";
import {
  openSlaPauses,
  workItemSlaSchema,
} from "../../../apps/api/src/work-item/sla-response";

const metric = (m: "first_response" | "resolution") => ({
  metric: m,
  state: "ok" as const,
  dueAt: null,
  targetMinutes: null,
  consumedMinutes: 0,
  consumedPct: 0,
  remainingMinutes: null,
});

describe("work item SLA response (SLA-13, SLA-19)", () => {
  it("keeps only open pauses, with the display shape", () => {
    const started = new Date("2026-10-20T09:00:00Z");
    const pauses = openSlaPauses([
      {
        metric: "resolution",
        startedAt: started,
        endedAt: new Date("2026-10-20T10:00:00Z"),
        reason: "waiting_on_customer",
      },
      {
        metric: "resolution",
        startedAt: started,
        endedAt: null,
        reason: "waiting_on_customer",
      },
    ]);
    expect(pauses).toEqual([
      {
        metric: "resolution",
        startedAt: started,
        endedAt: null,
        reason: "waiting_on_customer",
      },
    ]);
  });

  it("carries calendarName, atRiskThresholdPct and pauses", () => {
    const parsed = workItemSlaSchema.parse({
      key: "ABC-1",
      startedAt: new Date(),
      evaluatedAt: new Date(),
      metrics: [metric("first_response"), metric("resolution")],
      calendarName: "Business hours",
      atRiskThresholdPct: 80,
      pauses: openSlaPauses([
        {
          metric: "resolution",
          startedAt: new Date(),
          endedAt: null,
          reason: "waiting_on_customer",
        },
      ]),
    });
    expect(parsed.calendarName).toBe("Business hours");
    expect(parsed.atRiskThresholdPct).toBe(80);
    expect(parsed.pauses).toHaveLength(1);
  });
});
