import { type FeatureFlag, resolveFeatureFlag } from "@taskdesk/permissions";
import {
  and,
  eq,
  inArray,
  isNull,
  notInArray,
  or,
  type SQL,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import type { Context, MiddlewareHandler, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import type { Executor } from "../database/executor";

/**
 * Runtime enforcement of a feature flag (`ST-1`, `ST-11`; features.md "Disabled features are
 * enforced by the API and UI; hiding navigation alone is insufficient"). Every helper resolves
 * the same project -> workspace -> instance -> built-in default chain as the settings screens
 * and **fails closed**: a flag that cannot be read is off.
 */

/**
 * Runs a flag read without poisoning the caller's transaction (P4R2-L2). On the shared pool the
 * read runs directly; inside an open transaction it runs in a savepoint (Drizzle turns a nested
 * `transaction` into `SAVEPOINT`), so a failing read rolls back only the savepoint and the
 * caller's transaction stays usable while the helper answers "off".
 */
async function readFlags<T>(
  executor: Executor,
  read: (executor: Executor) => Promise<T>,
): Promise<T> {
  if (executor === db) return read(db);
  return executor.transaction((savepoint) => read(savepoint));
}

async function instanceView(feature: FeatureFlag, executor: Executor = db) {
  const [row] = await executor
    .select({
      enabled: schema.instanceFeatureFlagTable.enabled,
      locked: schema.instanceFeatureFlagTable.locked,
    })
    .from(schema.instanceFeatureFlagTable)
    .where(eq(schema.instanceFeatureFlagTable.featureKey, feature))
    .limit(1);
  return row ?? null;
}

async function workspaceRows(
  feature: FeatureFlag,
  workspaceIds: readonly string[],
  executor: Executor,
) {
  if (workspaceIds.length === 0) return new Map<string, boolean>();
  const rows = await executor
    .select({
      workspaceId: schema.workspaceFeatureFlagTable.workspaceId,
      enabled: schema.workspaceFeatureFlagTable.enabled,
    })
    .from(schema.workspaceFeatureFlagTable)
    .where(
      and(
        eq(schema.workspaceFeatureFlagTable.featureKey, feature),
        inArray(schema.workspaceFeatureFlagTable.workspaceId, [
          ...workspaceIds,
        ]),
      ),
    );
  return new Map(rows.map((row) => [row.workspaceId, row.enabled]));
}

async function resolveWorkspace(
  feature: FeatureFlag,
  workspaceId: string,
  reader: Executor,
): Promise<boolean> {
  const instance = await instanceView(feature, reader);
  const overrides = await workspaceRows(feature, [workspaceId], reader);
  return resolveFeatureFlag({
    feature,
    instance,
    workspace: overrides.get(workspaceId) ?? null,
  }).enabled;
}

/** Throws on a read error; callers decide how to fail closed. */
async function resolveProjects(
  feature: FeatureFlag,
  projectIds: readonly string[],
  reader: Executor,
): Promise<Set<string>> {
  const projects = await reader
    .select({
      id: schema.projectTable.id,
      workspaceId: schema.projectTable.workspaceId,
    })
    .from(schema.projectTable)
    .where(inArray(schema.projectTable.id, [...projectIds]));
  if (projects.length === 0) return new Set();
  const instance = await instanceView(feature, reader);
  const workspaces = await workspaceRows(
    feature,
    [...new Set(projects.map((project) => project.workspaceId))],
    reader,
  );
  const own = await reader
    .select({
      projectId: schema.projectFeatureFlagTable.projectId,
      enabled: schema.projectFeatureFlagTable.enabled,
    })
    .from(schema.projectFeatureFlagTable)
    .where(
      and(
        eq(schema.projectFeatureFlagTable.featureKey, feature),
        inArray(schema.projectFeatureFlagTable.projectId, [...projectIds]),
      ),
    );
  const ownByProject = new Map(own.map((row) => [row.projectId, row.enabled]));
  return new Set(
    projects
      .filter(
        (project) =>
          resolveFeatureFlag({
            feature,
            instance,
            workspace: workspaces.get(project.workspaceId) ?? null,
            project: ownByProject.get(project.id) ?? null,
          }).enabled,
      )
      .map((project) => project.id),
  );
}

/** The instance-level value, for surfaces that belong to no workspace (SCIM). */
export async function instanceFeatureEnabled(
  feature: FeatureFlag,
): Promise<boolean> {
  try {
    return resolveFeatureFlag({
      feature,
      instance: await instanceView(feature),
    }).enabled;
  } catch {
    return false;
  }
}

/**
 * The value for one workspace (workspace override, instance, default). Pass the open
 * transaction as `executor` when calling from inside one, so the read never waits for a second
 * pool connection while the transaction holds the first.
 */
export async function workspaceFeatureEnabled(
  feature: FeatureFlag,
  workspaceId: string,
  executor: Executor = db,
): Promise<boolean> {
  try {
    return await readFlags(executor, (reader) =>
      resolveWorkspace(feature, workspaceId, reader),
    );
  } catch {
    return false;
  }
}

/**
 * The subset of `projectIds` for which `feature` resolves on (project override, the project's
 * workspace override, instance, default). Projects that do not exist are left out. Fails
 * closed: an unreadable flag set returns no projects.
 */
export async function projectsWithFeatureEnabled(
  feature: FeatureFlag,
  projectIds: readonly string[],
  executor: Executor = db,
): Promise<Set<string>> {
  const unique = [...new Set(projectIds)];
  if (unique.length === 0) return new Set();
  try {
    return await readFlags(executor, (reader) =>
      resolveProjects(feature, unique, reader),
    );
  } catch {
    return new Set();
  }
}

/**
 * The value for one project (project override, workspace override, instance, default), the
 * level `ST-1` names first. Used wherever a project is in context: SLA clock start, scan,
 * badges and the portal SLA view (P4R2-M2).
 */
export async function projectFeatureEnabled(
  feature: FeatureFlag,
  projectId: string,
  executor: Executor = db,
): Promise<boolean> {
  return (await projectsWithFeatureEnabled(feature, [projectId], executor)).has(
    projectId,
  );
}

/**
 * Route middleware: the feature must be on for the request's resolved workspace, otherwise the
 * route answers exactly like one that does not exist (404). Place it after the middleware that
 * sets `workspaceId` and after the capability check, so an unauthorised caller still sees 403.
 */
export function requireWorkspaceFeature(
  feature: FeatureFlag,
): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const workspaceId = c.get("workspaceId") as string | undefined;
    if (!workspaceId || !(await workspaceFeatureEnabled(feature, workspaceId)))
      throw new HTTPException(404, { message: "Not found" });
    await next();
  };
}

