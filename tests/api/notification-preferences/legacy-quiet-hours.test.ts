/**
 * P4R1-M8 (`NO-3`): the legacy `deliverNotification` path (task.* subscribers, due-date reminders)
 * must hold external delivery during the recipient's quiet hours and retry when the window ends.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const outbound = vi.hoisted(() => ({
  sendWebhookRequest: vi.fn(async () => ({
    statusCode: 204,
    durationMs: 0,
    responseBody: "",
    error: null,
    success: true,
  })),
}));

vi.mock("../../../apps/api/src/webhook/safe-http", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../apps/api/src/webhook/safe-http")
  >()),
  sendWebhookRequest: outbound.sendWebhookRequest,
}));

const state = vi.hoisted(() => ({
  holds: [] as Array<{ id: string; until: Date }>,
  quiet: {
    start: "22:00" as string | null,
    end: "07:00" as string | null,
    timezone: "UTC" as string | null,
  },
}));

vi.mock(
  "../../../apps/api/src/notification-preferences/delivery.repository",
  () => ({
    findDeliveryNotification: async () => ({
      id: "notif-1",
      userId: "user-1",
      type: "due_date_reminder",
      title: "Due soon",
      content: "A task is due",
      eventData: null,
      resourceId: "ws-1",
      resourceType: "workspace",
      createdAt: new Date("2026-01-01T00:00:00Z"),
    }),
    findDeliveryWorkspaceContext: async () => [
      { workspaceId: "ws-1", workspaceName: "Acme" },
    ],
    findDeliveryTaskContext: async () => [],
    findDeliveryUser: async () => [
      { email: "u@example.com", name: "U", locale: "en" },
    ],
    findDeliveryPreference: async () => ({
      emailEnabled: false,
      ntfyEnabled: false,
      gotifyEnabled: false,
      webhookEnabled: true,
      webhookUrl: "https://hooks.example.com/in",
      webhookSecret: null,
    }),
    findDeliveryWorkspaceRule: async () => ({
      isActive: true,
      projectMode: "all",
      selectedProjects: [],
      emailEnabled: false,
      ntfyEnabled: false,
      gotifyEnabled: false,
      webhookEnabled: true,
    }),
    QUIET_HOURS_HOLD_KEY: "quietHoursHeldUntil",
    holdDeliveryUntil: async (id: string, until: Date) => {
      state.holds.push({ id, until });
    },
    findDeliveryQuietHours: async () => ({
      setting: state.quiet,
      fallbackTimezone: "UTC",
    }),
  }),
);
vi.mock("../../../apps/api/src/notification-preferences/secrets", () => ({
  decryptSecret: (value: string | null) => value,
  encryptSecret: (value: string | null) => value,
}));
vi.mock("../../../apps/api/src/notification/task-reach.repository", () => ({
  userCanReachTask: async () => true,
}));

import {
  deliverNotification,
  legacyQuietHoursDecision,
} from "../../../apps/api/src/notification-preferences/delivery";

describe("legacy delivery honours quiet hours (NO-3)", () => {
  let originalNodeEnv: string | undefined;
  let originalPrivateOverride: string | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    originalNodeEnv = process.env.NODE_ENV;
    originalPrivateOverride =
      process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS;
    process.env.NODE_ENV = "development";
    process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS = "true";
    outbound.sendWebhookRequest.mockClear();
    outbound.sendWebhookRequest.mockResolvedValue({
      statusCode: 204,
      durationMs: 0,
      responseBody: "",
      error: null,
      success: true,
    });
    state.quiet = { start: "22:00", end: "07:00", timezone: "UTC" };
    state.holds = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalPrivateOverride === undefined)
      delete process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS;
    else
      process.env.KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS =
        originalPrivateOverride;
  });

  it("decides defer inside the window (crossing midnight), send outside, withhold when malformed", async () => {
    expect(
      await legacyQuietHoursDecision("u", new Date("2026-03-01T02:00:00Z")),
    ).toEqual({ kind: "defer", until: new Date("2026-03-01T07:00:00Z") });
    expect(
      await legacyQuietHoursDecision("u", new Date("2026-03-01T12:00:00Z")),
    ).toEqual({ kind: "send" });
    state.quiet = { start: "22:00", end: "22:00", timezone: "UTC" };
    expect(
      await legacyQuietHoursDecision("u", new Date("2026-03-01T12:00:00Z")),
    ).toEqual({ kind: "withhold" });
    state.quiet = { start: null, end: null, timezone: null };
    expect(
      await legacyQuietHoursDecision("u", new Date("2026-03-01T02:00:00Z")),
    ).toEqual({ kind: "send" });
  });

  it("sends nothing at 02:00, persists the hold (no timer), and delivers on a later run", async () => {
    vi.setSystemTime(new Date("2026-03-01T02:00:00Z"));
    await deliverNotification("notif-1");
    expect(outbound.sendWebhookRequest).not.toHaveBeenCalled();
    // Durable hold until the window end; nothing is left in-process to lose on restart.
    expect(state.holds).toEqual([
      { id: "notif-1", until: new Date("2026-03-01T07:00:00Z") },
    ]);
    expect(vi.getTimerCount()).toBe(0);

    // Simulated restart: a later scheduler run re-enters delivery once the window has ended.
    vi.setSystemTime(new Date("2026-03-01T07:01:00Z"));
    await deliverNotification("notif-1");
    expect(outbound.sendWebhookRequest).toHaveBeenCalledTimes(1);
    expect(state.holds).toHaveLength(1);
  });

  it("delivers immediately outside quiet hours", async () => {
    vi.setSystemTime(new Date("2026-03-01T12:00:00Z"));
    await deliverNotification("notif-1");
    expect(outbound.sendWebhookRequest).toHaveBeenCalledTimes(1);
  });
});
