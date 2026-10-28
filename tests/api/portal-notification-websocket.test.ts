import { describe, expect, it } from "vitest";
import { portalNotificationSocketPayload } from "../../apps/api/src/notification/portal-inbox-websocket";

describe("portal notification WebSocket payload", () => {
  it("forwards only the payload-free notification invalidation", () => {
    expect(
      portalNotificationSocketPayload('{"type":"NOTIFICATION_CREATED"}'),
    ).toBe('{"type":"NOTIFICATION_CREATED"}');
  });

  it.each([
    '{"type":"NOTIFICATION_CREATED","title":"staff-only"}',
    '{"type":"identity.invalidate"}',
    '{"type":"NOTIFICATION_CREATED","resourceId":"work-item-id"}',
    "[]",
    "not-json",
  ])("drops unsupported frame %s", (raw) => {
    expect(portalNotificationSocketPayload(raw)).toBeNull();
  });
});
