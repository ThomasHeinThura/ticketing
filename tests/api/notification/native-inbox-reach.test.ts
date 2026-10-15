import { BUILT_IN_ROLES, type ResolvedIdentity } from "@taskdesk/permissions";
import { describe, expect, it } from "vitest";
import {
  canReadNativeInboxCandidate,
  type NativeInboxCandidate,
} from "../../../apps/api/src/notification/native-inbox-reach";
import type { CurrentNotificationResource } from "../../../apps/api/src/notification/repository";

const ids = {
  requester: "person-requester",
  participant: "person-participant",
  nonparticipant: "person-nonparticipant",
  servingOrganisation: "organisation-serving",
  foreignOrganisation: "organisation-foreign",
  project: "project-serving",
  workspace: "workspace-serving",
  workItem: "work-item-serving",
};

function customer(personId: string, organisationId = ids.servingOrganisation) {
  return {
    userId: `user-${personId}`,
    personId,
    side: "customer",
    organisationId,
    portal: "customer",
    credential: "session",
    memberships: [],
    teamIds: [],
    reach: { kind: "organisation", ids: [organisationId] },
    authority: [
      {
        roleKey: BUILT_IN_ROLES.customer.key,
        scope: BUILT_IN_ROLES.customer.scope,
        scopeId: organisationId,
        rank: BUILT_IN_ROLES.customer.rank,
        capabilities: BUILT_IN_ROLES.customer.capabilities,
      },
    ],
  } satisfies ResolvedIdentity;
}

function staff(
  options: {
    credential?: "session" | "api_key";
    keyCapabilities?: readonly string[];
  } = {},
) {
  return {
    userId: "staff-user",
    personId: "staff-person",
    side: "staff",
    organisationId: "internal-organisation",
    portal: "agent",
    credential: options.credential ?? "session",
    memberships: [{ scope: "project", scopeId: ids.project, seesAll: false }],
    teamIds: [],
    reach: { kind: "membership" },
    authority: [
      {
        roleKey: "test-project-reader",
        scope: "project",
        scopeId: ids.project,
        rank: 1,
        capabilities: ["work_item:read"],
      },
    ],
    ...(options.keyCapabilities === undefined
      ? {}
      : { keyCapabilities: options.keyCapabilities }),
  } satisfies ResolvedIdentity;
}

function candidate(
  personId: string,
  overrides: Partial<NativeInboxCandidate> = {},
): NativeInboxCandidate {
  return {
    userId: `user-${personId}`,
    personId,
    resourceType: "work_item",
    resourceId: ids.workItem,
    kind: "work_item.assigned",
    ...overrides,
  };
}

function resource(
  overrides: Partial<CurrentNotificationResource> = {},
): CurrentNotificationResource {
  return {
    workItemId: ids.workItem,
    workspaceId: ids.workspace,
    projectId: ids.project,
    organisationId: ids.servingOrganisation,
    visibleToPersonIds: null,
    customerVisible: true,
    staffUrl: null,
    ...overrides,
  };
}

describe("native inbox current reach", () => {
  it("admits a customer with canonical organisation read authority and current serving-org reach", () => {
    expect(
      canReadNativeInboxCandidate(
        customer(ids.requester),
        candidate(ids.requester),
        resource(),
      ),
    ).toBe(true);
    expect(
      canReadNativeInboxCandidate(
        customer(ids.requester, ids.foreignOrganisation),
        candidate(ids.requester),
        resource(),
      ),
    ).toBe(false);
    expect(
      canReadNativeInboxCandidate(
        customer(ids.requester),
        candidate(ids.requester),
        resource({ organisationId: null }),
      ),
    ).toBe(false);
    expect(
      canReadNativeInboxCandidate(
        { ...customer(ids.requester), authority: [] },
        candidate(ids.requester),
        resource(),
      ),
    ).toBe(false);
  });

  it("keeps private requester/participant audience and public-comment checks", () => {
    const privateResource = resource({
      visibleToPersonIds: [ids.requester, ids.participant],
    });
    expect(
      canReadNativeInboxCandidate(
        customer(ids.requester),
        candidate(ids.requester),
        privateResource,
      ),
    ).toBe(true);
    expect(
      canReadNativeInboxCandidate(
        customer(ids.participant),
        candidate(ids.participant),
        privateResource,
      ),
    ).toBe(true);
    expect(
      canReadNativeInboxCandidate(
        customer(ids.nonparticipant),
        candidate(ids.nonparticipant),
        privateResource,
      ),
    ).toBe(false);
    expect(
      canReadNativeInboxCandidate(
        customer(ids.requester),
        candidate(ids.requester, {
          resourceType: "comment",
          kind: "work_item.mentioned",
        }),
        resource({ customerVisible: false }),
      ),
    ).toBe(false);
  });

  it("fails closed for absent identity, absent resource, unsupported events, and person mismatch", () => {
    const identity = customer(ids.requester);
    expect(
      canReadNativeInboxCandidate(null, candidate(ids.requester), resource()),
    ).toBe(false);
    expect(
      canReadNativeInboxCandidate(
        identity,
        candidate(ids.requester),
        undefined,
      ),
    ).toBe(false);
    expect(
      canReadNativeInboxCandidate(
        identity,
        candidate(ids.requester, { kind: "unknown.event" }),
        resource(),
      ),
    ).toBe(false);
    expect(
      canReadNativeInboxCandidate(
        identity,
        candidate(ids.participant),
        resource(),
      ),
    ).toBe(false);
  });

  it("keeps staff work-item authority and API-key subset clamping", () => {
    expect(
      canReadNativeInboxCandidate(
        staff(),
        candidate("staff-person"),
        resource({ organisationId: null }),
      ),
    ).toBe(true);
    expect(
      canReadNativeInboxCandidate(
        staff({ credential: "api_key", keyCapabilities: ["work_item:read"] }),
        candidate("staff-person"),
        resource({ organisationId: null }),
      ),
    ).toBe(true);
    expect(
      canReadNativeInboxCandidate(
        staff({ credential: "api_key", keyCapabilities: [] }),
        candidate("staff-person"),
        resource({ organisationId: null }),
      ),
    ).toBe(false);
  });
});
