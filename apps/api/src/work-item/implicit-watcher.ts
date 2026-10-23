import { watcherTable } from "../database/schema";
import type { DbTransaction } from "../events/outbox";

/**
 * `WI-29`: the assignee is a watcher implicitly (`watcher.source = 'implicit'`). Written in
 * the assignment transaction with `ON CONFLICT DO NOTHING`, so an assignee who previously
 * opted out (`muted = true`) stays muted and an explicit watch is never downgraded: the row
 * is the persistent preference, assignment only guarantees one exists.
 */
export async function ensureImplicitAssigneeWatcher(
  tx: DbTransaction,
  workItemId: string,
  personId: string,
): Promise<void> {
  await tx
    .insert(watcherTable)
    .values({ workItemId, personId, source: "implicit", muted: false })
    .onConflictDoNothing({
      target: [watcherTable.workItemId, watcherTable.personId],
    });
}
