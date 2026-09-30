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

// PR #510 CI found the liveness lock returning its task error before the scoped
// lookup could mask a missing destination id like a foreign workspace project.
describe("PUT /api/task/move/{id} scopes destination project errors", () => {
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
    expect(withForeign.status).toBe(404);
    const foreignBody = await withForeign.text();
    expect(foreignBody).toBe("Project not found");

    const afterForeignRequest = await db.query.taskTable.findFirst({
      where: eq(schema.taskTable.id, task.id),
    });
    expect(afterForeignRequest?.projectId).toBe(project.id);

    const withNonexistent = await app.request(`/api/task/move/${task.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ destinationProjectId: randomUUID() }),
    });
    const nonexistentBody = await withNonexistent.text();
    expect(withForeign.status).toBe(withNonexistent.status);
    expect(withForeign.status).toBe(404);
    expect(foreignBody).toBe(nonexistentBody);
    expect(nonexistentBody).toBe("Project not found");

    const afterNonexistentRequest = await db.query.taskTable.findFirst({
      where: eq(schema.taskTable.id, task.id),
    });
    expect(afterNonexistentRequest?.projectId).toBe(project.id);
  });
});
