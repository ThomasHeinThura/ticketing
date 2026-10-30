import { describe, expect, it } from "vitest";
import type { Notification } from "@/types/notification";
import {
  getApiKeyNotificationHref,
  getNotificationContent,
  getNotificationTitle,
  getPendingActionNotificationHref,
  getWebhookNotificationHref,
} from "./notification-dropdown";

const t = (key: string, options?: Record<string, unknown>) => {
  if (key === "notifications:reminderLeadTime.days") {
    return `${options?.count} days`;
  }
  if (key === "notifications:events.due_date_reminder.content") {
    return `${options?.taskTitle} is due in ${options?.leadTime}`;
  }
  if (key === "notifications:events.task_comment.title") {
    return `${options?.commenterName} commented on your task`;
  }
  if (key === "notifications:events.task_comment.content") {
    return `New comment on ${options?.taskTitle}: ${options?.commentPreview}`;
  }
  return key;
};

function notification(
  type: string,
  eventData: Record<string, unknown>,
): Notification {
  return {
    id: "notification-1",
    userId: "user-1",
    title: null,
    content: null,
    type,
    eventData,
    isRead: false,
    createdAt: "2026-07-12T10:00:00.000Z",
    updatedAt: "2026-07-12T10:00:00.000Z",
  } as unknown as Notification;
}

describe("notification display content", () => {
  it("renders configured due-date lead times", () => {
    const item = notification("due_date_reminder", {
      taskTitle: "Launch website",
      leadTimeMinutes: 2880,
    });

    expect(getNotificationTitle(item, t)).toBe(
      "notifications:events.due_date_reminder.title",
    );
    expect(getNotificationContent(item, t)).toBe(
      "Launch website is due in 2 days",
    );
  });

  it("renders comment notifications with their preview", () => {
    const item = notification("task_comment", {
      taskTitle: "Launch website",
      commenterName: "Mina",
      commentPreview: "Ready for review",
    });

    expect(getNotificationTitle(item, t)).toBe("Mina commented on your task");
    expect(getNotificationContent(item, t)).toBe(
      "New comment on Launch website: Ready for review",
    );
  });
});

describe("pending action notification deep link", () => {
  it("opens the approval page for pending_action resources", () => {
    expect(
      getPendingActionNotificationHref({
        resourceType: "pending_action",
        resourceId: "pa/1",
      }),
    ).toBe("/dashboard/settings/account/pending-actions/pa%2F1");
  });

  it("ignores other resources and missing ids", () => {
    expect(
      getPendingActionNotificationHref({
        resourceType: "task",
        resourceId: "t1",
      }),
    ).toBeNull();
    expect(
      getPendingActionNotificationHref({
        resourceType: "pending_action",
        resourceId: null,
      }),
    ).toBeNull();
  });
});

describe("webhook auto-disable notification deep link", () => {
  it("opens the canonical webhook editor route", () => {
    expect(
      getWebhookNotificationHref({
        deepLink: { type: "webhook", id: "hook/1" },
      }),
    ).toBe("/dashboard/settings/workspace/webhooks/hook%2F1");
  });

  it("ignores missing or unsupported deep links", () => {
    expect(getWebhookNotificationHref({ deepLink: null })).toBeNull();
    expect(
      getWebhookNotificationHref({
        deepLink: { type: "webhook", id: "" },
      }),
    ).toBeNull();
  });
});

describe("API key auto-disable notification deep link", () => {
  it("opens the canonical developer settings page", () => {
    expect(
      getApiKeyNotificationHref({
        deepLink: { type: "api_key", id: "key/1" },
      }),
    ).toBe("/dashboard/settings/account/developer");
  });

  it("ignores missing, empty, or unsupported links", () => {
    expect(getApiKeyNotificationHref({ deepLink: null })).toBeNull();
    expect(
      getApiKeyNotificationHref({
        deepLink: { type: "api_key", id: "" },
      }),
    ).toBeNull();
    expect(
      getApiKeyNotificationHref({
        deepLink: { type: "webhook", id: "hook/1" },
      }),
    ).toBeNull();
  });
});
