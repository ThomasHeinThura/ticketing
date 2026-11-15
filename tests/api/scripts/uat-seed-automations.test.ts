import { describe, expect, it } from "vitest";
import { G1_AUTOMATIONS } from "../../../apps/api/scripts/uat-seed-plan";
import { validateRuleDefinition } from "../../../apps/api/src/automation/validation";
import { registeredJobCatalog } from "../../../apps/api/src/scheduler";

describe("UAT seed automation validation", () => {
  it("reports automation-schedule as enabled in registeredJobCatalog() even before scheduler startup", () => {
    const job = registeredJobCatalog().find(
      (entry) => entry.name === "automation-schedule",
    );
    expect(job).toBeDefined();
    expect(job?.enabled).toBe(true);
  });

  it("validates both G1_AUTOMATIONS entries with registeredJobCatalog() schedule availability", () => {
    const scheduleAvailable = registeredJobCatalog().some(
      (job) => job.name === "automation-schedule" && job.enabled,
    );
    expect(scheduleAvailable).toBe(true);
    expect(G1_AUTOMATIONS).toHaveLength(2);

    for (const target of G1_AUTOMATIONS) {
      const result = validateRuleDefinition(target.definition, {
        scheduleAvailable,
      });
      expect(result.ok, target.name).toBe(true);
    }
  });
});
