/**
 * Project reach on the legacy task-keyed write routes (task, task comment, activity, task
 * relation). Their policies are `reach: "required"` on the `work_item` scope and the
 * permission matrix declares 404 outside reach and 403 for customers, so for every route:
 *  - a same-workspace caller with no project membership gets 404 and nothing is written;
 *  - a customer-role member gets the matrix's answer (404 without / 403 with a project role);
 *  - a caller who reaches the task without the capability gets 403;
 *  - a read-scoped / unscoped API key owned by a capable member is refused, and a key owned
 *    by an outsider gets 404;
 *  - a project member with the capability is not refused (status other than 403/404).
 * Labels and time entries are declared at WORKSPACE scope in their policies and keep
 * workspace reach by design (see `tests/permissions/work-item-reach-guard.test.ts`).
 */
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  json,
  MATRIX,
  makeApiKey,
  matrixStatus,
  setAmbientHeaders,
  setupWorld,
} from "./helpers/reach-world";

type World = Awaited<ReturnType<typeof setupWorld>>;
type Seed = {
  taskId: string;
  otherTaskId: string;
  activityId: string;
  relationId: string;
  columnId: string;
};
type LegacyRoute = {
  matrixKey: string;
  /** Legacy controller checks authorship only, never the key's scope (pre-existing; the strict policy layer clamps keys when enabled). */
  noLegacyKeyScope?: boolean;
  call: (
    app: ReturnType<typeof createApp>["app"],
    s: Seed,
  ) => Promise<Response>;
};

const FULL_SCOPE = {
  project: ["read", "update"],
  task: ["read", "create", "update", "delete"],
  work_item: ["read", "update", "delete", "assign"],
  comment: ["create", "create_internal", "update_own", "delete_own"],
};

async function seed(world: World, memberUserId: string): Promise<Seed> {
  const [col] = await db
    .select()
    .from(schema.columnTable)
    .where(eq(schema.columnTable.projectId, world.project.id))
    .limit(1);
  if (!col) throw new Error("no column");
  const mk = async (n: number) => {
    const [t] = await db
      .insert(schema.taskTable)
      .values({
        projectId: world.project.id,
        title: n === 1 ? "Confidential legacy task" : "Other task",
        description: "d",
        priority: "medium",
        status: col.slug,
        columnId: col.id,
        number: n,
        position: n,
      })
      .returning();
    if (!t) throw new Error("task");
    return t;
  };
  const task = await mk(1);
  const other = await mk(2);
  const [activity] = await db
    .insert(schema.taskActivityTable)
    .values({
      taskId: task.id,
      type: "comment",
      userId: memberUserId,
      content: "legacy comment",
    })
    .returning();
  const [relation] = await db
    .insert(schema.taskRelationTable)
    .values({
      sourceTaskId: task.id,
      targetTaskId: other.id,
      relationType: "blocks",
    })
    .returning();
  if (!activity || !relation) throw new Error("seed");
  return {
    taskId: task.id,
    otherTaskId: other.id,
    activityId: activity.id,
    relationId: relation.id,
    columnId: col.id,
  };
}

async function snapshot() {
  return JSON.stringify({
    tasks: await db
      .select()
      .from(schema.taskTable)
      .orderBy(schema.taskTable.id),
    activity: await db
      .select()
      .from(schema.taskActivityTable)
      .orderBy(schema.taskActivityTable.id),
    relations: await db.select().from(schema.taskRelationTable),
  });
}

