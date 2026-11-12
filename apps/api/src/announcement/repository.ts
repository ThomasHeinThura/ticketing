import type { ResolvedIdentity } from "@taskdesk/permissions";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import db from "../database";
import type { Executor } from "../database/executor";
import {
  currentProjectReachPredicate,
  customerProjectAccessExists,
} from "../database/repositories/identity-scope.repository";
import {
  organisationTable,
  personTable,
  projectTable,
} from "../database/schema";
import {
  type AnnouncementAudience,
  type AnnouncementSeverity,
  announcementOrganisationTable,
  announcementProjectTable,
  announcementTable,
} from "../database/schema-p5-service";
import {
  type CustomerPortalScope,
  customerPortalOnFor,
  customerPortalOnSql,
  customerPortalScope,
} from "../feature-flag/enforce";
import { serviceCatalogueEnabled } from "../service-management/common";
import type { GovernanceActor } from "../team/audit";
import type {
  AnnouncementView,
  PortalAnnouncement,
  StaffAnnouncement,
} from "./response";

export class AnnouncementVersionConflictError extends Error {
  constructor(readonly currentVersion: number) {
    super("version_conflict");
  }
}

type AnnouncementRow = typeof announcementTable.$inferSelect;

const notFound = () =>
  new HTTPException(404, { message: "Announcement not found" });
const unprocessable = (message: string) => new HTTPException(422, { message });

/** A live customer project: not deleted, not archived, owned by a customer organisation. */
function liveCustomerProject() {
  return and(
    isNull(projectTable.deletedAt),
    isNull(projectTable.archivedAt),
    isNotNull(projectTable.organisationId),
  );
}

// ------------------------------------------------------------------------------- staff side

/**
 * The caller's project reach in one workspace, from the route's one decision source (#740).
 * `live` decides what a write may add or address; `any` (deleted projects included) decides
 * which stored targets the caller sees, so a notice whose only project was later deleted stays
 * manageable by whoever reached it.
 */
export type AnnouncementReach = {
  live: readonly string[];
  any: readonly string[];
};

const EVERY_CUSTOMER =
  "Addressing every customer needs reach to every customer project";
const HIDDEN_TARGETS =
  "Changing the audience needs reach to every current target";
const PUBLISH_HIDDEN_TARGETS = "Publishing needs reach to every target";
const PUBLISHED_HIDDEN_TARGETS =
  "Changing a published notice needs reach to every target";
const PUBLISHED_EVERY_CUSTOMER =
  "Changing a published notice for every customer needs reach to every customer project";

/**
 * Whether the caller reaches the announcement: a workspace-wide notice, or one with at least
 * one stored target in reach (a project they reach, or an organisation served by a project they
 * reach in this workspace). Anything else answers as missing, on reads and writes alike.
 */
function inReach(reach: AnnouncementReach) {
  const workspaceWide = eq(announcementTable.audience, "workspace");
  if (reach.any.length === 0) return workspaceWide;
  return or(
    workspaceWide,
    exists(
      db
        .select({ one: sql`1` })
        .from(announcementProjectTable)
        .where(
          and(
            eq(announcementProjectTable.announcementId, announcementTable.id),
            inArray(announcementProjectTable.projectId, [...reach.any]),
          ),
        ),
    ),
    exists(
      db
        .select({ one: sql`1` })
        .from(announcementOrganisationTable)
        .innerJoin(
          projectTable,
          and(
            eq(
              projectTable.organisationId,
              announcementOrganisationTable.organisationId,
            ),
            eq(
              projectTable.workspaceId,
              announcementOrganisationTable.workspaceId,
            ),
          ),
        )
        .where(
          and(
            eq(
              announcementOrganisationTable.announcementId,
              announcementTable.id,
            ),
            inArray(projectTable.id, [...reach.any]),
          ),
        ),
    ),
  );
}

type ReachSets = { projects: Set<string>; organisations: Set<string> };

/** The project and organisation targets the caller sees in this workspace. */
async function reachSets(
  executor: Executor,
  workspaceId: string,
  reach: AnnouncementReach,
): Promise<ReachSets> {
  const organisations =
    reach.any.length === 0
      ? []
      : await executor
          .selectDistinct({ id: projectTable.organisationId })
          .from(projectTable)
          .where(
            and(
              eq(projectTable.workspaceId, workspaceId),
              inArray(projectTable.id, [...reach.any]),
              isNotNull(projectTable.organisationId),
            ),
          );
  return {
    projects: new Set(reach.any),
    organisations: new Set(
      organisations
        .map((row) => row.id)
        .filter((id): id is string => id !== null),
    ),
  };
}

