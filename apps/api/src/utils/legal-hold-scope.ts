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

/** The `person` rows of the given user ids (`users` is a subquery yielding one column). */
function peopleOfUsers(users: SQL): SQL {
  return sql`SELECT pe."id" FROM "person" pe WHERE pe."user_id" IN (${users})`;
}

/**
 * Every person who authored or edited the given project pages (`pages` selects page ids; inner
 * aliases are `pgx` / `pgv`): `project_page.created_by` / `updated_by` and the
 * `project_page_version.created_by` of every stored version. The ONE list the page purge
 * (`scheduler/page-purge.ts`), the project purge and the workspace hard delete share.
 */
export function pagePeople(pages: SQL): SQL {
  return sql`
    SELECT pgx."created_by" AS pid FROM "project_page" pgx WHERE pgx."id" IN (${pages})
    UNION ALL SELECT pgx."updated_by" FROM "project_page" pgx WHERE pgx."id" IN (${pages})
    UNION ALL SELECT pgv."created_by" FROM "project_page_version" pgv WHERE pgv."page_id" IN (${pages})
  `;
}

/**
 * Every person whose rows hard-delete with the given knowledge base articles (`articles` selects
 * article ids; inner aliases `kax` / `kav` / `kaf` / `kad`): `kb_article.author_id` / `owner_id`,
 * `kb_article_version.created_by`, `kb_article_feedback.person_id` (a customer's answer and
 * comment) and `deflection_event.person_id` (the customer's search query). Customers are people
 * too, so a person-scope hold on a customer fences the article's purge.
 */
export function kbArticlePeople(articles: SQL): SQL {
  return sql`
    SELECT kax."author_id" AS pid FROM "kb_article" kax WHERE kax."id" IN (${articles})
    UNION ALL SELECT kax."owner_id" FROM "kb_article" kax WHERE kax."id" IN (${articles})
    UNION ALL SELECT kav."created_by" FROM "kb_article_version" kav WHERE kav."article_id" IN (${articles})
    UNION ALL SELECT kaf."person_id" FROM "kb_article_feedback" kaf WHERE kaf."article_id" IN (${articles})
    UNION ALL SELECT kad."person_id" FROM "deflection_event" kad WHERE kad."kb_article_id" IN (${articles})
  `;
}

/**
 * Every person whose rows hard-delete with the given work items (`items` is a subquery that
 * selects work-item ids; use inner aliases that do not clash with the caller's). The FK cascades
 * from `work_item` remove: the item's requester/assignee, `activity.actor_id`,
 * `comment.author_id`/`deleted_by`, `comment_version.edited_by`, `attachment.uploaded_by`
 * (direct or via a comment), `watcher.person_id`, `request_participant.person_id`/`added_by`
 * and `approval.requested_by`/`approver_id`. `activity.actor_id` and `comment.author_id` hold a
 * raw user id on some write paths (see schema comments), and `comment.deleted_by` and
 * `comment_version.edited_by` hold a user id in production (no FK), so all four are also
 * resolved through `person.user_id`. `cycle_scope_event.actor_id` (a user id; the rows cascade
 * with the item, FK 0148) is resolved the same way.
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
    UNION ALL SELECT x."person_id" FROM "running_timer" x WHERE x."work_item_id" IN (${items})
    UNION ALL ${peopleOfUsers(sql`
      SELECT x."freeze_override_by" FROM "change_detail" x WHERE x."work_item_id" IN (${items})
      UNION ALL SELECT x."updated_by" FROM "change_detail" x WHERE x."work_item_id" IN (${items})
      UNION ALL SELECT x."actor_id" FROM "cycle_scope_event" x WHERE x."work_item_id" IN (${items})
    `)}
  `;
}

/**
 * People attached to the given projects beyond their work items (`projectIds` selects project
 * ids): `project.created_by`, stakeholders, `project_feature_flag.updated_by`, and the legacy
 * Kaneo `task` subtree that cascades from the project (assignee, time-entry person, task
 * activity/comment authors, asset creators), all resolved to `person` through
 * `person.user_id`. P5 rows that go with the project: its pages and their versions, its
 * project-scoped knowledge base articles (authors, owners, versions, feedback, deflection
 * events), the module lead, and the user ids stored on cycles, scope events, modules, estimates,
 * estimate changes, budgets and rate cards. All are person data (a person-scope hold fences
 * them); none of them is organisation data.
 */
