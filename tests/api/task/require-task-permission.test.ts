import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveIdentityFromFacts } from "../../../apps/api/src/permissions/resolve-identity";

const { state } = vi.hoisted(() => ({
  state: {
    queried: false,
    nextCalled: false,
    resolveCallerIdentity: vi.fn(),
  },
}));

const identity = resolveIdentityFromFacts({
  userId: "user-1",
  person: {
    personId: "person-1",
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

vi.mock("../../../apps/api/src/utils/has-project-reach", () => ({
  resolveCallerIdentity: state.resolveCallerIdentity,
}));

vi.mock("../../../apps/api/src/database", () => {
  const chain = {
    select: () => chain,
    from: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    limit: async () => {
      state.queried = true;
      return [];
    },
  };
  return { default: chain, schema: {} };
});

const { requireTaskAssigneePermission } = await import(
  "../../../apps/api/src/task/controllers/require-task-permission"
);

// #281 sweep: `requireTaskAssigneePermission` reads its `id` path param directly and
// feeds it into a raw `eq(taskTable.id, id)` query -- unvalidated, a NUL byte would
// reach Postgres and throw. It is always paired with `workspaceAccess.fromTask()` on
// its one real route (`PUT /api/task/{id}`, `task/index.ts`), which already rejects a
// NUL-bearing `id` before this middleware ever runs -- so this is defense-in-depth,
// not a currently reachable live route, but the guard is tested standalone in case
// that pairing ever changes.
function buildApp() {
  return new Hono<{ Variables: { userId: string } }>()
    .use("*", async (c, next) => {
      c.set("userId", "user-1");
      return next();
    })
    .put("/task/:id", requireTaskAssigneePermission, async (c) => {
      state.nextCalled = true;
      return c.json({ ok: true });
    });
}

describe("requireTaskAssigneePermission", () => {
  beforeEach(() => {
    state.queried = false;
    state.nextCalled = false;
    state.resolveCallerIdentity.mockReset().mockResolvedValue(identity);
  });

  it("#281 sweep: a NUL byte in the id path param is an immediate 400, never reaching the DB query or the handler", async () => {
    const res = await buildApp().request(
      `/task/${encodeURIComponent("\u0000x")}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      },
    );

    expect(res.status).toBe(400);
    expect(state.queried).toBe(false);
    expect(state.nextCalled).toBe(false);
    expect(state.resolveCallerIdentity).not.toHaveBeenCalled();
  });

  it("a well-formed id with no assignee change reaches the handler", async () => {
    const res = await buildApp().request("/task/task-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    expect(state.queried).toBe(true);
    expect(state.nextCalled).toBe(true);
    expect(state.resolveCallerIdentity).toHaveBeenCalledOnce();
    expect(state.resolveCallerIdentity).toHaveBeenCalledWith(
      expect.any(Object),
      "user-1",
    );
  });
});
