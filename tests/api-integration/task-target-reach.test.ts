/**
 * Project reach on routes that act on a SPECIFIC TASK, or on an asset's own project (#720,
 * decision 720-A in `rbac.md` § Reach): labels, time entries, assets and the legacy bulk task
 * update. Workspace-level label DEFINITIONS (no task) stay workspace-scoped.
 *
 * For each route a same-workspace caller with a strong workspace role but no membership of the
 * task's project gets the same 404 as a missing row, nothing is written and no row is returned;
 * a project member succeeds; an API key owned by an outsider gets the same 404.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAnonymousSession, mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { requireRow } from "./helpers/fixtures";
import {
  TASK_TARGET_ROUTE_KEYS,
  TASK_TARGET_WORK_ITEM_ROUTE_KEYS,
} from "./helpers/project-reach-route-keys";
import {
  PROJECT_KEY_SCOPE,
  type ProjectWorld,
  projectSnapshot,
  setupProjectWorld,
} from "./helpers/project-reach-world";
import {
  type App,
  json,
  makeApiKey,
  seedLegacy,
  setAmbientHeaders,
  type World,
} from "./helpers/reach-world";

vi.mock("../../apps/api/src/storage", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../apps/api/src/storage")>();
  return {
    ...original,
    getPrivateObject: async () => ({
      body: new Blob(["probe"]).stream(),
      contentType: "image/png",
      contentLength: 5,
    }),
  };
});

type Ids = {
  taskId: string;
  taskLabelId: string;
  workspaceLabelId: string;
  timeEntryId: string;
  assetId: string;
};

const MARKERS = [
  "Confidential label",
  "Confidential legacy task",
  "Confidential time entry",
  "probe.png",
];

async function seed(world: ProjectWorld): Promise<Ids> {
  const seeded = await seedLegacy(
    world as unknown as World,
    world.projectAdmin.user.id,
  );
  const taskLabel = requireRow(
    await db
      .insert(schema.labelTable)
      .values({
        name: "Confidential label",
        color: "#ff0000",
        workspaceId: world.workspaceId,
        taskId: seeded.taskId,
      })
      .returning(),
    "task label",
  );
  const workspaceLabel = requireRow(
    await db
      .insert(schema.labelTable)
      .values({
        name: "Workspace definition",
        color: "#00ff00",
        workspaceId: world.workspaceId,
        taskId: null,
      })
      .returning(),
    "workspace label",
  );
  const timeEntry = requireRow(
    await db
      .insert(schema.timeEntryTable)
      .values({
        taskId: seeded.taskId,
        userId: world.projectAdmin.user.id,
        description: "Confidential time entry",
        startTime: new Date("2030-01-01T00:00:00Z"),
        endTime: new Date("2030-01-01T01:00:00Z"),
        duration: 3600,
      })
      .returning(),
    "time entry",
  );
  const asset = requireRow(
    await db
      .insert(schema.assetTable)
      .values({
        workspaceId: world.workspaceId,
        projectId: world.project.id,
        taskId: seeded.taskId,
        objectKey: `asset-${randomUUID()}`,
        filename: "probe.png",
        mimeType: "image/png",
        size: 5,
      })
      .returning(),
    "asset",
  );
  return {
    taskId: seeded.taskId,
    taskLabelId: taskLabel.id,
    workspaceLabelId: workspaceLabel.id,
    timeEntryId: timeEntry.id,
    assetId: asset.id,
  };
}

type Case = {
  matrixKey: string;
  /** What a missing row of this kind answers, for the byte-identical comparison. */
  missing: (app: App, w: ProjectWorld, i: Ids) => Promise<Response>;
  call: (app: App, w: ProjectWorld, i: Ids) => Promise<Response>;
  successStatus?: number;
};

const taskIdOf = (i: Ids) => i.taskId;

