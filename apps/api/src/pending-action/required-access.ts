import type { CapabilityPolicy, ResolvedIdentity } from "@taskdesk/permissions";
import {
  can,
  evaluatePolicy,
  instanceScope,
  NO_SINGLE_RESOURCE,
  reaches,
  workItemScopeFromRow,
  workspaceScopeFromRow,
} from "@taskdesk/permissions";
import { and, eq, gt, isNull } from "drizzle-orm";
import type db from "../database";
import {
  apikeyTable,
  personTable,
  projectTable,
  savedViewTable,
  serviceCalendarTable,
  sessionTable,
  teamTable,
  userTable,
  workItemTable,
  workspaceTable,
} from "../database/schema";
import { resolveIdentity } from "../permissions/resolve-identity";
import { policyRegistry } from "../policy-registry";
import {
  apiKeyCapabilitySubset,
  apiKeyScopeFromStoredPermissions,
} from "../utils/require-api-key-permission-scope";
import {
  canonicalPendingActionPayload,
  hashPendingActionPayload,
} from "./payload";

type PendingActionTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export type ActionRequiredAccessInput = {
  requestedByPersonId: string;
  credentialType: string;
  credentialId: string | null;
  action: string;
  targetType: string;
  targetIds: readonly string[];
  routeKey: string;
  workspaceId: string | null;
  projectId: string | null;
  organisationId: string | null;
  confirmationRequired: string;
  payload?: unknown;
  payloadHash?: string;
  targetVersions?: unknown;
};

export type RequiredAccessFailure =
  | "reach"
  | "capability"
  | "credential"
  | "target_scope"
  | "target_version"
  | "unsupported";

export type RequiredAccessDecision = {
  allowed: boolean;
  failure?: RequiredAccessFailure;
  status?: number;
};

/**
 * Evaluate only the two PA-9 target shapes that createPendingAction currently accepts.
 * All identity, credential, target, reach and policy facts are read through this transaction.
 */
