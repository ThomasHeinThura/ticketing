/**
 * #187: `GET /task/tasks/{projectId}` and `GET /task/export/{projectId}` must treat a
 * soft-deleted project as gone, the same way `get-project.ts` does -- Opus live-reproduced
 * both routes returning 200 with the deleted project's tasks before this fix.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

async function softDelete(projectId: string) {
  await db
    .update(schema.projectTable)
    .set({ deletedAt: new Date(), purgeAfter: new Date() })
    .where(eq(schema.projectTable.id, projectId));
}

function listTasksRequest(projectId: string) {
  const { app } = createApp();
  return app.request(`/api/task/tasks/${projectId}`);
}

function exportTasksRequest(projectId: string) {
  const { app } = createApp();
  return app.request(`/api/task/export/${projectId}`);
}

describe("API integration: task listing/export against a soft-deleted project", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("returns 404 from the board listing route once the project is soft-deleted", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    await db.insert(schema.taskTable).values({
      projectId: project.id,
      title: "Still on the board",
      status: "to-do",
      columnId: columns.todo.id,
      priority: "medium",
      number: 1,
      position: 1,
    });

    await softDelete(project.id);
    mockAuthenticatedSession(member.user);

    const response = await listTasksRequest(project.id);
    expect(response.status).toBe(404);
  });

  it("returns 404 from the export route once the project is soft-deleted", async () => {
    const member = await createWorkspaceMember();
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    await db.insert(schema.taskTable).values({
      projectId: project.id,
      title: "Exportable task",
      status: "to-do",
      columnId: columns.todo.id,
      priority: "medium",
      number: 1,
      position: 1,
    });

    await softDelete(project.id);
    mockAuthenticatedSession(member.user);

    const response = await exportTasksRequest(project.id);
    expect(response.status).toBe(404);
  });
});