/**
 * Route middleware for a route that addresses one project's resource (P4R2-M2): the feature must
 * be on for the request's `projectId` (project override, workspace override, instance), set by
 * the reach middleware that loaded the resource, otherwise 404. Place it after that middleware
 * and after the capability check.
 */
export function requireProjectFeature(feature: FeatureFlag): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const projectId = c.get("projectId") as string | undefined;
    if (!projectId || !(await projectFeatureEnabled(feature, projectId)))
      throw new HTTPException(404, { message: "Not found" });
    await next();
  };
}

// ---------------------------------------------------------------------------------------------
// Short in-process cache for the per-request portal lookups (P4R2-L1). The portal host checks
// `feature.customer_portal` on every request, static assets included; a few seconds of caching
// keeps that off the database. Only successful lookups are cached ("unknown" never is), and every
// flag write in this process clears the cache, so an administrator's change applies at once on
// this node and within the TTL on any other.
// ---------------------------------------------------------------------------------------------

export type FeatureLookupState = "on" | "off" | "unknown";

const FEATURE_CACHE_TTL_MS = 5_000;
const featureCache = new Map<string, { value: boolean; expiresAt: number }>();

/** Clears every cached flag lookup. Called after each flag write commits, and by tests. */
export function invalidateFeatureFlagCache(): void {
  featureCache.clear();
  portalScopeCache = null;
}

