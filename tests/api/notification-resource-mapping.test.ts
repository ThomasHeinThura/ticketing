import { describe, expect, it } from "vitest";
import type { DbTransaction } from "../../apps/api/src/events/outbox";
import { findCurrentNotificationResource } from "../../apps/api/src/notification/repository";
import { isSupportedNotificationResourceEvent } from "../../apps/api/src/notification/resource-contract";

describe("current notification resource mappings", () => {
  it("fails closed for an event/resource pair outside the implemented mapping set", async () => {
    const tx = {
      execute: () => {
        throw new Error("unsupported mappings must not query a resource");
      },
    } as unknown as DbTransaction;

    await expect(
      findCurrentNotificationResource(tx, {
        resourceType: "automation",
        resourceId: "key-1",
        eventKind: "automation.run_failed",
      }),
    ).resolves.toBeNull();
  });

  it("registers the current-owner API-key auto-disable mapping", () => {
    expect(
      isSupportedNotificationResourceEvent("api_key", "api_key.auto_disabled"),
    ).toBe(true);
    expect(
      isSupportedNotificationResourceEvent("api_key", "automation.run_failed"),
    ).toBe(false);
  });
});
