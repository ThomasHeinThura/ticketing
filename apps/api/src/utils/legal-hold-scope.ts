import { type SQL, sql } from "drizzle-orm";

/**
 * The ONE definition of "people and organisations whose rows a hard delete of this scope
 * removes" (PA-12; `data-model.md` §2 holds). A hard delete of a work item, a project or a
 * whole workspace is fenced while an open `legal_hold` covers any of them, so every path that
 * destroys history (the 30-day purge in `scheduler/soft-delete-purge.repository.ts`, the
 * workspace hard delete in `utils/workspace-legal-hold.ts`, and `attachment-gc`'s re-check in
 * `scheduler/attachment-cleanup.ts`) builds its predicate from the fragments below. A person or
 * organisation added here fences all of them at once; never copy the lists.
 *
 * The caller must hold `LOCK TABLE legal_hold IN SHARE MODE` for the check to be race-free.
 */

/**
 * Every person whose rows hard-delete with the given work items (`items` is a subquery that
 * selects work-item ids; use inner aliases that do not clash with the caller's). The FK cascades
 * from `work_item` remove: the item's requester/assignee, `activity.actor_id`,
 * `comment.author_id`/`deleted_by`, `comment_version.edited_by`, `attachment.uploaded_by`
 * (direct or via a comment), `watcher.person_id`, `request_participant.person_id`/`added_by`
 * and `approval.requested_by`/`approver_id`. `activity.actor_id` and `comment.author_id` hold a
 * raw user id on some write paths (see schema comments), and `comment.deleted_by` and
 * `comment_version.edited_by` hold a user id in production (no FK), so all four are also
 * resolved through `person.user_id`.
 */
export function workItemPeople(items: SQL): SQL {
  return sql`
    SELECT x."requester_id" AS pid FROM "work_item" x WHERE x."id" IN (${items})
    UNION ALL SELECT x."assignee_id" FROM "work_item" x WHERE x."id" IN (${items})
    UNION ALL SELECT x."actor_id" FROM "activity" x WHERE x."work_item_id" IN (${items})
    UNION ALL SELECT pe."id" FROM "person" pe WHERE pe."user_id" IN (
      SELECT x."actor_id" FROM "activity" x WHERE x."work_item_id" IN (${items})
    )
    UNION ALL SELECT x."author_id" FROM "comment" x WHERE x."work_item_id" IN (${items})
    UNION ALL SELECT x."deleted_by" FROM "comment" x WHERE x."work_item_id" IN (${items})
    UNION ALL SELECT pe."id" FROM "person" pe WHERE pe."user_id" IN (
      SELECT x."deleted_by" FROM "comment" x WHERE x."work_item_id" IN (${items})
    )
    UNION ALL SELECT pe."id" FROM "person" pe WHERE pe."user_id" IN (
      SELECT x."author_id" FROM "comment" x WHERE x."work_item_id" IN (${items})
    )
    UNION ALL SELECT v."edited_by" FROM "comment_version" v
      JOIN "comment" x ON x."id" = v."comment_id" WHERE x."work_item_id" IN (${items})
    UNION ALL SELECT pe."id" FROM "person" pe WHERE pe."user_id" IN (
      SELECT v."edited_by" FROM "comment_version" v
        JOIN "comment" x ON x."id" = v."comment_id" WHERE x."work_item_id" IN (${items})
    )
    UNION ALL SELECT x."uploaded_by" FROM "attachment" x
      WHERE x."work_item_id" IN (${items})
         OR x."comment_id" IN (SELECT cm."id" FROM "comment" cm WHERE cm."work_item_id" IN (${items}))
    UNION ALL SELECT x."person_id" FROM "watcher" x WHERE x."work_item_id" IN (${items})
    UNION ALL SELECT x."person_id" FROM "request_participant" x WHERE x."work_item_id" IN (${items})
    UNION ALL SELECT x."added_by" FROM "request_participant" x WHERE x."work_item_id" IN (${items})
    UNION ALL SELECT x."requested_by" FROM "approval" x WHERE x."work_item_id" IN (${items})
    UNION ALL SELECT x."approver_id" FROM "approval" x WHERE x."work_item_id" IN (${items})
  `;
}

/**
 * People attached to the given projects beyond their work items (`projectIds` selects project
 * ids): `project.created_by`, stakeholders, `project_feature_flag.updated_by`, and the legacy
 * Kaneo `task` subtree that cascades from the project (assignee, time-entry person, task
 * activity/comment authors, asset creators), all resolved to `person` through
 * `person.user_id`.
 */