async function cachedLookup(
  key: string,
  lookup: () => Promise<boolean>,
): Promise<FeatureLookupState> {
  const now = Date.now();
  const hit = featureCache.get(key);
  if (hit && hit.expiresAt > now) return hit.value ? "on" : "off";
  try {
    const value = await lookup();
    featureCache.set(key, { value, expiresAt: now + FEATURE_CACHE_TTL_MS });
    return value ? "on" : "off";
  } catch {
    return "unknown";
  }
}

async function enabledSomewhere(feature: FeatureFlag): Promise<boolean> {
  const instance = await instanceView(feature);
  if (resolveFeatureFlag({ feature, instance }).enabled) return true;
  if (instance?.locked) return false;
  const workspaces = await db
    .select({
      workspaceId: schema.workspaceFeatureFlagTable.workspaceId,
      enabled: schema.workspaceFeatureFlagTable.enabled,
    })
    .from(schema.workspaceFeatureFlagTable)
    .where(eq(schema.workspaceFeatureFlagTable.featureKey, feature));
  if (
    workspaces.some(
      (row) =>
        resolveFeatureFlag({ feature, instance, workspace: row.enabled })
          .enabled,
    )
  )
    return true;
  // A project switched on inside a workspace that is off still offers the feature.
  const projects = await db
    .select({ projectId: schema.projectFeatureFlagTable.projectId })
    .from(schema.projectFeatureFlagTable)
    .where(
      and(
        eq(schema.projectFeatureFlagTable.featureKey, feature),
        eq(schema.projectFeatureFlagTable.enabled, true),
      ),
    )
    .limit(1);
  return projects.length > 0;
}

/**
 * Whether the feature is on for the instance, for at least one workspace, or for at least one
 * project. For surfaces that are not addressed to a workspace (the customer-portal host,
 * `feature.customer_portal`): they answer while anything offers the feature. Tri-state so a
 * lookup failure ("unknown") is told apart from a deliberate "off" (P4R2-L1).
 */
export function featureStateSomewhere(
  feature: FeatureFlag,
): Promise<FeatureLookupState> {
  return cachedLookup(`somewhere:${feature}`, () => enabledSomewhere(feature));
}

/** Boolean form of {@link featureStateSomewhere}; "unknown" counts as off (fail closed). */
export async function featureEnabledSomewhere(
  feature: FeatureFlag,
): Promise<boolean> {
  return (await featureStateSomewhere(feature)) === "on";
}

/**
 * `feature.customer_portal` for one customer organisation (P4R2-M2). A customer organisation
 * belongs to no single workspace; the workspaces that serve it are those of its engaged projects
 * (`project.organisation_id`) and of the request types assigned to it. The portal is on for the
 * organisation when the flag resolves on for at least one of its engaged projects (project
 * level) or one of those request-type workspaces (workspace level). An organisation that no
 * workspace serves yet falls back to the instance value.
 */
async function customerPortalOnForOrganisation(
  organisationId: string,
): Promise<boolean> {
  const feature = "feature.customer_portal" as const;
  const projects = await db
    .select({ id: schema.projectTable.id })
    .from(schema.projectTable)
    .where(
      and(
        eq(schema.projectTable.organisationId, organisationId),
        isNull(schema.projectTable.deletedAt),
      ),
    );
  if (
    projects.length > 0 &&
    (
      await projectsWithFeatureEnabled(
        feature,
        projects.map((project) => project.id),
      )
    ).size > 0
  )
    return true;
  const requestTypes = await db
    .select({ workspaceId: schema.requestTypeTable.workspaceId })
    .from(schema.organisationRequestTypeTable)
    .innerJoin(
      schema.requestTypeTable,
      eq(
        schema.requestTypeTable.id,
        schema.organisationRequestTypeTable.requestTypeId,
      ),
    )
    .where(
      eq(schema.organisationRequestTypeTable.organisationId, organisationId),
    );
  const workspaceIds = [...new Set(requestTypes.map((row) => row.workspaceId))];
  const instance = await instanceView(feature);
  if (projects.length === 0 && workspaceIds.length === 0)
    return resolveFeatureFlag({ feature, instance }).enabled;
  const overrides = await workspaceRows(feature, workspaceIds, db);
  return workspaceIds.some(
    (workspaceId) =>
      resolveFeatureFlag({
        feature,
        instance,
        workspace: overrides.get(workspaceId) ?? null,
      }).enabled,
  );
}