/** Whether the caller reaches every live customer project of the workspace (sees-all does). */
async function reachesEveryCustomer(
  executor: Executor,
  workspaceId: string,
  live: readonly string[],
) {
  const [unreached] = await executor
    .select({ id: projectTable.id })
    .from(projectTable)
    .innerJoin(
      organisationTable,
      eq(organisationTable.id, projectTable.organisationId),
    )
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        liveCustomerProject(),
        eq(organisationTable.isInternal, false),
        isNull(organisationTable.deletedAt),
        live.length > 0 ? notInArray(projectTable.id, [...live]) : undefined,
      ),
    )
    .limit(1);
  return unreached === undefined;
}

/** Whether a stored target lies outside the caller's reach (the staff view hides it). */
function hasHiddenTargets(view: AnnouncementView, sets: ReachSets) {
  return (
    view.projects.some((entry) => !sets.projects.has(entry.id)) ||
    view.organisations.some((entry) => !sets.organisations.has(entry.id))
  );
}

/**
 * A published notice is live content for every customer it addresses, so editing, withdrawing
 * or deleting it is refused (422) unless the caller reaches all of them: no stored target is
 * hidden, and a `workspace` notice needs reach to every live customer project. Drafts are not
 * customer-facing and pass. The stored audience decides, so a partial-reach editor cannot
 * narrow a live workspace-wide notice either.
 */
async function assertReachesPublishedAudience(
  executor: Executor,
  workspaceId: string,
  row: Pick<AnnouncementRow, "audience" | "publishedAt">,
  view: AnnouncementView,
  sets: ReachSets,
  live: readonly string[],
) {
  if (row.publishedAt === null) return;
  if (hasHiddenTargets(view, sets))
    throw unprocessable(PUBLISHED_HIDDEN_TARGETS);
  if (
    row.audience === "workspace" &&
    !(await reachesEveryCustomer(executor, workspaceId, live))
  )
    throw unprocessable(PUBLISHED_EVERY_CUSTOMER);
}

/** The workspace of a live (not deleted) announcement; undefined when missing or deleted. */
export async function getAnnouncementWorkspace(id: string) {
  const [row] = await db
    .select({ workspaceId: announcementTable.workspaceId })
    .from(announcementTable)
    .where(
      and(eq(announcementTable.id, id), isNull(announcementTable.deletedAt)),
    )
    .limit(1);
  return row;
}

/**
 * Organisations and projects an announcement in this workspace may address: the caller's
 * reachable live customer projects, and the organisations those projects serve.
 */
export async function announcementAudienceOptions(
  workspaceId: string,
  reachableProjectIds: readonly string[],
) {
  const canAddressWorkspace = await reachesEveryCustomer(
    db,
    workspaceId,
    reachableProjectIds,
  );
  if (reachableProjectIds.length === 0)
    return { canAddressWorkspace, organisations: [], projects: [] };
  const rows = await db
    .select({
      projectId: projectTable.id,
      projectName: projectTable.name,
      organisationId: organisationTable.id,
      organisationName: organisationTable.name,
    })
    .from(projectTable)
    .innerJoin(
      organisationTable,
      eq(organisationTable.id, projectTable.organisationId),
    )
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        liveCustomerProject(),
        inArray(projectTable.id, [...reachableProjectIds]),
        eq(organisationTable.isInternal, false),
        isNull(organisationTable.deletedAt),
      ),
    )
    .orderBy(asc(organisationTable.name), asc(projectTable.name));
  const organisations = new Map<string, string>();
  for (const row of rows)
    organisations.set(row.organisationId, row.organisationName);
  return {
    canAddressWorkspace,
    organisations: [...organisations].map(([id, name]) => ({ id, name })),
    projects: rows.map((row) => ({
      id: row.projectId,
      name: row.projectName,
      organisationId: row.organisationId,
      organisationName: row.organisationName,
    })),
  };
}

async function targetsOf(executor: Executor, ids: readonly string[]) {
  if (ids.length === 0)
    return new Map<string, { organisations: Named[]; projects: Named[] }>();
  const [organisations, projects] = await Promise.all([
    executor
      .select({
        announcementId: announcementOrganisationTable.announcementId,
        id: organisationTable.id,
        name: organisationTable.name,
      })
      .from(announcementOrganisationTable)
      .innerJoin(
        organisationTable,
        eq(organisationTable.id, announcementOrganisationTable.organisationId),
      )
      .where(inArray(announcementOrganisationTable.announcementId, [...ids]))
      .orderBy(asc(organisationTable.name)),
    executor
      .select({
        announcementId: announcementProjectTable.announcementId,
        id: projectTable.id,
        name: projectTable.name,
      })
      .from(announcementProjectTable)
      .innerJoin(
        projectTable,
        and(
          eq(projectTable.id, announcementProjectTable.projectId),
          eq(projectTable.workspaceId, announcementProjectTable.workspaceId),
        ),
      )
      .where(inArray(announcementProjectTable.announcementId, [...ids]))
      .orderBy(asc(projectTable.name)),
  ]);
  const byId = new Map<string, { organisations: Named[]; projects: Named[] }>();
  const entry = (id: string) => {
    let value = byId.get(id);
    if (!value) {
      value = { organisations: [], projects: [] };
      byId.set(id, value);
    }
    return value;
  };
  for (const row of organisations)
    entry(row.announcementId).organisations.push({
      id: row.id,
      name: row.name,
    });
  for (const row of projects)
    entry(row.announcementId).projects.push({ id: row.id, name: row.name });
  return byId;
}

