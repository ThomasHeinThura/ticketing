/**
 * #202 (follow-up to #187 / PR-16): a soft-deleted project must be frozen *everywhere*
 * in ordinary use, not only on the read/write paths PR #200 fixed.
 *
 * `docs/03-features/projects-and-engagements.md` PR-16 makes deletion soft for 30 days,
 * and PR #200's own convention (`get-project.ts`, `get-tasks.ts`, `export-tasks.ts`,
 * `global-search.ts`, `reorder-projects.ts`, `getProjectWorkspaceId`) is that a
 * soft-deleted project is treated as gone. Both of PR #200's reviewers found routes that
 * still did not apply that convention, and this file pins each one:
 *
 *   update / archive / unarchive project, get / update / delete / reorder columns,
 *   and every task route that resolves by task id (get, update, delete, status,
 *   priority, title, description, due date, assignee, move) plus import and bulk.
 *
 * Every assertion is a two-part claim: the route now answers 404 (or, for bulk, skips the
 * row), AND the row it would have changed is byte-for-byte unchanged. A 404 alone would
 * also be produced by a route that rejected the request for an unrelated reason.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

function jsonRequest(
  path: string,
  method: "post" | "put" | "patch" | "delete",
  body?: unknown,
) {
  const { app } = createApp();
  return app.request(`/api${path}`, {
    method: method.toUpperCase(),
    ...(body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
}

function getRequest(path: string) {
  const { app } = createApp();
  return app.request(`/api${path}`);
}

async function softDeleteProject(projectId: string) {
  await db
    .update(schema.projectTable)
    .set({ deletedAt: new Date(), purgeAfter: new Date() })
    .where(eq(schema.projectTable.id, projectId));
}

async function reloadProject(projectId: string) {
  const row = await db.query.projectTable.findFirst({
    where: eq(schema.projectTable.id, projectId),
  });
  if (!row) {
    throw new Error(`project ${projectId} disappeared`);
  }
  return row;
}

async function reloadTask(taskId: string) {
  const row = await db.query.taskTable.findFirst({
    where: eq(schema.taskTable.id, taskId),
  });
  if (!row) {
    throw new Error(`task ${taskId} disappeared`);
  }
  return row;
}

async function reloadColumn(columnId: string) {
  const row = await db.query.columnTable.findFirst({
    where: eq(schema.columnTable.id, columnId),
  });
  if (!row) {
    throw new Error(`column ${columnId} disappeared`);
  }
  return row;
}

type Fixture = Awaited<ReturnType<typeof createWorkspaceMember>> & {
  project: typeof schema.projectTable.$inferSelect;
  columns: Record<
    "todo" | "inProgress" | "inReview" | "done",
    typeof schema.columnTable.$inferSelect
  >;
  task: typeof schema.taskTable.$inferSelect;
};

/** One soft-deleted project, with one column and one task still under it. */
async function buildDeletedProjectFixture(): Promise<Fixture> {
  const member = await createWorkspaceMember({ role: "admin" });
  const { project, columns } = await createProjectFixture({
    workspaceId: member.workspace.id,
  });

  const [task] = await db
    .insert(schema.taskTable)
    .values({
      projectId: project.id,
      title: "Frozen task",
      description: "Original description",
      status: "to-do",
      columnId: columns.todo.id,
      priority: "medium",
      number: 1,
      position: 1,
      // Set so the "unassign" case below is a real transition rather than an
      // early-return no-op -- that early return is exactly where the old code
      // skipped its guard.
      userId: member.user.id,
    })
    .returning();

  if (!task) {
    throw new Error("failed to seed task");
  }

  await softDeleteProject(project.id);
  mockAuthenticatedSession(member.user);

  return { ...member, project, columns, task };
}

