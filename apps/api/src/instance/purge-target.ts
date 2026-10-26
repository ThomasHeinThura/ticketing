import { sql } from "drizzle-orm";
import type { Executor } from "../database/executor";
import { deleteStorageObject } from "../storage";

/**
 * `PA-13` hard purge — target inspection and execution for `POST /api/instance/purge`.
 *
 * Hard purge is an exceptional `instance:admin` operation that is elevated, requires typed
 * confirmation and step-up (the pending-action `purge` kind, confirmation
 * `typed_name_step_up`), **checks legal hold and retention policy first**, and writes a complete
 * record of what was purged. This module owns the check and the irreversible delete; the
 * request route is `./purge.ts`; the confirmation is the pending-action approval.
 *
 * Targets are the two soft-deletable business records with a contracted purge lifecycle:
 * `work_item` (`WI-21`) and `project` (`PR-16`). The retention check is that the target was
 * already soft-deleted (an approved deletion): hard purge only ends the recovery window early,
 * it never removes live data, and there is no stored per-tenant retention policy yet. A legal
 * hold on the target's workspace/project organisation or on an attached person (requester or
 * assignee, or that person's organisation) refuses the purge (`safety-and-runtime.md`:
 * "purge (`PA-12`/`PA-13`) is refused while the hold stands").
 */

export const HARD_PURGE_TARGET_TYPES = [
  "work_item",
  "project",
  "organisation",
] as const;
export type HardPurgeTargetType = (typeof HARD_PURGE_TARGET_TYPES)[number];
export type HardPurgeTarget = {
  targetType: HardPurgeTargetType;
  targetId: string;
};

export type HardPurgeFacts = {
  exists: boolean;
  softDeleted: boolean;
  underLegalHold: boolean;
  /** Live or soft-deleted child work items outside the purge (work_item targets only). */
  childWorkItems: number;
  /** Portal submissions referencing a work item in scope (RESTRICT FK; never force-deleted). */
  submissions: number;
  /** Request types / versions naming a project target as `default_project_id` (RESTRICT FK). */
  requestTypeDefaults: number;
  externalDependants?: number;
  organisationVersion?: { operationId: string; generation: number };
  organisationImpact?: {
    organisations: number;
    projects: number;
    people: number;
    workItems: number;
    comments: number;
    submissions: number;
    attachments: number;
    storageObjectsQueued: number;
  };
  workItems: number;
  comments: number;
  attachments: number;
  label: string | null;
};

export type HardPurgeCheck =
  | { status: "not_found" }
  | { status: "refused"; reason: "legal_hold" | "not_soft_deleted" }
  | {
      status: "blocked";
      reason:
        | "has_child_work_items"
        | "has_submissions"
        | "is_request_type_default"
        | "has_external_dependants";
    }
  | {
      status: "eligible";
      summary: {
        targetType: HardPurgeTargetType;
        targetId: string;
        label: string | null;
        workItems: number;
        comments: number;
        attachments: number;
        legalHold: "none";
        retention: "soft_deleted";
        operationId?: string;
        generation?: number;
        impact?: HardPurgeFacts["organisationImpact"];
      };
    };

/** Pure decision. Legal hold is checked before anything else about an existing target. */
export function evaluateHardPurgeTarget(
  target: HardPurgeTarget,
  facts: HardPurgeFacts,
): HardPurgeCheck {
  if (!facts.exists) return { status: "not_found" };
  if (facts.underLegalHold) return { status: "refused", reason: "legal_hold" };
  if (!facts.softDeleted)
    return { status: "refused", reason: "not_soft_deleted" };
  if (facts.childWorkItems > 0)
    return { status: "blocked", reason: "has_child_work_items" };
  if (facts.submissions > 0)
    return { status: "blocked", reason: "has_submissions" };
  if (facts.requestTypeDefaults > 0)
    return { status: "blocked", reason: "is_request_type_default" };
  if ((facts.externalDependants ?? 0) > 0)
    return { status: "blocked", reason: "has_external_dependants" };
  return {
    status: "eligible",
    summary: {
      targetType: target.targetType,
      targetId: target.targetId,
      label: facts.label,
      workItems: facts.workItems,
      comments: facts.comments,
      attachments: facts.attachments,
      legalHold: "none",
      retention: "soft_deleted",
      ...(facts.organisationVersion
        ? {
            operationId: facts.organisationVersion.operationId,
            generation: facts.organisationVersion.generation,
          }
        : {}),
      ...(facts.organisationImpact ? { impact: facts.organisationImpact } : {}),
    },
  };
}

