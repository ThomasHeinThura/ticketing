import {
  evaluatePolicy,
  instanceScope,
  isCapabilityPolicy,
  isSelfPolicy,
  NO_PERSON_PARAMETER,
  NO_SINGLE_RESOURCE,
  normaliseRouteKey,
  organisationScopeFromRequest,
  organisationScopeFromRow,
  type PolicyContext,
  type PolicyDecision,
  type ProjectReachFacts,
  projectScopeFromRequest,
  projectScopeFromRow,
  type ResolvedIdentity,
  type ResolvedScope,
  reaches,
  workItemScopeFromRow,
  workspaceScopeFromRequest,
  workspaceScopeFromRow,
} from "@taskdesk/permissions";
import { and, eq } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../database";
import { policyRegistry } from "../policy-registry";
import { enforcedPolicySources } from "./enforcement-config";
import { resolveIdentity } from "./resolve-identity";
import { attributedMatchedRoute } from "./shadow-middleware";

type RuntimeContext = Context;
type RegisteredRoute = {
  readonly method: unknown;
  readonly path: unknown;
  readonly terminalHandler?: unknown;
};

type ScopeEvidence = {
  readonly workspaceId?: string;
  readonly workspaceIdSource?: "row" | "request";
  readonly projectId?: string;
  readonly projectIdFromRequest?: string;
  readonly workItemId?: string;
  readonly organisationId?: string;
  readonly organisationIdSource?: "row" | "request";
  readonly row?: PolicyContext["row"];
  readonly portalPredicateSatisfied?: boolean;
  readonly resource?:
    | "project"
    | "task"
    | "label"
    | "timeEntry"
    | "activity"
    | "comment"
    | "column"
    | "workflowRule"
    | "workflow"
    | "workflowVersion"
    | "work_item";
};

function isModernWorkItemResource(
  resource: ScopeEvidence["resource"],
): boolean {
  return (
    resource === "work_item" ||
    resource === "comment" ||
    resource === "timeEntry" ||
    resource === "activity" ||
    resource === "label" ||
    resource === "column" ||
    resource === "workflowRule" ||
    resource === "workflow" ||
    resource === "workflowVersion"
  );
}

function refuse(status: 401 | 403 | 404 | 500): never {
  const message =
    status === 401
      ? "Unauthorized"
      : status === 403
        ? "Forbidden"
        : status === 404
          ? "Not found"
          : "Internal Server Error";
  throw new HTTPException(status, { message });
}

async function identityFor(
  c: RuntimeContext,
): Promise<ResolvedIdentity | null> {
  const userId = c.get("userId") as string | undefined;
  if (!userId) return null;

  const apiKey = c.get("apiKey") as
    | { id: string; userId: string; enabled: boolean }
    | undefined;
  const session = c.get("session") as
    | { id?: string; impersonatedBy?: string | null }
    | null
    | undefined;
  const credential = apiKey
    ? "api_key"
    : session?.impersonatedBy
      ? "impersonation"
      : "session";

  return resolveIdentity({
    userId,
    credential,
    ...(apiKey
      ? {
          apiKey: {
            enabled: apiKey.enabled,
            ownerUserId: apiKey.userId,
          },
        }
      : {}),
  });
}

function readEvidence(c: RuntimeContext): ScopeEvidence {
  return {
    workspaceId: c.get("workspaceId") as string | undefined,
    workspaceIdSource: c.get("workspaceIdSource") as
      | "row"
      | "request"
      | undefined,
    projectId: c.get("projectId") as string | undefined,
    projectIdFromRequest: c.get("projectIdFromRequest") as string | undefined,
    workItemId: c.get("workItemId") as string | undefined,
    organisationId: c.get("policyOrganisationId") as string | undefined,
    organisationIdSource: c.get("policyOrganisationIdSource") as
      | "row"
      | "request"
      | undefined,
    row: c.get("policyRowFacts") as PolicyContext["row"] | undefined,
    portalPredicateSatisfied: c.get("portalPredicateSatisfied") as
      | boolean
      | undefined,
    resource: c.get("policyScopeResource") as ScopeEvidence["resource"],
  };
}

