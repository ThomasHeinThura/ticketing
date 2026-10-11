import db from "../../../apps/api/src/database";
import { transitionPersonLifecycleInTransaction } from "../../../apps/api/src/identity/person-lifecycle";
import {
  lockPendingActionLifecycle,
  reportPendingActionAuditFailures,
} from "../../../apps/api/src/pending-action/lifecycle-invalidation";

/** Drive the same person lifecycle transaction used by identity deactivation routes. */
export async function setPendingActionRequesterActive(
  personId: string,
  active: boolean,
) {
  const result = await db.transaction(async (tx) => {
    await lockPendingActionLifecycle(tx);
    return transitionPersonLifecycleInTransaction(
      tx,
      personId,
      active,
      "end_memberships",
      { kind: "administrative" },
    );
  });
  if (!result)
    throw new Error("Pending-action requester lifecycle row missing");
  await reportPendingActionAuditFailures(result.pendingActionAuditFailures);
}
