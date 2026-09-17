/**
 * #187: global search must not surface a soft-deleted project, or the tasks under it,
 * once it is gone from ordinary use -- Opus live-reproduced searching by project name and
 * by task title both still returning results from a soft-deleted project before this fix.
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

type SearchResult = { id: string; type: string; title: string };

async function search(workspaceId: string, query: string) {
  const { app } = createApp();
  const response = await app.request(
    `/api/search?workspaceId=${workspaceId}&q=${encodeURIComponent(query)}`,
  );
  expect(response.status).toBe(200);
  const payload = (await response.json()) as { results: SearchResult[] };
  return payload.results;
}

describe("API integration: global search excludes a soft-deleted project", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("no longer returns the project itself once soft-deleted", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
      name: "Findable Deleted Project",
    });
    mockAuthenticatedSession(member.user);

    const beforeDelete = await search(
      member.workspace.id,
      "Findable Deleted Project",
    );
    expect(beforeDelete.some((r) => r.id === project.id)).toBe(true);

    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date(), purgeAfter: new Date() })
      .where(eq(schema.projectTable.id, project.id));

    const afterDelete = await search(
      member.workspace.id,
      "Findable Deleted Project",
    );
    expect(afterDelete.some((r) => r.id === project.id)).toBe(false);
  });

  it("no longer returns a task belonging to a soft-deleted project", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project, columns } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    const [task] = await db
      .insert(schema.taskTable)
      .values({
        projectId: project.id,
        title: "Unique Searchable Task Title",
        status: "to-do",
        columnId: columns.todo.id,
        priority: "medium",
        number: 1,
        position: 1,
      })
      .returning();
    if (!task) throw new Error("failed to seed task");

    mockAuthenticatedSession(member.user);

    const beforeDelete = await search(
      member.workspace.id,
      "Unique Searchable Task Title",
    );
    expect(beforeDelete.some((r) => r.id === task.id)).toBe(true);

    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date(), purgeAfter: new Date() })
      .where(eq(schema.projectTable.id, project.id));

    const afterDelete = await search(
      member.workspace.id,
      "Unique Searchable Task Title",
    );
    expect(afterDelete.some((r) => r.id === task.id)).toBe(false);
  });
});