function itemsInScope(target: HardPurgeTarget) {
  return target.targetType === "work_item"
    ? sql`SELECT wi."id" FROM "work_item" wi WHERE wi."id" = ${target.targetId}`
    : sql`SELECT wi."id" FROM "work_item" wi WHERE wi."project_id" = ${target.targetId}`;
}

/** The project id for a project target; NULL (matches nothing) for a work item target. */
function projectTargetId(target: HardPurgeTarget) {
  return target.targetType === "project"
    ? sql`${target.targetId}::text`
    : sql`NULL::text`;
}

function attachmentsInScope(target: HardPurgeTarget) {
  const items = itemsInScope(target);
  return sql`(
    a."work_item_id" IN (${items})
    OR a."comment_id" IN (SELECT c."id" FROM "comment" c WHERE c."work_item_id" IN (${items}))
  )`;
}

export async function readHardPurgeFacts(
  executor: Executor,
  target: HardPurgeTarget,
): Promise<HardPurgeFacts> {
  if (target.targetType === "organisation") {
    const { lockOrganisationPurgeState, organisationUnderOpenLegalHold } =
      await import("./organisation-purge");
    const state = await lockOrganisationPurgeState(executor, target.targetId);
    if (!state) {
      return {
        exists: false,
        softDeleted: false,
        underLegalHold: false,
        childWorkItems: 0,
        submissions: 0,
        requestTypeDefaults: 0,
        workItems: 0,
        comments: 0,
        attachments: 0,
        label: null,
      };
    }
    const held = await organisationUnderOpenLegalHold(
      executor,
      target.targetId,
    );
    const counts = await executor.execute<{
      projects: string;
      people: string;
      work_items: string;
      comments: string;
      submissions: string;
      attachments: string;
      storage_objects_queued: string;
      external_dependants: string;
    }>(sql`
      SELECT
        (SELECT count(*) FROM project p
          WHERE p.organisation_id = ${target.targetId})::text AS projects,
        (SELECT count(*) FROM person pe
          WHERE pe.organisation_id = ${target.targetId})::text AS people,
        (SELECT count(*) FROM work_item wi JOIN project p ON p.id = wi.project_id
          WHERE p.organisation_id = ${target.targetId})::text AS work_items,
        (SELECT count(*) FROM comment c JOIN work_item wi ON wi.id = c.work_item_id
          JOIN project p ON p.id = wi.project_id
          WHERE p.organisation_id = ${target.targetId})::text AS comments,
        (SELECT count(*) FROM submission s
          WHERE s.organisation_id = ${target.targetId}
             OR s.work_item_id IN (
               SELECT wi.id FROM work_item wi JOIN project p ON p.id = wi.project_id
               WHERE p.organisation_id = ${target.targetId}
             ))::text AS submissions,
        (SELECT count(*) FROM attachment a
          WHERE a.organisation_id = ${target.targetId}
             OR a.work_item_id IN (
               SELECT wi.id FROM work_item wi JOIN project p ON p.id = wi.project_id
               WHERE p.organisation_id = ${target.targetId}
             )
             OR a.comment_id IN (
               SELECT c.id FROM comment c JOIN work_item wi ON wi.id = c.work_item_id
               JOIN project p ON p.id = wi.project_id
               WHERE p.organisation_id = ${target.targetId}
             )
             OR a.submission_id IN (
               SELECT s.id FROM submission s WHERE s.organisation_id = ${target.targetId}
             ))::text AS attachments,
        (SELECT count(DISTINCT a.object_key) FROM attachment a
          WHERE (a.organisation_id = ${target.targetId}
             OR a.work_item_id IN (
               SELECT wi.id FROM work_item wi JOIN project p ON p.id = wi.project_id
               WHERE p.organisation_id = ${target.targetId}
             )
             OR a.comment_id IN (
               SELECT c.id FROM comment c JOIN work_item wi ON wi.id = c.work_item_id
               JOIN project p ON p.id = wi.project_id
               WHERE p.organisation_id = ${target.targetId}
             )
             OR a.submission_id IN (
               SELECT s.id FROM submission s WHERE s.organisation_id = ${target.targetId}
             ))
            AND NOT EXISTS (
              SELECT 1 FROM attachment_object_gc gc WHERE gc.object_key = a.object_key
            ))::text AS storage_objects_queued,
        (
          (SELECT count(*) FROM project child JOIN project parent
            ON parent.id = child.parent_id
            WHERE parent.organisation_id = ${target.targetId}
              AND child.organisation_id IS DISTINCT FROM ${target.targetId})
          + (SELECT count(*) FROM workspace w
            WHERE w.organisation_id = ${target.targetId}
              AND EXISTS (SELECT 1 FROM project p WHERE p.workspace_id = w.id
                AND p.organisation_id IS DISTINCT FROM ${target.targetId}))
          + (SELECT count(*) FROM identity_connection ic
            JOIN workspace w ON w.id = ic.default_workspace_id
            WHERE w.organisation_id = ${target.targetId}
              AND ic.organisation_id IS DISTINCT FROM ${target.targetId})
          + (SELECT count(*) FROM membership_grant mg
            JOIN person p ON p.id = mg.granted_by_person_id
            WHERE p.organisation_id = ${target.targetId}
              AND mg.person_id NOT IN (SELECT id FROM person
                WHERE organisation_id = ${target.targetId}))
        )::text AS external_dependants
    `);
    const row = counts.rows[0];
    return {
      exists: true,
      softDeleted: true,
      underLegalHold: held,
      childWorkItems: 0,
      submissions: 0,
      requestTypeDefaults: 0,
      externalDependants: Number(row?.external_dependants ?? 0),
      workItems: Number(row?.work_items ?? 0),
      comments: Number(row?.comments ?? 0),
      attachments: Number(row?.attachments ?? 0),
      label: state.name,
      organisationImpact: {
        organisations: 1,
        projects: Number(row?.projects ?? 0),
        people: Number(row?.people ?? 0),
        workItems: Number(row?.work_items ?? 0),
        comments: Number(row?.comments ?? 0),
        submissions: Number(row?.submissions ?? 0),
        attachments: Number(row?.attachments ?? 0),
        storageObjectsQueued: Number(row?.storage_objects_queued ?? 0),
      },
      organisationVersion: {
        operationId: state.operationId,
        generation: state.generation,
      },
    };
  }
  const items = itemsInScope(target);
  const root =
    target.targetType === "work_item"
      ? sql`
        SELECT wi."key" AS label, (wi."deleted_at" IS NOT NULL) AS soft_deleted,
          ARRAY[w."organisation_id", p."organisation_id"]::text[] AS organisations
        FROM "work_item" wi
        JOIN "project" p ON p."id" = wi."project_id"
        JOIN "workspace" w ON w."id" = wi."workspace_id"
        WHERE wi."id" = ${target.targetId}`
      : sql`
        SELECT p."name" AS label, (p."deleted_at" IS NOT NULL) AS soft_deleted,
          ARRAY[w."organisation_id", p."organisation_id"]::text[] AS organisations
        FROM "project" p
        JOIN "workspace" w ON w."id" = p."workspace_id"
        WHERE p."id" = ${target.targetId}`;
  const result = await executor.execute<{
    label: string | null;
    soft_deleted: boolean;
    held: boolean;
    child_work_items: string;
    submissions: string;
    request_type_defaults: string;
    work_items: string;
    comments: string;
    attachments: string;
  }>(sql`
    WITH root AS (${root}),
    people AS (
      SELECT wi."requester_id" AS id FROM "work_item" wi WHERE wi."id" IN (${items})
      UNION SELECT wi."assignee_id" FROM "work_item" wi WHERE wi."id" IN (${items})
    )
    SELECT
      root.label,
      root.soft_deleted,
      EXISTS (
        SELECT 1 FROM "legal_hold" lh
        WHERE lh."lifted_at" IS NULL AND (
          (lh."scope" = 'organisation' AND (
            lh."scope_id" = ANY (root.organisations)
            OR lh."scope_id" IN (
              SELECT pe."organisation_id" FROM "person" pe WHERE pe."id" IN (SELECT id FROM people)
            )
          ))
          OR (lh."scope" = 'person' AND lh."scope_id" IN (SELECT id FROM people))
        )
      ) AS held,
      (SELECT count(*) FROM "work_item" c
        WHERE c."parent_id" IN (${items}) AND c."id" NOT IN (${items}))::text AS child_work_items,
      (SELECT count(*) FROM "submission" s WHERE s."work_item_id" IN (${items}))::text AS submissions,
      (
        SELECT count(*) FROM (
          SELECT 1 FROM "request_type" rt WHERE rt."default_project_id" = ${projectTargetId(target)}
          UNION ALL
          SELECT 1 FROM "request_type_version" rtv WHERE rtv."default_project_id" = ${projectTargetId(target)}
        ) d
      )::text AS request_type_defaults,
      (SELECT count(*) FROM (${items}) i)::text AS work_items,
      (SELECT count(*) FROM "comment" c WHERE c."work_item_id" IN (${items}))::text AS comments,
      (SELECT count(*) FROM "attachment" a WHERE ${attachmentsInScope(target)})::text AS attachments
    FROM root
  `);
  const row = result.rows[0];
  if (!row) {
    return {
      exists: false,
      softDeleted: false,
      underLegalHold: false,
      childWorkItems: 0,
      submissions: 0,
      requestTypeDefaults: 0,
      workItems: 0,
      comments: 0,
      attachments: 0,
      label: null,
    };
  }
  return {
    exists: true,
    softDeleted: row.soft_deleted === true,
    underLegalHold: row.held === true,
    childWorkItems: Number(row.child_work_items),
    submissions: Number(row.submissions),
    requestTypeDefaults: Number(row.request_type_defaults),
    workItems: Number(row.work_items),
    comments: Number(row.comments),
    attachments: Number(row.attachments),
    label: row.label,
  };
}