type Named = { id: string; name: string };

function toView(
  row: AnnouncementRow,
  targets: { organisations: Named[]; projects: Named[] } | undefined,
): AnnouncementView {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    title: row.title,
    body: row.body,
    severity: row.severity,
    audience: row.audience,
    organisations: targets?.organisations ?? [],
    projects: targets?.projects ?? [],
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Hide targets outside the caller's reach (their names are project content) and say whether the
 * caller reaches every addressed customer, the rule `assertReachesPublishedAudience` and publish
 * enforce. The flag tells only that something is out of reach, as their 422 already does.
 */
function withinReach(
  view: AnnouncementView,
  sets: ReachSets,
  everyCustomer: boolean,
): StaffAnnouncement {
  return {
    ...view,
    reachesAudience:
      !hasHiddenTargets(view, sets) &&
      (view.audience !== "workspace" || everyCustomer),
    organisations: view.organisations.filter((entry) =>
      sets.organisations.has(entry.id),
    ),
    projects: view.projects.filter((entry) => sets.projects.has(entry.id)),
  };
}

export async function listAnnouncements(
  workspaceId: string,
  reach: AnnouncementReach,
) {
  const sets = await reachSets(db, workspaceId, reach);
  const rows = await db
    .select()
    .from(announcementTable)
    .where(
      and(
        eq(announcementTable.workspaceId, workspaceId),
        isNull(announcementTable.deletedAt),
        inReach(reach),
      ),
    )
    .orderBy(desc(announcementTable.startsAt), desc(announcementTable.id))
    .limit(500);
  const targets = await targetsOf(
    db,
    rows.map((row) => row.id),
  );
  const everyCustomer = rows.some((row) => row.audience === "workspace")
    ? await reachesEveryCustomer(db, workspaceId, reach.live)
    : false;
  return rows.map((row) =>
    withinReach(toView(row, targets.get(row.id)), sets, everyCustomer),
  );
}

async function viewOf(
  executor: Executor,
  id: string,
  workspaceId: string,
  reach?: AnnouncementReach,
) {
  const [row] = await executor
    .select()
    .from(announcementTable)
    .where(
      and(
        eq(announcementTable.id, id),
        eq(announcementTable.workspaceId, workspaceId),
        isNull(announcementTable.deletedAt),
        reach ? inReach(reach) : undefined,
      ),
    )
    .limit(1);
  if (!row) return undefined;
  return toView(row, (await targetsOf(executor, [row.id])).get(row.id));
}

export async function getAnnouncement(
  id: string,
  workspaceId: string,
  reach: AnnouncementReach,
) {
  const view = await viewOf(db, id, workspaceId, reach);
  return view
    ? staffView(
        db,
        workspaceId,
        view,
        await reachSets(db, workspaceId, reach),
        reach,
      )
    : undefined;
}

/** `withinReach` for one notice, checking every-customer reach only for a workspace-wide one. */
async function staffView(
  executor: Executor,
  workspaceId: string,
  view: AnnouncementView,
  sets: ReachSets,
  reach: AnnouncementReach,
) {
  const everyCustomer =
    view.audience === "workspace" &&
    (await reachesEveryCustomer(executor, workspaceId, reach.live));
  return withinReach(view, sets, everyCustomer);
}

type Targets = {
  organisationIds: readonly string[];
  projectIds: readonly string[];
};

/**
 * The final audience must name at least one target. Every target the write ADDS must be a live
 * customer project the caller reaches, or an organisation served by one. Organisations are
 * instance-wide, so this is what stops a workspace addressing (or probing) a stranger. Targets
 * already stored are kept as they are, so an editor without reach to one cannot drop it.
 */
async function assertTargets(
  executor: Executor,
  workspaceId: string,
  audience: AnnouncementAudience,
  final: Targets,
  added: Targets,
  reachableProjectIds: readonly string[],
) {
  if (audience === "organisations" && final.organisationIds.length === 0)
    throw unprocessable("Choose at least one organisation");
  if (audience === "projects" && final.projectIds.length === 0)
    throw unprocessable("Choose at least one project");
  const { organisationIds, projectIds } = added;
  if (
    (organisationIds.length > 0 || projectIds.length > 0) &&
    reachableProjectIds.length === 0
  )
    throw unprocessable(
      organisationIds.length > 0 ? "Unknown organisation" : "Unknown project",
    );
  if (organisationIds.length > 0) {
    const found = await executor
      .selectDistinct({ id: projectTable.organisationId })
      .from(projectTable)
      .innerJoin(
        organisationTable,
        eq(organisationTable.id, projectTable.organisationId),
      )
      .where(
        and(
          eq(projectTable.workspaceId, workspaceId),
          liveCustomerProject(),
          inArray(projectTable.id, [...reachableProjectIds]),
          inArray(projectTable.organisationId, [...organisationIds]),
          eq(organisationTable.isInternal, false),
          isNull(organisationTable.deletedAt),
        ),
      );
    if (found.length !== organisationIds.length)
      throw unprocessable("Unknown organisation");
  }
  if (projectIds.length > 0) {
    const found = await executor
      .select({ id: projectTable.id })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.workspaceId, workspaceId),
          liveCustomerProject(),
          inArray(projectTable.id, [...reachableProjectIds]),
          inArray(projectTable.id, [...projectIds]),
        ),
      );
    if (found.length !== projectIds.length)
      throw unprocessable("Unknown project");
  }
}

