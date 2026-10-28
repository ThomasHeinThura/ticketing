import { randomUUID } from "node:crypto";
import db, { schema } from "../../../apps/api/src/database";
import {
  customFieldSectionTable,
  customFieldTable,
  customFieldTypeVisibilityTable,
  customFieldValueTable,
} from "../../../apps/api/src/database/migration-schema";
import { requireRow } from "./fixtures";

/**
 * Shared rows for the P4 close-out integration tests: a work-item type, a default state and
 * direct inserts for work items, teams and custom fields. Everything is written straight to
 * the (scratch) database; the behaviour under test is the API layered on top.
 */
export async function workItemWorld(workspaceId: string, projectId: string) {
  const type = requireRow(
    await db
      .insert(schema.workItemTypeTable)
      .values({
        workspaceId,
        key: `type-${randomUUID()}`,
        name: "Task",
        category: "delivery",
      })
      .returning(),
    "type",
  );
  const template = requireRow(
    await db
      .insert(schema.stateTemplateTable)
      .values({
        workspaceId,
        key: `state-${randomUUID()}`,
        name: "Backlog",
        group: "backlog",
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
  let number = 0;
  async function makeItem(title: string, projectOverride?: string) {
    number += 1;
    return requireRow(
      await db
        .insert(schema.workItemTable)
        .values({
          workspaceId,
          projectId: projectOverride ?? projectId,
          typeId: type.id,
          stateId: state.id,
          title,
          number,
          key: `P4C-${randomUUID().slice(0, 8)}`,
        })
        .returning(),
      "item",
    );
  }
  return { type, template, state, makeItem };
}

export async function makeTeam(
  workspaceId: string,
  userIds: readonly string[],
  options: { leadUserId?: string } = {},
) {
  const team = requireRow(
    await db
      .insert(schema.teamTable)
      .values({
        id: `team-${randomUUID()}`,
        name: `Team ${randomUUID().slice(0, 6)}`,
        workspaceId,
        createdAt: new Date(),
      })
      .returning(),
    "team",
  );
  for (const userId of userIds)
    await db.insert(schema.teamMemberTable).values({
      id: `tm-${randomUUID()}`,
      teamId: team.id,
      userId,
      isLead: options.leadUserId === userId,
      createdAt: new Date(),
    });
  return team;
}

export async function makeCustomField(
  workspaceId: string,
  typeId: string,
  input: {
    key: string;
    format: string;
    options?: { key: string; label: string }[];
    customerVisible?: boolean;
    visible?: boolean;
    name?: string;
  },
) {
  const section =
    (
      await db
        .insert(customFieldSectionTable)
        .values({
          id: `sec-${randomUUID()}`,
          workspaceId,
          name: `Section ${randomUUID().slice(0, 6)}`,
        })
        .returning()
    )[0] ?? null;
  if (!section) throw new Error("section insert failed");
  const field = requireRow(
    await db
      .insert(customFieldTable)
      .values({
        id: `cf-${randomUUID()}`,
        workspaceId,
        sectionId: section.id,
        key: input.key,
        name: input.name ?? input.key,
        format: input.format,
        options: input.options ?? [],
        customerVisible: input.customerVisible ?? false,
      })
      .returning(),
    "field",
  );
  await db.insert(customFieldTypeVisibilityTable).values({
    workspaceId,
    customFieldId: field.id,
    workItemTypeId: typeId,
    visible: input.visible ?? true,
    required: false,
  });
  return field;
}

export async function setCustomValue(
  workspaceId: string,
  fieldId: string,
  item: { id: string; projectId: string },
  value: unknown,
) {
  await db.insert(customFieldValueTable).values({
    id: `cfv-${randomUUID()}`,
    workspaceId,
    customFieldId: fieldId,
    entityType: "work_item",
    entityId: item.id,
    value: value as never,
    projectId: item.projectId,
  });
}
