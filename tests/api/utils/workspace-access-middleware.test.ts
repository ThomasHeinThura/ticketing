import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { rejectNulByte } from "../../../apps/api/src/utils/reject-nul-byte";

const { state } = vi.hoisted(() => ({
  state: {
    lookedUpIds: [] as string[],
    lookupPredicates: [] as string[],
    handlerReached: false,
  },
}));

// Keyed by id, not by resource type: every `workspaceAccess.*` "lookup" source runs the
// same shape of `select().from().innerJoin(...).where(eq(<table>.id, id)).limit(1)` query
// (see the mock below), so one id -> workspaceId map serves every resource (task, label,
// time entry, activity/comment, column, workflow rule) the 8 helpers under test resolve.
const WORKSPACE_BY_TASK: Record<string, string> = {
  "task-in-my-workspace": "workspace-mine",
  "task-in-other-workspace": "workspace-theirs",
  "label-in-my-workspace": "workspace-mine",
  "label-in-other-workspace": "workspace-theirs",
  "time-entry-in-my-workspace": "workspace-mine",
  "time-entry-in-other-workspace": "workspace-theirs",
  "activity-in-my-workspace": "workspace-mine",
  "activity-in-other-workspace": "workspace-theirs",
  "comment-in-my-workspace": "workspace-mine",
  "comment-in-other-workspace": "workspace-theirs",
  "column-in-my-workspace": "workspace-mine",
  "column-in-other-workspace": "workspace-theirs",
  "workflow-rule-in-my-workspace": "workspace-mine",
  "workflow-rule-in-other-workspace": "workspace-theirs",
  "project-in-my-workspace": "workspace-mine",
  "project-in-other-workspace": "workspace-theirs",
};

