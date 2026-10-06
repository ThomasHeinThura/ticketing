import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  can: vi.fn(),
  reaches: vi.fn(),
  resolveIdentity: vi.fn(),
  resolveNotificationPreference: vi.fn(),
  findApprovalNotificationContext: vi.fn(),
  findCurrentNotificationResource: vi.fn(),
  findNotificationPerson: vi.fn(),
}));

vi.mock("@taskdesk/permissions", () => ({
  can: mocks.can,
  reaches: mocks.reaches,
}));
vi.mock("../../apps/api/src/permissions/resolve-identity", () => ({
  resolveIdentity: mocks.resolveIdentity,
}));
vi.mock("../../apps/api/src/notification/preferences", () => ({
  resolveNotificationPreference: mocks.resolveNotificationPreference,
}));
vi.mock("../../apps/api/src/notification/repository", () => ({
  findApprovalNotificationContext: mocks.findApprovalNotificationContext,
  findCurrentNotificationResource: mocks.findCurrentNotificationResource,
  findNotificationPerson: mocks.findNotificationPerson,
}));

import type { ClaimedNotificationDelivery } from "../../apps/api/src/database/repositories/notification-delivery.repository";
import type { DbTransaction } from "../../apps/api/src/events/outbox";
import { evaluateCurrentNotificationReachAndPreference } from "../../apps/api/src/notification/current-eligibility";

const delivery = {
  id: "delivery-1",
  eventId: "event-1",
  recipientPersonId: "person-1",
  channel: "notify.email",
  workspaceId: "workspace-1",
  organisationId: "org-1",
  dedupeKey: "dedupe-1",
  attempts: 0,
  eventKind: "work_item.assigned",
  payload: { payload: {} },
  title: "Assigned",
  body: "A safe summary",
  resourceType: "work_item",
  resourceId: "item-1",
} satisfies ClaimedNotificationDelivery;

const tx = {} as DbTransaction;
const resource = {
  workspaceId: "workspace-1",
  projectId: "project-1",
  organisationId: "org-1",
  visibleToPersonIds: null,
  customerVisible: true,
  staffUrl: "/agent/work-items/item-1",
};

describe("current notification reach and preference", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.findNotificationPerson.mockResolvedValue({
      userId: "user-1",
      side: "staff",
      active: true,
      quietHoursStart: null,
      quietHoursEnd: null,
      quietHoursTimezone: null,
    });
    mocks.resolveIdentity.mockResolvedValue({
      personId: "person-1",
      side: "staff",
    });
    mocks.findCurrentNotificationResource.mockResolvedValue(resource);
    mocks.reaches.mockReturnValue(true);
    mocks.resolveNotificationPreference.mockResolvedValue({ enabled: true });
  });

  it("suppresses after current resource reach is lost", async () => {
    mocks.reaches.mockReturnValue(false);
    await expect(
      evaluateCurrentNotificationReachAndPreference(tx, delivery),
    ).resolves.toEqual({ kind: "suppress", reason: "reach_lost" });
    expect(mocks.resolveNotificationPreference).not.toHaveBeenCalled();
  });

  it("suppresses when the current channel preference is disabled", async () => {
    mocks.resolveNotificationPreference.mockResolvedValue({ enabled: false });
    await expect(
      evaluateCurrentNotificationReachAndPreference(tx, delivery),
    ).resolves.toEqual({ kind: "suppress", reason: "channel_disabled" });
  });

  it("returns only the recipient's inbox projection after both checks pass", async () => {
    await expect(
      evaluateCurrentNotificationReachAndPreference(tx, delivery),
    ).resolves.toEqual({
      kind: "eligible",
      projection: {
        title: "Assigned",
        body: "A safe summary",
        url: "/agent/work-items/item-1",
      },
    });
  });

  it("passes the current private requester/participant allowlist to canonical reach", async () => {
    mocks.findCurrentNotificationResource.mockResolvedValue({
      ...resource,
      visibleToPersonIds: ["person-1", "participant-2"],
    });
    await evaluateCurrentNotificationReachAndPreference(tx, delivery);
    expect(mocks.reaches).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        visibleToPersonIds: ["person-1", "participant-2"],
      }),
    );
  });

  it("does not project an internal comment to a customer", async () => {
    mocks.resolveIdentity.mockResolvedValue({
      personId: "person-1",
      side: "customer",
    });
    mocks.findCurrentNotificationResource.mockResolvedValue({
      ...resource,
      customerVisible: false,
    });
    await expect(
      evaluateCurrentNotificationReachAndPreference(tx, {
        ...delivery,
        eventKind: "work_item.commented",
        payload: { payload: { commentId: "comment-1" } },
        resourceType: "comment",
        resourceId: "comment-1",
      }),
    ).resolves.toEqual({
      kind: "suppress",
      reason: "resource_not_customer_visible",
    });
    expect(mocks.resolveNotificationPreference).not.toHaveBeenCalled();
  });

  it("does not give a customer a staff work-item destination", async () => {
    mocks.resolveIdentity.mockResolvedValue({
      personId: "person-1",
      side: "customer",
    });
    await expect(
      evaluateCurrentNotificationReachAndPreference(tx, delivery),
    ).resolves.toEqual({ kind: "destination_unresolved" });
  });

  it("limits customer approval projection to the addressed approver or requester", async () => {
    mocks.resolveIdentity.mockResolvedValue({
      personId: "person-1",
      side: "customer",
    });
    mocks.findApprovalNotificationContext.mockResolvedValue({
      approverId: "other-person",
      requestedBy: "requester-person",
    });
    await expect(
      evaluateCurrentNotificationReachAndPreference(tx, {
        ...delivery,
        eventKind: "approval.requested",
        payload: { payload: { approvalId: "approval-1" } },
        resourceType: "approval",
        resourceId: "approval-1",
      }),
    ).resolves.toEqual({
      kind: "suppress",
      reason: "approval_not_addressed_to_recipient",
    });
    expect(mocks.resolveNotificationPreference).not.toHaveBeenCalled();
  });

  it("holds provider eligibility when quiet-hours fields are configured", async () => {
    mocks.findNotificationPerson.mockResolvedValue({
      userId: "user-1",
      side: "staff",
      active: true,
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
      quietHoursTimezone: "Europe/London",
    });
    await expect(
      evaluateCurrentNotificationReachAndPreference(tx, delivery),
    ).resolves.toEqual({ kind: "quiet_hours_unresolved" });
  });

  it("holds a recipient-safe projection when no exact approval route exists", async () => {
    mocks.findApprovalNotificationContext.mockResolvedValue({
      approverId: "approver-2",
      requestedBy: "person-1",
      workItemId: "item-1",
    });
    mocks.findCurrentNotificationResource.mockResolvedValue({
      ...resource,
      staffUrl: null,
    });
    await expect(
      evaluateCurrentNotificationReachAndPreference(tx, {
        ...delivery,
        eventKind: "approval.expired",
        payload: { payload: { approvalId: "approval-1" } },
        resourceType: "approval",
        resourceId: "approval-1",
      }),
    ).resolves.toEqual({ kind: "destination_unresolved" });
  });

  it("does not send a customer to the staff work-item route", async () => {
    mocks.resolveIdentity.mockResolvedValue({
      personId: "person-1",
      side: "customer",
    });
    mocks.findCurrentNotificationResource.mockResolvedValue({
      ...resource,
      visibleToPersonIds: ["person-1"],
      staffUrl: null,
    });
    await expect(
      evaluateCurrentNotificationReachAndPreference(tx, delivery),
    ).resolves.toEqual({ kind: "destination_unresolved" });
  });
});
