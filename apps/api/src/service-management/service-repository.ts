import { createId } from "@paralleldrive/cuid2";
import {
  type DependencyEdge,
  traverseImpact,
  wouldCreateCycle,
} from "@taskdesk/domain";
import {
  and,
  asc,
  count,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import type { Executor } from "../database/executor";
import {
  organisationTable,
  projectTable,
  serviceCalendarTable,
  teamTable,
  workItemTable,
  workItemTypeTable,
} from "../database/schema";
import { kbArticleTable } from "../database/schema-p5-kb";
import {
  changeServiceTable,
  releaseTable,
  serviceDependencyTable,
  serviceLinkTable,
  serviceReleaseChecklistItemTable,
  serviceTable,
} from "../database/schema-p5-service";
import { staffScope } from "../kb/repository";
import { kbEnabledWorkspaceIds } from "../kb/visibility";
import { auditIfRegistered, type GovernanceActor } from "../team/audit";
import {
  assertCallerHasCapability,
  type CapabilityCredential,
} from "../utils/require-workspace-capability";
import { isUniqueViolation, VersionConflictError } from "./common";
import type { ServiceLinkInput } from "./schema";

export type ServiceRow = typeof serviceTable.$inferSelect;

async function assertSameWorkspace(
  executor: Executor,
  workspaceId: string,
  input: {
    ownerTeamId?: string | null;
    serviceCalendarId?: string | null;
    links?: ServiceLinkInput[];
    dependsOnServiceIds?: string[];
  },
) {
  if (input.ownerTeamId) {
    const [team] = await executor
      .select({ id: teamTable.id })
      .from(teamTable)
      .where(
        and(
          eq(teamTable.id, input.ownerTeamId),
          eq(teamTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!team)
      throw new HTTPException(422, { message: "owner_team_not_found" });
  }
  if (input.serviceCalendarId) {
    const [calendar] = await executor
      .select({ id: serviceCalendarTable.id })
      .from(serviceCalendarTable)
      .where(
        and(
          eq(serviceCalendarTable.id, input.serviceCalendarId),
          eq(serviceCalendarTable.workspaceId, workspaceId),
        ),
      )
      .limit(1);
    if (!calendar)
      throw new HTTPException(422, { message: "service_calendar_not_found" });
  }
  const projectIds = (input.links ?? []).flatMap((link) =>
    link.kind === "project" ? [link.projectId] : [],
  );
  if (projectIds.length > 0) {
    const found = await executor
      .select({ id: projectTable.id })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.workspaceId, workspaceId),
          inArray(projectTable.id, projectIds),
          isNull(projectTable.deletedAt),
        ),
      );
    if (found.length !== new Set(projectIds).size)
      throw new HTTPException(422, { message: "project_not_found" });
  }
  const articleIds = (input.links ?? []).flatMap((link) =>
    link.kind === "kb_article" ? [link.kbArticleId] : [],
  );
  if (articleIds.length > 0) {
    // The knowledge base tables belong to another lane's migration (0150); read them by name.
    const found = await executor.execute(
      sql`SELECT id FROM kb_article WHERE workspace_id = ${workspaceId} AND id IN (${sql.join(
        articleIds.map((articleId) => sql`${articleId}`),
        sql`, `,
      )})`,
    );
    if (found.rows.length !== new Set(articleIds).size)
      throw new HTTPException(422, { message: "kb_article_not_found" });
  }
  const dependsOn = input.dependsOnServiceIds ?? [];
  if (dependsOn.length > 0) {
    const found = await executor
      .select({ id: serviceTable.id })
      .from(serviceTable)
      .where(
        and(
          eq(serviceTable.workspaceId, workspaceId),
          inArray(serviceTable.id, dependsOn),
        ),
      );
    if (found.length !== new Set(dependsOn).size)
      throw new HTTPException(422, { message: "dependency_not_found" });
  }
}

