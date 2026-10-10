import { describe, expect, it } from "vitest";
import { defaultExternalPreference } from "../../../apps/api/src/notification/preferences";

describe("notification preference defaults", () => {
  it("keeps in-app enabled and defaults email only for assignment, mention, approval, and SLA breach", () => {
    expect(defaultExternalPreference("work_item.assigned", "in_app")).toEqual({
      enabled: true,
      digest: "off",
      source: "in_app",
    });
    expect(
      defaultExternalPreference("work_item.assigned", "notify.email").enabled,
    ).toBe(true);
    expect(
      defaultExternalPreference("work_item.unassigned", "notify.email").enabled,
    ).toBe(true);
    expect(
      defaultExternalPreference("work_item.mentioned", "notify.email").enabled,
    ).toBe(true);
    expect(
      defaultExternalPreference("approval.requested", "notify.email").enabled,
    ).toBe(true);
    expect(
      defaultExternalPreference("approval.expiring", "notify.email").enabled,
    ).toBe(true);
    expect(
      defaultExternalPreference("sla.breached", "notify.email").enabled,
    ).toBe(true);
    expect(
      defaultExternalPreference("work_item.commented", "notify.email").enabled,
    ).toBe(false);
    expect(
      defaultExternalPreference("sla.at_risk", "notify.email").enabled,
    ).toBe(false);
    expect(
      defaultExternalPreference("work_item.assigned", "notify.webhook").enabled,
    ).toBe(false);
  });
});
