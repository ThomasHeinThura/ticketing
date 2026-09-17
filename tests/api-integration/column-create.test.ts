/**
 * #187: creating a column against a soft-deleted project must 404, the same way
 * `get-project.ts` treats a soft-deleted project as gone -- rather than silently adding
 * board structure to a project that ordinary use can no longer see or reach.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

function createColumnRequest(projectId: string, name: string) {
  const { app } = createApp();
  return app.request(`/api/column/${projectId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

describe("API integration: column creation", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("creates a column for an existing project", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });
    mockAuthenticatedSession(member.user);

    const response = await createColumnRequest(project.id, "Blocked");
    expect(response.status).toBe(200);
  });

  it("returns 404 for column creation against a soft-deleted project", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const { project } = await createProjectFixture({
      workspaceId: member.workspace.id,
    });

    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date(), purgeAfter: new Date() })
      .where(eq(schema.projectTable.id, project.id));

    mockAuthenticatedSession(member.user);

    const response = await createColumnRequest(project.id, "Blocked");
    expect(response.status).toBe(404);

    // `createProjectFixture` already seeds the default columns (to-do, etc.), so the
    // assertion has to target the specific column this request would have added,
    // not "no columns for this project at all".
    const persistedColumn = await db.query.columnTable.findFirst({
      where: and(
        eq(schema.columnTable.projectId, project.id),
        eq(schema.columnTable.slug, "blocked"),
      ),
    });
    expect(persistedColumn).toBeUndefined();
  });
});
