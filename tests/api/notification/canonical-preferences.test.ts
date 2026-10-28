import { describe, expect, it } from "vitest";
import { canonicalPreferenceWriteSchema } from "../../../apps/api/src/notification/canonical-preferences";

describe("staff canonical email preferences", () => {
  it("accepts team notifications with the selected digest cadence", () => {
    expect(
      canonicalPreferenceWriteSchema.parse({
        eventKind: "automation.notification_sent",
        channel: "notify.email",
        scope: "global",
        scopeId: null,
        enabled: true,
        digest: "daily",
      }),
    ).toMatchObject({
      eventKind: "automation.notification_sent",
      enabled: true,
      digest: "daily",
    });
  });

  it("keeps mentions immediate and does not widen the staff event enum", () => {
    expect(
      canonicalPreferenceWriteSchema.safeParse({
        eventKind: "work_item.mentioned",
        channel: "notify.email",
        scope: "global",
        scopeId: null,
        enabled: true,
        digest: "daily",
      }).success,
    ).toBe(false);
    expect(
      canonicalPreferenceWriteSchema.safeParse({
        eventKind: "work_item.assigned",
        channel: "notify.email",
        scope: "global",
        scopeId: null,
        enabled: true,
        digest: "off",
      }).success,
    ).toBe(false);
  });
});
