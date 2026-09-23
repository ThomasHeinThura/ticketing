import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { state } = vi.hoisted(() => ({
  state: { queried: false, nextCalled: false },
}));

vi.mock("../../../apps/api/src/database", () => {
  const chain = {
    select: () => chain,
    from: () => chain,
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
  });
});
