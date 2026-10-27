import { and, asc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { workItemCustomFields } from "../../custom-field/repository";
import db from "../../database";
import {
  externalLinkTable,
  personTable,
  projectTable,
  stateTable,
  stateTemplateTable,
  userTable,
  workItemTable,
  workspaceUserTable,
} from "../../database/schema";
import { loadWorkItemRowFacts } from "../row-facts";

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
  const rows = await db
    .select({
      workItem: workItemTable,
      stateName: stateTemplateTable.name,
      stateCategory: stateTemplateTable.group,
      defaultCommentVisibility: projectTable.defaultCommentVisibility,
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
    .innerJoin(projectTable, eq(workItemTable.projectId, projectTable.id))
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

  const facts = (await loadWorkItemRowFacts(db, [row.workItem])).get(
    row.workItem.id,
  );
  return {
    ...row.workItem,
    ...facts,
    stateName: row.stateName,
    stateCategory: row.stateCategory,
    defaultCommentVisibility: row.defaultCommentVisibility,
    // Only ever the resolved name when the assignee is a member of THIS workspace --
    // see the `workspaceUserTable` join's own comment above. `null` otherwise: the
    // raw `assigneeId` is still returned so the caller can tell "assigned, name not
    // resolvable" (a placeholder person, or a user outside this workspace) apart from
    // "unassigned".
    assigneeName: row.assigneeIsWorkspaceMember ? row.assigneeName : null,
    // CF-3: only the fields that apply to this item's type, with its values.
    customFields: await workItemCustomFields(db, row.workItem),
    importProvenance: await workItemImportProvenance(row.workItem),
  };
}

/** `http(s)` only: a source URL is shown as a link, so no other scheme ever leaves the API. */
function safeSourceUrl(value: string | null) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

/**
 * The item's import provenance link(s) (P6-R1-04): the `external_link` rows of entity type
 * `work_item` with origin `imported`. The legacy task-link reader selects `task_id` rows only, so
 * these were never readable. Staff-only by route (`work_item:read` + reach); the customer portal
 * routes never call this.
 */
async function workItemImportProvenance(item: {
  id: string;
  workspaceId: string;
}) {
  const rows = await db
    .select({
      system: externalLinkTable.system,
      pluginId: externalLinkTable.pluginId,
      url: externalLinkTable.url,
      importedAt: externalLinkTable.createdAt,
      lastSeenAt: externalLinkTable.lastSeenAt,
      staleAt: externalLinkTable.staleAt,
      sourceCreatedAt: externalLinkTable.sourceCreatedAt,
      sourceUpdatedAt: externalLinkTable.sourceUpdatedAt,
      sourceResolvedAt: externalLinkTable.sourceResolvedAt,
    })
    .from(externalLinkTable)
    .where(
      and(
        eq(externalLinkTable.workspaceId, item.workspaceId),
        eq(externalLinkTable.workItemId, item.id),
        eq(externalLinkTable.entityType, "work_item"),
        eq(externalLinkTable.origin, "imported"),
      ),
    )
    .orderBy(asc(externalLinkTable.createdAt), asc(externalLinkTable.id));
  return rows.map((row) => ({
    system: row.system ?? "",
    pluginId: row.pluginId,
    sourceUrl: safeSourceUrl(row.url),
    importedAt: row.importedAt,
    lastSeenAt: row.lastSeenAt,
    stale: row.staleAt !== null,
    sourceCreatedAt: row.sourceCreatedAt,
    sourceUpdatedAt: row.sourceUpdatedAt,
    sourceResolvedAt: row.sourceResolvedAt,
  }));
}

export default getWorkItemByKey;
