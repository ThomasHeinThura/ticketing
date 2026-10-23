import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  resolveIdentity: vi.fn(),
  findNotificationPerson: vi.fn(),
  findCurrentNotificationResource: vi.fn(),
  listWorkItemWatchers: vi.fn(),
}));

vi.mock("../../../apps/api/src/permissions/resolve-identity", () => ({
  resolveIdentity: mocks.resolveIdentity,
}));
vi.mock("../../../apps/api/src/notification/repository", () => ({
  findNotificationPerson: mocks.findNotificationPerson,
  findCurrentNotificationResource: mocks.findCurrentNotificationResource,
  listWorkItemWatchers: mocks.listWorkItemWatchers,
}));

import type { ResolvedIdentity } from "@taskdesk/permissions";
import type {
  DbTransaction,
  DomainEventEnvelope,
} from "../../../apps/api/src/events/outbox";
import {
  planWorkItemRecipients,
  resolveWorkItemEventRecipients,
} from "../../../apps/api/src/notification/work-item-recipients";

describe("planWorkItemRecipients (AS-3/16/17/18, WI-28/29)", () => {
  const base = {
    assigneeId: null,
    previousAssigneeId: null,
    watchers: [],
    actorPersonId: null,
  } as const;

  it("AS-16: assigned notifies the new assignee", () => {
    expect(
      planWorkItemRecipients({
        ...base,
        kind: "work_item.assigned",
        assigneeId: "new",
      }),
    ).toEqual([{ personId: "new", role: "assignee" }]);
  });

  it("CP-7: an escalation notifies the assignee and unmuted watchers, never the actor", () => {
    expect(
      planWorkItemRecipients({
        ...base,
        kind: "work_item.escalated",
        assigneeId: "assignee",
        watchers: [
          { personId: "w1", muted: false },
          { personId: "w2", muted: true },
          { personId: "actor", muted: false },
        ],
        actorPersonId: "actor",
      }),
    ).toEqual([
      { personId: "assignee", role: "assignee" },
      { personId: "w1", role: "watcher" },
    ]);
  });

  it("AS-3: a reassignment also notifies the previous holder", () => {
    expect(
      planWorkItemRecipients({
        ...base,
        kind: "work_item.assigned",
        assigneeId: "new",
        previousAssigneeId: "old",
      }),
    ).toEqual([
      { personId: "new", role: "assignee" },
      { personId: "old", role: "previous_assignee" },
    ]);
  });

  it("AS-17: unassigned notifies the previous assignee", () => {
    expect(
      planWorkItemRecipients({
        ...base,
        kind: "work_item.unassigned",
        previousAssigneeId: "old",
      }),
    ).toEqual([{ personId: "old", role: "previous_assignee" }]);
  });

  it("AS-18: the actor is never notified, assigning or unassigning themselves", () => {
    expect(
      planWorkItemRecipients({
        ...base,
        kind: "work_item.assigned",
        assigneeId: "me",
        actorPersonId: "me",
      }),
    ).toEqual([]);
    expect(
      planWorkItemRecipients({
        ...base,
        kind: "work_item.unassigned",
        previousAssigneeId: "me",
        actorPersonId: "me",
      }),
    ).toEqual([]);
    // A watcher who is the actor is dropped too.
    expect(
      planWorkItemRecipients({
        ...base,
        kind: "work_item.assigned",
        assigneeId: "new",
        watchers: [{ personId: "me", muted: false }],
        actorPersonId: "me",
      }),
    ).toEqual([{ personId: "new", role: "assignee" }]);
  });

  it("WI-28/29: unmuted watchers are told, muted ones are not, one entry per person", () => {
    expect(
      planWorkItemRecipients({
        ...base,
        kind: "work_item.assigned",
        assigneeId: "new",
        watchers: [
          { personId: "new", muted: false },
          { personId: "watch", muted: false },
          { personId: "quiet", muted: true },
        ],
      }),
    ).toEqual([
      { personId: "new", role: "assignee" },
      { personId: "watch", role: "watcher" },
    ]);
  });

  it("a muted watcher row does not silence a direct assignee notification", () => {
    expect(
      planWorkItemRecipients({
        ...base,
        kind: "work_item.assigned",
        assigneeId: "new",
        watchers: [{ personId: "new", muted: true }],
      }),
    ).toEqual([{ personId: "new", role: "assignee" }]);
  });

  it("a state change goes to unmuted watchers only", () => {
    expect(
      planWorkItemRecipients({
        ...base,
        kind: "work_item.transitioned",
        assigneeId: "assignee",
        previousAssigneeId: "old",
        watchers: [
          { personId: "watch", muted: false },
          { personId: "quiet", muted: true },
        ],
      }),
    ).toEqual([{ personId: "watch", role: "watcher" }]);
  });
});

