import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  personTable,
  stateTable,
  stateTemplateTable,
  userTable,
  workItemTable,
  workspaceUserTable,
} from "../../database/schema";

/**
 * `GET /api/work-items/{key}` (`work_item:read`, plus reach on the project --
 * `work-items.md` § Permissions). `workspaceId` is the value the route's own middleware
 * (`requireWorkItemReach()`, `../require-work-item-reach.ts`) already resolved by looking
 * this same key up --
 * re-checked here, the same "controller re-loads the row itself" pattern
 * `workspace/policy.ts` documents for `GET /api/workspace/{id}`, rather than trusting the
 * middleware's lookup as the only read.
 *
 * This route resolves `stateName`/`stateCategory`/`assigneeName` for the row it returns,
 * so the work-item detail page (`docs/02-design/screen-inventory.md` "Work item — full
 * page", `/agent/work-items/{key}`) can render the same human-readable state and assignee
 * the list screen renders on its rows -- without a second round trip and without a raw
 * foreign key. There is no state-lookup or user-lookup endpoint in this codebase for a
 * client to resolve either itself.
 *
 * The resolved fields use the same names and the same null semantics as the list route's
 * resolution (`controllers/list-work-items.ts`) ON PURPOSE: a row's state/assignee must
 * not read differently depending on whether it was opened from the list or by URL. If
 * either resolution changes, both change.
 *
 * Bounded: exactly one query, every lookup JOINed -- nothing here scales with anything
 * but the single row.
 */
export async function getWorkItemByKey(key: string, workspaceId: string) {
  const rows = await db
    .select({
      workItem: workItemTable,
      stateName: stateTemplateTable.name,
      stateCategory: stateTemplateTable.group,
      assigneeName: userTable.name,
      // Signals whether the assignee's own user is actually a member of THIS work
      // item's workspace -- see the join comment below for why this gates
      // `assigneeName` rather than the join itself.
      assigneeIsWorkspaceMember: workspaceUserTable.id,
    })
    .from(workItemTable)
    // `work_item.state_id` is `NOT NULL` and `state.state_template_id` is `NOT NULL`
    // (`database/schema.ts`), so every work item has exactly one state and template --
    // an INNER JOIN can never drop a row here.
    .innerJoin(stateTable, eq(workItemTable.stateId, stateTable.id))
    .innerJoin(
      stateTemplateTable,
      eq(stateTable.stateTemplateId, stateTemplateTable.id),
    )
    // `assignee_id`/`person.user_id` are both nullable (unassigned; or a placeholder
    // person with no linked login) -- LEFT JOINs so those rows still come back, with
    // `assigneeName: null`, rather than being silently dropped.
    .leftJoin(personTable, eq(workItemTable.assigneeId, personTable.id))
    .leftJoin(userTable, eq(personTable.userId, userTable.id))
    // The same name-disclosure scoping the list route applies (its own S3 note,
    // #320's security review): `work_item.assignee_id -> person.id` is a plain,
    // UNSCOPED foreign key, unlike `state_id`/`type_id`/`parent_id`, which are
    // composite-FK'd to the same workspace/project the work item belongs to. Nothing
    // in this codebase writes `assignee_id` today (WI-10 assignment is unbuilt), so
    // this is latent, not live -- but rather than trust every future writer of
    // `assignee_id` to get the roster check right, this route scopes the NAME
    // DISCLOSURE itself: `assigneeName` is only ever the resolved name when the
    // assignee's own user actually holds a `workspace_member` row in the SAME
    // workspace as this work item. A LEFT JOIN (not an inner join or a WHERE) so a
    // foreign assignment still returns the row -- with `assigneeName: null`, the same
    // shape an unresolvable name already has -- rather than hiding the work item
    // itself.
    .leftJoin(
      workspaceUserTable,
      and(
        eq(workspaceUserTable.userId, personTable.userId),
        eq(workspaceUserTable.workspaceId, workItemTable.workspaceId),
      ),
    )
    .where(eq(workItemTable.key, key))
    .limit(1);

  const row = rows[0];
  if (!row || row.workItem.workspaceId !== workspaceId) {
    throw new HTTPException(404, { message: "Work item not found" });
  }

  return {
    ...row.workItem,
    stateName: row.stateName,
    stateCategory: row.stateCategory,
    // Only ever the resolved name when the assignee is a member of THIS workspace --
    // see the `workspaceUserTable` join's own comment above. `null` otherwise: the
    // raw `assigneeId` is still returned so the caller can tell "assigned, name not
    // resolvable" (a placeholder person, or a user outside this workspace) apart from
    // "unassigned".
    assigneeName: row.assigneeIsWorkspaceMember ? row.assigneeName : null,
  };
}

export default getWorkItemByKey;