async function writeLinks(
  executor: Executor,
  workspaceId: string,
  serviceId: string,
  links: ServiceLinkInput[],
) {
  await executor
    .delete(serviceLinkTable)
    .where(eq(serviceLinkTable.serviceId, serviceId));
  if (links.length === 0) return;
  await executor.insert(serviceLinkTable).values(
    links.map((link) => ({
      workspaceId,
      serviceId,
      kind: link.kind,
      label: link.kind === "documentation" ? (link.label ?? null) : null,
      url: link.kind === "documentation" ? link.url : null,
      projectId: link.kind === "project" ? link.projectId : null,
      kbArticleId: link.kind === "kb_article" ? link.kbArticleId : null,
    })),
  );
}

async function writeChecklist(
  executor: Executor,
  workspaceId: string,
  serviceId: string,
  items: string[],
) {
  await executor
    .delete(serviceReleaseChecklistItemTable)
    .where(eq(serviceReleaseChecklistItemTable.serviceId, serviceId));
  if (items.length === 0) return;
  await executor.insert(serviceReleaseChecklistItemTable).values(
    items.map((text, position) => ({
      workspaceId,
      serviceId,
      position,
      text,
    })),
  );
}

async function writeDependencies(
  executor: Executor,
  workspaceId: string,
  serviceId: string,
  dependsOn: string[],
) {
  const unique = [...new Set(dependsOn)].filter((id) => id !== serviceId);
  if (dependsOn.some((id) => id === serviceId))
    throw new HTTPException(422, {
      message: "A service cannot depend on itself",
    });
  await executor
    .delete(serviceDependencyTable)
    .where(eq(serviceDependencyTable.serviceId, serviceId));
  if (unique.length === 0) return;
  await executor.insert(serviceDependencyTable).values(
    unique.map((dependsOnServiceId) => ({
      workspaceId,
      serviceId,
      dependsOnServiceId,
    })),
  );
}

async function loadEdges(
  executor: Executor,
  workspaceId: string,
): Promise<DependencyEdge[]> {
  return executor
    .select({
      serviceId: serviceDependencyTable.serviceId,
      dependsOnServiceId: serviceDependencyTable.dependsOnServiceId,
    })
    .from(serviceDependencyTable)
    .where(eq(serviceDependencyTable.workspaceId, workspaceId));
}

export async function listServices(workspaceId: string, q?: string) {
  const rows = await db
    .select({
      service: serviceTable,
      ownerTeamName: teamTable.name,
      calendarName: serviceCalendarTable.name,
    })
    .from(serviceTable)
    .leftJoin(teamTable, eq(teamTable.id, serviceTable.ownerTeamId))
    .leftJoin(
      serviceCalendarTable,
      eq(serviceCalendarTable.id, serviceTable.serviceCalendarId),
    )
    .where(
      and(
        eq(serviceTable.workspaceId, workspaceId),
        q
          ? or(
              ilike(serviceTable.name, `%${q.replace(/[%_\\]/g, "\\$&")}%`),
              ilike(serviceTable.category, `%${q.replace(/[%_\\]/g, "\\$&")}%`),
            )
          : undefined,
      ),
    )
    .orderBy(asc(serviceTable.name), asc(serviceTable.id));
  const ids = rows.map((row) => row.service.id);
  const counts = await workItemCounts(db, workspaceId, ids);
  return rows.map((row) => ({
    ...row.service,
    ownerTeamName: row.ownerTeamName ?? null,
    calendarName: row.calendarName ?? null,
    incidentCount: counts.get(row.service.id)?.incidents ?? 0,
    openChangeCount: counts.get(row.service.id)?.openChanges ?? 0,
  }));
}

