import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { state } = vi.hoisted(() => ({
  state: { lookedUpIds: [] as string[], handlerReached: false },
}));

// Keyed by id, not by resource type: every `workspaceAccess.*` "lookup" source runs the
// same shape of `select().from().innerJoin(...).where(eq(<table>.id, id)).limit(1)` query
// (see the mock below), so one id -> workspaceId map serves every resource (task, label,
// time entry, activity/comment, column, workflow rule) the 8 helpers under test resolve.
const WORKSPACE_BY_TASK: Record<string, string> = {
  "task-in-my-workspace": "workspace-mine",
  "task-in-other-workspace": "workspace-theirs",
  "label-in-my-workspace": "workspace-mine",
  "time-entry-in-my-workspace": "workspace-mine",
  "activity-in-my-workspace": "workspace-mine",
  "comment-in-my-workspace": "workspace-mine",
  "column-in-my-workspace": "workspace-mine",
  "workflow-rule-in-my-workspace": "workspace-mine",
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
// "workspaceId" }]`-shaped helpers (issue #256 has since removed the second, `query`
// source from all 8 -- this app still exercises the NUL check on the single remaining
// `lookup` source).
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

// Generic app builder for the "nonexistent row + ?workspaceId=<mine> is 404, handler
// never reached" case, parameterised over which of the 8 helpers is under test and the
// path-param key its default `idKey` reads.
function buildLookupApp(
  middleware: ReturnType<typeof workspaceAccess.fromTask>,
  idKey: string,
) {
  return new Hono<{ Variables: { userId: string } }>()
    .use("*", async (c, next) => {
      c.set("userId", "user-1");
      return next();
    })
    .get(`/:${idKey}`, middleware, async (c) => {
      state.handlerReached = true;
      return c.json({ actedOn: c.req.param(idKey) });
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

  it("issue #256: a well-formed lookup id that resolves to no row is a clean 404, never a fall-through to ?workspaceId=", async () => {
    const res = await buildTaskApp().request(
      "/task/task-does-not-exist?workspaceId=workspace-mine",
    );

    // Pins current (fixed) behaviour: the id resolves to no row (a real "absent"
    // case, not a NUL byte). Before #256 this fell through to the caller-supplied
    // `?workspaceId=` and reached the handler against that workspace -- exactly the
    // defect #256 reports. Now it 404s directly from the middleware, and the query
    // parameter is never consulted at all.
    expect(res.status).toBe(404);
    expect(state.handlerReached).toBe(false);
  });

  // One test per #256 helper: a nonexistent row id, plus a caller-supplied
  // `?workspaceId=` naming the caller's OWN real workspace (the strongest case for the
  // fallback -- it isn't even a foreign workspace), still 404s without reaching the
  // handler. Mutation-checked: restoring the removed `{ type: "query", key:
  // "workspaceId" }` source to any one of these factories makes its own case here fail
  // (200, handler reached) while leaving the others green.
  describe("issue #256: no eight helpers fall back to ?workspaceId= on a failed lookup", () => {
    it.each([
      ["fromTask", () => workspaceAccess.fromTask(), "id"],
      ["fromTaskId", () => workspaceAccess.fromTaskId(), "taskId"],
      ["fromLabel", () => workspaceAccess.fromLabel(), "id"],
      ["fromTimeEntry", () => workspaceAccess.fromTimeEntry(), "id"],
      ["fromActivity", () => workspaceAccess.fromActivity(), "id"],
      ["fromComment", () => workspaceAccess.fromComment(), "id"],
      ["fromColumn", () => workspaceAccess.fromColumn(), "id"],
      ["fromWorkflowRule", () => workspaceAccess.fromWorkflowRule(), "id"],
    ] as const)(
      "%s: nonexistent id + ?workspaceId=<mine> is 404, handler not reached",
      async (_name, factory, idKey) => {
        const res = await buildLookupApp(factory(), idKey).request(
          "/does-not-exist?workspaceId=workspace-mine",
        );

        expect(res.status).toBe(404);
        expect(state.handlerReached).toBe(false);
      },
    );
  });
});