vi.mock("../../../apps/api/src/database", async () => {
  const schema = await import("../../../apps/api/src/database/schema");
  const { PgDialect } = await import("drizzle-orm/pg-core");

  // `sqlToQuery` is the dialect method drizzle's own `.toSQL()` is built on, so
  // the bound parameters come back through a supported surface rather than by
  // reaching into the condition object's internals.
  const dialect = new PgDialect();
  let boundId: string | undefined;
  let selectedFields: string[] = [];

  const chain = {
    select: (selection: Record<string, unknown>) => {
      selectedFields = Object.keys(selection);
      return chain;
    },
    from: () => chain,
    innerJoin: () => chain,
    where: (condition: Parameters<typeof dialect.sqlToQuery>[0]) => {
      // The `task` lookup filters on a single id; joins contribute no
      // parameters because they compare two columns.
      const query = dialect.sqlToQuery(condition);
      state.lookupPredicates.push(query.sql);
      boundId = query.params.find(
        (value): value is string =>
          typeof value === "string" && value in WORKSPACE_BY_TASK,
      );
      return chain;
    },
    limit: async () => {
      if (!boundId) {
        return [];
      }
      state.lookedUpIds.push(boundId);
      const workspaceId = WORKSPACE_BY_TASK[boundId];
      if (workspaceId !== "workspace-mine") return [];
      const values: Record<string, string> = {
        workspaceId,
        projectId: `project-${boundId}`,
        workItemId: boundId,
      };
      return [
        Object.fromEntries(selectedFields.map((key) => [key, values[key]])),
      ];
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
    state.lookupPredicates.length = 0;
    state.handlerReached = false;
  });

  it("keeps an unreachable or missing project indistinguishable to the shadow lane", async () => {
    const app = new Hono<{
      Variables: {
        userId: string;
        workspaceId?: string;
        workspaceIdSource?: "row" | "request";
        legacyAuthorization?: "allowed" | "denied" | "unknown";
      };
    }>()
      .use("*", async (c, next) => {
        c.set("userId", "user-1");
        return next();
      })
      .get("/project/:id", workspaceAccess.fromProject(), (c) =>
        c.json({ reached: true }),
      )
      .onError((error, c) =>
        c.json({
          originalStatus: error instanceof HTTPException ? error.status : 500,
          workspaceId: c.get("workspaceId"),
          workspaceIdSource: c.get("workspaceIdSource"),
          legacyAuthorization: c.get("legacyAuthorization"),
        }),
      );

    const response = await app.request("/project/project-in-other-workspace");
    expect(await response.json()).toEqual({
      originalStatus: 400,
      legacyAuthorization: "unknown",
    });
  });

  it("keeps an unreachable or missing task indistinguishable to the shadow lane", async () => {
    const app = new Hono<{
      Variables: {
        userId: string;
        workspaceId?: string;
        workspaceIdSource?: "row" | "request";
        projectId?: string;
        workItemId?: string;
        legacyAuthorization?: "allowed" | "denied" | "unknown";
      };
    }>()
      .use("*", async (c, next) => {
        c.set("userId", "user-1");
        return next();
      })
      .get("/task/:id", workspaceAccess.fromTask(), (c) =>
        c.json({ reached: true }),
      )
      .onError((error, c) =>
        c.json({
          originalStatus: error instanceof HTTPException ? error.status : 500,
          workspaceId: c.get("workspaceId"),
          workspaceIdSource: c.get("workspaceIdSource"),
          projectId: c.get("projectId"),
          workItemId: c.get("workItemId"),
          legacyAuthorization: c.get("legacyAuthorization"),
        }),
      );

    const response = await app.request("/task/task-in-other-workspace");
    expect(await response.json()).toEqual({
      originalStatus: 404,
      legacyAuthorization: "unknown",
    });
  });

  it("exposes a denied param target as request-sourced evidence", async () => {
    const app = new Hono<{
      Variables: {
        userId: string;
        workspaceId?: string;
        workspaceIdSource?: "row" | "request";
        legacyAuthorization?: "allowed" | "denied";
      };
    }>()
      .use("*", async (c, next) => {
        c.set("userId", "user-1");
        return next();
      })
      .get("/workspace/:workspaceId", workspaceAccess.fromParam(), (c) =>
        c.json({ reached: true }),
      )
      .onError((error, c) =>
        c.json({
          originalStatus: error instanceof HTTPException ? error.status : 500,
          workspaceId: c.get("workspaceId"),
          workspaceIdSource: c.get("workspaceIdSource"),
          legacyAuthorization: c.get("legacyAuthorization"),
        }),
      );

    const response = await app.request("/workspace/workspace-theirs");
    expect(await response.json()).toEqual({
      originalStatus: 403,
      workspaceId: "workspace-theirs",
      workspaceIdSource: "request",
      legacyAuthorization: "denied",
    });
  });

  it("authorizes against the body id the handler will act on", async () => {
    const res = await post("", { taskId: "task-in-my-workspace" });

    expect(res.status).toBe(200);
    expect(state.lookedUpIds).toEqual(["task-in-my-workspace"]);
    expect(state.lookupPredicates[0]).toContain("EXISTS");
    expect(state.lookupPredicates[0]).toContain('"workspace_member"');
  });

  it("issue #290: a body id in a workspace the caller cannot access gets the same 404 a nonexistent id gets, not a distinguishing 403", async () => {
    const res = await post("", { taskId: "task-in-other-workspace" });

    // Before #290, this fell through to the generic post-loop
    // `validateWorkspaceAccess` call and answered 403 -- distinguishable from the 404
    // a nonexistent task id gets (see the "issue #256" describe block below). Reach is
    // now checked as soon as the row resolves, inside the `lookup` branch itself, and
    // an out-of-reach 403 is rethrown as this resource's own "not found" answer.
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Task not found");
    expect(state.lookedUpIds).toEqual(["task-in-other-workspace"]);
  });

  it("does not let a query id override the body id the handler acts on", async () => {
    const res = await post("?taskId=task-in-my-workspace", {
      taskId: "task-in-other-workspace",
    });

    expect(state.lookedUpIds).toEqual(["task-in-other-workspace"]);
    expect(res.status).toBe(404);
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

  // Issue #290: for every one of the 8 `[lookup]`-shaped helpers, a row that exists
  // but resolves to a workspace the caller can't reach must answer BYTE-IDENTICALLY to
  // a row that doesn't exist at all -- same status, same body -- so the two are never
  // distinguishable from the outside. Before this fix, the nonexistent case above
  // already 404s from the `lookup` branch itself, but the other-tenant case fell
  // through to the generic post-loop `validateWorkspaceAccess` call and answered 403.
  describe("issue #290: an other-tenant row answers exactly like a nonexistent one", () => {
    it.each([
      ["fromTask", () => workspaceAccess.fromTask(), "id", "task"],
      ["fromTaskId", () => workspaceAccess.fromTaskId(), "taskId", "task"],
      ["fromLabel", () => workspaceAccess.fromLabel(), "id", "label"],
      [
        "fromTimeEntry",
        () => workspaceAccess.fromTimeEntry(),
        "id",
        "time-entry",
      ],
      ["fromActivity", () => workspaceAccess.fromActivity(), "id", "activity"],
      ["fromComment", () => workspaceAccess.fromComment(), "id", "comment"],
      ["fromColumn", () => workspaceAccess.fromColumn(), "id", "column"],
      [
        "fromWorkflowRule",
        () => workspaceAccess.fromWorkflowRule(),
        "id",
        "workflow-rule",
      ],
    ] as const)(
      "%s: nonexistent id and other-tenant id return the same status and body",
      async (_name, factory, idKey, seedPrefix) => {
        const nonexistentRes = await buildLookupApp(factory(), idKey).request(
          "/does-not-exist?workspaceId=workspace-mine",
        );
        const otherTenantRes = await buildLookupApp(factory(), idKey).request(
          `/${seedPrefix}-in-other-workspace?workspaceId=workspace-mine`,
        );

        expect(otherTenantRes.status).toBe(nonexistentRes.status);
        expect(otherTenantRes.status).toBe(404);
        expect(await otherTenantRes.text()).toBe(await nonexistentRes.text());
        expect(state.handlerReached).toBe(false);
      },
    );
  });

  // Issue #285's S1: the tests above pin the generic 404 throw, but not the removal of
  // the `{ type: "query", key: "workspaceId" }` source itself -- restoring that source
  // to any one of the 8 factories left every case above green, because an id is always
  // present in those cases. This covers the one case that depends on the source-list
  // removal alone: no id anywhere (no path param, no body field), plus a
  // `?workspaceId=` naming the caller's own real workspace. Mutation-checked: adding
  // `{ type: "query", key: "workspaceId" }` back to any one factory turns its own case
  // here into a 200 with the handler reached, while leaving the other seven green.
  describe("issue #285 S1: no id at all + ?workspaceId=<mine> is still 400, not a fall-through", () => {
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
      "%s: no id + ?workspaceId=<mine> is 400, handler not reached",
      async (_name, factory, _idKey) => {
        // No path param at all -- the route below never declares a dynamic segment --
        // and no JSON body, so the `lookup` source's id resolves to `null` on both the
        // param and the body reads.
        const app = new Hono<{ Variables: { userId: string } }>()
          .use("*", async (c, next) => {
            c.set("userId", "user-1");
            return next();
          })
          .post("/no-id", factory(), async (c) => {
            state.handlerReached = true;
            return c.json({ ok: true });
          });

        const res = await app.request("/no-id?workspaceId=workspace-mine", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        });

        expect(res.status).toBe(400);
        expect(state.handlerReached).toBe(false);
        expect(state.lookedUpIds).toEqual([]);
      },
    );
  });

  // Issue #290's own note on `fromProject`: it has always answered a generic 400 for
  // an unknown project id (#202), never the 404 the other 7 resources get. The fix
  // keeps that precedent -- an out-of-reach project matches the SAME 400 an unknown
  // one gets, not a new 404.
  describe("issue #290: fromProject keeps its own 400-on-unknown, applied identically to an other-tenant project", () => {
    it("nonexistent project id is 400", async () => {
      const res = await buildLookupApp(
        workspaceAccess.fromProject(),
        "id",
      ).request("/does-not-exist?workspaceId=workspace-mine");

      expect(res.status).toBe(400);
      expect(await res.text()).toBe("Workspace ID could not be determined");
    });

    it("other-tenant project id gets the identical 400, not a distinguishing 403", async () => {
      const res = await buildLookupApp(
        workspaceAccess.fromProject(),
        "id",
      ).request("/project-in-other-workspace?workspaceId=workspace-mine");

      expect(res.status).toBe(400);
      expect(await res.text()).toBe("Workspace ID could not be determined");
      expect(state.handlerReached).toBe(false);
    });
  });

  // Issue #288: the middleware used to carry its own hand-rolled NUL check
  // (`hasNulByte` plus an inline 400) instead of calling the one shared
  // `rejectNulByte` helper every other NUL-checking call site in the codebase uses --
  // two implementations of the same rule, with different wording. This proves the
  // middleware's NUL rejection and a direct call to the shared helper, with the same
  // label, produce the byte-identical body -- i.e. the middleware really does call
  // through to `rejectNulByte` now, not a parallel copy of it.
  it("issue #288: the middleware's NUL rejection is byte-identical to calling the shared rejectNulByte helper directly", async () => {
    const res = await buildTaskApp().request(
      `/task/${encodeURIComponent("\u0000x")}?workspaceId=workspace-mine`,
    );
    expect(res.status).toBe(400);
    const middlewareBody = await res.text();

    let directMessage = "";
    try {
      rejectNulByte("\u0000x", "Workspace/resource id");
    } catch (error) {
      directMessage =
        error instanceof HTTPException
          ? error.message
          : "not-an-http-exception";
    }

    expect(middlewareBody).toBe(directMessage);
  });
});
