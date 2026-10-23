/**
 * `session-cleanup`'s soft-delete purge (`WI-21`, `PR-16`, `PA-12`): soft-deleted work items
 * and projects past their 30-day window are hard-deleted; an open `legal_hold` on the
 * organisation or an attached person leaves the row soft-deleted until the hold lifts.
 *
 * Every hold case is two-sided: the same row is purged once the hold is lifted, so a passing
 * "retained" assertion cannot mean "nothing matched".
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { purgeSoftDeletedRows } from "../../apps/api/src/scheduler/soft-delete-purge";
import {
  buildTenant,
  createApproval,
  type Tenant,
} from "./helpers/approval-fixtures";
import { resetTestDatabase } from "./helpers/database";
import { requireRow } from "./helpers/fixtures";

const DAY_MS = 24 * 60 * 60 * 1000;

async function softDeleteWorkItem(t: Tenant, ageDays: number) {
  await db
    .update(schema.workItemTable)
    .set({ deletedAt: new Date(Date.now() - ageDays * DAY_MS) })
    .where(eq(schema.workItemTable.id, t.workItem.id));
}

async function workItemExists(id: string) {
  const rows = await db
    .select({ id: schema.workItemTable.id })
    .from(schema.workItemTable)
    .where(eq(schema.workItemTable.id, id));
  return rows.length === 1;
}

async function projectExists(id: string) {
  const rows = await db
    .select({ id: schema.projectTable.id })
    .from(schema.projectTable)
    .where(eq(schema.projectTable.id, id));
  return rows.length === 1;
}

async function workspaceOrganisation(t: Tenant) {
  return requireRow(
    await db
      .select({ organisationId: schema.workspaceTable.organisationId })
      .from(schema.workspaceTable)
      .where(eq(schema.workspaceTable.id, t.workspaceId)),
    "workspace organisation",
  ).organisationId;
}

async function placeHold(scope: "organisation" | "person", scopeId: string) {
  return requireRow(
    await db
      .insert(schema.legalHoldTable)
      .values({
        scope,
        scopeId,
        placedBy: "integration-test",
        reason: "soft-delete purge test",
      })
      .returning(),
    "placeHold",
  );
}

async function liftHold(id: string) {
  await db
    .update(schema.legalHoldTable)
    .set({ liftedAt: new Date(), liftedBy: "integration-test" })
    .where(eq(schema.legalHoldTable.id, id));
}

describe("soft-delete purge", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("purges a work item past its 30-day window and keeps one still inside it", async () => {
    const old = await buildTenant("purge-old");
    const recent = await buildTenant("purge-recent");
    await softDeleteWorkItem(old, 31);
    await softDeleteWorkItem(recent, 29);

    const outcome = await purgeSoftDeletedRows();

    expect(outcome.degraded).toBe(false);
    expect(await workItemExists(old.workItem.id)).toBe(false);
    expect(await workItemExists(recent.workItem.id)).toBe(true);
  });

  it("never purges a live work item", async () => {
    const live = await buildTenant("purge-live");
    await purgeSoftDeletedRows();
    expect(await workItemExists(live.workItem.id)).toBe(true);
  });

  it("retains a work item under an organisation hold until the hold lifts", async () => {
    const t = await buildTenant("purge-org-hold");
    await softDeleteWorkItem(t, 40);
    const hold = await placeHold(
      "organisation",
      await workspaceOrganisation(t),
    );

    await purgeSoftDeletedRows();
    expect(await workItemExists(t.workItem.id)).toBe(true);

    await liftHold(hold.id);
    await purgeSoftDeletedRows();
    expect(await workItemExists(t.workItem.id)).toBe(false);
  });

  it("retains a work item whose requester is under a person hold until it lifts", async () => {
    const t = await buildTenant("purge-person-hold");
    await db
      .update(schema.workItemTable)
      .set({ requesterId: t.requesterPerson.id })
      .where(eq(schema.workItemTable.id, t.workItem.id));
    await softDeleteWorkItem(t, 40);
    const hold = await placeHold("person", t.requesterPerson.id);

    await purgeSoftDeletedRows();
    expect(await workItemExists(t.workItem.id)).toBe(true);

    await liftHold(hold.id);
    await purgeSoftDeletedRows();
    expect(await workItemExists(t.workItem.id)).toBe(false);
  });

  it("purges a soft-deleted project past purge_after with its work items, and is idempotent", async () => {
    const t = await buildTenant("purge-project");
    const keep = await buildTenant("purge-project-keep");
    const past = new Date(Date.now() - DAY_MS);
    await db
      .update(schema.projectTable)
      .set({ deletedAt: new Date(Date.now() - 31 * DAY_MS), purgeAfter: past })
      .where(eq(schema.projectTable.id, t.project.id));
    await db
      .update(schema.projectTable)
      .set({
        deletedAt: new Date(),
        purgeAfter: new Date(Date.now() + 30 * DAY_MS),
      })
      .where(eq(schema.projectTable.id, keep.project.id));

    const first = await purgeSoftDeletedRows();
    expect(first.projectsPurged).toBe(1);
    expect(await projectExists(t.project.id)).toBe(false);
    expect(await workItemExists(t.workItem.id)).toBe(false);
    expect(await projectExists(keep.project.id)).toBe(true);

    const second = await purgeSoftDeletedRows();
    expect(second.projectsPurged).toBe(0);
    expect(second.workItemsPurged).toBe(0);
  });

  it("retains a soft-deleted project under an organisation hold", async () => {
    const t = await buildTenant("purge-project-hold");
    await db
      .update(schema.projectTable)
      .set({
        deletedAt: new Date(Date.now() - 31 * DAY_MS),
        purgeAfter: new Date(Date.now() - DAY_MS),
      })
      .where(eq(schema.projectTable.id, t.project.id));
    const hold = await placeHold(
      "organisation",
      await workspaceOrganisation(t),
    );

    await purgeSoftDeletedRows();
    expect(await projectExists(t.project.id)).toBe(true);

    await liftHold(hold.id);
    await purgeSoftDeletedRows();
    expect(await projectExists(t.project.id)).toBe(false);
  });

  describe("holds on every person whose rows cascade away (F8)", () => {
    const body = { type: "doc", content: [] };

    async function attach(
      t: Tenant,
      values: Partial<typeof schema.attachmentTable.$inferInsert> = {},
    ) {
      await db.insert(schema.attachmentTable).values({
        workspaceId: t.workspaceId,
        workItemId: t.workItem.id,
        objectKey: `purge/${randomUUID()}`,
        filename: "f.txt",
        mimeType: "text/plain",
        size: 1,
        state: "ready",
        customerVisible: false,
        ...values,
      });
    }

    async function expectHeldThenPurged(t: Tenant, personId: string) {
      await softDeleteWorkItem(t, 40);
      const hold = await placeHold("person", personId);
      await purgeSoftDeletedRows();
      expect(await workItemExists(t.workItem.id)).toBe(true);
      await liftHold(hold.id);
      await purgeSoftDeletedRows();
      expect(await workItemExists(t.workItem.id)).toBe(false);
    }

    it("retains a work item whose comment author is held", async () => {
      const t = await buildTenant("purge-comment-author");
      await db.insert(schema.commentTable).values({
        workspaceId: t.workspaceId,
        workItemId: t.workItem.id,
        authorId: t.approverPerson.id,
        actorType: "person",
        body,
        visibility: "internal",
      });
      await expectHeldThenPurged(t, t.approverPerson.id);
    });

    it("retains a work item whose comment author is recorded by raw user id", async () => {
      const t = await buildTenant("purge-comment-author-user");
      await db.insert(schema.commentTable).values({
        workspaceId: t.workspaceId,
        workItemId: t.workItem.id,
        authorId: t.approver.user.id,
        actorType: "person",
        body,
        visibility: "internal",
      });
      await expectHeldThenPurged(t, t.approverPerson.id);
    });

    it("retains a work item whose activity actor is held", async () => {
      const t = await buildTenant("purge-activity-actor");
      await db.insert(schema.activityTable).values({
        workspaceId: t.workspaceId,
        workItemId: t.workItem.id,
        actorId: t.approverPerson.id,
        actorType: "person",
        verb: "commented",
      });
      await expectHeldThenPurged(t, t.approverPerson.id);
    });

    it("retains a work item whose attachment uploader is held", async () => {
      const t = await buildTenant("purge-uploader");
      await attach(t, { uploadedBy: t.approverPerson.id, state: "deleted" });
      await softDeleteWorkItem(t, 40);
      const hold = await placeHold("person", t.approverPerson.id);
      await purgeSoftDeletedRows();
      expect(await workItemExists(t.workItem.id)).toBe(true);
      // The hold is the only thing pinning it: once lifted, the purge hands the attachment to
      // `attachment-gc` and waits for it (the item is purged only after the row is gone).
      await liftHold(hold.id);
      const awaiting = await purgeSoftDeletedRows();
      expect(awaiting.awaitingAttachments).toBe(1);
      expect(await workItemExists(t.workItem.id)).toBe(true);
      // Simulate attachment-gc finishing (object removed, row deleted), then the purge completes.
      await db
        .delete(schema.attachmentTable)
        .where(eq(schema.attachmentTable.workItemId, t.workItem.id));
      await purgeSoftDeletedRows();
      expect(await workItemExists(t.workItem.id)).toBe(false);
    });

    it("retains a work item with a held watcher", async () => {
      const t = await buildTenant("purge-watcher");
      await db.insert(schema.watcherTable).values({
        workItemId: t.workItem.id,
        personId: t.approverPerson.id,
        source: "explicit",
      });
      await expectHeldThenPurged(t, t.approverPerson.id);
    });

    it("retains a work item whose approval approver is held", async () => {
      const t = await buildTenant("purge-approver");
      await createApproval(t);
      await expectHeldThenPurged(t, t.approverPerson.id);
    });

    it("retains a project when only a comment author on one of its items is held", async () => {
      const t = await buildTenant("purge-project-author");
      await db.insert(schema.commentTable).values({
        workspaceId: t.workspaceId,
        workItemId: t.workItem.id,
        authorId: t.approverPerson.id,
        actorType: "person",
        body,
        visibility: "internal",
      });
      await db
        .update(schema.projectTable)
        .set({
          deletedAt: new Date(Date.now() - 31 * DAY_MS),
          purgeAfter: new Date(Date.now() - DAY_MS),
        })
        .where(eq(schema.projectTable.id, t.project.id));
      const hold = await placeHold("person", t.approverPerson.id);
      await purgeSoftDeletedRows();
      expect(await projectExists(t.project.id)).toBe(true);
      await liftHold(hold.id);
      await purgeSoftDeletedRows();
      expect(await projectExists(t.project.id)).toBe(false);
    });
  });

  describe("budgeted drain (F9)", () => {
    it("pages past a row awaiting attachments and still purges the rest", async () => {
      const stuck = await buildTenant("purge-stuck");
      const a = await buildTenant("purge-after-a");
      const b = await buildTenant("purge-after-b");
      await db.insert(schema.attachmentTable).values({
        workspaceId: stuck.workspaceId,
        workItemId: stuck.workItem.id,
        objectKey: `purge/${randomUUID()}`,
        filename: "f.txt",
        mimeType: "text/plain",
        size: 1,
        state: "ready",
        customerVisible: false,
      });
      await softDeleteWorkItem(stuck, 60);
      await softDeleteWorkItem(a, 40);
      await softDeleteWorkItem(b, 35);

      const outcome = await purgeSoftDeletedRows({ batch: 1 });

      expect(outcome.workItemsPurged).toBe(2);
      expect(outcome.awaitingAttachments).toBe(1);
      expect(outcome.permanentlyRetained).toBe(0);
      expect(await workItemExists(stuck.workItem.id)).toBe(true);
      expect(await workItemExists(a.workItem.id)).toBe(false);
      expect(await workItemExists(b.workItem.id)).toBe(false);
    });

    it("reports a row pinned by a shared stored object as degraded", async () => {
      const t = await buildTenant("purge-shared");
      const objectKey = `purge/${randomUUID()}`;
      const other = await buildTenant("purge-shared-other");
      for (const target of [t, other])
        await db.insert(schema.attachmentTable).values({
          workspaceId: target.workspaceId,
          workItemId: target.workItem.id,
          objectKey,
          filename: "shared.txt",
          mimeType: "text/plain",
          size: 1,
          state: "ready",
          customerVisible: false,
        });
      await softDeleteWorkItem(t, 40);

      const outcome = await purgeSoftDeletedRows();

      expect(outcome.permanentlyRetained).toBe(1);
      expect(outcome.degraded).toBe(true);
      expect(await workItemExists(t.workItem.id)).toBe(true);
    });
  });
});