const tx = { execute: mocks.execute } as unknown as DbTransaction;

function event(
  kind: string,
  payload: Record<string, unknown>,
): DomainEventEnvelope<Record<string, unknown>> {
  return {
    id: "event-1",
    kind,
    occurredAt: "2026-10-23T00:00:00.000Z",
    actor: { type: "person", id: "actor-user", name: "Actor" },
    scope: {
      workspaceId: "workspace-1",
      projectId: "project-1",
    },
    payload: { workItemId: "item-1", key: "SUP-1", ...payload },
    causationId: null,
    depth: 0,
    originAutomationId: null,
  };
}

function staffIdentity(personId: string, userId: string): ResolvedIdentity {
  return {
    personId,
    userId,
    side: "staff",
    organisationId: "organisation-1",
    portal: "agent",
    credential: "session",
    memberships: [{ scope: "project", scopeId: "project-1", seesAll: false }],
    teamIds: [],
    reach: { kind: "membership" },
    authority: [
      {
        roleKey: "test-project-reader",
        scope: "project",
        scopeId: "project-1",
        rank: 1,
        capabilities: ["work_item:read"],
      },
    ],
  } satisfies ResolvedIdentity;
}

function customerIdentity(personId: string, userId: string): ResolvedIdentity {
  return {
    personId,
    userId,
    side: "customer",
    organisationId: "organisation-1",
    portal: "customer",
    credential: "session",
    memberships: [],
    teamIds: [],
    reach: { kind: "organisation", ids: ["organisation-1"] },
    authority: [],
  } satisfies ResolvedIdentity;
}