export function projectOwnPeople(projectIds: SQL): SQL {
  return sql`
    SELECT pj."created_by" AS pid FROM "project" pj WHERE pj."id" IN (${projectIds})
    UNION ALL SELECT x."person_id" FROM "stakeholder" x WHERE x."project_id" IN (${projectIds})
    UNION ALL SELECT x."updated_by" FROM "project_feature_flag" x WHERE x."project_id" IN (${projectIds})
    UNION ALL SELECT pe."id" FROM "person" pe WHERE pe."user_id" IN (
      SELECT t."assignee_id" FROM "task" t WHERE t."project_id" IN (${projectIds})
      UNION ALL SELECT te."user_id" FROM "time_entry" te
        JOIN "task" t ON t."id" = te."task_id" WHERE t."project_id" IN (${projectIds})
      UNION ALL SELECT ta."user_id" FROM "task_activity" ta
        JOIN "task" t ON t."id" = ta."task_id" WHERE t."project_id" IN (${projectIds})
      UNION ALL SELECT tc."user_id" FROM "task_comment" tc
        JOIN "task" t ON t."id" = tc."task_id" WHERE t."project_id" IN (${projectIds})
      UNION ALL SELECT ast."created_by" FROM "asset" ast WHERE ast."project_id" IN (${projectIds})
    )
  `;
}

/** Organisations of the attachments that cascade away with the given work items. */
export function workItemAttachmentOrganisations(items: SQL): SQL {
  return sql`
    SELECT x."organisation_id" FROM "attachment" x
    WHERE x."work_item_id" IN (${items})
       OR x."comment_id" IN (SELECT cm."id" FROM "comment" cm WHERE cm."work_item_id" IN (${items}))
  `;
}

/**
 * True when an open hold covers one of `people` (person scope), one of `organisations`, or the
 * organisation of one of `people`. Both arguments are subqueries yielding one column.
 */
export function openHoldOver(people: SQL, organisations: SQL): SQL {
  return sql`
    EXISTS (
      SELECT 1 FROM "legal_hold" lh
      WHERE lh."lifted_at" IS NULL
        AND (
          (lh."scope" = 'person' AND lh."scope_id" IN (${people}))
          OR (lh."scope" = 'organisation' AND lh."scope_id" IN (
            ${organisations}
            UNION ALL
            SELECT pe."organisation_id" FROM "person" pe WHERE pe."id" IN (${people})
          ))
        )
    )
  `;
}

/** `wi` alias required (a work-item row of the caller's query). */
export const WORK_ITEM_UNDER_OPEN_HOLD = openHoldOver(
  workItemPeople(sql`SELECT wi."id"`),
  sql`
    SELECT w."organisation_id" FROM "workspace" w WHERE w."id" = wi."workspace_id"
    UNION ALL
    SELECT p."organisation_id" FROM "project" p WHERE p."id" = wi."project_id"
    UNION ALL
    ${workItemAttachmentOrganisations(sql`SELECT wi."id"`)}
  `,
);

/** Work items of a project, correlated on the caller's `pr` alias. */
export const PROJECT_WORK_ITEMS = sql`SELECT pwi."id" FROM "work_item" pwi WHERE pwi."project_id" = pr."id"`;

/** `pr` alias required. Includes holds on every person attached to its work items or itself. */
export const PROJECT_UNDER_OPEN_HOLD = openHoldOver(
  sql`${workItemPeople(PROJECT_WORK_ITEMS)} UNION ALL ${projectOwnPeople(sql`SELECT pr."id"`)}`,
  sql`
    SELECT w."organisation_id" FROM "workspace" w WHERE w."id" = pr."workspace_id"
    UNION ALL
    SELECT pr."organisation_id"
    UNION ALL
    ${workItemAttachmentOrganisations(PROJECT_WORK_ITEMS)}
  `,
);

/**
 * People whose rows `deleteWorkspaceRoleDependents` hard-deletes with the workspace but that no
 * work item or project reaches: submission requesters and claimers (submissions are deleted by
 * request type or work item), uploaders of every attachment of the workspace (including
 * submission attachments, which have no work item), and the `person_id` of every `membership` /
 * `membership_grant` row it removes (a role the workspace owns, or scope = the workspace or one
 * of its projects, and for grants the group mappings that qualify by the same rules). Mirrors
 * `workspaceDependentPredicates` in `workspace/controllers/delete-workspace-role-dependents.ts`.
 */
