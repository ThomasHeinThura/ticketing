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
  createProjectFixture,
  grantWorkItemProjectAccess,
} from "./helpers/fixtures";
import { LEGACY_WRITE_ROUTE_KEYS } from "./helpers/reach-route-keys";
import {
  addMember,
  json,
  MATRIX,
  makeApiKey,
  matrixStatus,
  type Seed,
  seedLegacy,
  setAmbientHeaders,
  setupWorld,
} from "./helpers/reach-world";

type LegacyRoute = {
  matrixKey: string;
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
    call: (a, s) =>
      json(a, "PUT", "/api/activity/comment", {
        activityId: s.activityId,
        comment: "x",
      }),
  },
  {
    matrixKey: "DELETE /api/activity/comment",
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

  it("the table covers exactly the legacy write routes the guard requires", () => {
    expect(ROUTES.map((route) => route.matrixKey).sort()).toEqual(
      [...LEGACY_WRITE_ROUTE_KEYS].sort(),
    );
  });

  for (const route of ROUTES) {
    describe(route.matrixKey, () => {
      async function arrange() {
        const world = await setupWorld();
        const { app } = createApp();
        const s = await seedLegacy(world, world.projectMember.user.id);
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
        for (const permissions of [
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

  describe("task relations across projects", () => {
    async function twoProjects() {
      const world = await setupWorld();
      const { app } = createApp();
      const s = await seedLegacy(world, world.projectMember.user.id);
      // A second project in the same workspace that the project member does NOT reach.
      const hidden = await createProjectFixture({
        workspaceId: world.workspaceId,
      });
      const [hiddenTask] = await db
        .insert(schema.taskTable)
        .values({
          projectId: hidden.project.id,
          title: "Hidden project task",
          description: "d",
          priority: "high",
          status: hidden.columns.todo.slug,
          columnId: hidden.columns.todo.id,
          number: 1,
          position: 1,
        })
        .returning();
      if (!hiddenTask) throw new Error("hidden task");
      // A colleague who reaches BOTH projects (and so may legitimately link them).
      const both = await addMember(world.workspaceId, "admin");
      await grantWorkItemProjectAccess(both.user.id, world.project.id);
      await grantWorkItemProjectAccess(both.user.id, hidden.project.id);
      return { world, app, s, hiddenTask, both };
    }
    const relate = (
      app: ReturnType<typeof createApp>["app"],
      source: string,
      target: string,
    ) =>
      json(app, "POST", "/api/task-relation", {
        sourceTaskId: source,
        targetTaskId: target,
        relationType: "blocks",
      });

    it("creating a relation to a task the caller cannot reach answers exactly like a missing target", async () => {
      const { world, app, s, hiddenTask } = await twoProjects();
      mockAuthenticatedSession(world.projectMember.user);
      const hiddenTarget = await relate(app, s.taskId, hiddenTask.id);
      const missingTarget = await relate(app, s.taskId, "no-such-task-id");
      const [hiddenBody, missingBody] = [
        await hiddenTarget.text(),
        await missingTarget.text(),
      ];
      expect(hiddenTarget.status).toBe(404);
      expect(hiddenBody).toBe(missingBody);
      expect(hiddenBody).toBe("Target task not found");
      expect(await db.select().from(schema.taskRelationTable)).toHaveLength(1); // the seeded one only
    });

    it("listing relations omits a related task the caller cannot reach, and removing needs both ends", async () => {
      const { world, app, s, hiddenTask, both } = await twoProjects();
      mockAuthenticatedSession(both.user);
      const created = await relate(app, s.taskId, hiddenTask.id);
      expect(created.status, await created.clone().text()).toBe(200);
      const { id: relationId } = (await created.json()) as { id: string };

      mockAuthenticatedSession(world.projectMember.user);
      const list = await json(app, "GET", `/api/task-relation/${s.taskId}`);
      const text = await list.text();
      expect(list.status, text).toBe(200);
      expect(text).not.toContain("Hidden project task");
      expect(text).not.toContain(hiddenTask.id);
      expect(text).toContain(s.otherTaskId); // the visible seeded relation remains

      const removed = await json(
        app,
        "DELETE",
        `/api/task-relation/${relationId}`,
      );
      expect(removed.status, await removed.text()).toBe(404);
      expect(
        await db
          .select()
          .from(schema.taskRelationTable)
          .where(eq(schema.taskRelationTable.id, relationId)),
      ).toHaveLength(1);

      mockAuthenticatedSession(both.user);
      const listBoth = await json(app, "GET", `/api/task-relation/${s.taskId}`);
      expect(await listBoth.text()).toContain("Hidden project task");
    });
  });
});