async function replaceTargets(
  executor: Executor,
  announcementId: string,
  workspaceId: string,
  organisationIds: readonly string[],
  projectIds: readonly string[],
) {
  await executor
    .delete(announcementOrganisationTable)
    .where(eq(announcementOrganisationTable.announcementId, announcementId));
  await executor
    .delete(announcementProjectTable)
    .where(eq(announcementProjectTable.announcementId, announcementId));
  if (organisationIds.length > 0)
    await executor.insert(announcementOrganisationTable).values(
      organisationIds.map((organisationId) => ({
        workspaceId,
        announcementId,
        organisationId,
      })),
    );
  if (projectIds.length > 0)
    await executor.insert(announcementProjectTable).values(
      projectIds.map((projectId) => ({
        workspaceId,
        announcementId,
        projectId,
      })),
    );
}

function auditShape(view: AnnouncementView) {
  return {
    title: view.title,
    severity: view.severity,
    audience: view.audience,
    organisationIds: view.organisations.map((entry) => entry.id),
    projectIds: view.projects.map((entry) => entry.id),
    startsAt: view.startsAt,
    endsAt: view.endsAt,
    publishedAt: view.publishedAt,
    bodyLength: view.body.length,
  };
}

async function audit(
  executor: Executor,
  action: string,
  actor: GovernanceActor,
  workspaceId: string,
  entityId: string,
  before: AnnouncementView | null,
  after: AnnouncementView | null,
) {
  await appendAuditLog(executor, {
    actorId: actor.userId,
    actorType: actor.actorType,
    apiKeyId: actor.apiKeyId ?? null,
    workspaceId,
    action,
    entityType: "announcement",
    entityId,
    before: before ? auditShape(before) : null,
    after: after ? auditShape(after) : null,
  });
}

function assertWindow(startsAt: Date, endsAt: Date | null) {
  if (endsAt && endsAt.getTime() <= startsAt.getTime())
    throw unprocessable("The end must be after the start");
}

const unique = (ids: readonly string[]) => [...new Set(ids)];