/** SVC-3: incidents and open changes per service, so "which service generates the most incidents" is answerable. */
async function workItemCounts(
  executor: Executor,
  workspaceId: string,
  serviceIds: string[],
) {
  const result = new Map<string, { incidents: number; openChanges: number }>();
  if (serviceIds.length === 0) return result;
  const incidents = await executor
    .select({ serviceId: workItemTable.serviceId, value: count() })
    .from(workItemTable)
    .innerJoin(
      workItemTypeTable,
      eq(workItemTypeTable.id, workItemTable.typeId),
    )
    .where(
      and(
        eq(workItemTable.workspaceId, workspaceId),
        inArray(workItemTable.serviceId, serviceIds),
        eq(workItemTypeTable.key, "incident"),
        isNull(workItemTable.deletedAt),
      ),
    )
    .groupBy(workItemTable.serviceId);
  for (const row of incidents)
    if (row.serviceId)
      result.set(row.serviceId, {
        incidents: row.value,
        openChanges: 0,
      });
  const changes = await openChangeCounts(executor, workspaceId, serviceIds);
  for (const [serviceId, openChanges] of changes) {
    const entry = result.get(serviceId) ?? { incidents: 0, openChanges: 0 };
    entry.openChanges = openChanges;
    result.set(serviceId, entry);
  }
  return result;
}

/**
 * Open changes affecting each service: live change work items that are not in a completed or
 * cancelled state group, through `change_service` or the work item's own `service_id`.
 */