export function projectOwnPeople(projectIds: SQL): SQL {
  return sql`
    SELECT pj."created_by" AS pid FROM "project" pj WHERE pj."id" IN (${projectIds})
    UNION ALL SELECT x."person_id" FROM "stakeholder" x WHERE x."project_id" IN (${projectIds})
    UNION ALL SELECT x."updated_by" FROM "project_feature_flag" x WHERE x."project_id" IN (${projectIds})
    UNION ALL SELECT x."person_id" FROM "time_entry" x WHERE x."project_id" IN (${projectIds})
    UNION ALL SELECT x."person_id" FROM "hourly_rate" x WHERE x."project_id" IN (${projectIds})
    UNION ALL SELECT x."lead_id" FROM "module" x WHERE x."project_id" IN (${projectIds})
    UNION ALL ${pagePeople(sql`SELECT pg."id" FROM "project_page" pg WHERE pg."project_id" IN (${projectIds})`)}
    UNION ALL ${kbArticlePeople(sql`SELECT ka."id" FROM "kb_article" ka WHERE ka."project_id" IN (${projectIds})`)}
    UNION ALL ${peopleOfUsers(sql`
      SELECT x."created_by" FROM "hourly_rate" x WHERE x."project_id" IN (${projectIds})
      UNION ALL SELECT x."created_by" FROM "budget" x WHERE x."project_id" IN (${projectIds})
      UNION ALL SELECT x."created_by" FROM "cycle" x WHERE x."project_id" IN (${projectIds})
      UNION ALL SELECT x."completed_by" FROM "cycle" x WHERE x."project_id" IN (${projectIds})
      UNION ALL SELECT ev."actor_id" FROM "cycle_scope_event" ev
        JOIN "cycle" x ON x."id" = ev."cycle_id" WHERE x."project_id" IN (${projectIds})
      UNION ALL SELECT x."created_by" FROM "module" x WHERE x."project_id" IN (${projectIds})
      UNION ALL SELECT x."created_by" FROM "estimate" x WHERE x."project_id" IN (${projectIds})
      UNION ALL SELECT x."actor_id" FROM "estimate_change" x WHERE x."project_id" IN (${projectIds})
    `)}
    UNION ALL SELECT pe."id" FROM "person" pe WHERE pe."user_id" IN (
      SELECT t."assignee_id" FROM "task" t WHERE t."project_id" IN (${projectIds})
      UNION ALL SELECT te."user_id" FROM "task_time_entry" te
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
 * of its projects, and for grants the group mappings that qualify by the same rules), plus the
 * P5 workspace-level rows: every knowledge base article (and its versions, feedback, deflection
 * events), dashboard owners, saved-view creators, invitation inviters and acceptors, and the
 * creators of services, releases and change freezes, the `done_by` person of every release checklist item (releases are workspace-bound, not project-bound), and the person and creator of the
 * workspace-default hourly rates (`project_id IS NULL`; project rates go with the project). Mirrors
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
    UNION ALL ${kbArticlePeople(sql`SELECT wka."id" FROM "kb_article" wka WHERE wka."workspace_id" = ${workspaceId}`)}
    UNION ALL SELECT dp."person_id" FROM "deflection_event" dp WHERE dp."workspace_id" = ${workspaceId}
    UNION ALL SELECT db."owner_id" FROM "dashboard" db WHERE db."workspace_id" = ${workspaceId}
    UNION ALL SELECT sv."created_by" FROM "saved_view" sv WHERE sv."workspace_id" = ${workspaceId}
    UNION ALL SELECT iv."accepted_person_id" FROM "invitation" iv WHERE iv."workspace_id" = ${workspaceId}
    UNION ALL SELECT hr."person_id" FROM "hourly_rate" hr
      WHERE hr."workspace_id" = ${workspaceId} AND hr."project_id" IS NULL
    UNION ALL SELECT ci."done_by" FROM "checklist_item" ci
      WHERE ci."release_id" IN (SELECT rl2."id" FROM "release" rl2 WHERE rl2."workspace_id" = ${workspaceId})
    UNION ALL ${peopleOfUsers(sql`
      SELECT hr."created_by" FROM "hourly_rate" hr
        WHERE hr."workspace_id" = ${workspaceId} AND hr."project_id" IS NULL
      UNION ALL SELECT iv."inviter_id" FROM "invitation" iv WHERE iv."workspace_id" = ${workspaceId}
      UNION ALL SELECT sx."created_by" FROM "service" sx WHERE sx."workspace_id" = ${workspaceId}
      UNION ALL SELECT sx."status_changed_by" FROM "service" sx WHERE sx."workspace_id" = ${workspaceId}
      UNION ALL SELECT rl."created_by" FROM "release" rl WHERE rl."workspace_id" = ${workspaceId}
      UNION ALL SELECT cf."created_by" FROM "change_freeze" cf WHERE cf."workspace_id" = ${workspaceId}
      UNION ALL SELECT cf."cancelled_by" FROM "change_freeze" cf WHERE cf."workspace_id" = ${workspaceId}
    `)}
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
      UNION ALL
      SELECT iv."organisation_id" FROM "invitation" iv WHERE iv."workspace_id" = ${workspaceId}
    `,
  );
}

/**
 * Open hold over a workspace/project-scoped operational row that carries copies of work-item data
 * (`webhook_delivery.request_body`, `automation_run.results`): the organisation of its workspace
 * and of its project, plus every person attached to the work item it names and to the work items
 * of its project. The columns are the caller's own row references (for example
 * `${table.workspaceId}`); `workItemId` may be null for rows that name none. Retention purges
 * of such rows must skip a row while this is true (`background-jobs.md`: retention obeys person,
 * source, recipient and resource-owner legal holds). The caller must hold
 * `LOCK TABLE legal_hold IN SHARE MODE` (`fenceLegalHolds`).
 */
export function scopedRowUnderOpenHold(row: {
  workspaceId: SQL;
  projectId: SQL;
  workItemId: SQL | null;
}): SQL {
  const items = sql`
    SELECT hi."id" FROM "work_item" hi
    WHERE hi."project_id" = ${row.projectId}
       ${row.workItemId ? sql`OR hi."id" = ${row.workItemId}` : sql``}
  `;
  return openHoldOver(
    sql`${workItemPeople(items)} UNION ALL ${projectOwnPeople(sql`SELECT ${row.projectId}`)}`,
    sql`
      SELECT w."organisation_id" FROM "workspace" w WHERE w."id" = ${row.workspaceId}
      UNION ALL
      SELECT p."organisation_id" FROM "project" p WHERE p."id" = ${row.projectId}
      UNION ALL
      ${workItemAttachmentOrganisations(items)}
    `,
  );
}