export async function inspectHardPurgeTarget(
  executor: Executor,
  target: HardPurgeTarget,
): Promise<HardPurgeCheck> {
  return evaluateHardPurgeTarget(
    target,
    await readHardPurgeFacts(executor, target),
  );
}

export type HardPurgeRecord = {
  targetType: HardPurgeTargetType;
  targetId: string;
  label: string | null;
  workItemIds: string[];
  comments: number;
  attachments: number;
  /** Stored objects no surviving attachment shares; remove them after commit. */
  storageObjectKeys: string[];
  organisationPurge?: {
    projects: number;
    workItems: number;
    people: number;
    attachments: number;
    storageObjectsQueued: number;
  };
};

export class HardPurgeRefused extends Error {
  constructor(readonly check: Exclude<HardPurgeCheck, { status: "eligible" }>) {
    super(`hard_purge_${check.status}`);
    this.name = "HardPurgeRefused";
  }
}

/**
 * Executes an approved hard purge inside the caller's transaction (the pending-action
 * executor's). Fences hold placement, re-runs the full check, then deletes work items
 * leaf-first and, for a project, the project row. Stored
 * attachment objects are **not** touched here: the caller removes `storageObjectKeys` with
 * {@link removePurgedObjects} only after the transaction commits, so a failed purge never leaves
 * a still-restorable soft-deleted item without its files (a post-commit storage failure leaks an
 * orphan object instead). Returns the complete record for the `pending_action.executed` audit.
 */