async function openChangeCounts(
  executor: Executor,
  workspaceId: string,
  serviceIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (serviceIds.length === 0) return out;
  const idList = sql.join(
    serviceIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = await executor.execute(sql`
    SELECT service_id, count(DISTINCT work_item_id)::int AS value FROM (
      SELECT cs.service_id AS service_id, cs.work_item_id AS work_item_id
        FROM change_service cs
        JOIN work_item wi ON wi.id = cs.work_item_id
        JOIN state s ON s.id = wi.state_id
        JOIN state_template st ON st.id = s.state_template_id
       WHERE cs.workspace_id = ${workspaceId} AND cs.service_id IN (${idList})
         AND wi.deleted_at IS NULL AND wi.archived_at IS NULL
         AND st."group" NOT IN ('completed', 'cancelled')
      UNION ALL
      SELECT wi.service_id AS service_id, wi.id AS work_item_id
        FROM work_item wi
        JOIN work_item_type wt ON wt.id = wi.type_id AND wt.is_change
        JOIN state s ON s.id = wi.state_id
        JOIN state_template st ON st.id = s.state_template_id
       WHERE wi.workspace_id = ${workspaceId} AND wi.service_id IN (${idList})
         AND wi.deleted_at IS NULL AND wi.archived_at IS NULL
         AND st."group" NOT IN ('completed', 'cancelled')
    ) t GROUP BY service_id`);
  for (const row of rows.rows as { service_id: string; value: number }[])
    out.set(row.service_id, Number(row.value));
  return out;
}

export async function getService(
  id: string,
  workspaceId: string,
  executor: Executor = db,
): Promise<ServiceRow | undefined> {
  const [row] = await executor
    .select()
    .from(serviceTable)
    .where(
      and(eq(serviceTable.id, id), eq(serviceTable.workspaceId, workspaceId)),
    )
    .limit(1);
  return row;
}

export async function getServiceWorkspace(id: string) {
  const [row] = await db
    .select({ workspaceId: serviceTable.workspaceId })
    .from(serviceTable)
    .where(eq(serviceTable.id, id))
    .limit(1);
  return row;
}

/** Who is looking at a service; `null` (or a null credential) shows no knowledge base links. */
export type ServiceKbAccess = {
  userId: string;
  credential: CapabilityCredential | null;
} | null;

/** The caller of a mutation: an API key's scope is not at hand there, so its response omits KB links. */
function kbAccessOf(actor: GovernanceActor): ServiceKbAccess {
  return {
    userId: actor.userId,
    credential: actor.apiKeyId ? null : { kind: "session" },
  };
}

async function callerMayReadKb(
  workspaceId: string,
  access: ServiceKbAccess,
): Promise<boolean> {
  if (!access?.credential) return false;
  if ((await kbEnabledWorkspaceIds([workspaceId])).length === 0) return false;
  try {
    await assertCallerHasCapability(
      workspaceId,
      access.userId,
      "kb_article:read",
      access.credential,
    );
    return true;
  } catch (error) {
    if (error instanceof HTTPException && error.status === 403) return false;
    throw error;
  }
}

/**
 * `reachableProjectIds` is the caller's project reach: a link to a project outside it is left
 * out, so a hidden project's id and name are never returned through a service.
 */
export async function getServiceDetail(
  id: string,
  workspaceId: string,
  reachableProjectIds: readonly string[],
  kbAccess: ServiceKbAccess = null,
) {
  const service = await getService(id, workspaceId);
  if (!service) return undefined;
  const [
    ownerTeam,
    calendar,
    links,
    dependsOn,
    dependents,
    checklist,
    counts,
    blockers,
  ] = await Promise.all([
    service.ownerTeamId
      ? db
          .select({ name: teamTable.name })
          .from(teamTable)
          .where(eq(teamTable.id, service.ownerTeamId))
          .limit(1)
      : Promise.resolve([]),
    service.serviceCalendarId
      ? db
          .select({ name: serviceCalendarTable.name })
          .from(serviceCalendarTable)
          .where(eq(serviceCalendarTable.id, service.serviceCalendarId))
          .limit(1)
      : Promise.resolve([]),
    db
      .select({
        id: serviceLinkTable.id,
        kind: serviceLinkTable.kind,
        label: serviceLinkTable.label,
        url: serviceLinkTable.url,
        projectId: serviceLinkTable.projectId,
        projectName: projectTable.name,
        kbArticleId: serviceLinkTable.kbArticleId,
      })
      .from(serviceLinkTable)
      .leftJoin(
        projectTable,
        and(
          eq(projectTable.id, serviceLinkTable.projectId),
          eq(projectTable.workspaceId, serviceLinkTable.workspaceId),
        ),
      )
      .where(eq(serviceLinkTable.serviceId, id))
      .orderBy(asc(serviceLinkTable.createdAt), asc(serviceLinkTable.id)),
    db
      .select({
        id: serviceTable.id,
        name: serviceTable.name,
        status: serviceTable.status,
      })
      .from(serviceDependencyTable)
      .innerJoin(
        serviceTable,
        eq(serviceTable.id, serviceDependencyTable.dependsOnServiceId),
      )
      .where(eq(serviceDependencyTable.serviceId, id))
      .orderBy(asc(serviceTable.name)),
    db
      .select({
        id: serviceTable.id,
        name: serviceTable.name,
        status: serviceTable.status,
      })
      .from(serviceDependencyTable)
      .innerJoin(
        serviceTable,
        eq(serviceTable.id, serviceDependencyTable.serviceId),
      )
      .where(eq(serviceDependencyTable.dependsOnServiceId, id))
      .orderBy(asc(serviceTable.name)),
    db
      .select({
        id: serviceReleaseChecklistItemTable.id,
        text: serviceReleaseChecklistItemTable.text,
        position: serviceReleaseChecklistItemTable.position,
      })
      .from(serviceReleaseChecklistItemTable)
      .where(eq(serviceReleaseChecklistItemTable.serviceId, id))
      .orderBy(asc(serviceReleaseChecklistItemTable.position)),
    workItemCounts(db, workspaceId, [id]),
    serviceDeletionBlockers(db, id, workspaceId),
  ]);
  const edges = await loadEdges(db, workspaceId);
  const cycle = traverseImpact(id, edges).cycleDetected;
  const reachable = new Set(reachableProjectIds);
  // A kb_article link is shown only when the article exists and the caller can see it; a dangling
  // id (the column has no foreign key) or an article of an unreachable project is dropped.
  // KB links need the caller's kb_article:read and the workspace's knowledge base switched on.
  const kbIds = [
    ...new Set(
      ((await callerMayReadKb(workspaceId, kbAccess)) ? links : []).flatMap(
        (link) => (link.kbArticleId ? [link.kbArticleId] : []),
      ),
    ),
  ];
  const visibleKbIds = new Set(
    kbIds.length === 0
      ? []
      : (
          await db
            .select({ id: kbArticleTable.id })
            .from(kbArticleTable)
            .where(
              and(
                inArray(kbArticleTable.id, kbIds),
                staffScope(workspaceId, [...reachableProjectIds]),
              ),
            )
        ).map((row) => row.id),
  );
  return {
    ...service,
    ownerTeamName: ownerTeam[0]?.name ?? null,
    calendarName: calendar[0]?.name ?? null,
    incidentCount: counts.get(id)?.incidents ?? 0,
    openChangeCount: counts.get(id)?.openChanges ?? 0,
    links: links.filter(
      (link) =>
        (link.projectId === null || reachable.has(link.projectId)) &&
        (link.kbArticleId === null || visibleKbIds.has(link.kbArticleId)),
    ),
    dependsOn,
    dependents,
    releaseChecklist: checklist,
    cycleDetected: cycle,
    deletionBlockers: blockers,
  };
}

export async function createService(input: {
  workspaceId: string;
  name: string;
  description?: string | null;
  category?: string | null;
  ownerTeamId?: string | null;
  supportLevel?: "L1" | "L2" | "L3";
  serviceCalendarId?: string | null;
  links?: ServiceLinkInput[];
  dependsOnServiceIds?: string[];
  releaseChecklist?: string[];
  actor: GovernanceActor;
  /** The caller's project reach, applied to the returned links. */
  reachableProjectIds: readonly string[];
}) {
  try {
    const id = await db.transaction(async (tx) => {
      await assertSameWorkspace(tx, input.workspaceId, input);
      const id = createId();
      await tx.insert(serviceTable).values({
        id,
        workspaceId: input.workspaceId,
        name: input.name,
        description: input.description ?? null,
        category: input.category ?? null,
        ownerTeamId: input.ownerTeamId ?? null,
        supportLevel: input.supportLevel ?? "L1",
        serviceCalendarId: input.serviceCalendarId ?? null,
        createdBy: input.actor.userId,
      });
      await writeLinks(tx, input.workspaceId, id, input.links ?? []);
      await writeDependencies(
        tx,
        input.workspaceId,
        id,
        input.dependsOnServiceIds ?? [],
      );
      await writeChecklist(
        tx,
        input.workspaceId,
        id,
        input.releaseChecklist ?? [],
      );
      await auditIfRegistered(tx, {
        action: "service.created",
        workspaceId: input.workspaceId,
        entityType: "service",
        entityId: id,
        actor: input.actor,
        after: {
          name: input.name,
          supportLevel: input.supportLevel ?? "L1",
          ownerTeamId: input.ownerTeamId ?? null,
        },
      });
      return id;
    });
    return await getServiceDetail(
      id,
      input.workspaceId,
      input.reachableProjectIds,
      kbAccessOf(input.actor),
    );
  } catch (error) {
    if (isUniqueViolation(error, "service_workspace_name_unique"))
      throw new HTTPException(409, {
        message: "A service with this name already exists",
      });
    throw error;
  }
}

export async function updateService(
  id: string,
  workspaceId: string,
  input: {
    name?: string;
    description?: string | null;
    category?: string | null;
    ownerTeamId?: string | null;
    supportLevel?: "L1" | "L2" | "L3";
    serviceCalendarId?: string | null;
    links?: ServiceLinkInput[];
    dependsOnServiceIds?: string[];
    releaseChecklist?: string[];
    version?: number;
  },
  actor: GovernanceActor,
  reachableProjectIds: readonly string[],
) {
  try {
    const found = await db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(serviceTable)
        .where(
          and(
            eq(serviceTable.id, id),
            eq(serviceTable.workspaceId, workspaceId),
          ),
        )
        .for("update")
        .limit(1);
      if (!before) return false;
      if (input.version !== undefined && before.version !== input.version)
        throw new VersionConflictError(before.version);
      await assertSameWorkspace(tx, workspaceId, input);
      const patch: Partial<typeof serviceTable.$inferInsert> = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.description !== undefined)
        patch.description = input.description;
      if (input.category !== undefined) patch.category = input.category;
      if (input.ownerTeamId !== undefined)
        patch.ownerTeamId = input.ownerTeamId;
      if (input.supportLevel !== undefined)
        patch.supportLevel = input.supportLevel;
      if (input.serviceCalendarId !== undefined)
        patch.serviceCalendarId = input.serviceCalendarId;
      await tx
        .update(serviceTable)
        .set({
          ...patch,
          version: before.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(serviceTable.id, id));
      if (input.links) await writeLinks(tx, workspaceId, id, input.links);
      let cycleCreated = false;
      if (input.dependsOnServiceIds) {
        const edges = await loadEdges(tx, workspaceId);
        const others = edges.filter((edge) => edge.serviceId !== id);
        cycleCreated = input.dependsOnServiceIds.some((dependsOn) =>
          wouldCreateCycle(id, dependsOn, others),
        );
        await writeDependencies(tx, workspaceId, id, input.dependsOnServiceIds);
      }
      if (input.releaseChecklist)
        await writeChecklist(tx, workspaceId, id, input.releaseChecklist);
      await auditIfRegistered(tx, {
        action: "service.updated",
        workspaceId,
        entityType: "service",
        entityId: id,
        actor,
        before: {
          name: before.name,
          ownerTeamId: before.ownerTeamId,
          supportLevel: before.supportLevel,
        },
        after: {
          changedFields: Object.keys(input).filter((key) => key !== "version"),
          cycleCreated,
        },
      });
      return true;
    });
    if (!found) return undefined;
    return await getServiceDetail(
      id,
      workspaceId,
      reachableProjectIds,
      kbAccessOf(actor),
    );
  } catch (error) {
    if (isUniqueViolation(error, "service_workspace_name_unique"))
      throw new HTTPException(409, {
        message: "A service with this name already exists",
      });
    throw error;
  }
}