function resolveCapabilityScope(
  policy: Extract<
    ReturnType<typeof policyRegistry.get> extends infer E
      ? E extends { policy: infer P }
        ? P
        : never
      : never,
    { readonly capability: string }
  >,
  evidence: ScopeEvidence,
): ResolvedScope | null {
  if (policy.scope === "instance") return instanceScope();

  if (policy.scope === "workspace") {
    if (!evidence.workspaceId) return null;
    if (policy.scopeSource === "row") {
      return evidence.workspaceIdSource === "row"
        ? workspaceScopeFromRow({ workspaceId: evidence.workspaceId })
        : null;
    }
    return evidence.workspaceIdSource === "request"
      ? workspaceScopeFromRequest({ workspaceId: evidence.workspaceId })
      : null;
  }

  if (policy.scope === "project") {
    if (!evidence.workspaceId) return null;
    if (policy.scopeSource === "request") {
      return evidence.projectIdFromRequest
        ? projectScopeFromRequest({
            projectId: evidence.projectIdFromRequest,
            workspaceId: evidence.workspaceId,
          })
        : null;
    }
    return evidence.projectId &&
      evidence.workspaceIdSource === "row" &&
      evidence.resource === "project"
      ? projectScopeFromRow({
          projectId: evidence.projectId,
          workspaceId: evidence.workspaceId,
        })
      : null;
  }

  if (policy.scope === "work_item") {
    if (
      policy.scopeSource !== "row" ||
      evidence.workspaceIdSource !== "row" ||
      !evidence.workItemId ||
      !evidence.projectId ||
      !evidence.workspaceId
    ) {
      return null;
    }
    return workItemScopeFromRow({
      workItemId: evidence.workItemId,
      projectId: evidence.projectId,
      workspaceId: evidence.workspaceId,
    });
  }

  if (policy.scope === "organisation") {
    if (!evidence.organisationId) return null;
    if (policy.scopeSource === "row") {
      return evidence.organisationIdSource === "row"
        ? organisationScopeFromRow({ organisationId: evidence.organisationId })
        : null;
    }
    return evidence.organisationIdSource === "request"
      ? organisationScopeFromRequest({
          organisationId: evidence.organisationId,
        })
      : null;
  }

  return null;
}

function workspaceReach(
  identity: ResolvedIdentity,
  workspaceId: string,
): boolean {
  if (identity.reach.kind === "all") return true;
  if (identity.reach.kind === "organisation") return false;
  if (
    identity.reach.kind === "membership_with_workspaces" &&
    identity.reach.workspaceIds.includes(workspaceId)
  ) {
    return true;
  }
  return identity.memberships.some(
    (membership) =>
      membership.scope === "workspace" && membership.scopeId === workspaceId,
  );
}