const ROUTES: LegacyRoute[] = [
  {
    matrixKey: "PUT /api/task/{id}",
    call: (a, s) => json(a, "PUT", `/api/task/${s.taskId}`, { title: "x" }),
  },
  {
    matrixKey: "PUT /api/v2/task/{id}",
    call: (a, s) => json(a, "PUT", `/api/v2/task/${s.taskId}`, { title: "x" }),
  },
  {
    matrixKey: "PUT /api/task/status/{id}",
    call: (a, s) =>
      json(a, "PUT", `/api/task/status/${s.taskId}`, { status: "done" }),
  },
  {
    matrixKey: "PUT /api/task/priority/{id}",
    call: (a, s) =>
      json(a, "PUT", `/api/task/priority/${s.taskId}`, { priority: "high" }),
  },
  {
    matrixKey: "PUT /api/task/assignee/{id}",
    call: (a, s) =>
      json(a, "PUT", `/api/task/assignee/${s.taskId}`, { userId: "" }),
  },
  {
    matrixKey: "PUT /api/task/due-date/{id}",
    call: (a, s) =>
      json(a, "PUT", `/api/task/due-date/${s.taskId}`, { dueDate: null }),
  },
  {
    matrixKey: "PUT /api/task/title/{id}",
    call: (a, s) =>
      json(a, "PUT", `/api/task/title/${s.taskId}`, { title: "y" }),
  },
  {
    matrixKey: "PUT /api/task/description/{id}",
    call: (a, s) =>
      json(a, "PUT", `/api/task/description/${s.taskId}`, { description: "y" }),
  },
  {
    matrixKey: "PUT /api/task/move/{id}",
    call: (a, s) =>
      json(a, "PUT", `/api/task/move/${s.taskId}`, {
        columnId: s.columnId,
        position: 1,
      }),
  },
  {
    matrixKey: "PUT /api/task/image-upload/{id}",
    call: (a, s) => json(a, "PUT", `/api/task/image-upload/${s.taskId}`, {}),
  },
  {
    matrixKey: "POST /api/task/image-upload/{id}/finalize",
    call: (a, s) =>
      json(a, "POST", `/api/task/image-upload/${s.taskId}/finalize`, {}),
  },
  {
    matrixKey: "DELETE /api/task/{id}",
    call: (a, s) => json(a, "DELETE", `/api/task/${s.taskId}`),
  },
  {
    matrixKey: "POST /api/comment/{taskId}",
    call: (a, s) =>
      json(a, "POST", `/api/comment/${s.taskId}`, { content: "hi" }),
  },
  {
    matrixKey: "PUT /api/comment/{id}",
    call: (a, s) =>
      json(a, "PUT", `/api/comment/${s.activityId}`, { content: "hi" }),
  },
  {
    matrixKey: "DELETE /api/comment/{id}",
    call: (a, s) => json(a, "DELETE", `/api/comment/${s.activityId}`),
  },
  {
    matrixKey: "POST /api/activity/create",
    call: (a, s) =>
      json(a, "POST", "/api/activity/create", {
        taskId: s.taskId,
        type: "comment",
        comment: "x",
      }),
  },
  {
    matrixKey: "POST /api/activity/comment",
    call: (a, s) =>
      json(a, "POST", "/api/activity/comment", {
        taskId: s.taskId,
        comment: "x",
      }),
  },
  {
    matrixKey: "PUT /api/activity/comment",
    noLegacyKeyScope: true,
    call: (a, s) =>
      json(a, "PUT", "/api/activity/comment", {
        activityId: s.activityId,
        comment: "x",
      }),
  },
  {
    matrixKey: "DELETE /api/activity/comment",
    noLegacyKeyScope: true,
    call: (a, s) =>
      json(a, "DELETE", "/api/activity/comment", { activityId: s.activityId }),
  },
  {
    matrixKey: "POST /api/task-relation",
    call: (a, s) =>
      json(a, "POST", "/api/task-relation", {
        sourceTaskId: s.taskId,
        targetTaskId: s.otherTaskId,
        relationType: "relates_to",
      }),
  },
  {
    matrixKey: "DELETE /api/task-relation/{id}",
    call: (a, s) => json(a, "DELETE", `/api/task-relation/${s.relationId}`),
  },
];

describe("API integration: project reach on the legacy task-keyed write routes", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });
  afterEach(() => {
    setAmbientHeaders({});
    vi.restoreAllMocks();
  });

  for (const route of ROUTES) {
    describe(route.matrixKey, () => {
      async function arrange() {
        const world = await setupWorld();
        const { app } = createApp();
        const s = await seed(world, world.projectMember.user.id);
        return { world, app, s };
      }

      it("a same-workspace caller with no project membership gets 404 and nothing is written", async () => {
        const { world, app, s } = await arrange();
        const declared = matrixStatus(
          MATRIX.routes[route.matrixKey]?.member?.outOfReach,
        );
        expect(declared).toBe(404);
        const before = await snapshot();
        for (const outsider of [
          world.outsiderLead,
          world.outsiderMember,
          world.outsiderAdmin,
        ]) {
          mockAuthenticatedSession(outsider.user);
          const response = await route.call(app, s);
          const text = await response.text();
          expect(response.status, text).toBe(404);
          expect(text).not.toContain("Confidential legacy task");
          expect(await snapshot()).toBe(before);
        }
      });

      it("a customer-role member gets the matrix's customer answer", async () => {
        const { world, app, s } = await arrange();
        const before = await snapshot();
        mockAuthenticatedSession(world.customerNoRole.user);
        const out = await route.call(app, s);
        expect(out.status, await out.text()).toBe(
          matrixStatus(MATRIX.routes[route.matrixKey]?.customer?.outOfReach),
        );
        mockAuthenticatedSession(world.customerWithRole.user);
        const inside = await route.call(app, s);
        expect(inside.status, await inside.text()).toBe(
          matrixStatus(MATRIX.routes[route.matrixKey]?.customer?.inReach),
        );
        expect(await snapshot()).toBe(before);
      });

      it("a caller who reaches the task without the capability gets 403 and nothing is written", async () => {
        const { world, app, s } = await arrange();
        const before = await snapshot();
        mockAuthenticatedSession(world.readerLead.user);
        const response = await route.call(app, s);
        expect(response.status, await response.text()).toBe(403);
        expect(await snapshot()).toBe(before);
      });

      it("a read-scoped or unscoped API key is refused, and an outsider's key gets 404", async () => {
        const { world, app, s } = await arrange();
        const before = await snapshot();
        mockAnonymousSession();
        for (const permissions of route.noLegacyKeyScope
          ? []
          : [
              { project: ["read"], task: ["read"], work_item: ["read"] },
              null,
            ]) {
          setAmbientHeaders({
            "x-api-key": await makeApiKey(
              world.projectMember.user.id,
              permissions,
            ),
          });
          const refused = await route.call(app, s);
          expect(refused.status, await refused.text()).toBe(403);
        }
        setAmbientHeaders({
          "x-api-key": await makeApiKey(world.outsiderLead.user.id, FULL_SCOPE),
        });
        const outsider = await route.call(app, s);
        expect(outsider.status, await outsider.text()).toBe(404);
        expect(await snapshot()).toBe(before);
      });

      it("a project member holding the capability is not refused", async () => {
        const { world, app, s } = await arrange();
        mockAuthenticatedSession(world.projectMember.user);
        const response = await route.call(app, s);
        const text = await response.text();
        expect([403, 404], text).not.toContain(response.status);
      });
    });
  }
});
