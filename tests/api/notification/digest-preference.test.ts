import { describe, expect, it } from "vitest";
import { canonicalPreferenceWriteSchema } from "../../../apps/api/src/notification/canonical-preferences";

const selector = {
  channel: "notify.email",
  scope: "global",
  scopeId: null,
  enabled: true,
};

describe("canonical digest preferences", () => {
  it("allows immediate, hourly, and daily comment delivery", () => {
    for (const digest of ["off", "hourly", "daily"] as const) {
      expect(
        canonicalPreferenceWriteSchema.safeParse({
          ...selector,
          eventKind: "work_item.commented",
          digest,
        }).success,
      ).toBe(true);
    }
  });

  it("keeps direct mentions out of digests regardless of cadence setting", () => {
    for (const digest of ["hourly", "daily"] as const) {
      expect(
        canonicalPreferenceWriteSchema.safeParse({
          ...selector,
          eventKind: "work_item.mentioned",
          digest,
        }).success,
      ).toBe(false);
    }
  });
});