describe("resolveWorkItemEventRecipients", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.execute.mockResolvedValue({ rows: [] });
    mocks.listWorkItemWatchers.mockResolvedValue([]);
    mocks.findCurrentNotificationResource.mockResolvedValue({
      workItemId: "item-1",
      workspaceId: "workspace-1",
      projectId: "project-1",
      organisationId: "organisation-1",
      visibleToPersonIds: null,
      customerVisible: true,
      staffUrl: null,
    });
  });

  it("ignores events of other kinds and malformed payloads without reading anything", async () => {
    expect(
      await resolveWorkItemEventRecipients(tx, event("work_item.updated", {})),
    ).toEqual([]);
    expect(
      await resolveWorkItemEventRecipients(
        tx,
        event("work_item.assigned", { workItemId: "", assigneeId: "p1" }),
      ),
    ).toEqual([]);
    expect(mocks.listWorkItemWatchers).not.toHaveBeenCalled();
  });

  it("AS-18: drops a recipient whose linked user is the acting user, even when the plan names them", async () => {
    mocks.findNotificationPerson.mockResolvedValue({
      userId: "actor-user",
      side: "staff",
      active: true,
    });
    expect(
      await resolveWorkItemEventRecipients(
        tx,
        event("work_item.assigned", { assigneeId: "actor-person" }),
      ),
    ).toEqual([]);
    expect(mocks.resolveIdentity).not.toHaveBeenCalled();
  });

  it("drops an inactive or login-less recipient and never invents an inbox principal", async () => {
    mocks.findNotificationPerson.mockResolvedValueOnce({
      userId: "u1",
      side: "staff",
      active: false,
    });
    mocks.findNotificationPerson.mockResolvedValueOnce({
      userId: null,
      side: "staff",
      active: true,
    });
    expect(
      await resolveWorkItemEventRecipients(
        tx,
        event("work_item.assigned", {
          assigneeId: "inactive",
          previousAssigneeId: "placeholder",
        }),
      ),
    ).toEqual([]);
  });

  it("drops a recipient whose identity does not resolve to the planned person", async () => {
    mocks.findNotificationPerson.mockResolvedValue({
      userId: "u1",
      side: "staff",
      active: true,
    });
    mocks.resolveIdentity.mockResolvedValue(
      staffIdentity("someone-else", "u1"),
    );
    expect(
      await resolveWorkItemEventRecipients(
        tx,
        event("work_item.assigned", { assigneeId: "p1" }),
      ),
    ).toEqual([]);
  });

  it("WI-28: skips a muted watcher and reads the watcher list for the event's own work item", async () => {
    mocks.listWorkItemWatchers.mockResolvedValue([
      { personId: "quiet", muted: true },
    ]);
    expect(
      await resolveWorkItemEventRecipients(
        tx,
        event("work_item.transitioned", {}),
      ),
    ).toEqual([]);
    expect(mocks.listWorkItemWatchers).toHaveBeenCalledWith(tx, "item-1");
    expect(mocks.findNotificationPerson).not.toHaveBeenCalled();
  });

  it("returns nothing when the work item is no longer readable (no resource)", async () => {
    mocks.findCurrentNotificationResource.mockResolvedValue(null);
    expect(
      await resolveWorkItemEventRecipients(
        tx,
        event("work_item.assigned", { assigneeId: "p1" }),
      ),
    ).toEqual([]);
    expect(mocks.findNotificationPerson).not.toHaveBeenCalled();
  });

  it("AS-16: produces an inbox candidate for a reachable assignee, with the work item as the resource", async () => {
    mocks.findNotificationPerson.mockResolvedValue({
      userId: "u1",
      side: "staff",
      active: true,
    });
    mocks.resolveIdentity.mockResolvedValue(staffIdentity("p1", "u1"));
    const candidates = await resolveWorkItemEventRecipients(
      tx,
      event("work_item.assigned", { assigneeId: "p1" }),
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      personId: "p1",
      resourceType: "work_item",
      resourceId: "item-1",
      title: "Assigned to you",
    });
  });

  it("AS-3: the previous holder of a reassignment is told they lost the item", async () => {
    mocks.findNotificationPerson.mockImplementation(
      async (_tx, id: string) => ({
        userId: `u-${id}`,
        side: "staff",
        active: true,
      }),
    );
    mocks.resolveIdentity.mockImplementation(
      async (input: { userId: string }) =>
        staffIdentity(input.userId.slice(2), input.userId),
    );
    const candidates = await resolveWorkItemEventRecipients(
      tx,
      event("work_item.assigned", {
        assigneeId: "new",
        previousAssigneeId: "old",
      }),
    );
    expect(candidates.map((c) => [c.personId, c.title])).toEqual([
      ["new", "Assigned to you"],
      ["old", "Reassigned"],
    ]);
  });

  it("NO-19: a customer-side watcher is never told about an assignment", async () => {
    mocks.listWorkItemWatchers.mockResolvedValue([
      { personId: "customer", muted: false },
    ]);
    mocks.findNotificationPerson.mockResolvedValue({
      userId: "uc",
      side: "customer",
      active: true,
    });
    mocks.resolveIdentity.mockResolvedValue(customerIdentity("customer", "uc"));
    expect(
      await resolveWorkItemEventRecipients(
        tx,
        event("work_item.assigned", { assigneeId: "someone" }),
      ),
    ).toEqual([]);
  });
});