async function projectReach(
  identity: ResolvedIdentity,
  evidence: ScopeEvidence,
  policyScope: "project" | "work_item",
): Promise<boolean> {
  const projectId =
    policyScope === "project"
      ? (evidence.projectIdFromRequest ?? evidence.projectId)
      : evidence.projectId;
  if (!projectId || !evidence.workspaceId) refuse(500);

  const [project] = await db
    .select({
      id: schema.projectTable.id,
      workspaceId: schema.projectTable.workspaceId,
      organisationId: schema.workspaceTable.organisationId,
    })
    .from(schema.projectTable)
    .innerJoin(
      schema.workspaceTable,
      eq(schema.workspaceTable.id, schema.projectTable.workspaceId),
    )
    .where(eq(schema.projectTable.id, projectId))
    .limit(1);
  if (!project) refuse(404);
  if (
    project.workspaceId !== evidence.workspaceId ||
    (policyScope === "project" &&
      evidence.projectIdFromRequest &&
      evidence.projectIdFromRequest !== project.id)
  ) {
    refuse(500);
  }

  let visibleToPersonIds: string[] | null = null;
  if (policyScope === "work_item") {
    if (!evidence.workItemId) refuse(500);
    if (evidence.resource === "task") {
      const [task] = await db
        .select({
          id: schema.taskTable.id,
          projectId: schema.taskTable.projectId,
        })
        .from(schema.taskTable)
        .where(eq(schema.taskTable.id, evidence.workItemId))
        .limit(1);
      if (!task || task.projectId !== project.id) refuse(500);
    } else if (isModernWorkItemResource(evidence.resource)) {
      const [workItem] = await db
        .select({
          id: schema.workItemTable.id,
          projectId: schema.workItemTable.projectId,
          workspaceId: schema.workItemTable.workspaceId,
          requesterId: schema.workItemTable.requesterId,
          customerVisibility: schema.workItemTable.customerVisibility,
        })
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.id, evidence.workItemId))
        .limit(1);
      if (!workItem) refuse(404);
      if (
        workItem.projectId !== project.id ||
        workItem.workspaceId !== project.workspaceId
      ) {
        refuse(500);
      }
      if (
        workItem.customerVisibility !== "private" &&
        workItem.customerVisibility !== "organisation"
      ) {
        refuse(500);
      }
      // Customer privacy is an audience boundary, not a staff visibility filter.
      // Staff with project reach must still be able to handle private submissions;
      // only customer identities are limited to the requester and participants.
      if (
        identity.side === "customer" &&
        workItem.customerVisibility === "private"
      ) {
        const watchers = await db
          .select({ personId: schema.watcherTable.personId })
          .from(schema.watcherTable)
          .where(eq(schema.watcherTable.workItemId, workItem.id));
        visibleToPersonIds = [
          ...new Set([
            ...(workItem.requesterId ? [workItem.requesterId] : []),
            ...watchers.map((watcher) => watcher.personId),
          ]),
        ];
      }
    } else {
      // A row scope without a resource marker cannot establish which persisted table owns
      // the route ID. Never guess the modern work-item table from an absent marker.
      refuse(500);
    }
  }

  const facts: ProjectReachFacts = {
    projectId: project.id,
    workspaceId: project.workspaceId,
    organisationId: project.organisationId,
    ancestorProjectIds: [],
    ownerTeamId: null,
    ...(visibleToPersonIds === null ? {} : { visibleToPersonIds }),
  };
  return reaches(identity, facts);
}

/** Re-read route-owned rows from persisted IDs before constructing evaluator targets. */
async function loadAuthoritativeEvidence(
  c: RuntimeContext,
  entry: NonNullable<ReturnType<typeof policyRegistry.get>>,
  initial: ScopeEvidence,
): Promise<ScopeEvidence> {
  const policy = entry.policy;
  if (entry.kind !== "capability" || !isCapabilityPolicy(policy)) {
    return initial;
  }

  let evidence = initial;
  if (policy.scope === "workspace" && policy.scopeSource === "row") {
    if (!evidence.workspaceId) refuse(500);
    if (evidence.workspaceIdSource === "request") {
      // A path/query/body id is not row evidence by itself. The workspace
      // access middleware has already applied the route's native reach check;
      // load the exact addressed workspace before the strict terminal boundary
      // so the evaluator can use the policy's declared row provenance. This
      // also preserves the compound detail route's existing 404 for a missing
      // workspace without allowing a request id to masquerade as a loaded row.
      const [workspace] = await db
        .select({ id: schema.workspaceTable.id })
        .from(schema.workspaceTable)
        .where(eq(schema.workspaceTable.id, evidence.workspaceId))
        .limit(1);
      if (!workspace) refuse(404);
      evidence = {
        ...evidence,
        workspaceId: workspace.id,
        workspaceIdSource: "row",
      };
    } else if (evidence.workspaceIdSource !== "row") {
      refuse(500);
    }
  }
  if (policy.scope === "work_item") {
    if (
      policy.scopeSource !== "row" ||
      evidence.workspaceIdSource !== "row" ||
      !evidence.workItemId ||
      !evidence.workspaceId
    ) {
      refuse(500);
    }
    if (evidence.resource === "task") {
      const [task] = await db
        .select({
          id: schema.taskTable.id,
          projectId: schema.taskTable.projectId,
          workspaceId: schema.projectTable.workspaceId,
          assigneeId: schema.taskTable.userId,
        })
        .from(schema.taskTable)
        .innerJoin(
          schema.projectTable,
          eq(schema.projectTable.id, schema.taskTable.projectId),
        )
        .where(eq(schema.taskTable.id, evidence.workItemId))
        .limit(1);
      if (!task || task.workspaceId !== evidence.workspaceId) refuse(500);
      evidence = {
        ...evidence,
        projectId: task.projectId,
        row: {
          ...evidence.row,
          assigneeId: task.assigneeId,
        },
      };
    } else if (isModernWorkItemResource(evidence.resource)) {
      const [workItem] = await db
        .select({
          id: schema.workItemTable.id,
          projectId: schema.workItemTable.projectId,
          workspaceId: schema.workItemTable.workspaceId,
          assigneeId: schema.workItemTable.assigneeId,
          requesterId: schema.workItemTable.requesterId,
        })
        .from(schema.workItemTable)
        .where(eq(schema.workItemTable.id, evidence.workItemId))
        .limit(1);
      if (
        !workItem ||
        workItem.workspaceId !== evidence.workspaceId ||
        (evidence.projectId && evidence.projectId !== workItem.projectId)
      ) {
        refuse(500);
      }
      evidence = {
        ...evidence,
        projectId: workItem.projectId,
        row: {
          ...evidence.row,
          assigneeId: workItem.assigneeId,
          requesterId: workItem.requesterId,
        },
      };
    } else {
      refuse(500);
    }
  }

  if (policy.orOwner) {
    if (policy.orOwner.predicate === "row.person_id === identity.personId") {
      const commentId = c.req.param("id");
      if (!commentId) refuse(500);
      const [comment] = await db
        .select({
          id: schema.commentTable.id,
          personId: schema.commentTable.authorId,
          workspaceId: schema.commentTable.workspaceId,
          workItemId: schema.commentTable.workItemId,
        })
        .from(schema.commentTable)
        .where(eq(schema.commentTable.id, commentId))
        .limit(1);
      if (
        !comment ||
        comment.workspaceId !== evidence.workspaceId ||
        comment.workItemId !== evidence.workItemId
      ) {
        refuse(500);
      }
      evidence = {
        ...evidence,
        row: { ...evidence.row, personId: comment.personId },
      };
    }
  }

  return evidence;
}

