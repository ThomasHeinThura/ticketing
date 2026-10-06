import { describe, expect, it } from "vitest";
import type { DbTransaction } from "../../apps/api/src/events/outbox";
import { findCurrentNotificationResource } from "../../apps/api/src/notification/repository";

describe("current notification resource mappings", () => {
  it("fails closed for an event/resource pair outside the implemented mapping set", async () => {
    const tx = {
      execute: () => {
        throw new Error("unsupported mappings must not query a resource");
      },
    } as unknown as DbTransaction;

    await expect(
      findCurrentNotificationResource(tx, {
        resourceType: "api_key",
        resourceId: "key-1",
        eventKind: "api_key.auto_disabled",
      }),
    ).resolves.toBeNull();
  });
});