describe("API integration: a soft-deleted project is frozen (#202)", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  describe("project routes", () => {
    it("refuses to rename a soft-deleted project, and leaves it unchanged", async () => {
      const { project } = await buildDeletedProjectFixture();

      const response = await jsonRequest(`/project/${project.id}`, "put", {
        name: "Renamed while deleted",
        icon: "Folder",
        slug: project.slug,
        description: "should not be stored",
      });

      expect(response.status).toBe(404);
      const row = await reloadProject(project.id);
      expect(row.name).toBe(project.name);
      expect(row.description).toBe(project.description);
    });

    it("refuses to archive a soft-deleted project, and leaves archived_at null", async () => {
      const { project } = await buildDeletedProjectFixture();

      const response = await jsonRequest(
        `/project/${project.id}/archive`,
        "put",
      );

      expect(response.status).toBe(404);
      const row = await reloadProject(project.id);
      expect(row.archivedAt).toBeNull();
    });

    it("refuses to unarchive a soft-deleted project", async () => {
      const { project } = await buildDeletedProjectFixture();

      const response = await jsonRequest(
        `/project/${project.id}/unarchive`,
        "put",
      );

      expect(response.status).toBe(404);
      const row = await reloadProject(project.id);
      // Still soft-deleted, and untouched by the unarchive attempt.
      expect(row.deletedAt).not.toBeNull();
      expect(row.archivedAt).toBeNull();
    });

    it("reports a soft-deleted project as deleted, not as foreign, when reordering", async () => {
      const { project, workspace } = await buildDeletedProjectFixture();

      const response = await jsonRequest(
        `/project/reorder?workspaceId=${workspace.id}`,
        "put",
        { projects: [{ id: project.id, position: 0 }] },
      );

      expect(response.status).toBe(400);
      // Hono renders an HTTPException's message as plain text, not JSON.
      const message = await response.text();
      // The id does belong to this workspace -- it is gone, and saying otherwise
      // sends whoever reads the error looking for the wrong problem (#202).
      expect(message).toBe(
        `Project ${project.id} is deleted and cannot be reordered`,
      );
      expect(message).not.toContain("does not belong to this workspace");

      const row = await reloadProject(project.id);
      expect(row.position).toBe(project.position);
      expect(row.workspaceId).toBe(workspace.id);
    });
  });

  describe("column routes", () => {
    it("returns 404 listing a soft-deleted project's columns", async () => {
      const { project, columns } = await buildDeletedProjectFixture();

      const response = await getRequest(`/column/${project.id}`);

      expect(response.status).toBe(404);
      // The columns are still there -- they are hidden, not deleted.
      expect((await reloadColumn(columns.todo.id)).name).toBe(
        columns.todo.name,
      );
    });

    it("refuses to rename a column of a soft-deleted project", async () => {
      const { columns } = await buildDeletedProjectFixture();

      const response = await jsonRequest(`/column/${columns.todo.id}`, "put", {
        name: "Renamed while deleted",
      });

      expect(response.status).toBe(404);
      expect((await reloadColumn(columns.todo.id)).name).toBe(
        columns.todo.name,
      );
    });

    it("refuses to delete a column of a soft-deleted project", async () => {
      const { columns } = await buildDeletedProjectFixture();

      const response = await jsonRequest(
        `/column/${columns.done.id}`,
        "delete",
      );

      expect(response.status).toBe(404);
      expect((await reloadColumn(columns.done.id)).id).toBe(columns.done.id);
    });

    it("refuses to reorder the columns of a soft-deleted project", async () => {
      const { project, columns } = await buildDeletedProjectFixture();
      const before = await reloadColumn(columns.todo.id);

      const response = await jsonRequest(
        `/column/reorder/${project.id}`,
        "put",
        { columns: [{ id: columns.todo.id, position: 99 }] },
      );

      expect(response.status).toBe(404);
      const after = await reloadColumn(columns.todo.id);
      expect(after.position).toBe(before.position);
    });
  });

  describe("task routes", () => {
    it("returns 404 fetching a soft-deleted project's task by id", async () => {
      const { task } = await buildDeletedProjectFixture();

      const response = await getRequest(`/task/${task.id}`);

      expect(response.status).toBe(404);
    });

    it("refuses to delete a soft-deleted project's task", async () => {
      const { task } = await buildDeletedProjectFixture();

      const response = await jsonRequest(`/task/${task.id}`, "delete");

      expect(response.status).toBe(404);
      // The row must survive: `getTask` (which delete-task.ts calls) is the guard.
      expect((await reloadTask(task.id)).id).toBe(task.id);
    });

    it("refuses a full task update on a soft-deleted project's task", async () => {
      const { task, project } = await buildDeletedProjectFixture();

      const response = await jsonRequest(`/task/${task.id}`, "put", {
        title: "Renamed while deleted",
        description: "should not be stored",
        projectId: project.id,
        status: "to-do",
        priority: "high",
        position: 1,
      });

      expect(response.status).toBe(404);
      const row = await reloadTask(task.id);
      expect(row.title).toBe(task.title);
      expect(row.priority).toBe(task.priority);
    });

    // Every single-field task route, so a new one cannot be added without a
    // deliberate decision about whether it belongs in this list.
    const singleFieldRoutes: ReadonlyArray<{
      name: string;
      path: (taskId: string) => string;
      method: "put";
      body: Record<string, unknown>;
      changed: (row: typeof schema.taskTable.$inferSelect) => unknown;
    }> = [
      {
        name: "title",
        path: (id) => `/task/title/${id}`,
        method: "put",
        body: { title: "Renamed while deleted" },
        changed: (row) => row.title,
      },
      {
        name: "description",
        path: (id) => `/task/description/${id}`,
        method: "put",
        body: { description: "Rewritten while deleted" },
        changed: (row) => row.description,
      },
      {
        name: "priority",
        path: (id) => `/task/priority/${id}`,
        method: "put",
        body: { priority: "urgent" },
        changed: (row) => row.priority,
      },
      {
        name: "status",
        path: (id) => `/task/status/${id}`,
        method: "put",
        body: { status: "done" },
        changed: (row) => row.status,
      },
      {
        name: "due-date",
        path: (id) => `/task/due-date/${id}`,
        method: "put",
        body: { dueDate: "2030-01-01" },
        changed: (row) => row.dueDate,
      },
      {
        name: "assignee (unassign)",
        path: (id) => `/task/assignee/${id}`,
        method: "put",
        body: { userId: null },
        changed: (row) => row.userId,
      },
    ];

    for (const route of singleFieldRoutes) {
      it(`refuses to change a soft-deleted project's task ${route.name}`, async () => {
        const { task } = await buildDeletedProjectFixture();
        const before = route.changed(await reloadTask(task.id));

        const response = await jsonRequest(
          route.path(task.id),
          route.method,
          route.body,
        );

        expect(response.status).toBe(404);
        const row = await reloadTask(task.id);
        expect(route.changed(row)).toEqual(before);
      });
    }

    it("refuses to move a soft-deleted project's task out of it", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project: deleted, columns: deletedColumns } =
        await createProjectFixture({
          workspaceId: member.workspace.id,
          name: "Deleted",
          slug: "deleted",
        });
      const { project: destination } = await createProjectFixture({
        workspaceId: member.workspace.id,
        name: "Destination",
        slug: "destination",
      });

      const [task] = await db
        .insert(schema.taskTable)
        .values({
          projectId: deleted.id,
          title: "Frozen task",
          status: "to-do",
          columnId: deletedColumns.todo.id,
          priority: "medium",
          number: 1,
          position: 1,
        })
        .returning();

      if (!task) {
        throw new Error("failed to seed task");
      }

      await softDeleteProject(deleted.id);
      mockAuthenticatedSession(member.user);

      const response = await jsonRequest(`/task/move/${task.id}`, "put", {
        destinationProjectId: destination.id,
      });

      expect(response.status).toBe(404);
      // Still under the deleted project, not smuggled into the live one.
      expect((await reloadTask(task.id)).projectId).toBe(deleted.id);
    });

    it("refuses to move a task INTO a soft-deleted project", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project: live, columns: liveColumns } =
        await createProjectFixture({
          workspaceId: member.workspace.id,
          name: "Live",
          slug: "live",
        });
      const { project: deleted } = await createProjectFixture({
        workspaceId: member.workspace.id,
        name: "Deleted",
        slug: "deleted",
      });

      const [task] = await db
        .insert(schema.taskTable)
        .values({
          projectId: live.id,
          title: "Live task",
          status: "to-do",
          columnId: liveColumns.todo.id,
          priority: "medium",
          number: 1,
          position: 1,
        })
        .returning();

      if (!task) {
        throw new Error("failed to seed task");
      }

      await softDeleteProject(deleted.id);
      mockAuthenticatedSession(member.user);

      const response = await jsonRequest(`/task/move/${task.id}`, "put", {
        destinationProjectId: deleted.id,
      });

      expect(response.status).toBe(404);
      expect((await reloadTask(task.id)).projectId).toBe(live.id);
    });

    it("refuses to import into a soft-deleted project", async () => {
      const { project } = await buildDeletedProjectFixture();

      const response = await jsonRequest(`/task/import/${project.id}`, "post", {
        tasks: [
          { title: "Imported while deleted", status: "to-do", priority: "low" },
        ],
      });

      expect(response.status).toBe(404);

      const rows = await db
        .select({ title: schema.taskTable.title })
        .from(schema.taskTable)
        .where(eq(schema.taskTable.projectId, project.id));
      expect(rows.map((row) => row.title)).not.toContain(
        "Imported while deleted",
      );
    });

    it("skips a soft-deleted project's tasks in a bulk operation", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project: deleted, columns: deletedColumns } =
        await createProjectFixture({
          workspaceId: member.workspace.id,
          name: "Deleted",
          slug: "deleted",
        });
      const { project: live, columns: liveColumns } =
        await createProjectFixture({
          workspaceId: member.workspace.id,
          name: "Live",
          slug: "live",
        });

      const [frozen] = await db
        .insert(schema.taskTable)
        .values({
          projectId: deleted.id,
          title: "Frozen task",
          status: "to-do",
          columnId: deletedColumns.todo.id,
          priority: "medium",
          number: 1,
          position: 1,
        })
        .returning();
      const [liveTask] = await db
        .insert(schema.taskTable)
        .values({
          projectId: live.id,
          title: "Live task",
          status: "to-do",
          columnId: liveColumns.todo.id,
          priority: "medium",
          number: 1,
          position: 1,
        })
        .returning();

      if (!frozen || !liveTask) {
        throw new Error("failed to seed tasks");
      }

      await softDeleteProject(deleted.id);
      mockAuthenticatedSession(member.user);

      const response = await jsonRequest("/task/bulk", "patch", {
        taskIds: [frozen.id, liveTask.id],
        operation: "updatePriority",
        value: "high",
      });

      // The live task is still updated -- one deleted project must not fail the
      // whole batch for the caller.
      expect(response.status).toBe(200);
      expect((await reloadTask(frozen.id)).priority).toBe("medium");
      expect((await reloadTask(liveTask.id)).priority).toBe("high");
    });

    it("reports 404 when every requested id belongs to a soft-deleted project", async () => {
      const { task } = await buildDeletedProjectFixture();

      const response = await jsonRequest("/task/bulk", "patch", {
        taskIds: [task.id],
        operation: "updatePriority",
        value: "high",
      });

      expect(response.status).toBe(404);
      expect((await reloadTask(task.id)).priority).toBe("medium");
    });
  });

  /**
   * These two routes live inline in `task/index.ts` rather than in a controller, so the
   * first pass over #202 missed them -- found by an independent reviewer's live probe
   * (`softDeleted: 200` where it expected 404). Each case is two-sided on purpose: the
   * same request succeeds against a *live* project's task and fails against a
   * soft-deleted one, so the 404 can only be the freeze, not a malformed request.
   */
  describe("task image-upload routes", () => {
    const uploadBody = {
      filename: "probe.png",
      contentType: "image/png",
      size: 128,
      surface: "description" as const,
    };

    // A live upload route needs a configured driver or it answers 503 before the
    // project is ever consulted, which would make a "refuses for a deleted project"
    // assertion pass for the wrong reason. The filesystem driver is the default once
    // its root is set -- same arrangement `storage-filesystem-upload.test.ts` uses.
    let root: string;
    const originalRoot = process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
    const originalDriver = process.env.TASKDESK_STORAGE_DRIVER;

    beforeEach(async () => {
      root = await mkdtemp(path.join(tmpdir(), "taskdesk-202-image-upload-"));
      process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = root;
      delete process.env.TASKDESK_STORAGE_DRIVER;
    });

    afterEach(async () => {
      if (originalRoot === undefined) {
        delete process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT;
      } else {
        process.env.TASKDESK_STORAGE_FILESYSTEM_ROOT = originalRoot;
      }
      if (originalDriver === undefined) {
        delete process.env.TASKDESK_STORAGE_DRIVER;
      } else {
        process.env.TASKDESK_STORAGE_DRIVER = originalDriver;
      }
      await rm(root, { recursive: true, force: true });
    });

    async function createLiveTask() {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });

      const [task] = await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          title: "Uploadable task",
          status: "to-do",
          columnId: columns.todo.id,
          priority: "medium",
          number: 1,
          position: 1,
        })
        .returning();

      if (!task) {
        throw new Error("failed to seed task");
      }

      mockAuthenticatedSession(member.user);
      return { member, project, task };
    }

    async function mintUploadKey(taskId: string) {
      const response = await jsonRequest(
        `/task/image-upload/${taskId}`,
        "put",
        uploadBody,
      );
      expect(response.status).toBe(200);
      const payload = (await response.json()) as { key?: string };
      if (!payload.key) {
        throw new Error("upload route returned no key");
      }
      return payload.key;
    }

    it("mints an upload URL while the project is live, then refuses once it is deleted", async () => {
      const { project, task } = await createLiveTask();

      const liveResponse = await jsonRequest(
        `/task/image-upload/${task.id}`,
        "put",
        uploadBody,
      );
      expect(liveResponse.status).toBe(200);

      await softDeleteProject(project.id);

      const frozenResponse = await jsonRequest(
        `/task/image-upload/${task.id}`,
        "put",
        uploadBody,
      );

      // Only `deleted_at` differs between the two calls, so the 404 can only be the
      // freeze -- not a malformed body and not an unconfigured storage driver.
      expect(frozenResponse.status).toBe(404);
    });

    it("finalizes a key while the project is live, then refuses once it is deleted", async () => {
      const { project, task } = await createLiveTask();

      // Two keys, minted while the project is live and therefore both genuinely valid.
      const keyBeforeDelete = await mintUploadKey(task.id);
      const keyAfterDelete = await mintUploadKey(task.id);

      const control = await jsonRequest(
        `/task/image-upload/${task.id}/finalize`,
        "post",
        { ...uploadBody, key: keyBeforeDelete },
      );
      expect(control.status).toBe(200);

      await softDeleteProject(project.id);

      const frozen = await jsonRequest(
        `/task/image-upload/${task.id}/finalize`,
        "post",
        { ...uploadBody, key: keyAfterDelete },
      );

      // Only `deleted_at` differs between the two calls.
      expect(frozen.status).toBe(404);
    });
  });

  /**
   * The workflow-rule routes were the second hole an independent reviewer found, after the
   * image-upload pair above -- `workspaceAccess.fromProject("projectId")` makes the subject
   * a project, but neither controller ever touched `projectTable`, so nothing in the chain
   * applied PR #200's exclusion. Unlike the other routes here, `GET` is the sharper half:
   * a deleted project's automation was still readable *and* a brand-new rule could still be
   * created against it.
   */
  describe("workflow-rule routes", () => {
    function upsertBody(columnId: string) {
      return {
        integrationType: "webhook",
        eventType: "task.created",
        columnId,
      };
    }

    async function countRules(projectId: string) {
      const rows = await db
        .select({ id: schema.workflowRuleTable.id })
        .from(schema.workflowRuleTable)
        .where(eq(schema.workflowRuleTable.projectId, projectId));
      return rows.length;
    }

    it("lists a live project's rules, then 404s once the project is deleted", async () => {
      const { project, columns } = await (async () => {
        const member = await createWorkspaceMember({ role: "admin" });
        const fixture = await createProjectFixture({
          workspaceId: member.workspace.id,
        });
        mockAuthenticatedSession(member.user);
        return fixture;
      })();

      const created = await jsonRequest(
        `/workflow-rule/${project.id}`,
        "put",
        upsertBody(columns.done.id),
      );
      expect(created.status).toBe(200);

      const listed = await getRequest(`/workflow-rule/${project.id}`);
      expect(listed.status).toBe(200);
      expect(await countRules(project.id)).toBe(1);

      await softDeleteProject(project.id);

      const afterDelete = await getRequest(`/workflow-rule/${project.id}`);
      expect(afterDelete.status).toBe(404);
      // Hidden, not erased -- the row survives, exactly like the project it belongs to.
      expect(await countRules(project.id)).toBe(1);
    });

    it("refuses to create or update a rule on a soft-deleted project", async () => {
      const { project, columns } = await (async () => {
        const member = await createWorkspaceMember({ role: "admin" });
        const fixture = await createProjectFixture({
          workspaceId: member.workspace.id,
        });
        mockAuthenticatedSession(member.user);
        return fixture;
      })();

      const live = await jsonRequest(
        `/workflow-rule/${project.id}`,
        "put",
        upsertBody(columns.done.id),
      );
      expect(live.status).toBe(200);
      expect(await countRules(project.id)).toBe(1);

      await softDeleteProject(project.id);

      const frozen = await jsonRequest(
        `/workflow-rule/${project.id}`,
        "put",
        // A different column, so a successful call would be a visible update rather
        // than an idempotent no-op.
        upsertBody(columns.inReview.id),
      );

      expect(frozen.status).toBe(404);
      const rules = await db
        .select({ columnId: schema.workflowRuleTable.columnId })
        .from(schema.workflowRuleTable)
        .where(eq(schema.workflowRuleTable.projectId, project.id));
      expect(rules).toHaveLength(1);
      expect(rules[0]?.columnId).toBe(columns.done.id);
    });

    it("refuses to delete a rule belonging to a soft-deleted project", async () => {
      const member = await createWorkspaceMember({ role: "admin" });
      const { project, columns } = await createProjectFixture({
        workspaceId: member.workspace.id,
      });
      mockAuthenticatedSession(member.user);

      const created = await jsonRequest(
        `/workflow-rule/${project.id}`,
        "put",
        upsertBody(columns.done.id),
      );
      expect(created.status).toBe(200);
      const rule = (await created.json()) as { id: string };

      await softDeleteProject(project.id);

      const deleted = await jsonRequest(`/workflow-rule/${rule.id}`, "delete");

      expect(deleted.status).toBe(404);
      expect(await countRules(project.id)).toBe(1);
    });
  });
});
