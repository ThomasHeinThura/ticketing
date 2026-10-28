/**
 * P1-5 / P1-23 hierarchy-aware soft-delete purge (WRITTEN, NOT RUN by its author -- the
 * coordinator runs DB integration tests).
 *
 *  - P1-23 (`WI-22`): children of a purged work item are detached (`parent_id` -> null) and
 *    journaled as activity, then the parent is purged; a parent still inside its 30-day window
 *    keeps its children attached (restore keeps working).
 *  - P1-5 (`PR-1`, `PR-16`): a soft-deleted project that still has a child project is not
 *    purged (its RESTRICT parent FK would fail every night); children go first, the parent
 *    follows on a later page; deleting a project that has live children is refused with 409.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { purgeSoftDeletedRows } from "../../apps/api/src/scheduler/soft-delete-purge";
import { buildTenant, json, type Tenant } from "./helpers/approval-fixtures";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  grantProjectRole,
  requireRow,
} from "./helpers/fixtures";
import { ensureAgentSession } from "./helpers/pending-deletion";
import { projectKey } from "./helpers/project-key";

const DAY_MS = 24 * 60 * 60 * 1000;

async function createChildItem(t: Tenant, parentId: string) {
  mockAuthenticatedSession(t.requester.user);
  const created = await t.app.request(
    `/api/projects/${t.project.id}/work-items`,
    {
      method: "POST",
      headers: json,
      body: JSON.stringify({ typeId: t.workItem.typeId, title: "Child item" }),
    },
  );
  expect(created.status, await created.clone().text()).toBe(200);
  const { key } = (await created.json()) as { key: string };
  const [child] = await db
    .update(schema.workItemTable)
    .set({ parentId })
    .where(eq(schema.workItemTable.key, key))
    .returning();
  return requireRow(child ? [child] : [], "child work item");
}

async function itemRow(id: string) {
  const [row] = await db
    .select()
    .from(schema.workItemTable)
    .where(eq(schema.workItemTable.id, id));
  return row;
}

async function projectRow(id: string) {
  const [row] = await db
    .select({ id: schema.projectTable.id })
    .from(schema.projectTable)
    .where(eq(schema.projectTable.id, id));
  return row;
}

describe("hierarchy-aware soft-delete purge", () => {
  beforeEach(async () => resetTestDatabase());

  it("P1-23: purges a deleted parent work item, detaching its child and journaling it", async () => {
    const t = await buildTenant("purge-parent-item");
    const child = await createChildItem(t, t.workItem.id);
    await db
      .update(schema.workItemTable)
      .set({ deletedAt: new Date(Date.now() - 31 * DAY_MS) })
      .where(eq(schema.workItemTable.id, t.workItem.id));

    const outcome = await purgeSoftDeletedRows();

    expect(outcome.failed).toBe(0);
    expect(await itemRow(t.workItem.id)).toBeUndefined();
    const survivor = await itemRow(child.id);
    expect(survivor?.parentId).toBeNull();
    expect(survivor?.deletedAt).toBeNull();
    const activity = await db
      .select()
      .from(schema.activityTable)
      .where(
        and(
          eq(schema.activityTable.workItemId, child.id),
          eq(schema.activityTable.field, "parent"),
        ),
      );
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({
      verb: "updated",
      actorType: "system",
      oldValue: t.workItem.id,
      newValue: null,
    });
  });

  it("P1-23: inside the 30-day window the child stays attached (restore keeps working)", async () => {
    const t = await buildTenant("purge-parent-window");
    const child = await createChildItem(t, t.workItem.id);
    await db
      .update(schema.workItemTable)
      .set({ deletedAt: new Date(Date.now() - 5 * DAY_MS) })
      .where(eq(schema.workItemTable.id, t.workItem.id));

    await purgeSoftDeletedRows();

    expect((await itemRow(t.workItem.id))?.id).toBe(t.workItem.id);
    expect((await itemRow(child.id))?.parentId).toBe(t.workItem.id);
  });

  it("P1-5: a deleted parent project waits for its child project, then is purged (leaf first)", async () => {
    const t = await buildTenant("purge-parent-project");
    const child = (
      await createProjectFixture({
        workspaceId: t.workspaceId,
        slug: projectKey(),
      })
    ).project;
    await db
      .update(schema.projectTable)
      .set({ parentId: t.project.id })
      .where(eq(schema.projectTable.id, child.id));
    const past = new Date(Date.now() - DAY_MS);
    const deletedAt = new Date(Date.now() - 31 * DAY_MS);
    await db
      .update(schema.projectTable)
      .set({ deletedAt, purgeAfter: past })
      .where(eq(schema.projectTable.id, t.project.id));
    // The child is still live: the parent must not be selected (and so must not fail the FK).
    const first = await purgeSoftDeletedRows();
    expect(first.failed).toBe(0);
    expect(first.degraded).toBe(false);
    expect(await projectRow(t.project.id)).toBeDefined();

    // Once the child is itself deleted and past its window, children go first, the parent follows.
    await db
      .update(schema.projectTable)
      .set({ deletedAt, purgeAfter: past })
      .where(eq(schema.projectTable.id, child.id));
    const second = await purgeSoftDeletedRows();
    expect(second.failed).toBe(0);
    expect(second.projectsPurged).toBe(2);
    expect(await projectRow(child.id)).toBeUndefined();
    expect(await projectRow(t.project.id)).toBeUndefined();
  });

  it("P1-5: deleting a project that has live child projects is refused with 409", async () => {
    const t = await buildTenant("delete-parent-project");
    const child = (
      await createProjectFixture({
        workspaceId: t.workspaceId,
        slug: projectKey(),
      })
    ).project;
    await db
      .update(schema.projectTable)
      .set({ parentId: t.project.id })
      .where(eq(schema.projectTable.id, child.id));
    // The tenant requester's project role carries no project:delete (a project role overrides
    // the workspace owner role on its project), so grant it for this probe.
    await grantProjectRole(t.requester.user.id, t.project.id, [
      "project:delete",
    ]);
    mockAuthenticatedSession(t.requester.user);
    await ensureAgentSession(t.requester.user.id);

    // The request itself is refused: no pending action is recorded for a parent with children.
    const response = await t.app.request(`/api/project/${t.project.id}`, {
      method: "DELETE",
    });

    expect(response.status, await response.clone().text()).toBe(409);
    expect(await response.text()).toContain("project_has_live_children");
  });
});