export async function setServiceStatus(
  id: string,
  workspaceId: string,
  input: {
    status: "operational" | "degraded" | "outage";
    note?: string | null;
  },
  actor: GovernanceActor,
  reachableProjectIds: readonly string[],
) {
  const found = await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(serviceTable)
      .where(
        and(eq(serviceTable.id, id), eq(serviceTable.workspaceId, workspaceId)),
      )
      .for("update")
      .limit(1);
    if (!before) return false;
    await tx
      .update(serviceTable)
      .set({
        status: input.status,
        statusNote: input.note ?? null,
        statusChangedAt: new Date(),
        statusChangedBy: actor.userId,
        version: before.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(serviceTable.id, id));
    await auditIfRegistered(tx, {
      action: "service.status_changed",
      workspaceId,
      entityType: "service",
      entityId: id,
      actor,
      before: { status: before.status },
      after: { status: input.status },
    });
    return true;
  });
  if (!found) return undefined;
  return await getServiceDetail(
    id,
    workspaceId,
    reachableProjectIds,
    kbAccessOf(actor),
  );
}

/**
 * SVC-5 impact: every service that depends, directly or transitively, on this one, with the
 * customers (organisations of linked projects) those services serve. Cycles stop the walk.
 */
/**
 * `reachableProjectIds` limits the customers to those served through a project the caller can
 * reach, so an organisation is never named for a project the caller cannot see.
 */
