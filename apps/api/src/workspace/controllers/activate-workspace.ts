import { eq } from "drizzle-orm";
import db, { schema } from "../../database";

/**
 * Set the caller's active workspace.
 *
 * S8a (issue #6, retrofit plan §3, S8a row): native replacement for
 * `authClient.organization.setActive()`. Mirrors better-auth's own
 * `setActiveOrganization` (`plugins/organization/adapter.mjs`), which writes
 * only `session.activeOrganizationId` -- NOT `activeTeamId`. The retrofit
 * plan's recommendation (S8a row) is to keep writing this existing column
 * and leave the sign-in backfill (`apps/api/src/auth.ts`) untouched; renaming
 * the column is S8b, deferred out of P0.
 *
 * Membership is enforced by the route's own middleware
 * (`workspaceAccess.fromParam` + `requireWorkspaceMembership`,
 * `apps/api/src/workspace/index.ts`), which restores the plugin's own
 * `USER_IS_NOT_A_MEMBER_OF_THE_ORGANIZATION` refusal
 * (`checkMembership` in `plugins/organization/routes/crud-org.mjs`) at the
 * route rather than inside this function -- the same split S4/S5's write
 * routes already use.
 *
 * The plugin's `/organization/set-active` also supports `organizationId:
 * null` to CLEAR the active workspace. No caller in this codebase ever
 * passes that -- every one of the nine `authClient.organization.setActive()`
 * call sites this replaces supplies a real workspace id -- so this route
 * only ever activates a workspace; clearing is not reachable and is not
 * reproduced here.
 */
async function activateWorkspace(
  workspaceId: string,
  sessionId: string,
): Promise<{ workspaceId: string }> {
  await db
    .update(schema.sessionTable)
    .set({ activeOrganizationId: workspaceId })
    .where(eq(schema.sessionTable.id, sessionId));

  return { workspaceId };
}

export default activateWorkspace;