async function buildContext(
  c: RuntimeContext,
  entry: NonNullable<ReturnType<typeof policyRegistry.get>>,
  identity: ResolvedIdentity | null,
): Promise<PolicyContext> {
  const { policy } = entry;
  if (entry.kind === "public" || entry.kind === "delegated") {
    return { identity, target: {} };
  }
  if (!identity) refuse(401);

  const evidence = await loadAuthoritativeEvidence(c, entry, readEvidence(c));
  if (entry.kind === "self") {
    if (!isSelfPolicy(policy)) refuse(500);
    const personParam = policy.personParam;
    let workspaceMembership: boolean | undefined;
    if (policy.workspaceMembership === true) {
      if (!evidence.workspaceId) refuse(500);
      const rows = await db
        .select({ userId: schema.workspaceUserTable.userId })
        .from(schema.workspaceUserTable)
        .innerJoin(
          schema.workspaceTable,
          eq(schema.workspaceTable.id, schema.workspaceUserTable.workspaceId),
        )
        .where(
          and(
            eq(schema.workspaceUserTable.userId, c.get("userId") as string),
            eq(schema.workspaceUserTable.workspaceId, evidence.workspaceId),
          ),
        )
        .limit(2);
      workspaceMembership = rows.length === 1;
    }
    return {
      identity,
      target: {},
      targetPersonId:
        typeof personParam === "string"
          ? (c.req.param(personParam) ?? null)
          : NO_PERSON_PARAMETER,
      ...(workspaceMembership === undefined ? {} : { workspaceMembership }),
    };
  }
  if (entry.kind === "portal") {
    if (typeof evidence.portalPredicateSatisfied !== "boolean") refuse(500);
    return {
      identity,
      target: {},
      portalPredicateSatisfied: evidence.portalPredicateSatisfied,
    };
  }
  if (!isCapabilityPolicy(policy)) refuse(500);

  const scope = resolveCapabilityScope(policy, evidence);
  if (!scope) refuse(500);

  const reachExempt =
    typeof policy.reach === "object" &&
    policy.reach.exempt === "no_single_resource";
  let inReach: PolicyContext["inReach"];
  if (reachExempt) {
    inReach = NO_SINGLE_RESOURCE;
  } else if (policy.reach === "required") {
    if (policy.scope === "instance") {
      inReach = identity.reach.kind === "all";
    } else if (policy.scope === "organisation") {
      inReach =
        identity.reach.kind === "all" ||
        (identity.reach.kind === "organisation" &&
          identity.reach.ids.includes(evidence.organisationId ?? ""));
    } else if (policy.scope === "workspace") {
      inReach = evidence.workspaceId
        ? workspaceReach(identity, evidence.workspaceId)
        : undefined;
    } else if (policy.scope === "project" || policy.scope === "work_item") {
      inReach = await projectReach(identity, evidence, policy.scope);
    }
  }

  if (policy.orOwner) {
    const requiredRowField = {
      "row.person_id === identity.personId": evidence.row?.personId,
      "row.created_by === identity.personId": evidence.row?.createdBy,
      "row.requester_id === identity.personId": evidence.row?.requesterId,
      "row.assignee_id === identity.personId": evidence.row?.assigneeId,
    }[policy.orOwner.predicate];
    if (requiredRowField === undefined) refuse(500);
  }

  let body: PolicyContext["body"];
  if (policy.orSelfTarget) {
    let parsed: unknown;
    try {
      parsed = (
        c.req as unknown as { valid: (target: "json") => unknown }
      ).valid("json");
    } catch {
      refuse(500);
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("assigneeId" in parsed) ||
      (typeof parsed.assigneeId !== "string" && parsed.assigneeId !== null)
    ) {
      refuse(500);
    }
    body = { assigneeId: parsed.assigneeId };
  }

  return {
    identity,
    target: {},
    scope,
    inReach,
    row: evidence.row,
    body,
    now: new Date(),
  };
}

