import { describe, expect, it } from "vitest";
import { resolveNotificationDeepLinks } from "../../../apps/api/src/notification/links";

describe("notification deep links", () => {
  it("links an owner-scoped API key auto-disable notice to its resource", () => {
    expect(
      resolveNotificationDeepLinks([
        {
          id: "notice-1",
          kind: "api_key.auto_disabled",
          resourceType: "api_key",
          resourceId: "key-1",
        },
      ]),
    ).toEqual(new Map([["notice-1", { type: "api_key", id: "key-1" }]]));
  });

  it("omits empty ids, mismatched resources, and unsupported kinds", () => {
    expect(
      resolveNotificationDeepLinks([
        {
          id: "empty",
          kind: "api_key.auto_disabled",
          resourceType: "api_key",
          resourceId: "",
        },
        {
          id: "mismatch",
          kind: "api_key.auto_disabled",
          resourceType: "webhook",
          resourceId: "key-2",
        },
        {
          id: "unknown",
          kind: "api_key.created",
          resourceType: "api_key",
          resourceId: "key-3",
        },
      ]),
    ).toEqual(new Map());
  });
});
