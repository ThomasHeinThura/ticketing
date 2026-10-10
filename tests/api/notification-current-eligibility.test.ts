import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  can: vi.fn(),
  reaches: vi.fn(),
  resolveIdentity: vi.fn(),
  resolveNotificationPreference: vi.fn(),
  findCurrentNotificationResource: vi.fn(),
  findNotificationPerson: vi.fn(),
  findApprovalNotificationContext: vi.fn(),
  isApprovalApproverStillValid: vi.fn(),
  listApprovalWatcherPersonIds: vi.fn(),
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
  findCurrentNotificationResource: mocks.findCurrentNotificationResource,
  findNotificationPerson: mocks.findNotificationPerson,
  findApprovalNotificationContext: mocks.findApprovalNotificationContext,
  isApprovalApproverStillValid: mocks.isApprovalApproverStillValid,
  listApprovalWatcherPersonIds: mocks.listApprovalWatcherPersonIds,
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
  payload: {
    id: "event-1",
    kind: "work_item.assigned",
    scope: { workspaceId: "workspace-1", organisationId: "org-1" },
    payload: { workItemId: "item-1" },
  },
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
    mocks.can.mockReturnValue(true);
    mocks.resolveNotificationPreference.mockResolvedValue({ enabled: true });
  });

  it("suppresses after current resource reach is lost", async () => {
    mocks.reaches.mockReturnValue(false);
    await expect(
      evaluateCurrentNotificationReachAndPreference(tx, delivery),
    ).resolves.toEqual({ kind: "suppress", reason: "reach_lost" });
    expect(mocks.resolveNotificationPreference).not.toHaveBeenCalled();
  });

  it("suppresses when reach holds but work_item:read authority is lost", async () => {
    mocks.can.mockImplementation(
      (_identity, capability) => capability !== "work_item:read",
    );
    await expect(
      evaluateCurrentNotificationReachAndPreference(tx, delivery),
    ).resolves.toEqual({ kind: "suppress", reason: "read_authority_lost" });
    expect(mocks.can).toHaveBeenCalledWith(
      expect.anything(),
      "work_item:read",
      "work_item",
      expect.objectContaining({
        workspaceId: "workspace-1",
        projectId: "project-1",
        workItemProjectId: "project-1",
      }),
    );
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

  it.each([
    ["work_item id", "work_item.assigned", { workItemId: "item-1" }],
    [
      "canonical key",
      "work_item.unblocked",
      { key: "item-1", formerBlockerId: "blocker-1" },
    ],
  ])(
    "accepts a matching %s for the event kind",
    async (_label, eventKind, payload) => {
      const result = await evaluateCurrentNotificationReachAndPreference(tx, {
        ...delivery,
        eventKind,
        payload: {
          id: delivery.eventId,
          kind: eventKind,
          scope: {
            workspaceId: delivery.workspaceId,
            organisationId: delivery.organisationId,
          },
          payload,
        },
      });
      expect(result.kind).toBe("eligible");
    },
  );

  it.each([
    ["missing mapping", "work_item.assigned", {}],
    [
      "different work-item id",
      "work_item.assigned",
      { workItemId: "other-item" },
    ],
    [
      "different work-item key",
      "work_item.unblocked",
      { key: "OTHER-1", formerBlockerId: "blocker-1" },
    ],
    [
      "comment mention mapped to a work item",
      "work_item.mentioned",
      { commentId: "comment-1" },
    ],
  ])(
    "rejects %s before recipient evaluation",
    async (_label, eventKind, payload) => {
      await expect(
        evaluateCurrentNotificationReachAndPreference(tx, {
          ...delivery,
          eventKind,
          payload: {
            id: delivery.eventId,
            kind: eventKind,
            scope: {
              workspaceId: delivery.workspaceId,
              organisationId: delivery.organisationId,
            },
            payload,
          },
        }),
      ).resolves.toEqual({
        kind: "suppress",
        reason: "resource_mapping_mismatch",
      });
      expect(mocks.findNotificationPerson).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["missing", undefined],
    ["wrong", "other-event"],
  ])("rejects an envelope with %s event identity", async (_label, eventId) => {
    await expect(
      evaluateCurrentNotificationReachAndPreference(tx, {
        ...delivery,
        payload: {
          id: eventId,
          kind: delivery.eventKind,
          scope: {
            workspaceId: delivery.workspaceId,
            organisationId: delivery.organisationId,
          },
          payload: { workItemId: "item-1" },
        },
      }),
    ).resolves.toEqual({
      kind: "suppress",
      reason: "resource_mapping_mismatch",
    });
  });

  it("rejects an envelope whose workspace differs from the delivery scope", async () => {
    await expect(
      evaluateCurrentNotificationReachAndPreference(tx, {
        ...delivery,
        payload: {
          id: delivery.eventId,
          kind: delivery.eventKind,
          scope: { workspaceId: "foreign-workspace" },
          payload: { workItemId: "item-1" },
        },
      }),
    ).resolves.toEqual({
      kind: "suppress",
      reason: "resource_mapping_mismatch",
    });
  });

  it("rejects an envelope whose organisation differs from the delivery scope", async () => {
    await expect(
      evaluateCurrentNotificationReachAndPreference(tx, {
        ...delivery,
        payload: {
          id: delivery.eventId,
          kind: delivery.eventKind,
          scope: {
            workspaceId: delivery.workspaceId,
            organisationId: "foreign-org",
          },
          payload: { workItemId: "item-1" },
        },
      }),
    ).resolves.toEqual({
      kind: "suppress",
      reason: "resource_mapping_mismatch",
    });
    expect(mocks.findNotificationPerson).not.toHaveBeenCalled();
  });

  it("treats an omitted event organisation as null when the delivery is unbound", async () => {
    mocks.findCurrentNotificationResource.mockResolvedValue({
      ...resource,
      organisationId: null,
    });
    await expect(
      evaluateCurrentNotificationReachAndPreference(tx, {
        ...delivery,
        organisationId: null,
        payload: {
          id: delivery.eventId,
          kind: delivery.eventKind,
          scope: { workspaceId: delivery.workspaceId },
          payload: { workItemId: "item-1" },
        },
      }),
    ).resolves.toMatchObject({ kind: "eligible" });
  });

  it("rejects an envelope project that differs from the resolved resource", async () => {
    await expect(
      evaluateCurrentNotificationReachAndPreference(tx, {
        ...delivery,
        payload: {
          id: delivery.eventId,
          kind: delivery.eventKind,
          scope: {
            workspaceId: delivery.workspaceId,
            organisationId: delivery.organisationId,
            projectId: "foreign-project",
          },
          payload: { workItemId: "item-1" },
        },
      }),
    ).resolves.toEqual({ kind: "suppress", reason: "resource_scope_changed" });
  });

  it("passes every supplied work-item identity to the canonical row resolver", async () => {
    const mapped = {
      ...delivery,
      payload: {
        id: delivery.eventId,
        kind: delivery.eventKind,
        scope: {
          workspaceId: delivery.workspaceId,
          organisationId: delivery.organisationId,
        },
        payload: { workItemId: "item-1", key: "OTHER-1" },
      },
    };
    await evaluateCurrentNotificationReachAndPreference(tx, mapped);
    expect(mocks.findCurrentNotificationResource).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        canonicalWorkItem: { id: "item-1", key: "OTHER-1" },
      }),
    );
  });

  it.each([
    ["work_item", "approval.requested", { approvalId: "item-1" }],
    ["approval", "work_item.assigned", { workItemId: "item-1" }],
    ["workspace", "work_item.assigned", { workItemId: "item-1" }],
  ])(
    "rejects unsupported resource/event pairing %s / %s",
    async (resourceType, eventKind, payload) => {
      await expect(
        evaluateCurrentNotificationReachAndPreference(tx, {
          ...delivery,
          resourceType,
          eventKind,
          payload: {
            id: delivery.eventId,
            kind: eventKind,
            scope: {
              workspaceId: delivery.workspaceId,
              organisationId: delivery.organisationId,
            },
            payload,
          },
        }),
      ).resolves.toEqual({
        kind: "suppress",
        reason: "resource_mapping_mismatch",
      });
      expect(mocks.findNotificationPerson).not.toHaveBeenCalled();
    },
  );

  it.each([
    ...[
      "work_item.assigned",
      "work_item.unassigned",
      "work_item.mentioned",
      "work_item.transitioned",
      "work_item.escalated",
      "work_item.due_soon",
      "work_item.overdue",
      "work_item.unblocked",
      "sla.at_risk",
      "sla.breached",
    ].map(
      (eventKind) =>
        ["work_item", eventKind, "item-1", { workItemId: "item-1" }] as const,
    ),
    ...["work_item.commented", "work_item.mentioned"].map(
      (eventKind) =>
        [
          "comment",
          eventKind,
          "comment-1",
          { commentId: "comment-1" },
        ] as const,
    ),
    [
      "workspace",
      "workspace.created",
      "workspace-1",
      { workspaceId: "workspace-1" },
    ] as const,
  ])(
    "accepts canonical %s event binding for %s",
    async (resourceType, eventKind, resourceId, payload) => {
      mocks.findCurrentNotificationResource.mockResolvedValue({
        ...resource,
        ...(resourceType === "workspace" ? { projectId: null } : {}),
      });
      await evaluateCurrentNotificationReachAndPreference(tx, {
        ...delivery,
        eventKind,
        resourceType,
        resourceId,
        payload: {
          id: delivery.eventId,
          kind: eventKind,
          scope: {
            workspaceId: delivery.workspaceId,
            organisationId: delivery.organisationId,
          },
          payload,
        },
      });
      expect(mocks.findCurrentNotificationResource).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ resourceType, resourceId, eventKind }),
      );
    },
  );

  it("rejects an event envelope with no workspace scope", async () => {
    await expect(
      evaluateCurrentNotificationReachAndPreference(tx, {
        ...delivery,
        payload: {
          id: delivery.eventId,
          kind: delivery.eventKind,
          payload: { workItemId: "item-1" },
        },
      }),
    ).resolves.toEqual({
      kind: "suppress",
      reason: "resource_mapping_mismatch",
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
        payload: {
          id: delivery.eventId,
          kind: "work_item.commented",
          scope: {
            workspaceId: delivery.workspaceId,
            organisationId: delivery.organisationId,
          },
          payload: { commentId: "comment-1" },
        },
        resourceType: "comment",
        resourceId: "comment-1",
      }),
    ).resolves.toEqual({
      kind: "suppress",
      reason: "resource_not_customer_visible",
    });
    expect(mocks.resolveNotificationPreference).not.toHaveBeenCalled();
  });

  it("binds a comment mention to its exact comment resource", async () => {
    const mapped = {
      ...delivery,
      eventKind: "work_item.mentioned",
      payload: {
        id: delivery.eventId,
        kind: "work_item.mentioned",
        scope: {
          workspaceId: delivery.workspaceId,
          organisationId: delivery.organisationId,
        },
        payload: { commentId: "comment-1" },
      },
      resourceType: "comment",
      resourceId: "comment-1",
    };
    await expect(
      evaluateCurrentNotificationReachAndPreference(tx, mapped),
    ).resolves.toMatchObject({ kind: "eligible" });
    await expect(
      evaluateCurrentNotificationReachAndPreference(tx, {
        ...mapped,
        resourceId: "another-comment",
      }),
    ).resolves.toEqual({
      kind: "suppress",
      reason: "resource_mapping_mismatch",
    });
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

describe("approval notification eligibility (S3, 0120-anchored)", () => {
  const approvalDelivery = (
    eventKind: string,
    recipientPersonId = "person-1",
  ) => ({
    ...delivery,
    recipientPersonId,
    eventKind,
    resourceType: "approval",
    resourceId: "approval-1",
    payload: {
      id: delivery.eventId,
      kind: eventKind,
      scope: {
        workspaceId: delivery.workspaceId,
        organisationId: delivery.organisationId,
      },
      payload: { approvalId: "approval-1" },
    },
  });
  const approval = {
    id: "approval-1",
    kind: "cab",
    state: "pending",
    requestedBy: "person-requester",
    approverId: "person-1",
    workItemId: "item-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    organisationId: "org-1",
    requesterId: null,
    customerVisibility: "organisation",
  };

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
    mocks.findCurrentNotificationResource.mockResolvedValue({
      ...resource,
      staffUrl: null,
    });
    mocks.findApprovalNotificationContext.mockResolvedValue(approval);
    mocks.isApprovalApproverStillValid.mockResolvedValue(true);
    mocks.listApprovalWatcherPersonIds.mockResolvedValue([]);
    mocks.reaches.mockReturnValue(true);
    mocks.can.mockReturnValue(true);
    mocks.resolveNotificationPreference.mockResolvedValue({ enabled: true });
  });

  it("passes every gate for the current, valid approver (no destination is registered yet)", async () => {
    await expect(
      evaluateCurrentNotificationReachAndPreference(
        tx,
        approvalDelivery("approval.requested"),
      ),
    ).resolves.toEqual({ kind: "destination_unresolved" });
    expect(mocks.findApprovalNotificationContext).toHaveBeenCalledWith(
      tx,
      "approval-1",
      "workspace-1",
    );
    expect(mocks.findCurrentNotificationResource).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ workspaceId: "workspace-1" }),
    );
  });

  it("suppresses a recipient who is not the addressed person", async () => {
    mocks.findApprovalNotificationContext.mockResolvedValue({
      ...approval,
      approverId: "someone-else",
    });
    await expect(
      evaluateCurrentNotificationReachAndPreference(
        tx,
        approvalDelivery("approval.requested"),
      ),
    ).resolves.toEqual({
      kind: "suppress",
      reason: "approval_not_addressed_to_recipient",
    });
  });

  it("suppresses a request or reminder once the approval is no longer pending", async () => {
    mocks.findApprovalNotificationContext.mockResolvedValue({
      ...approval,
      state: "approved",
    });
    for (const kind of ["approval.requested", "approval.expiring"]) {
      await expect(
        evaluateCurrentNotificationReachAndPreference(
          tx,
          approvalDelivery(kind),
        ),
      ).resolves.toEqual({ kind: "suppress", reason: "approval_not_pending" });
    }
  });

  it("suppresses when the named approver is no longer valid for the workspace", async () => {
    mocks.isApprovalApproverStillValid.mockResolvedValue(false);
    await expect(
      evaluateCurrentNotificationReachAndPreference(
        tx,
        approvalDelivery("approval.requested"),
      ),
    ).resolves.toEqual({
      kind: "suppress",
      reason: "approver_no_longer_valid",
    });
  });

  it("suppresses when the approval is gone or belongs to another workspace", async () => {
    mocks.findApprovalNotificationContext.mockResolvedValue(null);
    await expect(
      evaluateCurrentNotificationReachAndPreference(
        tx,
        approvalDelivery("approval.requested"),
      ),
    ).resolves.toEqual({ kind: "suppress", reason: "resource_unavailable" });
    mocks.findApprovalNotificationContext.mockResolvedValue({
      ...approval,
      workspaceId: "workspace-2",
    });
    await expect(
      evaluateCurrentNotificationReachAndPreference(
        tx,
        approvalDelivery("approval.requested"),
      ),
    ).resolves.toEqual({ kind: "suppress", reason: "resource_unavailable" });
  });

  it("notifies the requester of a decision and a staff watcher, and nobody else", async () => {
    const decided = (person: string) =>
      approvalDelivery("approval.decided", person);
    mocks.resolveIdentity.mockResolvedValue({
      personId: "person-requester",
      side: "staff",
    });
    await expect(
      evaluateCurrentNotificationReachAndPreference(
        tx,
        decided("person-requester"),
      ),
    ).resolves.toEqual({ kind: "destination_unresolved" });

    mocks.resolveIdentity.mockResolvedValue({
      personId: "watcher",
      side: "staff",
    });
    mocks.listApprovalWatcherPersonIds.mockResolvedValue([
      { personId: "watcher" },
    ]);
    await expect(
      evaluateCurrentNotificationReachAndPreference(tx, decided("watcher")),
    ).resolves.toEqual({ kind: "destination_unresolved" });

    mocks.resolveIdentity.mockResolvedValue({
      personId: "stranger",
      side: "staff",
    });
    await expect(
      evaluateCurrentNotificationReachAndPreference(tx, decided("stranger")),
    ).resolves.toEqual({
      kind: "suppress",
      reason: "approval_not_addressed_to_recipient",
    });
  });

  it("evaluates a customer approver's read authority at organisation scope", async () => {
    mocks.resolveIdentity.mockResolvedValue({
      personId: "person-1",
      side: "customer",
    });
    mocks.can.mockImplementation(
      (_identity: unknown, _capability: string, scope: string) =>
        scope === "organisation",
    );
    await expect(
      evaluateCurrentNotificationReachAndPreference(
        tx,
        approvalDelivery("approval.requested"),
      ),
    ).resolves.toEqual({ kind: "destination_unresolved" });
    expect(mocks.can).toHaveBeenCalledWith(
      expect.anything(),
      "work_item:read",
      "organisation",
      expect.objectContaining({ organisationId: "org-1" }),
    );
    mocks.can.mockReturnValue(false);
    await expect(
      evaluateCurrentNotificationReachAndPreference(
        tx,
        approvalDelivery("approval.requested"),
      ),
    ).resolves.toEqual({ kind: "suppress", reason: "read_authority_lost" });
  });
});
