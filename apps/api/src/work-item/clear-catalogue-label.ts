import type { ResolvedIdentity } from "@taskdesk/permissions";
import { publishEvent } from "../events";
import type { DbTransaction } from "../events/outbox";
import { recordWorkItemActivity } from "./activity";
import {
  advanceLabelWorkItemVersion,
  listAssignedLabelIds,
  lockLabelWorkItems,
  replaceWorkItemLabels,
} from "./labels-repository";
import { publishWorkItemHint, recordWorkItemEvent } from "./native-event";

// The catalogue lock is held before acquiring work-item locks, including on assignment.
export async function clearCatalogueLabel(
  tx: DbTransaction,
  workspaceId: string,
  labelId: string,
  actorId: string,
  identity: ResolvedIdentity,
) {
  const actorType =
    identity.credential === "api_key"
      ? ("api_key" as const)
      : ("person" as const);
  const changes = [];
  for (const { item } of await lockLabelWorkItems(tx, workspaceId, labelId)) {
    const before = await listAssignedLabelIds(tx, item.id);
    const after = before.filter((id) => id !== labelId);
    await replaceWorkItemLabels(tx, item.id, workspaceId, after);
    await advanceLabelWorkItemVersion(tx, item.id);
    await recordWorkItemActivity(tx, [
      {
        workspaceId,
        workItemId: item.id,
        actorId,
        actorType,
        verb: "updated",
        field: "label",
        oldValue: before,
        newValue: after,
      },
    ]);
    const fields = [
      {
        field: "label",
        from: before,
        to: after,
        visibility: "internal" as const,
      },
    ];
    const input = {
      kind: "work_item.updated" as const,
      workItemId: item.id,
      key: item.key,
      workspaceId,
      projectId: item.projectId,
      actorId,
      actorType,
      customerVisible: false,
      payload: {
        key: item.key,
        url: `/agent/work-items/${encodeURIComponent(item.key)}`,
        changes: fields,
      },
    };
    const event = await recordWorkItemEvent(tx, input);
    changes.push({ event, input, fields });
  }
  return changes;
}

export async function publishCatalogueLabelChanges(
  changes: Awaited<ReturnType<typeof clearCatalogueLabel>>,
) {
  for (const { event, input, fields } of changes) {
    await publishEvent("work_item.updated", {
      workItemId: input.workItemId,
      key: input.key,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      actorId: input.actorId,
      actorType: input.actorType,
      changes: fields,
    });
    await publishWorkItemHint(event, input);
  }
}
