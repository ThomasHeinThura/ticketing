/**
 * #314: a work item's state name and category come from a `state_template` of its own
 * workspace only. A state pointing at another workspace's template must not leak that name
 * through the item detail or the list.
 */
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { seedProjectStates } from "../../apps/api/src/utils/seed-project-states";
import { seedWorkspaceDefaults } from "../../apps/api/src/utils/seed-workspace-defaults";
import { createWorkItem } from "../../apps/api/src/work-item/controllers/create-work-item";
import { getWorkItemByKey } from "../../apps/api/src/work-item/controllers/get-work-item";
import { listWorkItems } from "../../apps/api/src/work-item/controllers/list-work-items";
import { resetTestDatabase } from "./helpers/database";
import {
  createProjectFixture,
  createWorkspaceMember,
  requireRow,
} from "./helpers/fixtures";

beforeEach(resetTestDatabase);

describe("work item state name is scoped to the item's workspace (#314)", () => {
  it("does not resolve a state template from another workspace", async () => {
    const actor = await createWorkspaceMember({ role: "member" });
    await seedWorkspaceDefaults(actor.workspace.id);
    const { project } = await createProjectFixture({
      workspaceId: actor.workspace.id,
    });
    await seedProjectStates(project.id, actor.workspace.id);
    const type = requireRow(
      await db
        .select()
        .from(schema.workItemTypeTable)
        .where(
          and(
            eq(schema.workItemTypeTable.workspaceId, actor.workspace.id),
            eq(schema.workItemTypeTable.key, "task"),
          ),
        ),
      "type",
    );
    const item = await createWorkItem({
      projectId: project.id,
      workspaceId: actor.workspace.id,
      typeId: type.id,
      title: "Scoped state",
      actorId: actor.user.id,
      actorType: "person",
    });
    expect(
      (await getWorkItemByKey(item.key, actor.workspace.id)).stateName,
    ).toBeTruthy();

    const foreign = await createWorkspaceMember();
    const foreignTemplate = requireRow(
      await db
        .insert(schema.stateTemplateTable)
        .values({
          workspaceId: foreign.workspace.id,
          key: "foreign-secret",
          name: "Foreign secret state",
          group: "backlog",
        })
        .returning(),
      "foreign template",
    );
    await db
      .update(schema.stateTable)
      .set({ stateTemplateId: foreignTemplate.id })
      .where(eq(schema.stateTable.id, item.stateId));

    await expect(
      getWorkItemByKey(item.key, actor.workspace.id),
    ).rejects.toMatchObject({ status: 404 });
    const listed = await listWorkItems(
      project.id,
      actor.workspace.id,
      actor.user.id,
      { lifecycle: "active" },
    );
    expect(JSON.stringify(listed)).not.toContain("Foreign secret state");
  });
});