const CASES: Case[] = [
  {
    matrixKey: "POST /api/label",
    call: (app, w, i) =>
      json(app, "POST", "/api/label", {
        name: "Injected label",
        color: "#123456",
        workspaceId: w.workspaceId,
        taskId: taskIdOf(i),
      }),
    missing: (app, w) =>
      json(app, "POST", "/api/label", {
        name: "Injected label",
        color: "#123456",
        workspaceId: w.workspaceId,
        taskId: `missing-${randomUUID()}`,
      }),
  },
  {
    matrixKey: "GET /api/label/{id}",
    call: (app, _w, i) => json(app, "GET", `/api/label/${i.taskLabelId}`),
    missing: (app) => json(app, "GET", `/api/label/missing-${randomUUID()}`),
  },
  {
    matrixKey: "PUT /api/label/{id}",
    call: (app, _w, i) =>
      json(app, "PUT", `/api/label/${i.taskLabelId}`, {
        name: "Overwritten label",
        color: "#abcdef",
      }),
    missing: (app) =>
      json(app, "PUT", `/api/label/missing-${randomUUID()}`, {
        name: "Overwritten label",
        color: "#abcdef",
      }),
  },
  {
    matrixKey: "DELETE /api/label/{id}",
    call: (app, _w, i) => json(app, "DELETE", `/api/label/${i.taskLabelId}`),
    missing: (app) => json(app, "DELETE", `/api/label/missing-${randomUUID()}`),
  },
  {
    matrixKey: "PUT /api/label/{id}/task",
    call: (app, _w, i) =>
      json(app, "PUT", `/api/label/${i.workspaceLabelId}/task`, {
        taskId: taskIdOf(i),
      }),
    missing: (app, _w, i) =>
      json(app, "PUT", `/api/label/${i.workspaceLabelId}/task`, {
        taskId: `missing-${randomUUID()}`,
      }),
  },
  {
    matrixKey: "DELETE /api/label/{id}/task",
    call: (app, _w, i) =>
      json(app, "DELETE", `/api/label/${i.taskLabelId}/task`),
    missing: (app) =>
      json(app, "DELETE", `/api/label/missing-${randomUUID()}/task`),
  },
  {
    matrixKey: "GET /api/label/task/{taskId}",
    call: (app, _w, i) => json(app, "GET", `/api/label/task/${i.taskId}`),
    missing: (app) =>
      json(app, "GET", `/api/label/task/missing-${randomUUID()}`),
  },
  {
    matrixKey: "GET /api/time-entry/task/{taskId}",
    call: (app, _w, i) => json(app, "GET", `/api/time-entry/task/${i.taskId}`),
    missing: (app) =>
      json(app, "GET", `/api/time-entry/task/missing-${randomUUID()}`),
  },
  {
    matrixKey: "GET /api/time-entry/{id}",
    call: (app, _w, i) => json(app, "GET", `/api/time-entry/${i.timeEntryId}`),
    missing: (app) =>
      json(app, "GET", `/api/time-entry/missing-${randomUUID()}`),
  },
  {
    matrixKey: "POST /api/time-entry",
    call: (app, _w, i) =>
      json(app, "POST", "/api/time-entry", {
        taskId: i.taskId,
        startTime: "2031-01-01T00:00:00Z",
        endTime: "2031-01-01T01:00:00Z",
        description: "Injected time",
      }),
    missing: (app) =>
      json(app, "POST", "/api/time-entry", {
        taskId: `missing-${randomUUID()}`,
        startTime: "2031-01-01T00:00:00Z",
        endTime: "2031-01-01T01:00:00Z",
        description: "Injected time",
      }),
  },
  {
    matrixKey: "PUT /api/time-entry/{id}",
    call: (app, _w, i) =>
      json(app, "PUT", `/api/time-entry/${i.timeEntryId}`, {
        startTime: "2031-01-01T00:00:00Z",
        endTime: "2031-01-01T01:00:00Z",
        description: "Overwritten time",
      }),
    missing: (app) =>
      json(app, "PUT", `/api/time-entry/missing-${randomUUID()}`, {
        startTime: "2031-01-01T00:00:00Z",
        endTime: "2031-01-01T01:00:00Z",
        description: "Overwritten time",
      }),
  },
  {
    matrixKey: "GET /api/asset/{id}",
    call: (app, _w, i) => json(app, "GET", `/api/asset/${i.assetId}`),
    missing: (app) => json(app, "GET", `/api/asset/missing-${randomUUID()}`),
  },
  {
    matrixKey: "PATCH /api/task/bulk",
    call: (app, _w, i) =>
      json(app, "PATCH", "/api/task/bulk", {
        taskIds: [i.taskId],
        operation: "updatePriority",
        value: "urgent",
      }),
    missing: (app) =>
      json(app, "PATCH", "/api/task/bulk", {
        taskIds: [`missing-${randomUUID()}`],
        operation: "updatePriority",
        value: "urgent",
      }),
  },
];