/** Cached, tri-state form of the per-organisation customer-portal check. */
export function customerPortalStateForOrganisation(
  organisationId: string,
): Promise<FeatureLookupState> {
  return cachedLookup(`portal-organisation:${organisationId}`, () =>
    customerPortalOnForOrganisation(organisationId),
  );
}

/**
 * The customer-portal state for the organisation of a signed-in portal user, or `null` when the
 * user is not a customer (staff, or no person row): the per-organisation check does not apply.
 */
export async function customerPortalStateForUser(
  userId: string,
): Promise<FeatureLookupState | null> {
  let organisationId: string | undefined;
  try {
    const [person] = await db
      .select({
        organisationId: schema.personTable.organisationId,
        side: schema.personTable.side,
      })
      .from(schema.personTable)
      .where(eq(schema.personTable.userId, userId))
      .limit(1);
    if (person?.side !== "customer") return null;
    organisationId = person.organisationId;
  } catch {
    return "unknown";
  }
  return customerPortalStateForOrganisation(organisationId);
}

/**
 * `feature.customer_portal` for the workspace or project behind one portal submission
 * (`SUB-n`), so a customer whose organisation is served by several workspaces cannot reach a
 * submission of a workspace that has the portal off. The submission's converted work item
 * decides by its project; otherwise its request type's workspace does. A reference that names
 * no submission answers "on" and is left to the route's own not-found.
 */
