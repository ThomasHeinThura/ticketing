import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { state } = vi.hoisted(() => ({
  state: { lookedUpIds: [] as string[], handlerReached: false },
}));

const WORKSPACE_BY_TASK: Record<string, string> = {
  "task-in-my-workspace": "workspace-mine",
  "task-in-other-workspace": "workspace-theirs",
};

vi.mock("../../../apps/api/src/database", async () => {
  const schema = await import("../../../apps/api/src/database/schema");
  const { PgDialect } = await import("drizzle-orm/pg-core");

  // `sqlToQuery` is the dialect method drizzle's own `.toSQL()` is built on, so
  // the bound parameters come back through a supported surface rather than by
  // reaching into the condition object's internals.
  const dialect = new PgDialect();
  let boundId: string | undefined;

  const chain = {
    select: () => chain,
    from: () => chain,
    innerJoin: () => chain,
    where: (condition: Parameters<typeof dialect.sqlToQuery>[0]) => {
      // The `task` lookup filters on a single id; joins contribute no
      // parameters because they compare two columns.
      const [id] = dialect.sqlToQuery(condition).params;
      boundId = typeof id === "string" ? id : undefined;
      return chain;
    },
    limit: async () => {
      if (!boundId) {
        return [];
      }
      state.lookedUpIds.push(boundId);
      const workspaceId = WORKSPACE_BY_TASK[boundId];
      return workspaceId ? [{ workspaceId }] : [];
    },
  };

  return { default: chain, schema };
});

vi.mock("../../../apps/api/src/utils/validate-workspace-access", async () => {
  const { HTTPException } = await import("hono/http-exception");
  return {
    validateWorkspaceAccess: async (_userId: string, workspaceId: string) => {
      if (workspaceId !== "workspace-mine") {
        throw new HTTPException(403, {
          message: "You don't have access to this workspace",
        });
      }
    },
  };
});

const { workspaceAccess } = await import(
  "../../../apps/api/src/utils/workspace-access-middleware"
);

// Mirrors POST /api/activity/comment: there is no `taskId` path param, the id
// travels in the JSON body, and the handler acts on that body value.
function buildApp() {
  return new Hono<{ Variables: { userId: string } }>()
    .use("*", async (c, next) => {
      c.set("userId", "user-1");
      return next();
    })
    .post("/comment", workspaceAccess.fromTaskId(), async (c) => {
      const body = (await c.req.json()) as { taskId: string };
      return c.json({ actedOn: body.taskId });
    });
}

function post(query: string, body: Record<string, unknown>) {
  return buildApp().request(`/comment${query}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// `fromTask` is one of the 8 `[{ type: "lookup" }, { type: "query", key:
// "workspaceId" }]`-shaped helpers -- a NUL-bearing path-param id must never fall
// through to the `?workspaceId=` source that follows it in the same list.
function buildTaskApp() {
  return new Hono<{ Variables: { userId: string } }>()
    .use("*", async (c, next) => {
      c.set("userId", "user-1");
      return next();
    })
    .get("/task/:id", workspaceAccess.fromTask(), async (c) => {
      state.handlerReached = true;
      return c.json({ actedOn: c.req.param("id") });
    });
}

describe("workspaceAccess lookup sources", () => {
  beforeEach(() => {
    state.lookedUpIds.length = 0;
    state.handlerReached = false;
  });

  it("authorizes against the body id the handler will act on", async () => {
    const res = await post("", { taskId: "task-in-my-workspace" });

    expect(res.status).toBe(200);
    expect(state.lookedUpIds).toEqual(["task-in-my-workspace"]);
  });

  it("rejects a body id in a workspace the caller cannot access", async () => {
    const res = await post("", { taskId: "task-in-other-workspace" });

    expect(res.status).toBe(403);
    expect(state.lookedUpIds).toEqual(["task-in-other-workspace"]);
  });

  it("does not let a query id override the body id the handler acts on", async () => {
    const res = await post("?taskId=task-in-my-workspace", {
      taskId: "task-in-other-workspace",
    });

    expect(state.lookedUpIds).toEqual(["task-in-other-workspace"]);
    expect(res.status).toBe(403);
  });

  it("T4 follow-up (ordinary review of the #271 delta-round PR): a NUL byte in the lookup id is an immediate 400, never a fall-through to the caller-supplied ?workspaceId=, and never reaches the handler", async () => {
    const res = await buildTaskApp().request(
      `/task/${encodeURIComponent("\u0000x")}?workspaceId=workspace-mine`,
    );

    expect(res.status).toBe(400);
    expect(state.handlerReached).toBe(false);
    // Never even reached `lookupWorkspaceId` -- the NUL byte is rejected before the
    // DB lookup, not merely treated as "not found".
    expect(state.lookedUpIds).toEqual([]);
  });

  it("a well-formed lookup id still falls through to ?workspaceId= exactly as before, once it's genuinely absent", async () => {
    const res = await buildTaskApp().request(
      "/task/task-does-not-exist?workspaceId=workspace-mine",
    );

    // The id resolves to no row (a real "absent" case, not a NUL byte), so this
    // still legitimately falls through to the query fallback and succeeds against
    // the caller's own workspace -- proving the NUL fix didn't remove the
    // fallback for the case it's actually meant for.
    expect(res.status).toBe(200);
    expect(state.handlerReached).toBe(true);
  });
});
