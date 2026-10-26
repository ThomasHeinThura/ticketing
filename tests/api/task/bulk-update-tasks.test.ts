import { describe, expect, it } from "vitest";
import { resolveIdentityFromFacts } from "../../../apps/api/src/permissions/resolve-identity";
import bulkUpdateTasks from "../../../apps/api/src/task/controllers/bulk-update-tasks";

const identity = resolveIdentityFromFacts({
  userId: "some-user-id",
  person: {
    personId: "some-person-id",
    organisationId: "internal-organisation-id",
    side: "staff",
    active: true,
    organisationActive: true,
    organisationPortalAccess: true,
    organisationDeleted: false,
  },
  banned: false,
  isInstanceAdmin: false,
  workspaceMemberships: [],
  teamMemberships: [],
  credential: "session",
});
if (!identity) throw new Error("expected resolved unit-test identity");

// S6 (Opus review of PR #307, delta round): `bulkUpdateTasks` takes `workspaceId`
// from its one caller's `c.get("workspaceId")`, set by `workspaceAccess.fromTasks()`.
// That is true of every route wired up today, but it is an invariant of the ROUTE,
// not of this function's own signature -- a future re-mount without `fromTasks()`
// would otherwise pass `undefined`/`""` straight into an `eq(...)` filter and rely on
// the ORM matching no row to fail closed as a 404, which is correct by accident. This
// proves the function itself fails loudly (500) before touching the database at all,
// rather than trusting the caller.
describe("issue #307 S6: bulkUpdateTasks fails closed when workspaceId is falsy", () => {
  it("throws 500 for an empty workspaceId, before any database access", async () => {
    await expect(
      bulkUpdateTasks({
        identity,
        taskIds: ["some-task-id"],
        operation: "delete",
        userId: "some-user-id",
        // Deliberately the falsy value a missing/broken middleware would produce --
        // cast because the real call site's type is `string`, not `string | ""`.
        workspaceId: "" as string,
        // Deny-all stand-in for the route's reach context: the call must fail on the
        // workspace invariant before it is ever consulted.
        reach: {
          identity: null,
          reaches: async () => false,
          can: async () => false,
          reachableProjectIds: async () => [],
          projectFactsFor: async () => [],
        },
      }),
    ).rejects.toMatchObject({ status: 500 });
  });

  it("refuses operation delete with 410 and never reaches the database (PA-1)", async () => {
    await expect(
      bulkUpdateTasks({
        identity,
        taskIds: ["some-task-id"],
        operation: "delete",
        userId: "some-user-id",
        workspaceId: "some-workspace-id",
        reach: {
          identity: null,
          reaches: async () => true,
          can: async () => true,
          reachableProjectIds: async () => [],
          projectFactsFor: async () => [],
        },
      }),
    ).rejects.toMatchObject({ status: 410 });
  });

  it("throws 500 when the route's reach context is missing, before any database access", async () => {
    await expect(
      bulkUpdateTasks({
        identity,
        taskIds: ["some-task-id"],
        operation: "delete",
        userId: "some-user-id",
        workspaceId: "some-workspace-id",
        reach: undefined as never,
      }),
    ).rejects.toMatchObject({ status: 500 });
  });
});