export async function serviceImpact(
  id: string,
  workspaceId: string,
  reachableProjectIds: readonly string[],
) {
  const service = await getService(id, workspaceId);
  if (!service) return undefined;
  const edges = await loadEdges(db, workspaceId);
  const traversal = traverseImpact(id, edges);
  const ids = [id, ...traversal.impacted.map((node) => node.serviceId)];
  const services = await db
    .select({
      id: serviceTable.id,
      name: serviceTable.name,
      status: serviceTable.status,
    })
    .from(serviceTable)
    .where(
      and(
        eq(serviceTable.workspaceId, workspaceId),
        inArray(serviceTable.id, ids),
      ),
    );
  const byId = new Map(services.map((row) => [row.id, row]));
  const customers = await db
    .selectDistinct({
      id: organisationTable.id,
      name: organisationTable.name,
    })
    .from(serviceLinkTable)
    .innerJoin(
      projectTable,
      and(
        eq(projectTable.id, serviceLinkTable.projectId),
        eq(projectTable.workspaceId, serviceLinkTable.workspaceId),
      ),
    )
    .innerJoin(
      organisationTable,
      eq(organisationTable.id, projectTable.organisationId),
    )
    .where(
      and(
        eq(serviceLinkTable.workspaceId, workspaceId),
        inArray(serviceLinkTable.serviceId, ids),
        eq(serviceLinkTable.kind, "project"),
        isNull(projectTable.deletedAt),
        eq(organisationTable.isInternal, false),
        reachableProjectIds.length > 0
          ? inArray(projectTable.id, [...reachableProjectIds])
          : sql`false`,
      ),
    )
    .orderBy(asc(organisationTable.name));
  return {
    service: { id: service.id, name: service.name, status: service.status },
    impacted: traversal.impacted.map((node) => ({
      serviceId: node.serviceId,
      name: byId.get(node.serviceId)?.name ?? node.serviceId,
      status: byId.get(node.serviceId)?.status ?? "operational",
      depth: node.depth,
      viaServiceId: node.viaServiceId,
      viaName: byId.get(node.viaServiceId)?.name ?? node.viaServiceId,
    })),
    customers,
    cycleDetected: traversal.cycleDetected,
    cycleServiceIds: traversal.cycleServiceIds,
  };
}

