import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { getWorkItemByKeyQuery } from "../repository";

/**
 * `GET /api/work-items/{key}` (`work_item:read`, plus reach on the project --
 * `work-items.md` § Permissions). `workspaceId` is the value the route's own middleware
 * (`requireWorkItemReach()`, `../require-work-item-reach.ts`) already resolved by looking
 * this same key up --
 * re-checked here, the same "controller re-loads the row itself" pattern
 * `workspace/policy.ts` documents for `GET /api/workspace/{id}`, rather than trusting the
 * middleware's lookup as the only read.
 *
 * This route resolves `stateName`/`stateCategory`/`assigneeName` and the project's
 * `defaultCommentVisibility` for the row it returns. The detail screen can render the
 * state/assignee without another lookup and can initialize the CA-2 comment composer
 * from the same project setting the server stores. Comment creation still requires an
 * explicit visibility. There is no state-lookup or user-lookup endpoint in this codebase
 * for a client to resolve either itself.
 *
 * The resolved fields use the same names and the same null semantics as PR #320's
 * list-route resolution (unmerged when this was written; identical join, identical
 * `assigneeName` gating) ON PURPOSE: once both are on `main`, a row's state/assignee
 * must not read differently depending on whether it was opened from the list or by URL --
 * if either resolution changes, both change.
 *
 * Bounded: exactly one query, every lookup JOINed -- nothing here scales with anything
 * but the single row.
 */
export async function getWorkItemByKey(key: string, workspaceId: string) {
  const rows = await getWorkItemByKeyQuery(db, key);

  const row = rows[0];
  if (!row || row.workItem.workspaceId !== workspaceId) {
    throw new HTTPException(404, { message: "Work item not found" });
  }

  return {
    ...row.workItem,
    stateName: row.stateName,
    stateCategory: row.stateCategory,
    defaultCommentVisibility: row.defaultCommentVisibility,
    // Only ever the resolved name when the assignee is a member of THIS workspace --
    // see the `workspaceUserTable` join's own comment above. `null` otherwise: the
    // raw `assigneeId` is still returned so the caller can tell "assigned, name not
    // resolvable" (a placeholder person, or a user outside this workspace) apart from
    // "unassigned".
    assigneeName: row.assigneeIsWorkspaceMember ? row.assigneeName : null,
  };
}

export default getWorkItemByKey;