export async function createAnnouncement(
  input: {
    workspaceId: string;
    title: string;
    body: string;
    severity: AnnouncementSeverity;
    audience: AnnouncementAudience;
    organisationIds: readonly string[];
    projectIds: readonly string[];
    startsAt?: Date;
    endsAt?: Date | null;
  },
  actor: GovernanceActor,
  reach: AnnouncementReach,
) {
  const reachableProjectIds = reach.live;
  const startsAt = input.startsAt ?? new Date();
  const endsAt = input.endsAt ?? null;
  assertWindow(startsAt, endsAt);
  const organisationIds =
    input.audience === "organisations" ? unique(input.organisationIds) : [];
  const projectIds =
    input.audience === "projects" ? unique(input.projectIds) : [];
  return db.transaction(async (tx) => {
    const targets = { organisationIds, projectIds };
    await assertTargets(
      tx,
      input.workspaceId,
      input.audience,
      targets,
      targets,
      reachableProjectIds,
    );
    if (
      input.audience === "workspace" &&
      !(await reachesEveryCustomer(tx, input.workspaceId, reach.live))
    )
      throw unprocessable(EVERY_CUSTOMER);
    const [row] = await tx
      .insert(announcementTable)
      .values({
        workspaceId: input.workspaceId,
        title: input.title,
        body: input.body,
        severity: input.severity,
        audience: input.audience,
        startsAt,
        endsAt,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning();
    if (!row) throw new Error("announcement insert returned no row");
    await replaceTargets(
      tx,
      row.id,
      input.workspaceId,
      organisationIds,
      projectIds,
    );
    const view = await viewOf(tx, row.id, input.workspaceId);
    if (!view) throw new Error("announcement vanished after insert");
    await audit(
      tx,
      "announcement.created",
      actor,
      input.workspaceId,
      row.id,
      null,
      view,
    );
    return staffView(
      tx,
      input.workspaceId,
      view,
      await reachSets(tx, input.workspaceId, reach),
      reach,
    );
  });
}

/** Lock the row for a write; a row outside the caller's reach is missing, before any version check. */
async function lockForWrite(
  executor: Executor,
  id: string,
  workspaceId: string,
  version: number,
  reach: AnnouncementReach,
) {
  const [row] = await executor
    .select()
    .from(announcementTable)
    .where(
      and(
        eq(announcementTable.id, id),
        eq(announcementTable.workspaceId, workspaceId),
        isNull(announcementTable.deletedAt),
        inReach(reach),
      ),
    )
    .for("update")
    .limit(1);
  if (!row) throw notFound();
  if (row.version !== version)
    throw new AnnouncementVersionConflictError(row.version);
  return row;
}

export async function updateAnnouncement(
  id: string,
  workspaceId: string,
  input: {
    version: number;
    title?: string;
    body?: string;
    severity?: AnnouncementSeverity;
    audience?: AnnouncementAudience;
    organisationIds?: readonly string[];
    projectIds?: readonly string[];
    startsAt?: Date;
    endsAt?: Date | null;
  },
  actor: GovernanceActor,
  reach: AnnouncementReach,
) {
  const reachableProjectIds = reach.live;
  return db.transaction(async (tx) => {
    const row = await lockForWrite(tx, id, workspaceId, input.version, reach);
    const before = await viewOf(tx, id, workspaceId);
    if (!before) throw notFound();
    const sets = await reachSets(tx, workspaceId, reach);
    await assertReachesPublishedAudience(
      tx,
      workspaceId,
      row,
      before,
      sets,
      reach.live,
    );
    const audience = input.audience ?? row.audience;
    const startsAt = input.startsAt ?? row.startsAt;
    const endsAt = input.endsAt !== undefined ? input.endsAt : row.endsAt;
    assertWindow(startsAt, endsAt);
    const storedOrganisations = before.organisations.map((entry) => entry.id);
    const storedProjects = before.projects.map((entry) => entry.id);
    // The editor sees only reachable targets; stored ones beyond their reach stay, and the
    // audience cannot change while any exist (that would drop or widen past them).
    const hiddenProjects = storedProjects.filter(
      (id) => !sets.projects.has(id),
    );
    const hiddenOrganisations = storedOrganisations.filter(
      (id) => !sets.organisations.has(id),
    );
    const audienceChanged = audience !== row.audience;
    if (
      audienceChanged &&
      (hiddenProjects.length > 0 || hiddenOrganisations.length > 0)
    )
      throw unprocessable(HIDDEN_TARGETS);
    if (
      audienceChanged &&
      audience === "workspace" &&
      !(await reachesEveryCustomer(tx, workspaceId, reach.live))
    )
      throw unprocessable(EVERY_CUSTOMER);
    const organisationIds =
      audience === "organisations"
        ? unique(
            input.organisationIds
              ? [...input.organisationIds, ...hiddenOrganisations]
              : storedOrganisations,
          )
        : [];
    const projectIds =
      audience === "projects"
        ? unique(
            input.projectIds
              ? [...input.projectIds, ...hiddenProjects]
              : storedProjects,
          )
        : [];
    await assertTargets(
      tx,
      workspaceId,
      audience,
      { organisationIds, projectIds },
      {
        organisationIds: organisationIds.filter(
          (id) => !storedOrganisations.includes(id),
        ),
        projectIds: projectIds.filter((id) => !storedProjects.includes(id)),
      },
      reachableProjectIds,
    );
    await tx
      .update(announcementTable)
      .set({
        title: input.title ?? row.title,
        body: input.body ?? row.body,
        severity: input.severity ?? row.severity,
        audience,
        startsAt,
        endsAt,
        updatedBy: actor.userId,
        updatedAt: new Date(),
        version: row.version + 1,
      })
      .where(eq(announcementTable.id, id));
    await replaceTargets(tx, id, workspaceId, organisationIds, projectIds);
    const after = await viewOf(tx, id, workspaceId);
    if (!after) throw notFound();
    await audit(
      tx,
      "announcement.updated",
      actor,
      workspaceId,
      id,
      before,
      after,
    );
    return staffView(tx, workspaceId, after, sets, reach);
  });
}

/**
 * Publish (the portal may show it once in window) or unpublish (back to a draft). Publishing
 * needs reach to every stored target, and a workspace-wide notice addresses every customer, so
 * publishing one needs reach to every customer project.
 */
export async function setAnnouncementPublished(
  id: string,
  workspaceId: string,
  version: number,
  published: boolean,
  actor: GovernanceActor,
  reach: AnnouncementReach,
) {
  return db.transaction(async (tx) => {
    const row = await lockForWrite(tx, id, workspaceId, version, reach);
    const before = await viewOf(tx, id, workspaceId);
    if (!before) throw notFound();
    const sets = await reachSets(tx, workspaceId, reach);
    if (published === (row.publishedAt !== null))
      return staffView(tx, workspaceId, before, sets, reach);
    // Publishing addresses every stored target, so a target beyond the caller's reach refuses
    // it (the same hidden-target test `updateAnnouncement` uses for an audience change).
    if (published && hasHiddenTargets(before, sets))
      throw unprocessable(PUBLISH_HIDDEN_TARGETS);
    if (
      published &&
      row.audience === "workspace" &&
      !(await reachesEveryCustomer(tx, workspaceId, reach.live))
    )
      throw unprocessable(EVERY_CUSTOMER);
    // Withdrawing a live notice changes what every addressed customer sees.
    if (!published)
      await assertReachesPublishedAudience(
        tx,
        workspaceId,
        row,
        before,
        sets,
        reach.live,
      );
    await tx
      .update(announcementTable)
      .set({
        publishedAt: published ? new Date() : null,
        updatedBy: actor.userId,
        updatedAt: new Date(),
        version: row.version + 1,
      })
      .where(eq(announcementTable.id, id));
    const after = await viewOf(tx, id, workspaceId);
    if (!after) throw notFound();
    await audit(
      tx,
      published ? "announcement.published" : "announcement.unpublished",
      actor,
      workspaceId,
      id,
      before,
      after,
    );
    return staffView(tx, workspaceId, after, sets, reach);
  });
}

/**
 * `inReach` for the pending deletion, which has the caller's identity but no request reach:
 * the same SQL reach decision (`currentProjectReachPredicate`), deleted projects included.
 */
export async function callerReachesAnnouncement(
  executor: Executor,
  id: string,
  workspaceId: string,
  identity: ResolvedIdentity,
) {
  const reached = (alias: typeof projectTable) =>
    currentProjectReachPredicate(
      identity,
      alias.id,
      alias.workspaceId,
      alias.organisationId,
      executor,
    );
  const [row] = await executor
    .select({ id: announcementTable.id })
    .from(announcementTable)
    .where(
      and(
        eq(announcementTable.id, id),
        eq(announcementTable.workspaceId, workspaceId),
        or(
          eq(announcementTable.audience, "workspace"),
          exists(
            executor
              .select({ one: sql`1` })
              .from(announcementProjectTable)
              .innerJoin(
                projectTable,
                and(
                  eq(projectTable.id, announcementProjectTable.projectId),
                  eq(
                    projectTable.workspaceId,
                    announcementProjectTable.workspaceId,
                  ),
                ),
              )
              .where(
                and(
                  eq(
                    announcementProjectTable.announcementId,
                    announcementTable.id,
                  ),
                  reached(projectTable),
                ),
              ),
          ),
          exists(
            executor
              .select({ one: sql`1` })
              .from(announcementOrganisationTable)
              .innerJoin(
                projectTable,
                and(
                  eq(
                    projectTable.organisationId,
                    announcementOrganisationTable.organisationId,
                  ),
                  eq(
                    projectTable.workspaceId,
                    announcementOrganisationTable.workspaceId,
                  ),
                ),
              )
              .where(
                and(
                  eq(
                    announcementOrganisationTable.announcementId,
                    announcementTable.id,
                  ),
                  reached(projectTable),
                ),
              ),
          ),
        ),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * The deletion rule for a notice the caller reaches: deleting a published notice needs reach to
 * every customer it addresses. A notice outside reach passes here and answers 404 through the
 * pending-action path, so the refusal never confirms a hidden row exists.
 */
export async function assertAnnouncementDeletable(
  executor: Executor,
  id: string,
  workspaceId: string,
  reach: AnnouncementReach,
) {
  const [row] = await executor
    .select()
    .from(announcementTable)
    .where(
      and(
        eq(announcementTable.id, id),
        eq(announcementTable.workspaceId, workspaceId),
        isNull(announcementTable.deletedAt),
        inReach(reach),
      ),
    )
    .limit(1);
  if (!row) return;
  const view = await viewOf(executor, id, workspaceId);
  if (!view) return;
  await assertReachesPublishedAudience(
    executor,
    workspaceId,
    row,
    view,
    await reachSets(executor, workspaceId, reach),
    reach.live,
  );
}

/**
 * The caller's announcement reach from an identity alone (the approved pending deletion): the
 * workspace's projects that pass the same SQL reach decision `callerReachesAnnouncement` uses.
 */
export async function announcementReachOfIdentity(
  executor: Executor,
  workspaceId: string,
  identity: ResolvedIdentity,
): Promise<AnnouncementReach> {
  const rows = await executor
    .select({ id: projectTable.id, deletedAt: projectTable.deletedAt })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        currentProjectReachPredicate(
          identity,
          projectTable.id,
          projectTable.workspaceId,
          projectTable.organisationId,
          executor,
        ),
      ),
    );
  return {
    live: rows.filter((row) => row.deletedAt === null).map((row) => row.id),
    any: rows.map((row) => row.id),
  };
}

/** Soft delete, run by the approved pending action. False when the row changed or is gone. */
export async function softDeleteAnnouncement(
  executor: Executor,
  id: string,
  workspaceId: string,
  actor: GovernanceActor,
) {
  const before = await viewOf(executor, id, workspaceId);
  if (!before) return false;
  const [deleted] = await executor
    .update(announcementTable)
    .set({
      deletedAt: new Date(),
      updatedBy: actor.userId,
      updatedAt: new Date(),
      version: before.version + 1,
    })
    .where(
      and(
        eq(announcementTable.id, id),
        eq(announcementTable.workspaceId, workspaceId),
        isNull(announcementTable.deletedAt),
      ),
    )
    .returning({ id: announcementTable.id });
  if (!deleted) return false;
  await audit(
    executor,
    "announcement.deleted",
    actor,
    workspaceId,
    id,
    before,
    null,
  );
  return true;
}

// ------------------------------------------------------------------------------ portal side

export type PortalAnnouncementScope = {
  personId: string;
  organisationId: string;
  workspaceIds: string[];
};

/**
 * The caller's customer person, organisation, and the workspaces that can show it announcements:
 * a live project of the organisation the customer holds access to, `feature.customer_portal` on
 * and the service catalogue on.
 */
export async function resolvePortalAnnouncementScope(
  userId: string,
): Promise<PortalAnnouncementScope> {
  const [person] = await db
    .select({
      personId: personTable.id,
      organisationId: personTable.organisationId,
    })
    .from(personTable)
    .where(
      and(
        eq(personTable.userId, userId),
        eq(personTable.side, "customer"),
        eq(personTable.active, true),
      ),
    )
    .limit(1);
  if (!person?.organisationId)
    throw new HTTPException(404, { message: "Portal account not found" });
  const reached = await db
    .selectDistinct({ workspaceId: projectTable.workspaceId })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.organisationId, person.organisationId),
        isNull(projectTable.deletedAt),
        isNull(projectTable.archivedAt),
        customerProjectAccessExists(
          person.personId,
          person.organisationId,
          projectTable.id,
        ),
      ),
    );
  const portal = await customerPortalScope();
  const enabled = await Promise.all(
    reached.map(async ({ workspaceId }) =>
      customerPortalOnFor(portal, workspaceId) &&
      (await serviceCatalogueEnabled(workspaceId))
        ? workspaceId
        : null,
    ),
  );
  return {
    personId: person.personId,
    organisationId: person.organisationId,
    workspaceIds: enabled.filter((id): id is string => id !== null),
  };
}

