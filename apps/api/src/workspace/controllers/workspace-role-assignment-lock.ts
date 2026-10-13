import { sql } from "drizzle-orm";
import type { DatabaseInstance } from "../../database";
import { WORKSPACE_MEMBERSHIP_LOCK_NAMESPACE } from "./workspace-membership-lock";
import { WORKSPACE_ROLE_LOCK_NAMESPACE } from "./workspace-role-lock";

type WorkspaceTransaction = Parameters<
  Parameters<DatabaseInstance["transaction"]>[0]
>[0];

/**
 * Serialize every native transaction that assigns or removes a
 * `workspace_member.role` reference against workspace-role deletion.
 *
 * Lock order is global and deliberate: membership namespace 4_002, then role
 * namespace 4_003, both keyed by workspace. Assignment paths re-read the role
 * under these locks before writing; deletion takes the same pair before
 * checking member references and deleting. Thus whichever transaction gets
 * the pair first either commits the assignment (making deletion refuse) or
 * commits the deletion (making assignment refuse). No transaction in this
 * pair may acquire 4_003 before 4_002.
 *
 * Role create/update paths take only 4_003 and never wait for 4_002, so they
 * cannot form a reverse-order deadlock with this pair.
 */
export async function lockWorkspaceRoleAssignment(
  tx: WorkspaceTransaction,
  workspaceId: string,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${WORKSPACE_MEMBERSHIP_LOCK_NAMESPACE}, hashtext(${workspaceId}))`,
  );
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${WORKSPACE_ROLE_LOCK_NAMESPACE}, hashtext(${workspaceId}))`,
  );
}