describe("API integration: project reach on task-targeting routes (#720)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterEach(() => {
    setAmbientHeaders({});
    vi.restoreAllMocks();
  });

  it("the table covers exactly the routes the guards require of this family", () => {
    expect(CASES.map((route) => route.matrixKey).sort()).toEqual(
      [...TASK_TARGET_ROUTE_KEYS, ...TASK_TARGET_WORK_ITEM_ROUTE_KEYS].sort(),
    );
  });

  async function arrange() {
    const world = await setupProjectWorld();
    const { app } = createApp();
    const ids = await seed(world);
    return { world, app, ids };
  }

  for (const route of CASES) {
    describe(route.matrixKey, () => {
      it("a same-workspace caller outside the task's project gets 404 like a missing row, writes nothing and sees no row", async () => {
        const { world, app, ids } = await arrange();
        const before = await projectSnapshot();
        mockAuthenticatedSession(world.projectAdmin.user);
        const missing = await route.missing(app, world, ids);
        const missingText = await missing.text();
        // A missing task/label/entry/asset is the family's own 404.
        expect(missing.status, missingText).toBe(404);

        for (const outsider of [
          world.outsiderLead,
          world.outsiderMember,
          world.outsiderAdmin,
          world.otherProjectAdmin,
        ]) {
          mockAuthenticatedSession(outsider.user);
          const response = await route.call(app, world, ids);
          const text = await response.text();
          expect(response.status, text).toBe(404);
          expect(text).toBe(missingText);
          for (const marker of MARKERS) expect(text).not.toContain(marker);
          expect(await projectSnapshot()).toBe(before);
        }
      });

      it("a project member succeeds", async () => {
        const { world, app, ids } = await arrange();
        mockAuthenticatedSession(world.projectAdmin.user);
        const response = await route.call(app, world, ids);
        expect(response.status, await response.clone().text()).toBe(
          route.successStatus ?? 200,
        );
      });

      it("API key: an outsider's fully scoped key gets the same 404; a member's scoped key succeeds", async () => {
        const { world, app, ids } = await arrange();
        mockAnonymousSession();
        const outsiderKey = await makeApiKey(
          world.outsiderAdmin.user.id,
          PROJECT_KEY_SCOPE,
        );
        const memberKey = await makeApiKey(
          world.projectAdmin.user.id,
          PROJECT_KEY_SCOPE,
        );
        const before = await projectSnapshot();
        setAmbientHeaders({ "x-api-key": outsiderKey });
        const outside = await route.call(app, world, ids);
        const outsideText = await outside.text();
        expect(outside.status, outsideText).toBe(404);
        for (const marker of MARKERS) expect(outsideText).not.toContain(marker);
        expect(await projectSnapshot()).toBe(before);

        setAmbientHeaders({ "x-api-key": memberKey });
        const allowed = await route.call(app, world, ids);
        setAmbientHeaders({});
        expect(allowed.status, await allowed.clone().text()).toBe(
          route.successStatus ?? 200,
        );
      });
    });
  }

  describe("PUT /api/label/{id}/task: both the label's task and the named task are checked", () => {
    it("a caller who reaches the named task cannot re-attach a label bound to a task in a project they cannot reach", async () => {
      const { world, app, ids } = await arrange();
      // A task in the OTHER project, which `otherProjectAdmin` reaches; the label stays
      // bound to the first project's task, which that caller does not reach.
      const reachable = requireRow(
        await db
          .insert(schema.taskTable)
          .values({
            projectId: world.otherProject.id,
            title: "Reachable task",
            description: "d",
            priority: "low",
            status: "to-do",
            number: 1,
            position: 1,
          })
          .returning(),
        "reachable task",
      );
      const before = await projectSnapshot();
      mockAuthenticatedSession(world.otherProjectAdmin.user);
      const response = await json(
        app,
        "PUT",
        `/api/label/${ids.taskLabelId}/task`,
        { taskId: reachable.id },
      );
      const text = await response.text();
      expect(response.status, text).toBe(404);
      expect(text).toBe("Label not found");
      expect(await projectSnapshot()).toBe(before);
    });
  });

  describe("workspace-level label definitions stay workspace-scoped", () => {
    it("an outsider reads, creates, renames and deletes a label that targets no task", async () => {
      const { world, app, ids } = await arrange();
      mockAuthenticatedSession(world.outsiderAdmin.user);
      const read = await json(app, "GET", `/api/label/${ids.workspaceLabelId}`);
      expect(read.status, await read.clone().text()).toBe(200);
      const created = await json(app, "POST", "/api/label", {
        name: "Another definition",
        color: "#222222",
        workspaceId: world.workspaceId,
      });
      expect(created.status, await created.clone().text()).toBe(200);
      const renamed = await json(
        app,
        "PUT",
        `/api/label/${ids.workspaceLabelId}`,
        { name: "Renamed definition", color: "#333333" },
      );
      expect(renamed.status, await renamed.clone().text()).toBe(200);
      const removed = await json(
        app,
        "DELETE",
        `/api/label/${ids.workspaceLabelId}`,
      );
      expect(removed.status, await removed.clone().text()).toBe(200);
    });
  });

  describe("PATCH /api/task/bulk: per-item reach and capability", () => {
    it("an unreachable task is reported like a missing id; nothing changes", async () => {
      const { world, app, ids } = await arrange();
      const before = await projectSnapshot();
      mockAuthenticatedSession(world.outsiderAdmin.user);
      const response = await json(app, "PATCH", "/api/task/bulk", {
        taskIds: [ids.taskId, "missing-task"],
        operation: "updatePriority",
        value: "urgent",
      });
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("No tasks found");
      expect(await projectSnapshot()).toBe(before);
    });

    it("a mixed batch changes only the tasks the caller reaches and reports the rest anonymously", async () => {
      const { world, app, ids } = await arrange();
      // A second project the member cannot reach, holding a second task.
      const hidden = requireRow(
        await db
          .insert(schema.taskTable)
          .values({
            projectId: world.otherProject.id,
            title: "Hidden task",
            description: "d",
            priority: "low",
            status: "to-do",
            number: 1,
            position: 1,
          })
          .returning(),
        "hidden task",
      );
      mockAuthenticatedSession(world.projectAdmin.user);
      const response = await json(app, "PATCH", "/api/task/bulk", {
        taskIds: [ids.taskId, hidden.id, "missing-task"],
        operation: "updatePriority",
        value: "urgent",
      });
      const body = (await response.json()) as {
        updatedCount: number;
        results: { taskId?: string; success: boolean; error?: string }[];
      };
      expect(response.status).toBe(200);
      expect(body.updatedCount).toBe(1);
      expect(body.results).toEqual([
        { taskId: ids.taskId, success: true },
        { success: false, error: "Task not found" },
        { success: false, error: "Task not found" },
      ]);
      const [reached] = await db
        .select({ priority: schema.taskTable.priority })
        .from(schema.taskTable)
        .where(eq(schema.taskTable.id, ids.taskId));
      expect(reached?.priority).toBe("urgent");
      const [untouched] = await db
        .select({ priority: schema.taskTable.priority })
        .from(schema.taskTable)
        .where(eq(schema.taskTable.id, hidden.id));
      expect(untouched?.priority).toBe("low");
    });

    it("a reachable task the caller's project role does not permit is refused per item", async () => {
      const { world, app, ids } = await arrange();
      const before = await projectSnapshot();
      // A workspace admin whose PROJECT role carries read only: the legacy workspace gate
      // passes and the task is in reach, so only the per-item project capability refuses.
      mockAuthenticatedSession(world.readerAdmin.user);
      for (const body of [
        { operation: "delete" },
        { operation: "updatePriority", value: "urgent" },
        { operation: "updateAssignee", value: world.projectAdmin.user.id },
        { operation: "addLabel", value: ids.workspaceLabelId },
      ]) {
        const response = await json(app, "PATCH", "/api/task/bulk", {
          taskIds: [ids.taskId],
          ...body,
        });
        expect(response.status, await response.clone().text()).toBe(200);
        expect(await response.json()).toMatchObject({
          updatedCount: 0,
          results: [
            {
              taskId: ids.taskId,
              success: false,
              error: "Insufficient permissions",
            },
          ],
        });
        expect(await projectSnapshot()).toBe(before);
      }
    });
  });
});
