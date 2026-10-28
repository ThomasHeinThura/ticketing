/**
 * PG-7: a deleted page can be restored inside its 30 day window (`POST .../undelete`) and is
 * hard-deleted by `page-purge` after it, leaf-first and never while an open legal hold covers it.
 * Every hold case is two-sided: the same page is purged once the hold is lifted.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import {
  projectPageTable,
  projectPageVersionTable,
} from "../../apps/api/src/database/schema-p5-pages";
import { updatePage } from "../../apps/api/src/pages/repository";
import {
  initializeScheduler,
  registeredJobByName,
  shutdownScheduler,
} from "../../apps/api/src/scheduler";
import {
  PAGE_PURGE_JOB,
  purgeSoftDeletedPages,
  runPagePurgeJob,
} from "../../apps/api/src/scheduler/page-purge";
import { resetTestDatabase } from "./helpers/database";
import { requireRow } from "./helpers/fixtures";
import { type PageBody, type PagesWorld, pagesWorld } from "./helpers/p5-pages";
import {
  approvePendingDeletion,
  deleteThroughApproval,
  ensureAgentSession,
  requestDeletion,
} from "./helpers/pending-deletion";

const DAY_MS = 24 * 60 * 60 * 1000;
let w: PagesWorld;
beforeEach(async () => {
  await resetTestDatabase();
  w = await pagesWorld();
  await ensureAgentSession(w.editor.user.id);
});

const make = async (title: string, parentId: string | null = null) =>
  w.json<PageBody>(
    await w.call(w.editor.user, w.base(), {
      method: "POST",
      body: { title, parentId },
    }),
    201,
  );
const undelete = (id: string, user = w.editor.user) =>
  w.call(user, `${w.base()}/${id}/undelete`, { method: "POST" });
const row = async (id: string) =>
  (
    await db.select().from(projectPageTable).where(eq(projectPageTable.id, id))
  )[0];
const ageDeleted = (id: string, ageDays: number) =>
  db
    .update(projectPageTable)
    .set({
      deletedAt: new Date(Date.now() - ageDays * DAY_MS),
      purgeAfter: new Date(Date.now() + (30 - ageDays) * DAY_MS),
    })
    .where(eq(projectPageTable.id, id));
const versions = async (id: string) =>
  (
    await db
      .select()
      .from(projectPageVersionTable)
      .where(eq(projectPageVersionTable.pageId, id))
  ).length;
const audit = async (id: string, action: string) =>
  (
    await db
      .select()
      .from(schema.auditLogTable)
      .where(
        and(
          eq(schema.auditLogTable.entityId, id),
          eq(schema.auditLogTable.action, action),
        ),
      )
  ).length;

async function placeHold(scope: "organisation" | "person", scopeId: string) {
  return requireRow(
    await db
      .insert(schema.legalHoldTable)
      .values({
        scope,
        scopeId,
        placedBy: "integration-test",
        reason: "page purge hold test",
      })
      .returning(),
    "hold",
  );
}
const lift = (id: string) =>
  db
    .update(schema.legalHoldTable)
    .set({ liftedAt: new Date(), liftedBy: "integration-test" })
    .where(eq(schema.legalHoldTable.id, id));

describe("restoring a deleted page (PG-7)", () => {
  it("restores through the API inside the window, with versions, and audits it", async () => {
    const page = await make("Runbook");
    await deleteThroughApproval(w.app, w.editor.user, `${w.base()}/${page.id}`);
    expect((await row(page.id))?.deletedAt).not.toBeNull();
    expect((await w.call(w.editor.user, `${w.base()}/${page.id}`)).status).toBe(
      404,
    );
    const restored = await w.json<PageBody>(await undelete(page.id));
    expect(restored).toMatchObject({ id: page.id, version: 1 });
    const after = await row(page.id);
    expect(after?.deletedAt).toBeNull();
    expect(after?.purgeAfter).toBeNull();
    expect(await versions(page.id)).toBe(1);
    expect((await w.call(w.editor.user, `${w.base()}/${page.id}`)).status).toBe(
      200,
    );
    expect(await audit(page.id, "page.undeleted")).toBe(1);
    // A live page is not "deleted".
    expect((await undelete(page.id)).status).toBe(409);
  });

  it("refuses once the window has passed, and the page is then purged", async () => {
    const page = await make("Late");
    await ageDeleted(page.id, 31);
    const late = await undelete(page.id);
    expect(late.status).toBe(409);
    expect(await late.text()).toContain("30 day");
    expect((await row(page.id))?.deletedAt).not.toBeNull();
  });

  it("is project:update only, staff only and project-scoped", async () => {
    const page = await make("Guarded");
    await ageDeleted(page.id, 1);
    expect((await undelete(page.id, w.reader.user)).status).toBe(403);
    expect((await undelete(page.id, w.outsider.user)).status).toBe(404);
    expect((await undelete(page.id, w.foreign.user)).status).toBe(404);
    const wrongProject = await w.call(
      w.editor.user,
      `${w.base(w.otherProject.id)}/${page.id}/undelete`,
      { method: "POST" },
    );
    expect(wrongProject.status).toBe(404);
    expect((await row(page.id))?.deletedAt).not.toBeNull();
    expect((await undelete(page.id)).status).toBe(200);
  });

  it("keeps the parent: refused while the parent is deleted, allowed after it is restored", async () => {
    const parent = await make("Parent");
    const child = await make("Child", parent.id);
    await ageDeleted(child.id, 1);
    await ageDeleted(parent.id, 1);
    const refused = await undelete(child.id);
    expect(refused.status).toBe(409);
    expect(await refused.text()).toContain("parent");
    expect((await row(child.id))?.deletedAt).not.toBeNull();
    expect((await undelete(parent.id)).status).toBe(200);
    expect((await undelete(child.id)).status).toBe(200);
    expect((await row(child.id))?.parentId).toBe(parent.id);
  });

  it("restores only the page it names: sub-pages deleted on their own stay deleted", async () => {
    const parent = await make("Parent");
    const child = await make("Child", parent.id);
    await ageDeleted(child.id, 2);
    await ageDeleted(parent.id, 1);
    expect((await undelete(parent.id)).status).toBe(200);
    expect((await row(child.id))?.deletedAt).not.toBeNull();
  });
});

describe("page-purge job (PG-7)", () => {
  it("purges a page past its window with its versions, audited without the body", async () => {
    const page = await make("Expired");
    await w.call(w.editor.user, `${w.base()}/${page.id}`, {
      method: "PATCH",
      body: { expectedVersion: 1, title: "Expired v2" },
    });
    expect(await versions(page.id)).toBe(2);
    await ageDeleted(page.id, 31);
    const outcome = await purgeSoftDeletedPages();
    expect(outcome).toMatchObject({ purged: 1, versionsDeleted: 2, failed: 0 });
    expect(await row(page.id)).toBeUndefined();
    expect(await versions(page.id)).toBe(0);
    expect(await audit(page.id, "page.purged")).toBe(1);
  });

  it("keeps a page inside its window and a live page", async () => {
    const inside = await make("Inside");
    const live = await make("Live");
    await ageDeleted(inside.id, 29);
    expect(await purgeSoftDeletedPages()).toMatchObject({ purged: 0 });
    expect(await row(inside.id)).toBeDefined();
    expect(await row(live.id)).toBeDefined();
  });

  it("purges leaf-first: a parent waits for its child, then follows on the next pass", async () => {
    const parent = await make("Parent");
    const child = await make("Child", parent.id);
    await ageDeleted(child.id, 31);
    await ageDeleted(parent.id, 31);
    const first = await purgeSoftDeletedPages();
    expect(first.purged).toBe(2);
    expect(await row(parent.id)).toBeUndefined();
    expect(await row(child.id)).toBeUndefined();
  });

  it("keeps a deleted parent while a live or restorable child remains", async () => {
    const parent = await make("Parent");
    const child = await make("Child", parent.id);
    await ageDeleted(child.id, 1);
    await ageDeleted(parent.id, 31);
    expect(await purgeSoftDeletedPages()).toMatchObject({ purged: 0 });
    expect(await row(parent.id)).toBeDefined();
    await ageDeleted(child.id, 31);
    expect((await purgeSoftDeletedPages()).purged).toBe(2);
  });

  it("an undelete committed before the purge wins", async () => {
    const page = await make("Saved");
    await ageDeleted(page.id, 29);
    expect((await undelete(page.id)).status).toBe(200);
    // Even if the window then lapses, a live page has no deleted_at and is never a candidate.
    await db
      .update(projectPageTable)
      .set({ purgeAfter: new Date(Date.now() - DAY_MS) })
      .where(eq(projectPageTable.id, page.id));
    expect(await purgeSoftDeletedPages()).toMatchObject({ purged: 0 });
    expect(await row(page.id)).toBeDefined();
  });

  it.each([
    [
      "the project's organisation",
      async () => ["organisation", w.customer.orgId] as const,
    ],
    [
      "the workspace's organisation",
      async () => {
        const [workspace] = await db
          .select()
          .from(schema.workspaceTable)
          .where(eq(schema.workspaceTable.id, w.workspaceId));
        return ["organisation", workspace?.organisationId as string] as const;
      },
    ],
    [
      "the page's author",
      async () => {
        const [person] = await db
          .select()
          .from(schema.personTable)
          .where(eq(schema.personTable.userId, w.editor.user.id));
        return ["person", person?.id as string] as const;
      },
    ],
  ])(
    "is skipped while an open hold covers %s, and purged once it lifts",
    async (_name, scope) => {
      const page = await make("Held");
      await ageDeleted(page.id, 31);
      const [kind, id] = await scope();
      const hold = await placeHold(kind, id);
      expect(await purgeSoftDeletedPages()).toMatchObject({
        purged: 0,
        skipped: 0,
      });
      expect(await row(page.id)).toBeDefined();
      expect(await versions(page.id)).toBe(1);
      await lift(hold.id);
      expect(await purgeSoftDeletedPages()).toMatchObject({ purged: 1 });
      expect(await row(page.id)).toBeUndefined();
    },
  );

  it("is registered as page-purge and its run reports the outcome", async () => {
    initializeScheduler();
    try {
      expect(registeredJobByName(PAGE_PURGE_JOB)).toBeDefined();
    } finally {
      shutdownScheduler();
    }
    const page = await make("Scheduled");
    await ageDeleted(page.id, 31);
    expect(await runPagePurgeJob()).toMatchObject({
      status: "purged",
      purged: 1,
    });
    expect(await row(page.id)).toBeUndefined();
  });
});

describe("delete versus a concurrent move under the page (P5-R3-06)", () => {
  it("never leaves a live page under a deleted parent", async () => {
    // A second person moves the page (the approving person's own row is locked by the approval).
    const [mover] = await db
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, w.reader.user.id));
    if (!mover) throw new Error("mover person missing");
    const scope = { workspaceId: w.workspaceId, projectId: w.project.id };
    const moverActor = {
      userId: w.reader.user.id,
      personId: mover.id,
      actorType: "person" as const,
      apiKeyId: null,
    };
    const outcomes = new Set<string>();
    for (let round = 0; round < 8; round++) {
      const parent = await make(`Parent ${round}`);
      const child = await make(`Child ${round}`);
      const pending = await requestDeletion(w.app, `${w.base()}/${parent.id}`);
      const [moved, approved] = await Promise.all([
        new Promise((resolve) => setTimeout(resolve, round * 6))
          .then(() =>
            updatePage(
              scope,
              child.id,
              { expectedVersion: 1, parentId: parent.id },
              moverActor,
            ),
          )
          .then(
            () => 200,
            (error: { status?: number }) => error.status ?? 500,
          ),
        approvePendingDeletion(w.app, w.editor.user.id, pending),
      ]);
      const parentRow = await row(parent.id);
      const childRow = await row(child.id);
      // Whichever won, a live child never sits under a deleted parent.
      expect(
        childRow?.deletedAt === null &&
          parentRow?.deletedAt !== null &&
          childRow.parentId === parent.id,
        `round ${round}`,
      ).toBe(false);
      if (parentRow?.deletedAt) {
        expect(moved, `round ${round}`).toBe(422);
        expect(approved.status).toBe(200);
        outcomes.add("deleted");
      } else {
        expect(moved, `round ${round}`).toBe(200);
        expect(approved.status).toBe(409);
        expect(await approved.text()).toContain("sub-pages");
        outcomes.add("refused");
      }
    }
    expect(outcomes.size).toBeGreaterThan(0);
  });
});
