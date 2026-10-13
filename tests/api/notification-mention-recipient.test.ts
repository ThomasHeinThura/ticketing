import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveIdentity: vi.fn(),
  findNotificationPerson: vi.fn(),
  findCurrentNotificationResource: vi.fn(),
}));

vi.mock("../../apps/api/src/permissions/resolve-identity", () => ({
  resolveIdentity: mocks.resolveIdentity,
}));
vi.mock("../../apps/api/src/notification/repository", () => ({
  findNotificationPerson: mocks.findNotificationPerson,
  findCurrentNotificationResource: mocks.findCurrentNotificationResource,
}));

import type { ResolvedIdentity } from "@taskdesk/permissions";
import type {
  DbTransaction,
  DomainEventEnvelope,
} from "../../apps/api/src/events/outbox";
import { resolveMentionEventRecipient } from "../../apps/api/src/notification/recipient-resolvers";

const tx = {} as DbTransaction;

function mentionEvent(
  personId: string,
): DomainEventEnvelope<Record<string, unknown>> {
  return {
    id: "event-1",
    kind: "work_item.mentioned",
    occurredAt: "2026-10-12T00:00:00.000Z",
    actor: { type: "person", id: "author-user", name: "Author" },
    scope: {
      workspaceId: "workspace-1",
      organisationId: "organisation-1",
      projectId: "project-1",
    },
    payload: {
      commentId: "comment-1",
      key: "SUP-1",
      mentionedPersonId: personId,
      workItemId: "item-1",
    },
    causationId: null,
    depth: 0,
    originAutomationId: null,
  };
}

function identity(input: {
  personId: string;
  userId: string;
  side: "staff" | "customer";
  memberships: ResolvedIdentity["memberships"];
  reach: ResolvedIdentity["reach"];
}): ResolvedIdentity {
  return {
    ...input,
    organisationId: "organisation-1",
    portal: input.side === "customer" ? "customer" : "agent",
    credential: "session",
    teamIds: [],
    authority: [],
  };
}

const privateResource = {
  workspaceId: "workspace-1",
  projectId: "project-1",
  organisationId: "organisation-1",
  visibleToPersonIds: ["requester-person", "participant-person"],
  customerVisible: true,
  staffUrl: null,
};

describe("native mention recipient reach", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.findNotificationPerson.mockResolvedValue({
      userId: "recipient-user",
      side: "staff",
      active: true,
      quietHoursStart: null,
      quietHoursEnd: null,
      quietHoursTimezone: null,
    });
    mocks.findCurrentNotificationResource.mockResolvedValue(privateResource);
  });

  it("keeps reachable staff mentions eligible on a private-customer-visibility item", async () => {
    mocks.resolveIdentity.mockResolvedValue(
      identity({
        personId: "staff-recipient",
        userId: "recipient-user",
        side: "staff",
        memberships: [
          { scope: "project", scopeId: "project-1", seesAll: false },
        ],
        reach: { kind: "membership" },
      }),
    );

    await expect(
      resolveMentionEventRecipient(tx, mentionEvent("staff-recipient")),
    ).resolves.toMatchObject([
      {
        personId: "staff-recipient",
        resourceType: "comment",
        resourceId: "comment-1",
      },
    ]);
  });

  it("retains the private audience boundary for customers outside the audience", async () => {
    mocks.findNotificationPerson.mockResolvedValue({
      userId: "customer-user",
      side: "customer",
      active: true,
      quietHoursStart: null,
      quietHoursEnd: null,
      quietHoursTimezone: null,
    });
    mocks.resolveIdentity.mockResolvedValue(
      identity({
        personId: "outside-customer",
        userId: "customer-user",
        side: "customer",
        memberships: [],
        reach: { kind: "organisation", ids: ["organisation-1"] },
      }),
    );

    await expect(
      resolveMentionEventRecipient(tx, mentionEvent("outside-customer")),
    ).resolves.toEqual([]);
  });

  it("suppresses a staff mention after current project reach is lost", async () => {
    mocks.resolveIdentity.mockResolvedValue(
      identity({
        personId: "staff-recipient",
        userId: "recipient-user",
        side: "staff",
        memberships: [],
        reach: { kind: "membership" },
      }),
    );

    await expect(
      resolveMentionEventRecipient(tx, mentionEvent("staff-recipient")),
    ).resolves.toEqual([]);
  });
});
