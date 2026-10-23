import { sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import type { Executor } from "../../database/executor";
import { isUniqueViolation } from "../../utils/is-unique-violation";
import {
  archiveChecklistTemplate,
  archiveWorkItemTemplate,
  countWorkspaceLabels,
  getChecklistTemplate,
  getWorkItemTemplate,
  insertChecklistTemplate,
  insertWorkItemTemplate,
  listChecklistTemplates,
  listWorkItemTemplates,
  renameChecklistTemplate,
  replaceChecklistTemplateItems,
  replaceWorkItemTemplate,
  type TemplateWrite,
  workspaceHasType,
} from "./repository";
import type {
  CreateWorkItemTemplateInput,
  UpdateWorkItemTemplateInput,
} from "./schema";

const TEMPLATE_NAME_CONSTRAINT = "work_item_template_workspace_name_unique";
const CHECKLIST_NAME_CONSTRAINT = "checklist_template_workspace_name_unique";

async function validateTemplateReferences(
  executor: Executor,
  workspaceId: string,
  value: TemplateWrite,
) {
  if (!(await workspaceHasType(executor, workspaceId, value.typeId)))
    throw new HTTPException(422, {
      message: "Work item type does not belong to this workspace",
    });
  const known = await countWorkspaceLabels(
    executor,
    workspaceId,
    value.labelIds,
  );
  if (known.length !== value.labelIds.length)
    throw new HTTPException(422, {
      message: "Template labels must be workspace-wide labels",
    });
  if (value.checklistTemplateId !== null) {
    const checklist = await getChecklistTemplate(
      executor,
      workspaceId,
      value.checklistTemplateId,
      "share",
    );
    if (!checklist || checklist.archivedAt)
      throw new HTTPException(422, {
        message: "Checklist template not found in this workspace",
      });
  }
}

export const workItemTemplateService = {
  /** Live templates only: what a create dialog reads (`work_item:create` is all that is needed to USE one). */
  listLive: (workspaceId: string) =>
    listWorkItemTemplates(db, workspaceId, false),
  listForManagement: (workspaceId: string, includeArchived: boolean) =>
    listWorkItemTemplates(db, workspaceId, includeArchived),

  async create(workspaceId: string, input: CreateWorkItemTemplateInput) {
    const value: TemplateWrite = {
      name: input.name,
      typeId: input.typeId,
      title: input.title,
      description: input.description ?? null,
      labelIds: [...(input.labelIds ?? [])].sort(),
      customFieldValues: input.customFieldValues ?? {},
      checklistTemplateId: input.checklistTemplateId ?? null,
    };
    try {
      return await db.transaction(async (tx) => {
        await validateTemplateReferences(tx, workspaceId, value);
        return insertWorkItemTemplate(tx, workspaceId, value);
      });
    } catch (error) {
      if (isUniqueViolation(error, TEMPLATE_NAME_CONSTRAINT))
        throw new HTTPException(409, {
          message: "A work item template with this name already exists",
        });
      throw error;
    }
  },

  async update(
    workspaceId: string,
    id: string,
    input: UpdateWorkItemTemplateInput,
  ) {
    try {
      return await db.transaction(async (tx) => {
        const current = await getWorkItemTemplate(
          tx,
          workspaceId,
          id,
          "update",
        );
        if (!current || current.archivedAt)
          throw new HTTPException(404, {
            message: "Work item template not found",
          });
        const value: TemplateWrite = {
          name: input.name ?? current.name,
          typeId: input.typeId ?? current.typeId,
          title: input.title ?? current.title,
          description:
            input.description === undefined
              ? current.description
              : input.description,
          labelIds: [...(input.labelIds ?? current.labelIds)].sort(),
          customFieldValues:
            input.customFieldValues ?? current.customFieldValues,
          checklistTemplateId:
            input.checklistTemplateId === undefined
              ? current.checklistTemplateId
              : input.checklistTemplateId,
        };
        await validateTemplateReferences(tx, workspaceId, value);
        const updated = await replaceWorkItemTemplate(
          tx,
          workspaceId,
          id,
          value,
        );
        if (!updated)
          throw new HTTPException(404, {
            message: "Work item template not found",
          });
        return updated;
      });
    } catch (error) {
      if (isUniqueViolation(error, TEMPLATE_NAME_CONSTRAINT))
        throw new HTTPException(409, {
          message: "A work item template with this name already exists",
        });
      throw error;
    }
  },

  async archive(workspaceId: string, id: string) {
    const archived = await archiveWorkItemTemplate(db, workspaceId, id);
    if (!archived)
      throw new HTTPException(404, {
        message: "Work item template not found",
      });
    return archived;
  },
};

export const checklistTemplateService = {
  list: (workspaceId: string, includeArchived: boolean) =>
    listChecklistTemplates(db, workspaceId, includeArchived),

  async create(workspaceId: string, name: string, items: readonly string[]) {
    try {
      return await db.transaction((tx) =>
        insertChecklistTemplate(tx, workspaceId, name, items),
      );
    } catch (error) {
      if (isUniqueViolation(error, CHECKLIST_NAME_CONSTRAINT))
        throw new HTTPException(409, {
          message: "A checklist template with this name already exists",
        });
      throw error;
    }
  },

  async update(
    workspaceId: string,
    id: string,
    input: { name?: string; items?: readonly string[] },
  ) {
    try {
      return await db.transaction(async (tx) => {
        const current = await getChecklistTemplate(
          tx,
          workspaceId,
          id,
          "update",
        );
        if (!current || current.archivedAt)
          throw new HTTPException(404, {
            message: "Checklist template not found",
          });
        await renameChecklistTemplate(tx, workspaceId, id, input.name);
        // Items already copied onto work items are independent rows and stay as they are.
        if (input.items)
          await replaceChecklistTemplateItems(tx, workspaceId, id, input.items);
        const updated = await getChecklistTemplate(tx, workspaceId, id);
        if (!updated)
          throw new HTTPException(404, {
            message: "Checklist template not found",
          });
        return updated;
      });
    } catch (error) {
      if (isUniqueViolation(error, CHECKLIST_NAME_CONSTRAINT))
        throw new HTTPException(409, {
          message: "A checklist template with this name already exists",
        });
      throw error;
    }
  },

  async archive(workspaceId: string, id: string) {
    const archived = await db.transaction(async (tx) => {
      // A live work item template that still links it would silently lose its checklist.
      const current = await getChecklistTemplate(tx, workspaceId, id, "update");
      if (!current || current.archivedAt)
        throw new HTTPException(404, {
          message: "Checklist template not found",
        });
      const linked = await tx.execute(sqlLinked(workspaceId, id));
      if ((linked.rowCount ?? 0) > 0)
        throw new HTTPException(409, {
          message:
            "A live work item template still uses this checklist template; unlink it first",
        });
      await archiveChecklistTemplate(tx, workspaceId, id);
      return getChecklistTemplate(tx, workspaceId, id);
    });
    if (!archived)
      throw new HTTPException(404, {
        message: "Checklist template not found",
      });
    return archived;
  },
};

function sqlLinked(workspaceId: string, checklistTemplateId: string) {
  return sql`
    SELECT 1 FROM work_item_template
    WHERE workspace_id = ${workspaceId} AND checklist_template_id = ${checklistTemplateId}
      AND archived_at IS NULL
  `;
}
