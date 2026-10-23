import { appendAuditLog } from "../audit/audit-writer";
import type { Transaction } from "../database/executor";
import type { workItemTable } from "../database/schema";
import { publishEvent } from "../events";
import { resolveWorkItemEventRecipients } from "../notification/work-item-recipients";
import {
  type ActivityActorType,
  diffWorkItemFieldChanges,
  recordWorkItemActivity,
  resolveVisibility,
} from "./activity";
import type { InitialWorkItemFields } from "./create-preparation";
import { ensureImplicitAssigneeWatcher } from "./implicit-watcher";
import { replaceWorkItemLabels } from "./labels-repository";
import { publishWorkItemHint, recordWorkItemEvent } from "./native-event";

type Item = typeof workItemTable.$inferSelect;
export async function recordInitialWorkItemFields(
  tx: Transaction,
  item: Item,
  fields: InitialWorkItemFields,
  actorId: string | null,
  actorType: ActivityActorType,
) {
  const common = {
    workItemId: item.id,
    key: item.key,
    workspaceId: item.workspaceId,
    projectId: item.projectId,
    actorId,
    actorType,
  };
  const labels =
    fields.labelIds === undefined
      ? undefined
      : await replaceWorkItemLabels(
          tx,
          item.id,
          item.workspaceId,
          item.projectId,
          fields.labelIds,
        );
  const before = {
    ...(fields.startDate !== undefined ? { startDate: null } : {}),
    ...(fields.dueDate !== undefined ? { dueDate: null } : {}),
    ...(labels ? { labelIds: [] } : {}),
  };
  const after = {
    ...(fields.startDate !== undefined ? { startDate: item.startDate } : {}),
    ...(fields.dueDate !== undefined ? { dueDate: item.dueDate } : {}),
    ...(labels ? { labelIds: labels.after } : {}),
  };
  const rows = diffWorkItemFieldChanges(before, after, common);
  await recordWorkItemActivity(tx, rows);
  const changes = rows.map((row) => ({
    field: row.field,
    from: row.oldValue,
    to: row.newValue,
    visibility: resolveVisibility(row),
  }));
  const url = `/agent/work-items/${encodeURIComponent(item.key)}`;
  const events: Array<{
    kind: "work_item.updated" | "work_item.assigned";
    customerVisible: boolean;
    event: Awaited<ReturnType<typeof recordWorkItemEvent>>;
    payload: Record<string, unknown>;
  }> = [];
  if (changes.length) {
    const customerVisible = changes.some(
      (change) => change.visibility === "public",
    );
    events.push({
      kind: "work_item.updated",
      customerVisible,
      payload: { ...common, changes },
      event: await recordWorkItemEvent(tx, {
        ...common,
        kind: "work_item.updated",
        customerVisible,
        payload: { key: item.key, url, changes },
      }),
    });
  }
  if (fields.assigneeId !== undefined) {
    await recordWorkItemActivity(tx, [
      {
        ...common,
        verb: "updated",
        field: "assigneeId",
        oldValue: null,
        newValue: fields.assigneeId,
      },
    ]);
    await appendAuditLog(tx, {
      actorId,
      actorType,
      workspaceId: item.workspaceId,
      projectId: item.projectId,
      action: "work_item.assigned",
      entityType: "work_item",
      entityId: item.id,
      before: { assigneeId: null },
      after: { assigneeId: fields.assigneeId },
    });
    const assignment = {
      assigneeId: fields.assigneeId,
      previousAssigneeId: null,
    };
    // `WI-29`/`AS-16`: an initial assignee is an implicit watcher and is notified exactly
    // as on the assign route (the actor excluded, `AS-18`).
    if (fields.assigneeId) {
      await ensureImplicitAssigneeWatcher(tx, item.id, fields.assigneeId);
    }
    events.push({
      kind: "work_item.assigned",
      customerVisible: true,
      payload: { ...common, ...assignment },
      event: await recordWorkItemEvent(tx, {
        ...common,
        kind: "work_item.assigned",
        customerVisible: true,
        notify: { resolveRecipients: resolveWorkItemEventRecipients },
        payload: { workItemId: item.id, key: item.key, url, ...assignment },
      }),
    });
  }
  return events;
}
export async function publishInitialWorkItemFields(
  item: Item,
  events: Awaited<ReturnType<typeof recordInitialWorkItemFields>>,
) {
  for (const entry of events) {
    // Keep the closed creation-event union explicit for the catalogue checker.
    if (entry.kind === "work_item.updated")
      await publishEvent("work_item.updated", entry.payload);
    else if (entry.kind === "work_item.assigned")
      await publishEvent("work_item.assigned", entry.payload);
    else {
      const unsupported: never = entry.kind;
      throw new Error(`Unsupported initial event: ${unsupported}`);
    }
    await publishWorkItemHint(entry.event, {
      kind: entry.kind,
      key: item.key,
      projectId: item.projectId,
      customerVisible: entry.customerVisible,
    });
  }
}
