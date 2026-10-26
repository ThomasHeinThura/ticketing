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
  grantProjectRole,
  requireRow,
} from "./helpers/fixtures";

const PROJECT_READ = ["project:read"];
const WORK_ITEM_READ = ["project:read", "work_item:read"];

async function addProjectItem(
  workspaceId: string,
  projectId: string,
  slug: string,
) {
  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId,
        key: randomUUID(),
        name: "Combined scope fixture",
        category: "delivery",
      })
      .returning(),
    "work item type",
  );
  const template = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId,
        key: randomUUID(),
        name: `${slug} state`,
        group: "unstarted",
      })
      .returning(),
    "state template",
  );
  const state = requireRow(
    await db
      .insert(schema.stateTable)
      .values({ projectId, stateTemplateId: template.id, isDefault: true })
      .returning(),
    "state",
  );
  const item = requireRow(
    await db
      .insert(schema.workItemTable)
      .values({
        workspaceId,
        projectId,
        typeId: type.id,
        stateId: state.id,
        title: `${slug} visible scope fixture`,
        number: 1,
        key: `${slug}-1`,
      })
      .returning(),
    "work item",
  );
  return { item, template };
}

describe("combined project board descendant authorization", () => {
  beforeEach(async () => resetTestDatabase());

  it("filters unreadable projects and stops at archived or deleted ancestors before paging and columns", async () => {
    const member = await createWorkspaceMember({ role: "admin" });
    const projects = await Promise.all(
      [
        "combined-root",
        "combined-readable-child",
        "combined-unreadable-child",
        "combined-archived-ancestor",
        "combined-archived-descendant",
        "combined-deleted-ancestor",
        "combined-deleted-descendant",
      ].map((slug) =>
        createProjectFixture({
          workspaceId: member.workspace.id,
          name: slug,
          slug,
        }),
      ),
    );
    const [
      root,
      readable,
      unreadable,
      archived,
      belowArchived,
      deleted,
      belowDeleted,
    ] = projects.map(({ project }) => project);
    if (
      !root ||
      !readable ||
      !unreadable ||
      !archived ||
      !belowArchived ||
      !deleted ||
      !belowDeleted
    )
      throw new Error("Combined project fixtures were not created");

    await db
      .update(schema.projectTable)
      .set({ parentId: root.id })
      .where(eq(schema.projectTable.id, readable.id));
    await db
      .update(schema.projectTable)
      .set({ parentId: root.id })
      .where(eq(schema.projectTable.id, unreadable.id));
    await db
      .update(schema.projectTable)
      .set({ parentId: root.id, archivedAt: new Date() })
      .where(eq(schema.projectTable.id, archived.id));
    await db
      .update(schema.projectTable)
      .set({ parentId: archived.id })
      .where(eq(schema.projectTable.id, belowArchived.id));
    await db
      .update(schema.projectTable)
      .set({ parentId: root.id, deletedAt: new Date() })
      .where(eq(schema.projectTable.id, deleted.id));
    await db
      .update(schema.projectTable)
      .set({ parentId: deleted.id })
      .where(eq(schema.projectTable.id, belowDeleted.id));

    await grantProjectRole(member.user.id, root.id, WORK_ITEM_READ);
    await grantProjectRole(member.user.id, readable.id, WORK_ITEM_READ);
    await grantProjectRole(member.user.id, unreadable.id, PROJECT_READ);
    await grantProjectRole(member.user.id, archived.id, WORK_ITEM_READ);
    await grantProjectRole(member.user.id, belowArchived.id, WORK_ITEM_READ);
    await grantProjectRole(member.user.id, deleted.id, WORK_ITEM_READ);
    await grantProjectRole(member.user.id, belowDeleted.id, WORK_ITEM_READ);

    const rootItem = await addProjectItem(
      member.workspace.id,
      root.id,
      root.slug,
    );
    const readableItem = await addProjectItem(
      member.workspace.id,
      readable.id,
      readable.slug,
    );
    const unreadableItem = await addProjectItem(
      member.workspace.id,
      unreadable.id,
      unreadable.slug,
    );
    const archivedItem = await addProjectItem(
      member.workspace.id,
      belowArchived.id,
      belowArchived.slug,
    );
    const deletedItem = await addProjectItem(
      member.workspace.id,
      belowDeleted.id,
      belowDeleted.slug,
    );

    mockAuthenticatedSession(member.user);
    const { app } = createApp();
    const first = await app.request(
      `/api/projects/${root.id}/work-items/combined?limit=1&sort=key&dir=asc`,
    );
    expect(first.status, await first.clone().text()).toBe(200);
    const pageOne = (await first.json()) as {
      data: Array<{ key: string; sourceProject: { id: string; name: string } }>;
      columns: Array<{ templateId: string }>;
      page: { hasMore: boolean; nextCursor: string | null };
      meta: { total: number };
    };
    expect(pageOne.meta.total).toBe(2);
    expect(pageOne.data).toHaveLength(1);
    expect(pageOne.page.hasMore).toBe(true);
    expect(pageOne.page.nextCursor).toEqual(expect.any(String));

    const second = await app.request(
      `/api/projects/${root.id}/work-items/combined?limit=1&sort=key&dir=asc&cursor=${encodeURIComponent(pageOne.page.nextCursor ?? "")}`,
    );
    expect(second.status, await second.clone().text()).toBe(200);
    const pageTwo = (await second.json()) as typeof pageOne;
    const rows = [...pageOne.data, ...pageTwo.data];
    expect(rows.map((item) => item.key)).toEqual(
      expect.arrayContaining([rootItem.item.key, readableItem.item.key]),
    );
    expect(rows).toHaveLength(2);
    expect(pageTwo.meta.total).toBe(2);
    expect(pageTwo.page.hasMore).toBe(false);
    expect(rows.map((item) => item.sourceProject.id)).not.toContain(
      unreadable.id,
    );
    expect(rows.map((item) => item.sourceProject.id)).not.toContain(
      belowArchived.id,
    );
    expect(rows.map((item) => item.sourceProject.id)).not.toContain(
      belowDeleted.id,
    );
    expect(rows.map((item) => item.sourceProject.name)).not.toContain(
      unreadable.name,
    );
    expect(rows.map((item) => item.key)).not.toEqual(
      expect.arrayContaining([
        unreadableItem.item.key,
        archivedItem.item.key,
        deletedItem.item.key,
      ]),
    );
    const visibleTemplateIds = pageOne.columns.map(
      (column) => column.templateId,
    );
    expect(visibleTemplateIds).toEqual(
      expect.arrayContaining([rootItem.template.id, readableItem.template.id]),
    );
    expect(visibleTemplateIds).not.toEqual(
      expect.arrayContaining([
        unreadableItem.template.id,
        archivedItem.template.id,
        deletedItem.template.id,
      ]),
    );
  });
});