/** A live, portal-on project of the organisation in the announcement's workspace that `personId` reaches. */
function organisationProjectInWorkspace(
  personId: string,
  organisationId: string,
  portal: CustomerPortalScope | null,
) {
  return exists(
    db
      .select({ one: sql`1` })
      .from(projectTable)
      .where(
        and(
          eq(projectTable.workspaceId, announcementTable.workspaceId),
          eq(projectTable.organisationId, organisationId),
          isNull(projectTable.deletedAt),
          isNull(projectTable.archivedAt),
          customerProjectAccessExists(
            personId,
            organisationId,
            projectTable.id,
          ),
          customerPortalOnSql(
            portal,
            projectTable.workspaceId,
            projectTable.id,
          ),
        ),
      ),
  );
}

/** The audience predicate: who the announcement addresses, evaluated for one customer person. */
function addressesOrganisation(
  personId: string,
  organisationId: string,
  portal: CustomerPortalScope | null,
) {
  const inWorkspace = organisationProjectInWorkspace(
    personId,
    organisationId,
    portal,
  );
  return or(
    and(eq(announcementTable.audience, "workspace"), inWorkspace),
    and(
      eq(announcementTable.audience, "organisations"),
      inWorkspace,
      exists(
        db
          .select({ one: sql`1` })
          .from(announcementOrganisationTable)
          .where(
            and(
              eq(
                announcementOrganisationTable.announcementId,
                announcementTable.id,
              ),
              eq(
                announcementOrganisationTable.workspaceId,
                announcementTable.workspaceId,
              ),
              eq(announcementOrganisationTable.organisationId, organisationId),
            ),
          ),
      ),
    ),
    and(
      eq(announcementTable.audience, "projects"),
      exists(
        db
          .select({ one: sql`1` })
          .from(announcementProjectTable)
          .innerJoin(
            projectTable,
            and(
              eq(projectTable.id, announcementProjectTable.projectId),
              eq(
                projectTable.workspaceId,
                announcementProjectTable.workspaceId,
              ),
            ),
          )
          .where(
            and(
              eq(announcementProjectTable.announcementId, announcementTable.id),
              eq(
                announcementProjectTable.workspaceId,
                announcementTable.workspaceId,
              ),
              eq(projectTable.organisationId, organisationId),
              isNull(projectTable.deletedAt),
              isNull(projectTable.archivedAt),
              customerProjectAccessExists(
                personId,
                organisationId,
                projectTable.id,
              ),
              customerPortalOnSql(
                portal,
                projectTable.workspaceId,
                projectTable.id,
              ),
            ),
          ),
      ),
    ),
  );
}