/**
 * CH-1 / SVC-5: "this change affects 3 services and 2 customers". The affected services plus
 * everything that depends on them, and the customers (organisations of linked projects) served.
 */
export async function changeImpactCounts(
  executor: Executor,
  workspaceId: string,
  serviceIds: string[],
): Promise<{ services: number; customers: number }> {
  if (serviceIds.length === 0) return { services: 0, customers: 0 };
  const edges = await loadEdges(executor, workspaceId);
  const affected = new Set<string>(serviceIds);
  for (const serviceId of serviceIds)
    for (const node of traverseImpact(serviceId, edges).impacted)
      affected.add(node.serviceId);
  const customers = await executor
    .selectDistinct({ id: organisationTable.id })
    .from(serviceLinkTable)
    .innerJoin(
      projectTable,
      and(
        eq(projectTable.id, serviceLinkTable.projectId),
        eq(projectTable.workspaceId, serviceLinkTable.workspaceId),
      ),
    )
    .innerJoin(
      organisationTable,
      eq(organisationTable.id, projectTable.organisationId),
    )
    .where(
      and(
        eq(serviceLinkTable.workspaceId, workspaceId),
        inArray(serviceLinkTable.serviceId, [...affected]),
        eq(serviceLinkTable.kind, "project"),
        isNull(projectTable.deletedAt),
        eq(organisationTable.isInternal, false),
      ),
    );
  return { services: affected.size, customers: customers.length };
}

