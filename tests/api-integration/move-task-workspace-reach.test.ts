import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

async function seedTask(projectId: string, columnId: string) {
  return requireRow(
    await db
      .insert(schema.taskTable)
      .values({
        projectId,
        title: "Seeded task",
        description: "Existing",
        priority: "medium",
        status: "to-do",
        columnId,
        number: 1,
        position: 1,
      })
      .returning(),
    "seedTask",
  );
}

// Issue #307 S2 (Opus review of PR #307, delta round): `move-task.ts` looked up the
// destination project by id with no workspace scope, so a `destinationProjectId`
// belonging to another workspace resolved and then 400'd "can only be moved within
// the same workspace" -- distinguishable from the 404 a nonexistent destination
// project id already gave. The lookup is now scoped to the source project's own
// (already reach-checked) workspace, so both answer this same 404.
describe("issue #307 S2: PUT /api/task/move/{id} scopes the destination project lookup", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("a destination project in another workspace answers exactly like a nonexistent one", async () => {
    const member = await createWorkspaceMember();
    const foreign = await createWorkspaceMember({ role: "admin" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const { project: foreignProject } = await createProjectFixture({
      workspaceId: foreign.workspace.id,
    });
    const task = await seedTask(project.id, columns.todo.id);

    mockAuthenticatedSession(member.user);
    const { app } = createApp();

    const withForeign = await app.request(`/api/task/move/${task.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ destinationProjectId: foreignProject.id }),
    });
    const withNonexistent = await app.request(`/api/task/move/${task.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ destinationProjectId: randomUUID() }),
    });

    const [foreignBody, nonexistentBody] = await Promise.all([
      withForeign.text(),
      withNonexistent.text(),
    ]);
    expect(withForeign.status).toBe(withNonexistent.status);
    expect(withForeign.status).toBe(404);
    expect(foreignBody).toBe(nonexistentBody);
    expect(foreignBody).toBe("Project not found");

    const stillInSourceProject = await db.query.taskTable.findFirst({
      where: eq(schema.taskTable.id, task.id),
    });
    expect(stillInSourceProject?.projectId).toBe(project.id);
  });
});
