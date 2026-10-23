import { HTTPException } from "hono/http-exception";
import db from "../../database";
import type { Transaction } from "../../database/executor";
import type { workItemTable } from "../../database/schema";
import {
  type ActivityActorType,
  diffWorkItemFieldChanges,
  recordWorkItemActivity,
} from "../activity";
import { replaceWorkItemLabels } from "../labels-repository";
import {
  copyChecklistToWorkItem,
  countWorkspaceLabels,
  getChecklistTemplate,
  getWorkItemTemplate,
  type WorkItemTemplate,
} from "./repository";

type Item = typeof workItemTable.$inferSelect;

const NOT_FOUND = "Work item template not found";

/**
 * `WI-5`: reads the template a create request names, BEFORE the create transaction, so the route
 * can fill in the fields the request left out. A missing, archived or other-workspace template
 * is one and the same 404 (a template id from another tenant must not be distinguishable), and a
 * template of a different type than the request's `typeId` is refused rather than silently
 * overriding either.
 *
 * Using a template needs only `work_item:create` on the target project (already enforced by the
 * create route); the template itself is workspace-scoped and read here by `workspace_id`.
 */
export async function loadTemplateForCreate(
  workspaceId: string,
  templateId: string,
  typeId: string,
): Promise<WorkItemTemplate> {
  const template = await getWorkItemTemplate(db, workspaceId, templateId);
  if (!template || template.archivedAt)
    throw new HTTPException(404, { message: NOT_FOUND });
  if (template.typeId !== typeId)
    throw new HTTPException(422, {
      message: "The template belongs to a different work item type",
    });
  return template;
}

/**
 * The create-transaction hook. Re-locks the template `FOR SHARE` (an archive or edit that landed
 * after `loadTemplateForCreate` is a 409, never a half-applied older version), then copies what
 * `WI-5` lists and nothing else: labels (only when the request sent none, and only labels that
 * still exist in the workspace catalogue) and the linked checklist template's items.
 * Never assignee, dates or state. Custom field values are stored on the template but the
 * work item has no custom-field storage yet, so they are not applied.
 *
 * Labels are attached directly (the template is the configuration; the creator needs only
 * `work_item:create`), and each applied change writes an internal activity row (`WI-6`).
 */
export async function applyTemplateInTransaction(
  tx: Transaction,
  template: WorkItemTemplate,
  item: Item,
  options: {
    applyLabels: boolean;
    actorId: string;
    actorType: ActivityActorType;
  },
) {
  const current = await getWorkItemTemplate(
    tx,
    item.workspaceId,
    template.id,
    "share",
  );
  if (!current || current.archivedAt)
    throw new HTTPException(404, { message: NOT_FOUND });
  if (current.version !== template.version)
    throw new HTTPException(409, {
      message:
        "The template changed while the work item was being created; retry",
    });

  const context = {
    workspaceId: item.workspaceId,
    workItemId: item.id,
    actorId: options.actorId,
    actorType: options.actorType,
  };
  const rows = [
    {
      ...context,
      verb: "updated",
      field: "template",
      oldValue: null,
      newValue: current.id,
      payload: { name: current.name },
      visibility: "internal" as const,
    },
  ];

  if (options.applyLabels && current.labelIds.length) {
    const live = await countWorkspaceLabels(
      tx,
      item.workspaceId,
      current.labelIds,
    );
    if (live.length) {
      const applied = await replaceWorkItemLabels(
        tx,
        item.id,
        item.workspaceId,
        item.projectId,
        live,
      );
      rows.push(
        ...(diffWorkItemFieldChanges(
          { labelIds: [] },
          { labelIds: applied.after },
          context,
        ) as unknown as typeof rows),
      );
    }
  }

  if (current.checklistTemplateId) {
    const checklist = await getChecklistTemplate(
      tx,
      item.workspaceId,
      current.checklistTemplateId,
      "share",
    );
    if (checklist && !checklist.archivedAt) {
      const copied = await copyChecklistToWorkItem(
        tx,
        item.workspaceId,
        checklist.id,
        item.id,
      );
      if (copied)
        rows.push({
          ...context,
          verb: "updated",
          field: "checklist",
          oldValue: null,
          newValue: checklist.id,
          payload: { name: checklist.name, items: copied } as never,
          visibility: "internal" as const,
        });
    }
  }
  await recordWorkItemActivity(tx, rows);
}