/** Run at the endpoint boundary, after route middleware and Zod validators, before handler effects. */
export async function enforceRegisteredPolicy(
  c: Context,
  next: Next,
  registeredRoute?: RegisteredRoute,
) {
  if (enforcedPolicySources.size === 0) return next();

  const exactRegisteredMatch = registeredRoute?.terminalHandler
    ? (
        c.req.matchedRoutes as Array<{
          handler?: unknown;
          method: string;
          path: string;
        }>
      ).find(
        (candidate) => candidate.handler === registeredRoute.terminalHandler,
      )
    : undefined;
  const matched =
    exactRegisteredMatch ??
    (registeredRoute
      ? {
          method:
            typeof registeredRoute.method === "string"
              ? registeredRoute.method
              : Array.isArray(registeredRoute.method) &&
                  registeredRoute.method.includes(c.req.method.toLowerCase())
                ? c.req.method
                : null,
          path:
            typeof registeredRoute.path === "string"
              ? registeredRoute.path
              : Array.isArray(registeredRoute.path) &&
                  typeof registeredRoute.path[0] === "string"
                ? registeredRoute.path[0]
                : null,
        }
      : attributedMatchedRoute(c));
  if (
    matched === null ||
    matched.method === null ||
    typeof matched.path !== "string"
  ) {
    refuse(500);
  }
  let routeKey: string;
  try {
    routeKey = normaliseRouteKey(`${matched.method} ${matched.path}`);
  } catch {
    refuse(500);
  }

  const entry = policyRegistry.get(routeKey);
  if (!entry) refuse(500);
  if (!enforcedPolicySources.has(entry.source)) return next();

  let identity: ResolvedIdentity | null;
  try {
    identity = await identityFor(c as RuntimeContext);
  } catch {
    refuse(500);
  }

  let context: PolicyContext;
  try {
    context = await buildContext(c as RuntimeContext, entry, identity);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    refuse(500);
  }

  let decision: PolicyDecision;
  try {
    decision = evaluatePolicy(entry.policy, context);
  } catch {
    refuse(500);
  }
  if (!decision.allowed) refuse(decision.status);

  // `requiresElevation` is not proof. The protected operation's existing handler must still
  // consume its exact route-bound proof in the same transaction as its mutation.
  return next();
}
