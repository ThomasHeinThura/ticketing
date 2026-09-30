/**
 * The inherited authorization layer stored its work-item permissions under `task` before
 * migration 0071. During the rolling-deployment and rollback window, both old and new
 * binaries may read and write the same JSON rows. New code uses `work_item` as its canonical
 * key, accepts task-only rows written by an old replica, and mirrors every new write to
 * `task` so old replicas continue to enforce the same grant set.
 *
 * When both keys exist, `work_item` is authoritative. New write paths always overwrite the
 * compatibility alias from that value, so a revoked grant cannot survive only under `task`.
 */
export type PermissionKeyMap = Record<string, string[]>;

export function normalizeWorkItemPermissionKey(
  permissions: PermissionKeyMap,
): PermissionKeyMap {
  const normalized = { ...permissions };
  const hasCanonical = Object.hasOwn(normalized, "work_item");
  const legacyActions = normalized.task;
  delete normalized.task;

  if (!hasCanonical && legacyActions) {
    normalized.work_item = [...legacyActions];
  }

  return normalized;
}

export function mirrorWorkItemPermissionForLegacyReplicas(
  permissions: PermissionKeyMap,
): PermissionKeyMap {
  const normalized = normalizeWorkItemPermissionKey(permissions);
  const workItemActions = normalized.work_item;
  if (Array.isArray(workItemActions)) {
    normalized.task = [...workItemActions];
  }
  return normalized;
}