/** Published, not deleted and inside its window right now. */
function liveNow(now: Date) {
  return and(
    isNotNull(announcementTable.publishedAt),
    isNull(announcementTable.deletedAt),
    lte(announcementTable.startsAt, now),
    or(isNull(announcementTable.endsAt), gt(announcementTable.endsAt, now)),
  );
}

function toPortal(row: AnnouncementRow): PortalAnnouncement {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    severity: row.severity,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    publishedAt: (row.publishedAt ?? row.startsAt).toISOString(),
  };
}

type PortalCursor = {
  v: 1;
  personId: string;
  organisationId: string;
  startsAt: string;
  id: string;
};

function encodeCursor(cursor: PortalCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(
  value: string | undefined,
  personId: string,
  organisationId: string,
): PortalCursor | null | false {
  if (value === undefined) return null;
  try {
    if (!/^[A-Za-z0-9_-]{1,512}$/u.test(value)) return false;
    const candidate: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      return false;
    const parsed = candidate as Record<string, unknown>;
    if (
      Object.keys(parsed).sort().join(",") !==
        "id,organisationId,personId,startsAt,v" ||
      parsed.v !== 1 ||
      parsed.personId !== personId ||
      parsed.organisationId !== organisationId ||
      typeof parsed.id !== "string" ||
      parsed.id.length < 1 ||
      parsed.id.length > 128 ||
      typeof parsed.startsAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(parsed.startsAt)
    )
      return false;
    const cursor = parsed as PortalCursor;
    const timestamp = new Date(cursor.startsAt);
    return !Number.isNaN(timestamp.getTime()) &&
      timestamp.toISOString() === cursor.startsAt &&
      encodeCursor(cursor) === value
      ? cursor
      : false;
  } catch {
    return false;
  }
}

export async function listPortalAnnouncements(
  scope: PortalAnnouncementScope,
  input: {
    limit: number;
    cursor?: string;
    severities?: readonly AnnouncementSeverity[];
  },
) {
  const cursor = decodeCursor(
    input.cursor,
    scope.personId,
    scope.organisationId,
  );
  if (cursor === false)
    throw new HTTPException(400, { message: "Invalid announcement cursor" });
  if (scope.workspaceIds.length === 0) return { data: [], nextCursor: null };
  const now = new Date();
  const rows = await db
    .select()
    .from(announcementTable)
    .where(
      and(
        inArray(announcementTable.workspaceId, scope.workspaceIds),
        liveNow(now),
        addressesOrganisation(
          scope.personId,
          scope.organisationId,
          await customerPortalScope(),
        ),
        input.severities?.length
          ? inArray(announcementTable.severity, [...input.severities])
          : undefined,
        cursor
          ? or(
              lt(announcementTable.startsAt, new Date(cursor.startsAt)),
              and(
                eq(announcementTable.startsAt, new Date(cursor.startsAt)),
                lt(announcementTable.id, cursor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(announcementTable.startsAt), desc(announcementTable.id))
    .limit(input.limit + 1);
  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const last = page.at(-1);
  return {
    data: page.map(toPortal),
    nextCursor:
      hasMore && last
        ? encodeCursor({
            v: 1,
            personId: scope.personId,
            organisationId: scope.organisationId,
            startsAt: last.startsAt.toISOString(),
            id: last.id,
          })
        : null,
  };
}

export async function getPortalAnnouncement(
  scope: PortalAnnouncementScope,
  id: string,
) {
  if (scope.workspaceIds.length === 0) throw notFound();
  const [row] = await db
    .select()
    .from(announcementTable)
    .where(
      and(
        eq(announcementTable.id, id),
        inArray(announcementTable.workspaceId, scope.workspaceIds),
        liveNow(new Date()),
        addressesOrganisation(
          scope.personId,
          scope.organisationId,
          await customerPortalScope(),
        ),
      ),
    )
    .limit(1);
  if (!row) throw notFound();
  return toPortal(row);
}
