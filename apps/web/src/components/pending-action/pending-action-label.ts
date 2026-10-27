import { registeredDeletionTarget } from "./registered-deletion-targets";

/** Fixed action labels for targets outside the registered name-bearing deletions. */
const TARGET_ACTION_KEYS: Readonly<Record<string, string>> = {
  saved_view: "pendingActions:targets.saved_view",
  service_calendar: "pendingActions:targets.service_calendar",
  approval_decision: "pendingActions:targets.approval_decision",
  import_chunk: "pendingActions:targets.import_chunk",
  import_run: "pendingActions:importRun.action",
  work_item: "tasks:delete.action",
  attachment: "pendingActions:attachment.action",
  comment: "pendingActions:comment.action",
  relation: "tasks:relations.removeRelation",
};

const PURGE_ACTION_KEYS: Readonly<Record<string, string>> = {
  organisation: "pendingActions:hardPurge.organisationAction",
  project: "pendingActions:hardPurge.projectAction",
  work_item: "pendingActions:hardPurge.workItemAction",
};

/**
 * The translation key that names a pending action ("Delete saved view"). A pending action
 * is never titled with the raw API `action` or `targetType`; an unknown kind reads as the
 * translated generic "Pending action".
 */
export function pendingActionLabelKey(action: {
  action: string;
  targetType: string;
}): string {
  if (action.action === "purge")
    return (
      PURGE_ACTION_KEYS[action.targetType] ??
      "pendingActions:hardPurge.unavailableTitle"
    );
  if (action.action === "bulk_delete" && action.targetType === "work_item")
    return "pendingActions:bulk.action";
  const registered =
    action.action === "delete"
      ? registeredDeletionTarget(action.targetType)
      : null;
  if (registered) return `pendingActions:registered.actions.${registered}`;
  return (
    TARGET_ACTION_KEYS[action.targetType] ??
    "pendingActions:dynamic.pendingAction"
  );
}

/**
 * Cache prefixes an executed pending action makes stale, by target type, for targets whose
 * screens are not covered by the registered-deletion prefixes.
 */
export const PENDING_ACTION_TARGET_QUERY_PREFIXES: Readonly<
  Record<string, readonly string[]>
> = {
  saved_view: ["saved-views", "saved-view", "saved-view-count"],
  service_calendar: [
    "service-calendars",
    "service-calendar",
    "service-calendar-usage",
    "service-calendar-preview",
  ],
};
