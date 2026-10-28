import { sql } from "drizzle-orm";
import type { StepUpExecutor } from "../auth/repository";
import type { Executor } from "../database/executor";
import { retireImportProjectTargets } from "../imports/project-retention";

export type OrganisationPurgeVersion = {
  operationId: string;
  generation: number;
};

export function organisationPurgeVersion(
  operationId: string,
  generation: number,
) {
  return JSON.stringify({ operationId, generation });
}

export type OrganisationPurgeState = {
  organisationId: string;
  name: string;
  operationId: string;
  generation: number;
  deletedAt: string;
  purgeAfter: string;
};

/**
 * Takes the same identity-domain -> organisation -> deletion-snapshot locks as
 * restore. That makes the operation/generation pair an ABA-safe fence for both
 * manual and retention purges.
 */
export async function lockOrganisationPurgeState(
  tx: Executor,
  organisationId: string,
  expected?: OrganisationPurgeVersion,
): Promise<OrganisationPurgeState | null> {
  const { lockOrganisationIdentityDomainBindings } = await import(
    "./organisation-lifecycle"
  );
  await lockOrganisationIdentityDomainBindings(tx);
  const organisation = await tx.execute<{
    id: string;
    name: string;
    is_internal: boolean;
    deleted_at: string | null;
    purge_after: string | null;
    deletion_generation: number;
  }>(sql`
    SELECT id, name, is_internal, deleted_at, purge_after,
      deletion_generation::double precision AS deletion_generation
    FROM organisation
    WHERE id = ${organisationId}
    FOR UPDATE
  `);
  const row = organisation.rows[0];
  if (
    !row ||
    row.is_internal ||
    !row.deleted_at ||
    !row.purge_after ||
    !Number.isSafeInteger(row.deletion_generation)
  )
    return null;

  const snapshot = await tx.execute<{
    operation_id: string;
    generation: number;
    deleted_at: string;
    purge_after: string;
  }>(sql`
    SELECT operation_id, generation::double precision AS generation,
      deleted_at, purge_after
    FROM organisation_deletion_snapshot
    WHERE organisation_id = ${organisationId}
    FOR UPDATE
  `);
  const active = snapshot.rows[0];
  if (
    !active ||
    active.generation !== row.deletion_generation ||
    active.deleted_at !== row.deleted_at ||
    active.purge_after !== row.purge_after ||
    (expected !== undefined &&
      (active.operation_id !== expected.operationId ||
        active.generation !== expected.generation))
  )
    return null;

  return {
    organisationId: row.id,
    name: row.name,
    operationId: active.operation_id,
    generation: active.generation,
    deletedAt: active.deleted_at,
    purgeAfter: active.purge_after,
  };
}

