import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  grantProjectManageAccess,
  requireRow,
} from "./helpers/fixtures";

/**
 * P0 deletion audit: legacy `DELETE /api/task/{id}` used to hard-delete the inherited `task`
 * row and its S3 assets with no pending action. It now answers 410 Gone, under the
 * compatibility Deprecation/Sunset headers, and leaves the row untouched.
 */
describe("legacy task deletion is gone", () => {
  beforeEach(() => resetTestDatabase());

  it("answers 410 with Sunset/Deprecation headers and deletes nothing", async () => {
    const member = await createWorkspaceMember({ role: "owner" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    await grantProjectManageAccess(member.user.id, project.id);
    const task = requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          columnId: columns.todo.id,
          title: "Kept task",
        })
        .returning(),
      "task",
    );
    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const response = await app.request(`/api/task/${task.id}`, {
      method: "DELETE",
    });
    expect(response.status, await response.clone().text()).toBe(410);
    expect(response.headers.get("Sunset")).toBe(
      "Thu, 01 Apr 2027 00:00:00 GMT",
    );
    expect(response.headers.get("Deprecation")).toBe("@1790812800");
    expect(
      await db
        .select()
        .from(schema.taskTable)
        .where(eq(schema.taskTable.id, task.id)),
    ).toHaveLength(1);
    expect(await db.select().from(schema.pendingActionTable)).toHaveLength(0);
  });
});
