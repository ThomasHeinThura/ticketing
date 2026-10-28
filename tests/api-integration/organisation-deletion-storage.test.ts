import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
} from "./helpers/fixtures";

async function project() {
  const member = await createWorkspaceMember({ role: "admin" });
  return (await createProjectFixture({ workspaceId: member.workspace.id }))
    .project;
}
async function current(id: string) {
  const [row] = await db
    .select()
    .from(schema.projectTable)
    .where(eq(schema.projectTable.id, id));
  if (!row) throw new Error("Expected fixture project");
  return row;
}

describe("organisation deletion restore storage fences", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("preserves the deletion marker only for its archive and fences an independent same-value archive", async () => {
    const row = await project();
    const [archived] = await db
      .update(schema.projectTable)
      .set({
        archivedAt: new Date(),
        organisationDeletionOperationId: "operation-owned",
        archiveVersion: 99,
      })
      .where(eq(schema.projectTable.id, row.id))
      .returning();
    if (!archived) throw new Error("Archive did not return fixture project");
    expect(archived.archiveVersion).toBe(1);
    expect(archived.organisationDeletionOperationId).toBe("operation-owned");
    // Even an idempotent independent archive is a new choice, not permission to restore.
    await db
      .update(schema.projectTable)
      .set({ archivedAt: archived.archivedAt })
      .where(eq(schema.projectTable.id, row.id));
    expect(await current(row.id)).toMatchObject({
      archiveVersion: 2,
      organisationDeletionOperationId: null,
    });
  });

  it("fences delete/restore ABA even when the project ends with the same visible archive state", async () => {
    const row = await project();
    await db
      .update(schema.projectTable)
      .set({
        archivedAt: new Date(),
        organisationDeletionOperationId: "operation-owned",
      })
      .where(eq(schema.projectTable.id, row.id));
    await db
      .update(schema.projectTable)
      .set({
        deletedAt: new Date(),
        purgeAfter: new Date(Date.now() + 86400000),
      })
      .where(eq(schema.projectTable.id, row.id));
    await db
      .update(schema.projectTable)
      .set({ deletedAt: null, purgeAfter: null })
      .where(eq(schema.projectTable.id, row.id));
    expect(await current(row.id)).toMatchObject({
      archiveVersion: 3,
      organisationDeletionOperationId: null,
      deletedAt: null,
    });
  });

  it("rejects nonrepresentable restore generations at the database boundary", async () => {
    const row = await project();
    await expect(
      db.execute(
        sql`UPDATE project SET archive_version = 9007199254740992 WHERE id = ${row.id}`,
      ),
    ).rejects.toThrow();
    expect((await current(row.id)).archiveVersion).toBe(0);
  });
});