export function workspaceOwnPeople(workspaceId: string): SQL {
  const roles = sql`SELECT r."id" FROM "role" r WHERE r."workspace_id" = ${workspaceId}`;
  const projects = sql`SELECT wsp."id" FROM "project" wsp WHERE wsp."workspace_id" = ${workspaceId}`;
  // Column names are internal constants; the workspace id stays a bound parameter.
  const scopeTest = (scope: string, scopeId: string): SQL =>
    sql`((${sql.raw(scope)} = 'workspace' AND ${sql.raw(scopeId)} = ${workspaceId}) OR (${sql.raw(scope)} = 'project' AND ${sql.raw(scopeId)} IN (${projects})))`;
  return sql`
    SELECT s."requester_id" AS pid FROM "submission" s
      WHERE s."request_type_id" IN (SELECT rt."id" FROM "request_type" rt WHERE rt."workspace_id" = ${workspaceId})
         OR s."work_item_id" IN (SELECT wi."id" FROM "work_item" wi WHERE wi."workspace_id" = ${workspaceId})
    UNION ALL SELECT s."claimed_by" FROM "submission" s
      WHERE s."request_type_id" IN (SELECT rt."id" FROM "request_type" rt WHERE rt."workspace_id" = ${workspaceId})
         OR s."work_item_id" IN (SELECT wi."id" FROM "work_item" wi WHERE wi."workspace_id" = ${workspaceId})
    UNION ALL SELECT a."uploaded_by" FROM "attachment" a WHERE a."workspace_id" = ${workspaceId}
    UNION ALL SELECT mb."person_id" FROM "membership" mb
      WHERE mb."role_id" IN (${roles}) OR ${scopeTest('mb."scope"', 'mb."scope_id"')}
    UNION ALL SELECT g."person_id" FROM "membership_grant" g
      WHERE g."role_id" IN (${roles})
         OR ${scopeTest('g."scope"', 'g."scope_id"')}
         OR g."oidc_group_mapping_id" IN (
              SELECT om."id" FROM "oidc_group_mapping" om
              WHERE om."role_id" IN (${roles}) OR ${scopeTest('om."scope"', 'om."scope_id"')})
         OR g."scim_group_mapping_id" IN (
              SELECT sm."id" FROM "scim_group_mapping" sm
              WHERE sm."role_id" IN (${roles}) OR ${scopeTest('sm."scope"', 'sm."scope_id"')})
  `;
}

/**
 * Open hold over everything a hard delete of the whole workspace removes: the work-item people
 * and organisations of every item in it, the project-level people and organisations of every
 * project in it (including the legacy Kaneo task subtree), every workspace member, and the
 * submission, attachment and membership people of {@link workspaceOwnPeople}.
 */
export function workspaceUnderOpenHold(workspaceId: string): SQL {
  const items = sql`SELECT wsi."id" FROM "work_item" wsi WHERE wsi."workspace_id" = ${workspaceId}`;
  const projects = sql`SELECT wsp."id" FROM "project" wsp WHERE wsp."workspace_id" = ${workspaceId}`;
  return openHoldOver(
    sql`
      ${workItemPeople(items)}
      UNION ALL ${projectOwnPeople(projects)}
      UNION ALL ${workspaceOwnPeople(workspaceId)}
      UNION ALL SELECT pe."id" FROM "person" pe WHERE pe."user_id" IN (
        SELECT m."user_id" FROM "workspace_member" m WHERE m."workspace_id" = ${workspaceId}
      )
    `,
    sql`
      SELECT w."organisation_id" FROM "workspace" w WHERE w."id" = ${workspaceId}
      UNION ALL
      SELECT p."organisation_id" FROM "project" p WHERE p."workspace_id" = ${workspaceId}
      UNION ALL
      ${workItemAttachmentOrganisations(items)}
      UNION ALL
      SELECT a."organisation_id" FROM "attachment" a WHERE a."workspace_id" = ${workspaceId}
      UNION ALL
      SELECT s."organisation_id" FROM "submission" s
        WHERE s."request_type_id" IN (SELECT rt."id" FROM "request_type" rt WHERE rt."workspace_id" = ${workspaceId})
           OR s."work_item_id" IN (${items})
    `,
  );
}