/** Plain-language reasons a service may not be deleted. Empty when it can be. */
export async function serviceDeletionBlockers(
  executor: Executor,
  id: string,
  workspaceId: string,
): Promise<string[]> {
  const blockers: string[] = [];
  const open = await openChangeCounts(executor, workspaceId, [id]);
  const openCount = open.get(id) ?? 0;
  if (openCount > 0)
    blockers.push(
      `The service has ${openCount} open change${openCount === 1 ? "" : "s"}.`,
    );
  const [releases] = await executor
    .select({ value: count() })
    .from(releaseTable)
    .where(
      and(
        eq(releaseTable.workspaceId, workspaceId),
        eq(releaseTable.serviceId, id),
      ),
    );
  if ((releases?.value ?? 0) > 0)
    blockers.push(`The service has ${releases?.value} release(s).`);
  const [affected] = await executor
    .select({ value: count() })
    .from(changeServiceTable)
    .where(
      and(
        eq(changeServiceTable.workspaceId, workspaceId),
        eq(changeServiceTable.serviceId, id),
      ),
    );
  if ((affected?.value ?? 0) > 0 && openCount === 0)
    blockers.push(
      `The service is recorded as affected by ${affected?.value} past change(s).`,
    );
  const [dependents] = await executor
    .select({ value: count() })
    .from(serviceDependencyTable)
    .where(
      and(
        eq(serviceDependencyTable.workspaceId, workspaceId),
        eq(serviceDependencyTable.dependsOnServiceId, id),
      ),
    );
  if ((dependents?.value ?? 0) > 0)
    blockers.push(
      `${dependents?.value} other service(s) depend on it. Remove the dependency first.`,
    );
  return blockers;
}

export async function deleteServiceRow(
  tx: Executor,
  id: string,
  workspaceId: string,
  actor: GovernanceActor,
): Promise<boolean> {
  const [row] = await tx
    .select()
    .from(serviceTable)
    .where(
      and(eq(serviceTable.id, id), eq(serviceTable.workspaceId, workspaceId)),
    )
    .for("update")
    .limit(1);
  if (!row) return false;
  // Clear the plain reference on work items first: the constraint is NO ACTION.
  // The unlink spans the whole workspace (including projects the approver cannot reach and held
  // items), so the audit row records how many items were unlinked and in which projects (ids only,
  // never titles). Held items are unlinked too: the service no longer exists, the reference cannot stay.
  const unlinked = await tx
    .update(workItemTable)
    .set({ serviceId: null })
    .where(
      and(
        eq(workItemTable.workspaceId, workspaceId),
        eq(workItemTable.serviceId, id),
      ),
    )
    .returning({ projectId: workItemTable.projectId });
  const unlinkedProjectIds = [
    ...new Set(unlinked.map((item) => item.projectId)),
  ].sort();
  await tx.delete(serviceTable).where(eq(serviceTable.id, id));
  await auditIfRegistered(tx, {
    action: "service.deleted",
    workspaceId,
    entityType: "service",
    entityId: id,
    actor,
    before: { name: row.name },
    after: {
      unlinkedWorkItemCount: unlinked.length,
      unlinkedProjectIds,
    },
  });
  return true;
}

/** Rows of changes whose service reference is a still-live service (used by detail screens). */
export async function listServiceChoices(workspaceId: string) {
  return db
    .select({ id: serviceTable.id, name: serviceTable.name })
    .from(serviceTable)
    .where(eq(serviceTable.workspaceId, workspaceId))
    .orderBy(asc(serviceTable.name));
}

/** SVC-3: set or clear the service a work item affects. */
export async function setWorkItemService(
  workItemId: string,
  workspaceId: string,
  serviceId: string | null,
  actor: GovernanceActor,
) {
  return db.transaction(async (tx) => {
    if (serviceId) {
      const service = await getService(serviceId, workspaceId, tx);
      if (!service)
        throw new HTTPException(422, { message: "service_not_found" });
    }
    const [before] = await tx
      .select({ serviceId: workItemTable.serviceId })
      .from(workItemTable)
      .where(
        and(
          eq(workItemTable.id, workItemId),
          eq(workItemTable.workspaceId, workspaceId),
          isNull(workItemTable.deletedAt),
        ),
      )
      .for("update")
      .limit(1);
    if (!before) return false;
    await tx
      .update(workItemTable)
      .set({ serviceId })
      .where(eq(workItemTable.id, workItemId));
    await auditIfRegistered(tx, {
      action: "service.work_item_linked",
      workspaceId,
      entityType: "work_item",
      entityId: workItemId,
      actor,
      before: { serviceId: before.serviceId },
      after: { serviceId },
    });
    return true;
  });
}