export async function organisationUnderOpenLegalHold(
  tx: Executor,
  organisationId: string,
): Promise<boolean> {
  const result = await tx.execute<{ held: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM legal_hold lh
      WHERE lh.lifted_at IS NULL
        AND (
          (lh.scope = 'organisation' AND lh.scope_id = ${organisationId})
          OR (lh.scope = 'person' AND lh.scope_id IN (
            SELECT p.id FROM person p WHERE p.organisation_id = ${organisationId}
          ))
        )
    ) AS held
  `);
  return result.rows[0]?.held === true;
}

export type OrganisationPurgeCounts = {
  projects: number;
  workItems: number;
  people: number;
  attachments: number;
  storageObjectsQueued: number;
};

export type OrganisationPurgeCandidate = OrganisationPurgeVersion & {
  organisationId: string;
};

export type OrganisationRetentionPurgeResult =
  | {
      status: "purged";
      state: OrganisationPurgeState;
      counts: OrganisationPurgeCounts;
    }
  | { status: "held" | "stale" | "not_found" };

export async function listOrganisationPurgeCandidates(
  executor: Executor,
  limit: number,
  exclude: readonly string[] = [],
): Promise<OrganisationPurgeCandidate[]> {
  const excluding = exclude.length
    ? sql`AND o.id NOT IN (${sql.join(
        exclude.map((id) => sql`${id}`),
        sql`, `,
      )})`
    : sql``;
  const result = await executor.execute<{
    organisation_id: string;
    operation_id: string;
    generation: number;
  }>(sql`
    SELECT o.id AS organisation_id, d.operation_id,
      d.generation::double precision AS generation
    FROM organisation o
    JOIN organisation_deletion_snapshot d ON d.organisation_id = o.id
    WHERE o.is_internal = false
      AND o.deleted_at = d.deleted_at
      AND o.purge_after = d.purge_after
      AND o.deletion_generation = d.generation
      AND d.purge_after <= clock_timestamp()
      ${excluding}
    ORDER BY d.purge_after, o.id
    LIMIT ${limit}
  `);
  return result.rows.map((row) => ({
    organisationId: row.organisation_id,
    operationId: row.operation_id,
    generation: row.generation,
  }));
}

/** PA-12: runs the already-approved organisation deletion after its 30-day window. */
export async function purgeExpiredOrganisation(
  tx: Executor,
  candidate: OrganisationPurgeCandidate,
): Promise<OrganisationRetentionPurgeResult> {
  const { loadDeletedOrganisationForPurge } = await import(
    "./organisation-lifecycle"
  );
  const eligibility = await loadDeletedOrganisationForPurge(
    tx as StepUpExecutor,
    {
      organisationId: candidate.organisationId,
      expectedOperationId: candidate.operationId,
      expectedGeneration: candidate.generation,
    },
  );
  if (eligibility.kind !== "purgeable")
    return { status: eligibility.kind === "not_found" ? "not_found" : "stale" };
  const state = await lockOrganisationPurgeState(tx, candidate.organisationId, {
    operationId: candidate.operationId,
    generation: candidate.generation,
  });
  if (!state) return { status: "stale" };
  await tx.execute(sql`LOCK TABLE legal_hold IN SHARE MODE`);
  if (await organisationUnderOpenLegalHold(tx, candidate.organisationId))
    return { status: "held" };
  const counts = await deleteOrganisationPurgeGraph(tx, state);
  return { status: "purged", state, counts };
}

/**
 * Removes the organisation-owned project graph while keeping any shared workspace
 * intact. The caller holds the identity-domain, organisation, snapshot and legal-hold
 * fences established by `lockOrganisationPurgeState` and `LOCK legal_hold`.
 */
export async function deleteOrganisationPurgeGraph(
  tx: Executor,
  state: OrganisationPurgeState,
): Promise<OrganisationPurgeCounts> {
  const projectRows = await tx.execute<{ id: string }>(sql`
    SELECT id FROM project
    WHERE organisation_id = ${state.organisationId}
    ORDER BY id
    FOR UPDATE
  `);
  const projectIds = projectRows.rows.map((row) => row.id);
  const projectList = projectIds.length
    ? sql.join(
        projectIds.map((id) => sql`${id}`),
        sql`, `,
      )
    : sql`NULL`;

  const mixedWorkspace = await tx.execute<{ id: string }>(sql`
    SELECT w.id
    FROM workspace w
    WHERE w.organisation_id = ${state.organisationId}
      AND EXISTS (
        SELECT 1 FROM project p
        WHERE p.workspace_id = w.id
          AND p.organisation_id IS DISTINCT FROM ${state.organisationId}
      )
    LIMIT 1
  `);
  if (mixedWorkspace.rows.length)
    throw new Error(
      "organisation_purge_workspace_has_other_organisation_projects",
    );

  const externalChild = projectIds.length
    ? await tx.execute<{ id: string }>(sql`
        SELECT child.id FROM project child
        WHERE child.parent_id IN (${projectList})
          AND child.organisation_id IS DISTINCT FROM ${state.organisationId}
        LIMIT 1
      `)
    : { rows: [] };
  if (externalChild.rows.length)
    throw new Error("organisation_purge_project_has_external_child");

  const itemRows = projectIds.length
    ? await tx.execute<{ id: string }>(sql`
        SELECT id FROM work_item WHERE project_id IN (${projectList}) ORDER BY id
      `)
    : { rows: [] };
  const workItemIds = itemRows.rows.map((row) => row.id);
  const items = workItemIds.length
    ? sql.join(
        workItemIds.map((id) => sql`${id}`),
        sql`, `,
      )
    : sql`NULL`;

  const attachmentCount = await tx.execute<{ count: string }>(sql`
    SELECT count(*)::text AS count FROM attachment a
    WHERE a.organisation_id = ${state.organisationId}
       OR a.work_item_id IN (${items})
       OR a.comment_id IN (
         SELECT c.id FROM comment c WHERE c.work_item_id IN (${items})
       )
       OR a.submission_id IN (
         SELECT s.id FROM submission s WHERE s.organisation_id = ${state.organisationId}
       )
  `);
  const queued = await tx.execute(sql`
    INSERT INTO attachment_object_gc (object_key, source_workspace_id)
    SELECT DISTINCT ON (a.object_key) a.object_key, a.workspace_id
    FROM attachment a
    WHERE a.organisation_id = ${state.organisationId}
       OR a.work_item_id IN (${items})
       OR a.comment_id IN (
         SELECT c.id FROM comment c WHERE c.work_item_id IN (${items})
       )
       OR a.submission_id IN (
         SELECT s.id FROM submission s WHERE s.organisation_id = ${state.organisationId}
       )
    ORDER BY a.object_key
    ON CONFLICT (object_key) DO NOTHING
  `);

  const workspaceRows = await tx.execute<{ id: string }>(sql`
    SELECT id FROM workspace
    WHERE organisation_id = ${state.organisationId}
    ORDER BY id
    FOR UPDATE
  `);
  const workspaceIds = workspaceRows.rows.map((row) => row.id);
  const workspaceList = workspaceIds.length
    ? sql.join(
        workspaceIds.map((id) => sql`${id}`),
        sql`, `,
      )
    : sql`NULL`;
  const externalIdentityDefault = await tx.execute<{ id: string }>(sql`
    SELECT id FROM identity_connection
    WHERE default_workspace_id IN (${workspaceList})
      AND organisation_id IS DISTINCT FROM ${state.organisationId}
    LIMIT 1
  `);
  if (externalIdentityDefault.rows.length)
    throw new Error("organisation_purge_workspace_is_identity_default");
  const personRows = await tx.execute<{
    id: string;
    user_id: string | null;
  }>(sql`
    SELECT id, user_id FROM person WHERE organisation_id = ${state.organisationId}
    ORDER BY id FOR UPDATE
  `);
  const personIds = personRows.rows.map((person) => person.id);
  const personList = personIds.length
    ? sql.join(
        personIds.map((id) => sql`${id}`),
        sql`, `,
      )
    : sql`NULL`;
  const externalGrantor = await tx.execute<{ id: string }>(sql`
    SELECT id FROM membership_grant
    WHERE granted_by_person_id IN (${personList})
      AND person_id NOT IN (${personList})
    LIMIT 1
  `);
  if (externalGrantor.rows.length)
    throw new Error("organisation_purge_person_granted_external_membership");

  // A project deletion snapshot is RESTRICTed to the project row. Remove only snapshots
  // owned by this organisation's active deletion operation before deleting its projects.
  await tx.execute(sql`
    DELETE FROM organisation_deletion_project_snapshot
    WHERE organisation_id = ${state.organisationId}
  `);

  // Request records have RESTRICT references into work items, request type versions and
  // customer people. They are part of the customer organisation's retained data graph.
  await tx.execute(sql`
    DELETE FROM submission
    WHERE organisation_id = ${state.organisationId}
       OR work_item_id IN (${items})
  `);
  await tx.execute(sql`
    DELETE FROM attachment
    WHERE organisation_id = ${state.organisationId}
       OR work_item_id IN (${items})
       OR comment_id IN (
         SELECT c.id FROM comment c WHERE c.work_item_id IN (${items})
       )
       OR submission_id IN (
         SELECT s.id FROM submission s WHERE s.organisation_id = ${state.organisationId}
       )
  `);

  // Delete notification children before their RESTRICTed digest groups and outbox parent.
  // Only exact organisation, recipient, project and owned-workspace rows are selected.
  await tx.execute(sql`
    DELETE FROM notification_delivery
    WHERE organisation_id = ${state.organisationId}
       OR recipient_person_id IN (${personList})
       OR workspace_id IN (${workspaceList})
  `);
  await tx.execute(sql`
    DELETE FROM notification_digest d
    WHERE (d.organisation_id = ${state.organisationId}
       OR d.recipient_person_id IN (${personList})
       OR d.workspace_id IN (${workspaceList}))
      AND NOT EXISTS (
        SELECT 1 FROM notification_delivery nd WHERE nd.digest_id = d.id
      )
  `);
  await tx.execute(sql`
    DELETE FROM notification WHERE person_id IN (${personList})
  `);
  await tx.execute(sql`
    DELETE FROM metric_snapshot WHERE organisation_id = ${state.organisationId}
  `);
  await tx.execute(sql`
    DELETE FROM outbox
    WHERE organisation_id = ${state.organisationId}
       OR workspace_id IN (${workspaceList})
       OR payload->'scope'->>'projectId' IN (${projectList})
  `);

  // Project custom values and defaults can RESTRICT project deletion. Keep unrelated
  // workspace configuration, but clear a project pointer that is being purged.
  if (projectIds.length) {
    await tx.execute(sql`
      DELETE FROM custom_field_value
      WHERE project_id IN (${projectList})
    `);
    await tx.execute(sql`
      UPDATE request_type SET default_project_id = NULL
      WHERE default_project_id IN (${projectList})
    `);
    await tx.execute(sql`
      UPDATE request_type_version SET default_project_id = NULL
      WHERE default_project_id IN (${projectList})
    `);
  }

  // Work-item parent links are RESTRICTed. Delete leaves until the complete project tree
  // is gone; all work-item children (comments, activity, notifications and attachments)
  // follow their declared cascades.
  let workItemsDeleted = 0;
  while (projectIds.length) {
    const deleted = await tx.execute(sql`
      DELETE FROM work_item wi
      WHERE wi.project_id IN (${projectList})
        AND NOT EXISTS (SELECT 1 FROM work_item ch WHERE ch.parent_id = wi.id)
    `);
    if (!deleted.rowCount) break;
    workItemsDeleted += deleted.rowCount;
  }

  // Project parent links are RESTRICTed too. Only target-owned projects are in the set;
  // any cross-organisation child was rejected above rather than modified.
  await retireImportProjectTargets(tx, projectIds);
  let projectsDeleted = 0;
  while (projectIds.length) {
    const deleted = await tx.execute(sql`
      DELETE FROM project p
      WHERE p.id IN (${projectList})
        AND NOT EXISTS (
          SELECT 1 FROM project ch
          WHERE ch.workspace_id = p.workspace_id AND ch.parent_id = p.id
        )
    `);
    if (!deleted.rowCount) break;
    projectsDeleted += deleted.rowCount;
  }
  if (projectsDeleted !== projectIds.length)
    throw new Error("organisation_purge_project_graph_incomplete");

  // Owned workspaces are deleted only after their organisation-owned projects. A shared
  // internal workspace has a different organisation_id and is therefore never selected.
  for (const workspace of workspaceRows.rows) {
    await tx.execute(sql`DELETE FROM workspace WHERE id = ${workspace.id}`);
  }

  // Preserve staff sessions and credentials attached to other workspace memberships.
  // Customer accounts without another staff/workspace association are removed with their
  // person; shared accounts keep their login and have customer portal sessions revoked.
  if (personIds.length) {
    await tx.execute(sql`
      DELETE FROM membership_grant
      WHERE identity_connection_id IN (
        SELECT id FROM identity_connection WHERE organisation_id = ${state.organisationId}
      )
    `);
    await tx.execute(sql`
      DELETE FROM membership_grant WHERE person_id IN (${personList})
    `);
    await tx.execute(sql`
      DELETE FROM membership_grant WHERE granted_by_person_id IN (${personList})
    `);
    await tx.execute(sql`
      DELETE FROM external_identity WHERE person_id IN (${personList})
    `);
    await tx.execute(sql`
      UPDATE workflow_version SET published_by = NULL
      WHERE published_by IN (${personList})
    `);
    await tx.execute(sql`
      UPDATE checklist_item SET done_by = NULL WHERE done_by IN (${personList})
    `);
    await tx.execute(sql`
      UPDATE request_participant SET added_by = NULL WHERE added_by IN (${personList})
    `);
    await tx.execute(sql`
      UPDATE attachment SET uploaded_by = NULL
      WHERE uploaded_by IN (${personList})
    `);
    await tx.execute(sql`
      DELETE FROM webhook WHERE created_by IN (${personList})
    `);
    await tx.execute(sql`
      DELETE FROM automation WHERE created_by IN (${personList})
    `);
    await tx.execute(sql`
      UPDATE request_type SET default_assignee_id = NULL
      WHERE default_assignee_id IN (${personList})
    `);
    await tx.execute(sql`
      UPDATE request_type_version SET default_assignee_id = NULL
      WHERE default_assignee_id IN (${personList})
    `);
  }

  await tx.execute(sql`
    DELETE FROM identity_connection WHERE organisation_id = ${state.organisationId}
  `);

  for (const person of personRows.rows) {
    if (!person.user_id) continue;
    await tx.execute(sql`
      DELETE FROM session WHERE user_id = ${person.user_id} AND portal = 'customer'
    `);
    const sharedAccount = await tx.execute<{ exists: boolean }>(sql`
      SELECT EXISTS (
        SELECT 1 FROM workspace_member wm
        WHERE wm.user_id = ${person.user_id}
          AND wm.workspace_id NOT IN (
            SELECT id FROM workspace WHERE organisation_id = ${state.organisationId}
          )
      ) OR EXISTS (
        SELECT 1 FROM session s
        WHERE s.user_id = ${person.user_id} AND s.portal = 'agent'
      ) AS exists
    `);
    if (!sharedAccount.rows[0]?.exists) {
      await tx.execute(sql`
        DELETE FROM idempotency_key
        WHERE actor_type = 'user' AND actor_id = ${person.user_id}
      `);
      await tx.execute(sql`DELETE FROM user WHERE id = ${person.user_id}`);
    }
  }

  // Other restrictive person references are either customer records already removed above
  // or nullable attribution columns intentionally retained on unrelated shared records.
  // This final delete is allowed to fail closed if the schema adds an unhandled RESTRICT edge.
  const peopleDeleted = await tx.execute(sql`
    DELETE FROM person WHERE organisation_id = ${state.organisationId}
  `);

  // Keep all audit history as durable tombstones; the audit FK's guarded ON DELETE SET NULL
  // transition runs only after the organisation row itself has disappeared.
  await tx.execute(sql`
    DELETE FROM organisation_deletion_snapshot
    WHERE organisation_id = ${state.organisationId}
  `);
  await tx.execute(sql`
    DELETE FROM organisation WHERE id = ${state.organisationId}
  `);

  return {
    projects: projectsDeleted,
    workItems: workItemsDeleted,
    people: peopleDeleted.rowCount ?? 0,
    attachments: Number(attachmentCount.rows[0]?.count ?? 0),
    storageObjectsQueued: queued.rowCount ?? 0,
  };
}