export async function executeHardPurge(
  tx: Executor,
  target: HardPurgeTarget,
  expectedOrganisationVersion?: { operationId: string; generation: number },
): Promise<HardPurgeRecord> {
  if (target.targetType === "organisation") {
    const { deleteOrganisationPurgeGraph, lockOrganisationPurgeState } =
      await import("./organisation-purge");
    const state = await lockOrganisationPurgeState(
      tx,
      target.targetId,
      expectedOrganisationVersion,
    );
    if (!state) throw new HardPurgeRefused({ status: "not_found" });
    await tx.execute(sql`LOCK TABLE legal_hold IN SHARE MODE`);
    const check = await inspectHardPurgeTarget(tx, target);
    if (check.status !== "eligible") throw new HardPurgeRefused(check);
    const organisationPurge = await deleteOrganisationPurgeGraph(tx, state);
    return {
      targetType: "organisation",
      targetId: target.targetId,
      label: state.name,
      workItemIds: [],
      comments: check.summary.comments,
      attachments: organisationPurge.attachments,
      storageObjectKeys: [],
      organisationPurge,
    };
  }

  // An org-owned project shares the lifecycle lock order used by organisation restore and
  // purge before the project row is locked. Its organisation snapshot row is removed in the
  // same transaction to release the RESTRICT FK.
  if (target.targetType === "project") {
    const ownerResult = await tx.execute<{
      organisation_id: string | null;
    }>(sql`
      SELECT organisation_id FROM project WHERE id = ${target.targetId}
    `);
    const owner = ownerResult.rows[0];
    if (owner?.organisation_id) {
      const { lockOrganisationIdentityDomainBindings } = await import(
        "./organisation-lifecycle"
      );
      await lockOrganisationIdentityDomainBindings(tx);
      await tx.execute(sql`
        SELECT id FROM organisation WHERE id = ${owner.organisation_id} FOR UPDATE
      `);
      await tx.execute(sql`
        SELECT operation_id FROM organisation_deletion_snapshot
        WHERE organisation_id = ${owner.organisation_id} FOR UPDATE
      `);
    }
  }
  await tx.execute(sql`LOCK TABLE legal_hold IN SHARE MODE`);
  if (target.targetType === "work_item") {
    await tx.execute(
      sql`SELECT 1 FROM "work_item" WHERE "id" = ${target.targetId} FOR UPDATE`,
    );
  } else {
    await tx.execute(
      sql`SELECT 1 FROM "project" WHERE "id" = ${target.targetId} FOR UPDATE`,
    );
  }
  const check = await inspectHardPurgeTarget(tx, target);
  if (check.status !== "eligible") throw new HardPurgeRefused(check);

  const items = itemsInScope(target);
  const workItemIds = (
    await tx.execute<{ id: string }>(sql`${items} ORDER BY 1`)
  ).rows.map((row) => row.id);

  const objects = await tx.execute<{ object_key: string }>(sql`
    SELECT DISTINCT a."object_key" FROM "attachment" a
    WHERE ${attachmentsInScope(target)}
      AND NOT EXISTS (
        SELECT 1 FROM "attachment" other
        WHERE other."object_key" = a."object_key"
          AND NOT (
            other."work_item_id" IN (${items})
            OR other."comment_id" IN (
              SELECT c."id" FROM "comment" c WHERE c."work_item_id" IN (${items})
            )
          )
      )
  `);

  for (;;) {
    const deleted = await tx.execute(sql`
      DELETE FROM "work_item" wi
      WHERE wi."id" IN (${items})
        AND NOT EXISTS (SELECT 1 FROM "work_item" c WHERE c."parent_id" = wi."id")
    `);
    if ((deleted.rowCount ?? 0) === 0) break;
  }
  if (target.targetType === "project") {
    await tx.execute(sql`
      DELETE FROM organisation_deletion_project_snapshot
      WHERE project_id = ${target.targetId}
    `);
    const project = await tx.execute(
      sql`DELETE FROM "project" WHERE "id" = ${target.targetId}`,
    );
    if ((project.rowCount ?? 0) !== 1)
      throw new Error("Hard purge removed no project row");
  }

  return {
    targetType: target.targetType,
    targetId: target.targetId,
    label: check.summary.label,
    workItemIds,
    comments: check.summary.comments,
    attachments: check.summary.attachments,
    storageObjectKeys: objects.rows.map((row) => row.object_key),
  };
}

/** Post-commit, best-effort object removal. Returns how many objects could not be removed. */
export async function removePurgedObjects(
  keys: readonly string[],
  remove: (key: string) => Promise<void> = deleteStorageObject,
): Promise<number> {
  let failed = 0;
  for (const key of keys) {
    try {
      await remove(key);
    } catch {
      failed++;
    }
  }
  return failed;
}