export async function evaluateActionRequiredAccess(
  tx: PendingActionTransaction,
  input: ActionRequiredAccessInput,
  options: {
    /** A before/after snapshot used only while the same key row is locked in its update tx. */
    apiKeyPermissions?: string | null;
    /** Existing pending actions survive natural session expiry; explicit revocation atomically invalidates them. */
    existingPendingAction?: boolean;
  } = {},
): Promise<RequiredAccessDecision> {
  const route = policyRegistry.get(input.routeKey);
  if (route?.kind !== "capability" || !("scope" in route.policy)) {
    return { allowed: false, failure: "unsupported", status: 403 };
  }
  if (
    input.credentialType !== "session" &&
    input.credentialType !== "api_key"
  ) {
    return { allowed: false, failure: "credential", status: 403 };
  }

  if (input.payload !== undefined) {
    let payload: ReturnType<typeof canonicalPendingActionPayload>;
    try {
      payload = canonicalPendingActionPayload(
        input.payload as Parameters<typeof canonicalPendingActionPayload>[0],
      );
    } catch {
      return { allowed: false, failure: "unsupported", status: 409 };
    }
    if (
      input.payloadHash === undefined ||
      hashPendingActionPayload(payload) !== input.payloadHash ||
      payload.action !== input.action ||
      payload.route_key !== input.routeKey ||
      payload.target_type !== input.targetType ||
      payload.target_ids.length !== input.targetIds.length ||
      payload.target_ids.some(
        (id, index) => id !== [...input.targetIds].sort()[index],
      ) ||
      payload.workspace_id !== input.workspaceId ||
      payload.project_id !== input.projectId ||
      payload.organisation_id !== input.organisationId ||
      payload.confirmation_required !== input.confirmationRequired
    ) {
      return { allowed: false, failure: "unsupported", status: 409 };
    }
  }

  const [requester] = await tx
    .select({
      userId: personTable.userId,
      active: personTable.active,
      side: personTable.side,
    })
    .from(personTable)
    .where(eq(personTable.id, input.requestedByPersonId))
    .limit(1);
  if (!requester?.userId || !requester.active || requester.side !== "staff") {
    return { allowed: false, failure: "credential", status: 403 };
  }

  const now = new Date();
  let identityCredential:
    | { credential: "session" }
    | {
        credential: "api_key";
        apiKey: {
          enabled: boolean;
          ownerUserId: string;
          capabilities: readonly string[];
        };
      };
  if (input.credentialType === "session") {
    if (!input.credentialId) {
      return { allowed: false, failure: "credential", status: 403 };
    }
    if (!options.existingPendingAction) {
      const [session] = await tx
        .select({ id: sessionTable.id })
        .from(sessionTable)
        .where(
          and(
            eq(sessionTable.id, input.credentialId),
            eq(sessionTable.userId, requester.userId),
            eq(sessionTable.portal, "agent"),
            gt(sessionTable.expiresAt, now),
          ),
        )
        .limit(1);
      if (!session) {
        return { allowed: false, failure: "credential", status: 403 };
      }
    }
    identityCredential = { credential: "session" };
  } else {
    if (!input.credentialId) {
      return { allowed: false, failure: "credential", status: 403 };
    }
    const [apiKey] = await tx
      .select({
        id: apikeyTable.id,
        referenceId: apikeyTable.referenceId,
        userId: apikeyTable.userId,
        enabled: apikeyTable.enabled,
        expiresAt: apikeyTable.expiresAt,
        permissions: apikeyTable.permissions,
      })
      .from(apikeyTable)
      .where(eq(apikeyTable.id, input.credentialId))
      .limit(1);
    const ownerUserId =
      apiKey?.referenceId === requester.userId
        ? apiKey.referenceId
        : apiKey?.userId === requester.userId
          ? apiKey.userId
          : null;
    if (
      !apiKey ||
      !ownerUserId ||
      !apiKey.enabled ||
      (apiKey.expiresAt !== null && apiKey.expiresAt <= now)
    ) {
      return { allowed: false, failure: "credential", status: 403 };
    }
    const permissions =
      options.apiKeyPermissions === undefined
        ? apiKey.permissions
        : options.apiKeyPermissions;
    const scope = apiKeyScopeFromStoredPermissions(permissions);
    identityCredential = {
      credential: "api_key",
      apiKey: {
        enabled: true,
        ownerUserId,
        capabilities: apiKeyCapabilitySubset(scope),
      },
    };
  }

  const identity = await resolveIdentity(
    {
      userId: requester.userId,
      ...identityCredential,
    },
    tx,
  );
  if (!identity) return { allowed: false, failure: "credential", status: 403 };

  if (
    input.action === "delete" &&
    input.targetType === "work_item" &&
    input.routeKey === "DELETE /api/work-items/{key}" &&
    input.targetIds.length === 1 &&
    route.policy.scope === "work_item" &&
    route.policy.scopeSource === "row" &&
    route.policy.reach === "required" &&
    "capability" in route.policy &&
    route.policy.capability === "work_item:delete"
  ) {
    const [target] = await tx
      .select({
        workItemId: workItemTable.id,
        key: workItemTable.key,
        projectId: projectTable.id,
        workspaceId: projectTable.workspaceId,
        organisationId: workspaceTable.organisationId,
      })
      .from(workItemTable)
      .innerJoin(projectTable, eq(projectTable.id, workItemTable.projectId))
      .innerJoin(
        workspaceTable,
        eq(workspaceTable.id, projectTable.workspaceId),
      )
      .where(
        and(
          eq(workItemTable.key, input.targetIds[0] ?? ""),
          isNull(workItemTable.deletedAt),
          isNull(workItemTable.archivedAt),
          isNull(projectTable.deletedAt),
          isNull(projectTable.archivedAt),
        ),
      )
      .for("update")
      .limit(1);
    if (
      !target ||
      target.workspaceId !== input.workspaceId ||
      target.projectId !== input.projectId ||
      target.organisationId !== input.organisationId
    ) {
      return { allowed: false, failure: "unsupported", status: 404 };
    }
    const inReach = reaches(identity, {
      projectId: target.projectId,
      workspaceId: target.workspaceId,
      organisationId: target.organisationId,
      ancestorProjectIds: [],
      ownerTeamId: null,
    });
    const decision = evaluatePolicy(route.policy, {
      identity,
      target: {
        workItemId: target.workItemId,
        projectId: target.projectId,
        workspaceId: target.workspaceId,
      },
      scope: workItemScopeFromRow({
        workItemId: target.workItemId,
        projectId: target.projectId,
        workspaceId: target.workspaceId,
      }),
      inReach,
    });
    if (decision.allowed) return { allowed: true };
    if (decision.status === 404) {
      return { allowed: false, failure: "reach", status: decision.status };
    }
    if (decision.status === 403) {
      return {
        allowed: false,
        failure: "capability",
        status: decision.status,
      };
    }
    return { allowed: false, failure: "unsupported", status: 403 };
  }

  if (
    input.action === "delete" &&
    input.targetType === "user" &&
    input.routeKey === "POST /api/instance/users/{id}/deactivate" &&
    input.targetIds.length === 1 &&
    input.credentialType === "session" &&
    input.workspaceId === null &&
    input.projectId === null &&
    input.organisationId === null &&
    route.policy.scope === "instance" &&
    "capability" in route.policy &&
    route.policy.capability === "instance:admin"
  ) {
    const [target] = await tx
      .select({ id: personTable.id })
      .from(personTable)
      .innerJoin(userTable, eq(userTable.id, personTable.userId))
      .where(
        and(
          eq(userTable.id, input.targetIds[0] ?? ""),
          eq(personTable.active, true),
          eq(userTable.isAnonymous, false),
        ),
      )
      .limit(1);
    if (!target) return { allowed: false, failure: "unsupported", status: 404 };
    const decision = evaluatePolicy(route.policy, {
      identity,
      target: {},
      scope: instanceScope(),
      inReach: NO_SINGLE_RESOURCE,
    });
    if (decision.allowed) return { allowed: true };
    return {
      allowed: false,
      failure: decision.status === 403 ? "capability" : "unsupported",
      status: decision.status,
    };
  }

  if (
    input.action === "delete" &&
    input.targetIds.length === 1 &&
    input.workspaceId !== null &&
    input.projectId === null &&
    input.organisationId === null &&
    ((input.targetType === "service_calendar" &&
      input.routeKey === "DELETE /api/service-calendars/{id}" &&
      input.confirmationRequired === "click" &&
      route.policy.scope === "workspace" &&
      route.policy.scopeSource === "row" &&
      route.policy.reach === "required" &&
      "capability" in route.policy &&
      route.policy.capability === "sla_policy:manage") ||
      (input.targetType === "saved_view" &&
        input.routeKey === "DELETE /api/views/{id}" &&
        input.confirmationRequired === "click" &&
        route.policy.scope === "workspace" &&
        route.policy.scopeSource === "row" &&
        route.policy.reach === "required" &&
        "capability" in route.policy &&
        route.policy.capability === "workspace:manage_settings" &&
        "orOwner" in route.policy &&
        route.policy.orOwner?.predicate ===
          "row.created_by === identity.personId" &&
        route.policy.orOwner.capability === "saved_view:create"))
  ) {
    return evaluateWorkspaceDeletionAccess(tx, route.policy, identity, input);
  }

  return { allowed: false, failure: "unsupported", status: 403 };
}