export async function customerPortalStateForSubmission(
  submissionNumber: number,
): Promise<FeatureLookupState> {
  const feature = "feature.customer_portal" as const;
  try {
    const [row] = await db
      .select({
        workspaceId: schema.requestTypeTable.workspaceId,
        projectId: schema.workItemTable.projectId,
      })
      .from(schema.submissionTable)
      .innerJoin(
        schema.requestTypeTable,
        eq(schema.requestTypeTable.id, schema.submissionTable.requestTypeId),
      )
      .leftJoin(
        schema.workItemTable,
        eq(schema.workItemTable.id, schema.submissionTable.workItemId),
      )
      .where(eq(schema.submissionTable.number, submissionNumber))
      .limit(1);
    if (!row) return "on";
    const enabled = row.projectId
      ? (await resolveProjects(feature, [row.projectId], db)).has(row.projectId)
      : await resolveWorkspace(feature, row.workspaceId, db);
    return enabled ? "on" : "off";
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------------------------
// `feature.customer_portal` for the rows of a portal list (P4R2-M2, round 3). A customer
// organisation can be served by workspaces and projects with the portal on and others with it
// off; every portal list and the notification inbox show only rows whose own project (or, for a
// row without one, workspace) resolves on. The override rows are few (one per workspace or
// project that overrides the flag), so the whole set is read once and cached like the host
// lookup, then applied as a SQL condition (keeps cursor pagination exact) or a predicate.
// ---------------------------------------------------------------------------------------------

/** Every stored `feature.customer_portal` value, the input to per-row resolution. */
export type CustomerPortalScope = {
  instance: { enabled: boolean; locked: boolean } | null;
  workspaces: ReadonlyMap<string, boolean>;
  projects: ReadonlyMap<string, boolean>;
};

let portalScopeCache: { value: CustomerPortalScope; expiresAt: number } | null =
  null;

/**
 * The stored portal flag values, cached for {@link FEATURE_CACHE_TTL_MS}. `null` when they
 * cannot be read: callers then show nothing (fail closed).
 */
export async function customerPortalScope(): Promise<CustomerPortalScope | null> {
  const now = Date.now();
  if (portalScopeCache && portalScopeCache.expiresAt > now)
    return portalScopeCache.value;
  const feature = "feature.customer_portal" as const;
  try {
    const [instance, workspaceRows, projectRows] = await Promise.all([
      instanceView(feature),
      db
        .select({
          id: schema.workspaceFeatureFlagTable.workspaceId,
          enabled: schema.workspaceFeatureFlagTable.enabled,
        })
        .from(schema.workspaceFeatureFlagTable)
        .where(eq(schema.workspaceFeatureFlagTable.featureKey, feature)),
      db
        .select({
          id: schema.projectFeatureFlagTable.projectId,
          enabled: schema.projectFeatureFlagTable.enabled,
        })
        .from(schema.projectFeatureFlagTable)
        .where(eq(schema.projectFeatureFlagTable.featureKey, feature)),
    ]);
    const value: CustomerPortalScope = {
      instance,
      workspaces: new Map(workspaceRows.map((row) => [row.id, row.enabled])),
      projects: new Map(projectRows.map((row) => [row.id, row.enabled])),
    };
    portalScopeCache = { value, expiresAt: now + FEATURE_CACHE_TTL_MS };
    return value;
  } catch {
    return null;
  }
}

/** Whether a row in `workspaceId` (and `projectId`, when it has one) is shown on the portal. */
export function customerPortalOnFor(
  scope: CustomerPortalScope | null,
  workspaceId: string,
  projectId?: string | null,
): boolean {
  if (!scope) return false;
  return resolveFeatureFlag({
    feature: "feature.customer_portal",
    instance: scope.instance,
    workspace: scope.workspaces.get(workspaceId) ?? null,
    project: projectId ? (scope.projects.get(projectId) ?? null) : null,
  }).enabled;
}

function idsWhere(map: ReadonlyMap<string, boolean>, enabled: boolean) {
  return [...map].filter(([, value]) => value === enabled).map(([id]) => id);
}

/**
 * The same resolution as {@link customerPortalOnFor} as a SQL condition over a row's workspace
 * column and, when the row can belong to a project, its (nullable) project column.
 */
export function customerPortalOnSql(
  scope: CustomerPortalScope | null,
  workspaceColumn: SQLWrapper,
  projectColumn?: SQLWrapper,
): SQL {
  if (!scope) return sql`false`;
  const instanceOn = resolveFeatureFlag({
    feature: "feature.customer_portal",
    instance: scope.instance,
  }).enabled;
  if (scope.instance?.locked) return instanceOn ? sql`true` : sql`false`;
  const offWorkspaces = idsWhere(scope.workspaces, false);
  const onWorkspaces = idsWhere(scope.workspaces, true);
  const workspaceOn: SQL = instanceOn
    ? offWorkspaces.length
      ? notInArray(workspaceColumn, offWorkspaces)
      : sql`true`
    : onWorkspaces.length
      ? inArray(workspaceColumn, onWorkspaces)
      : sql`false`;
  if (!projectColumn) return workspaceOn;
  const onProjects = idsWhere(scope.projects, true);
  const offProjects = idsWhere(scope.projects, false);
  const notOverriddenOff = offProjects.length
    ? (or(isNull(projectColumn), notInArray(projectColumn, offProjects)) as SQL)
    : sql`true`;
  const inherits = and(notOverriddenOff, workspaceOn) as SQL;
  return onProjects.length
    ? (or(inArray(projectColumn, onProjects), inherits) as SQL)
    : inherits;
}

/** Convenience: read the scope and build the condition in one call. */
export async function customerPortalCondition(
  workspaceColumn: SQLWrapper,
  projectColumn?: SQLWrapper,
): Promise<SQL> {
  return customerPortalOnSql(
    await customerPortalScope(),
    workspaceColumn,
    projectColumn,
  );
}
