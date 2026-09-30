import { sql } from "drizzle-orm";
import type db from "../database";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Serialize writes to one workspace label family (the workspace row and all
 * task-level copies with the same name). Every family mutation takes these
 * transaction-scoped locks before taking label, task, or project row locks.
 * Names are sorted so a rename that holds both its old and new family cannot
 * deadlock with another rename that touches the same pair in reverse order.
 *
 * PostgreSQL hash collisions only cause unrelated labels to wait; they cannot
 * weaken the family lock. The workspace id is UUID-shaped in this schema, so
 * the colon delimiter is unambiguous for the family key. Namespace `4_007` is
 * distinct from the startup column-seed namespace `4_004`.
 */
export const WORKSPACE_LABEL_NAME_LOCK_NAMESPACE = 4_007;

export async function lockWorkspaceLabelNames(
  tx: DbOrTx,
  workspaceId: string | null | undefined,
  names: string[],
) {
  if (!workspaceId) return;

  for (const name of [...new Set(names)].sort()) {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${WORKSPACE_LABEL_NAME_LOCK_NAMESPACE}, hashtext(${`${workspaceId}:${name}`}))`,
    );
  }
}
