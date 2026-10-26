import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../../apps/api/src/database";
import { createApp } from "../../../apps/api/src/index";
import { purgeSoftDeletedRows } from "../../../apps/api/src/scheduler/soft-delete-purge";
import { resetTestDatabase } from "../helpers/database";
import { requireRow } from "../helpers/fixtures";
import {
  commitChunk,
  createRun,
  record,
  writerFixture,
} from "./writer-fixture";

const DAY_MS = 24 * 60 * 60 * 1000;

beforeEach(async () => resetTestDatabase());

async function importedItem() {
  const f = await writerFixture();
  const { app } = createApp();
  const run = await createRun(app, f, "persist");
  const { commit } = await commitChunk(app, f, run.id, "c1", [
    record(f, "P-1", {
      comments: [
        {
          sourceId: "p1-c1",
          authorEmail: "held.author@example.test",
          authorName: "Held Author",
          body: "Authored by a placeholder",
        },
      ],
    }),
  ]);
  return { f, run, workItemId: commit.rows[0]?.targetId as string };
}

describe("import provenance and imported-origin persistence (0198)", () => {
  it("rejects malformed provenance and origin markers at the database", async () => {
    const { f, workItemId } = await importedItem();
    const base = {
      resourceType: "import",
      externalId: "x",
      workspaceId: f.workspace.id,
      workItemId,
      entityType: "work_item" as const,
      entityId: workItemId,
      system: "constraint-system",
      origin: "imported" as const,
    };
    await expect(
      db
        .insert(schema.importProvenanceTable)
        .values({ ...base, entityType: "person" as never }),
    ).rejects.toThrow();
    await expect(
      db
        .insert(schema.importProvenanceTable)
        .values({ ...base, origin: "native" as never }),
    ).rejects.toThrow();
    await expect(
      db
        .insert(schema.importProvenanceTable)
        .values({ ...base, taskId: null, workItemId: null }),
    ).rejects.toThrow();
    await expect(
      db
        .insert(schema.importProvenanceTable)
        .values({ ...base, workItemId: "no-such-item" }),
    ).rejects.toThrow();
    await expect(
      db.execute(
        sql`UPDATE "activity" SET "origin" = NULL WHERE "origin" = 'imported'`,
      ),
    ).rejects.toThrow(); // imported_at without origin
    await expect(
      db.execute(
        sql`UPDATE "comment" SET "origin" = 'forged', "imported_at" = now()`,
      ),
    ).rejects.toThrow();
  });

  it("allows one imported provenance row per source entity and keeps legacy task links valid", async () => {
    const { f, workItemId } = await importedItem();
    const dup = {
      resourceType: "import",
      externalId: "issue:P-1",
      workspaceId: f.workspace.id,
      workItemId,
      entityType: "work_item" as const,
      entityId: workItemId,
      system: "persist",
      origin: "imported" as const,
    };
    await expect(
      db.insert(schema.importProvenanceTable).values(dup),
    ).rejects.toThrow();
    // a legacy Kaneo task link (task_id set, no entity anchor) is still a valid row
    const project = requireRow(
      await db
        .select()
        .from(schema.projectTable)
        .where(eq(schema.projectTable.id, f.project.id)),
      "project",
    );
    const task = requireRow(
      await db
        .insert(schema.taskTable)
        .values({
          projectId: project.id,
          userId: f.user.id,
          title: "Legacy task",
          status: "to-do",
          priority: "low",
          number: 1,
        })
        .returning(),
      "legacy task",
    );
    await db.insert(schema.externalLinkTable).values({
      taskId: task.id,
      resourceType: "issue",
      externalId: randomUUID(),
      url: "https://legacy.example.test/1",
    });
    expect(
      (await db.select().from(schema.externalLinkTable)).filter(
        (row) => row.taskId === task.id,
      ),
    ).toHaveLength(1);
  });

  it("deletes provenance with its work item and leaves the claim ledger and placeholder in place", async () => {
    const { workItemId } = await importedItem();
    expect(
      (await db.select().from(schema.importProvenanceTable)).length,
    ).toBeGreaterThan(0);
    await db
      .delete(schema.workItemTable)
      .where(eq(schema.workItemTable.id, workItemId));
    expect(await db.select().from(schema.importProvenanceTable)).toHaveLength(
      0,
    );
    expect(await db.select().from(schema.commentTable)).toHaveLength(0);
    expect(
      await db.select().from(schema.importPlaceholderClaimTable),
    ).toHaveLength(1);
  });

  it("a legal hold on an imported placeholder fences the hard delete of the item they authored", async () => {
    const { workItemId } = await importedItem();
    const [placeholder] = await db
      .select()
      .from(schema.personTable)
      .where(eq(schema.personTable.isPlaceholder, true));
    const hold = requireRow(
      await db
        .insert(schema.legalHoldTable)
        .values({
          scope: "person",
          scopeId: placeholder?.id as string,
          placedBy: "integration-test",
          reason: "imported placeholder hold",
        })
        .returning(),
      "hold",
    );
    await db
      .update(schema.workItemTable)
      .set({ deletedAt: new Date(Date.now() - 45 * DAY_MS) })
      .where(eq(schema.workItemTable.id, workItemId));
    await purgeSoftDeletedRows();
    expect(
      await db
        .select({ id: schema.workItemTable.id })
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.id, workItemId)),
    ).toHaveLength(1);
    await db
      .update(schema.legalHoldTable)
      .set({ liftedAt: new Date(), liftedBy: "integration-test" })
      .where(eq(schema.legalHoldTable.id, hold.id));
    await purgeSoftDeletedRows();
    expect(
      await db
        .select({ id: schema.workItemTable.id })
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.id, workItemId)),
    ).toHaveLength(0);
    // the imported comment, its provenance and the activity went with the item
    expect(await db.select().from(schema.commentTable)).toHaveLength(0);
    expect(await db.select().from(schema.importProvenanceTable)).toHaveLength(
      0,
    );
  });
});