async function evaluateWorkspaceDeletionAccess(
  tx: PendingActionTransaction,
  policy: CapabilityPolicy,
  identity: ResolvedIdentity,
  input: ActionRequiredAccessInput,
): Promise<RequiredAccessDecision> {
  const targetId = input.targetIds[0] ?? "";
  const isCalendar = input.targetType === "service_calendar";
  let target:
    | {
        id: string;
        workspaceId: string;
        version: number;
        createdBy: string | null;
        visibility: string | null;
        sharedWithTeamId: string | null;
      }
    | undefined;
  if (isCalendar) {
    const [calendar] = await tx
      .select({
        id: serviceCalendarTable.id,
        workspaceId: serviceCalendarTable.workspaceId,
        version: serviceCalendarTable.version,
      })
      .from(serviceCalendarTable)
      .where(eq(serviceCalendarTable.id, targetId))
      .for("update")
      .limit(1);
    if (calendar) {
      target = {
        ...calendar,
        createdBy: null,
        visibility: null,
        sharedWithTeamId: null,
      };
    }
  } else {
    const [view] = await tx
      .select({
        id: savedViewTable.id,
        workspaceId: savedViewTable.workspaceId,
        version: savedViewTable.updatedAt,
        createdBy: savedViewTable.createdBy,
        visibility: savedViewTable.visibility,
        sharedWithTeamId: savedViewTable.sharedWithTeamId,
      })
      .from(savedViewTable)
      .where(eq(savedViewTable.id, targetId))
      .for("update")
      .limit(1);
    if (view) {
      target = {
        ...view,
        version: view.version.getTime(),
      };
    }
  }
  if (!target) {
    return { allowed: false, failure: "reach", status: 404 };
  }
  if (target.workspaceId !== input.workspaceId) {
    return { allowed: false, failure: "target_scope", status: 409 };
  }

  const targetVersions =
    typeof input.targetVersions === "object" &&
    input.targetVersions !== null &&
    !Array.isArray(input.targetVersions)
      ? (input.targetVersions as Record<string, unknown>)
      : null;
  const storedVersion = targetVersions?.[targetId];
  if (
    (input.payload !== undefined ||
      (input.targetVersions !== undefined && input.targetVersions !== null)) &&
    (!targetVersions || storedVersion !== target.version)
  ) {
    return { allowed: false, failure: "target_version", status: 409 };
  }

  if (!isCalendar && target.visibility === "team") {
    if (!target.sharedWithTeamId) {
      return { allowed: false, failure: "unsupported", status: 409 };
    }
    const [team] = await tx
      .select({ id: teamTable.id, workspaceId: teamTable.workspaceId })
      .from(teamTable)
      .where(eq(teamTable.id, target.sharedWithTeamId))
      .limit(1);
    if (!team || team.workspaceId !== target.workspaceId) {
      return { allowed: false, failure: "reach", status: 404 };
    }
    const retainsWorkspaceViewAccess =
      target.createdBy === identity.personId ||
      can(identity, "workspace:manage_settings", "workspace", {
        workspaceId: target.workspaceId,
      });
    if (!identity.teamIds.includes(team.id) && !retainsWorkspaceViewAccess) {
      return { allowed: false, failure: "reach", status: 404 };
    }
  }

  const inReach =
    identity.reach.kind === "all" ||
    (identity.reach.kind !== "organisation" &&
      ((identity.reach.kind === "membership_with_workspaces" &&
        identity.reach.workspaceIds.includes(target.workspaceId)) ||
        identity.memberships.some(
          (membership) =>
            membership.scope === "workspace" &&
            membership.scopeId === target.workspaceId,
        )));
  const rowCreatedBy = isCalendar ? undefined : target.createdBy;
  const decision = evaluatePolicy(policy, {
    identity,
    target: { workspaceId: target.workspaceId },
    scope: workspaceScopeFromRow({ workspaceId: target.workspaceId }),
    inReach,
    ...(rowCreatedBy ? { row: { createdBy: rowCreatedBy } } : {}),
  });
  if (!decision.allowed) {
    return {
      allowed: false,
      failure: decision.status === 404 ? "reach" : "capability",
      status: decision.status,
    };
  }
  if (
    !isCalendar &&
    rowCreatedBy !== identity.personId &&
    !can(identity, "workspace:manage_settings", "workspace", {
      workspaceId: target.workspaceId,
    })
  ) {
    return { allowed: false, failure: "capability", status: 403 };
  }
  return { allowed: true };
}
