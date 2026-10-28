/**
 * R2-L2: `custom_field_value.project_id` follows a work item when it moves projects. A stale value
 * would keep a (workspace, project) FK onto the old project and block that project's purge.
 */
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { customFieldValueTable } from "../../apps/api/src/database/migration-schema";
import { createApp } from "../../apps/api/src/index";
import { purgeSoftDeletedProject } from "../../apps/api/src/scheduler/soft-delete-purge";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  grantProjectRole,
  WORK_ITEM_PROJECT_CAPABILITIES,
} from "./helpers/fixtures";
import { makeCustomField, setCustomValue } from "./helpers/p4-closeout";
import { createItem, json, setupWorld } from "./helpers/reach-world";

describe("API integration: move keeps custom_field_value.project_id current", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("rewrites project_id on move so the old project can be purged", async () => {
    const world = await setupWorld();
    const app = createApp().app;
    const item = await createItem(app, world, "Has values");
    const field = await makeCustomField(world.workspaceId, world.type.id, {
      key: "r2l2",
      format: "text",
    });
    await setCustomValue(
      world.workspaceId,
      field.id,
      { id: item.id, projectId: world.project.id },
      "kept",
    );

    const { project: target } = await createProjectFixture({
      workspaceId: world.workspaceId,
    });
    const now = new Date();
    await db.insert(schema.stateTable).values([
      {
        projectId: target.id,
        stateTemplateId: world.transition.fromStateTemplateId as string,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await grantProjectRole(world.projectMember.user.id, target.id, [
      ...WORK_ITEM_PROJECT_CAPABILITIES,
    ]);

    mockAuthenticatedSession(world.projectMember.user);
    const response = await json(
      app,
      "POST",
      `/api/v2/work-items/${item.key}/move`,
      { targetProjectId: target.id, moveChildren: false },
      { "if-match": '"1"' },
    );
    expect(response.status, await response.clone().text()).toBe(200);

    const [value] = await db
      .select()
      .from(customFieldValueTable)
      .where(eq(customFieldValueTable.entityId, item.id));
    expect(value?.projectId).toBe(target.id);
    expect(value?.value).toBe("kept");

    // The old project is soft-deleted past its window and purged; nothing still points at it.
    await db
      .update(schema.projectTable)
      .set({
        deletedAt: new Date(Date.now() - 40 * 86_400_000),
        purgeAfter: new Date(Date.now() - 86_400_000),
      })
      .where(eq(schema.projectTable.id, world.project.id));
    const purged = await purgeSoftDeletedProject(world.project.id);
    expect(purged.result).toBe("purged");
    const [after] = await db
      .select()
      .from(customFieldValueTable)
      .where(eq(customFieldValueTable.entityId, item.id));
    expect(after?.projectId).toBe(target.id);
  }, 60_000);
});
