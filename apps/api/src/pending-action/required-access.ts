import { evaluateApprovalDecision } from "@taskdesk/domain";
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
import { and, eq, gt, sql } from "drizzle-orm";
import type db from "../database";
import { schema } from "../database";
import {
  apiKeyExtensionTable,
  apikeyTable,
  approvalTable,
  instanceFeatureFlagTable,
  personTable,
  projectTable,
  savedViewTable,
  serviceCalendarTable,
  sessionTable,
  teamMemberTable,
  teamTable,
  userTable,
  workItemTable,
} from "../database/schema";
import {
  IMPORT_CHUNK_ROUTE,
  IMPORT_CHUNK_TARGET,
  IMPORT_LINK_CHUNK_ROUTE,
  readImportChunkBinding,
} from "../imports/pending-action-contract";
import {
  HARD_PURGE_TARGET_TYPES,
  type HardPurgeTargetType,
  inspectHardPurgeTarget,
} from "../instance/purge-target";
import { resolveIdentity } from "../permissions/resolve-identity";
import { policyRegistry } from "../policy-registry";
import {
  projectAncestryFor,
  projectOwnerTeamFor,
} from "../utils/project-ancestry";
import {
  apiKeyCapabilitySubset,
  apiKeyScopeFromStoredPermissions,
} from "../utils/require-api-key-permission-scope";
import { evaluateAttachmentDeletionAccess } from "./attachment-deletion-target";
import { evaluateBulkWorkItemDeletionAccess } from "./bulk-work-item-deletion-target";
import { evaluateCommentDeletionAccess } from "./comment-deletion-target";
import {
  evaluateRegisteredDeletionAccess,
  isRegisteredDeletion,
} from "./deletion-targets";
import {
  canonicalPendingActionPayload,
  hashPendingActionPayload,
  MCP_APPROVAL_DECISION_ROUTE,
} from "./payload";
import { evaluateRelationDeletionAccess } from "./relation-deletion-target";
import { evaluateWorkItemDeletionAccess } from "./work-item-deletion-target";

type PendingActionTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export type ActionRequiredAccessInput = {
  requestedByPersonId: string;
  credentialType: string;
  credentialId: string | null;
  /** Stored origin discriminator; key kind is re-derived from persisted extension data. */
  origin?: string;
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
 * Evaluate registered pending-action targets against the original credential and current scope.
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
    /** Use nonlocking target/credential reads for a read-only DTO projection. */
    readOnly?: boolean;
  } = {},
): Promise<RequiredAccessDecision> {
  const route = policyRegistry.get(input.routeKey);
  const registeredSelfDeletion =
    route?.kind === "self" && isRegisteredDeletion(input);
  if (
    !route ||
    (!registeredSelfDeletion &&
      (route.kind !== "capability" || !("scope" in route.policy)))
  ) {
    return { allowed: false, failure: "unsupported", status: 403 };
  }
  const capabilityPolicy =
    route.kind === "capability" && "capability" in route.policy
      ? route.policy
      : undefined;
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

  const resolved = await resolvePendingActionCredentialIdentity(
    tx,
    input,
    options,
  );
  if (!("authority" in resolved)) return resolved;
  const identity = resolved;
  if (input.action === "purge")
    return evaluateHardPurgeAccess(tx, input, identity);
  if (input.targetType === "attachment")
    return evaluateAttachmentDeletionAccess(tx, input, identity);
  if (input.targetType === "comment")
    return evaluateCommentDeletionAccess(tx, input, identity);
  if (input.targetType === "relation")
    return evaluateRelationDeletionAccess(tx, input, identity);

  if (
    input.action === "mcp_destructive" &&
    input.targetType === "approval_decision" &&
    input.routeKey === MCP_APPROVAL_DECISION_ROUTE
  )
    return evaluateMcpApprovalDecisionAccess(tx, input, identity);

  if (
    input.action === "mcp_destructive" &&
    input.targetType === IMPORT_CHUNK_TARGET &&
    (input.routeKey === IMPORT_CHUNK_ROUTE ||
      input.routeKey === IMPORT_LINK_CHUNK_ROUTE)
  )
    return evaluateImportChunkAccess(
      tx,
      input,
      identity,
      capabilityPolicy,
      options.readOnly === true,
    );

  if (input.targetType === "work_item" && input.action === "bulk_delete")
    return evaluateBulkWorkItemDeletionAccess(tx, input, identity);
  if (input.targetType === "work_item")
    return evaluateWorkItemDeletionAccess(tx, input, identity);
  if (isRegisteredDeletion(input))
    return evaluateRegisteredDeletionAccess(
      tx,
      input,
      identity,
      options.readOnly ? "read" : "locked",
    );
  if (
    input.action === "delete" &&
    input.targetType === "user" &&
    input.routeKey === "POST /api/instance/users/{id}/deactivate" &&
    input.targetIds.length === 1 &&
    input.credentialType === "session" &&
    input.workspaceId === null &&
    input.projectId === null &&
    input.organisationId === null &&
    capabilityPolicy?.scope === "instance" &&
    capabilityPolicy.capability === "instance:admin"
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
    const decision = evaluatePolicy(capabilityPolicy, {
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
      capabilityPolicy?.scope === "workspace" &&
      capabilityPolicy.scopeSource === "row" &&
      capabilityPolicy.reach === "required" &&
      capabilityPolicy.capability === "sla_policy:manage") ||
      (input.targetType === "saved_view" &&
        input.routeKey === "DELETE /api/views/{id}" &&
        input.confirmationRequired === "click" &&
        capabilityPolicy?.scope === "workspace" &&
        capabilityPolicy.scopeSource === "row" &&
        capabilityPolicy.reach === "required" &&
        capabilityPolicy.capability === "workspace:manage_settings" &&
        capabilityPolicy.orOwner?.predicate ===
          "row.created_by === identity.personId" &&
        capabilityPolicy.orOwner.capability === "saved_view:create"))
  ) {
    return evaluateWorkspaceDeletionAccess(
      tx,
      capabilityPolicy,
      identity,
      input,
      options.readOnly ? "read" : "locked",
    );
  }

  return { allowed: false, failure: "unsupported", status: 403 };
}

async function evaluateImportChunkAccess(
  tx: PendingActionTransaction,
  input: ActionRequiredAccessInput,
  identity: ResolvedIdentity,
  capabilityPolicy: CapabilityPolicy | undefined,
  readOnly: boolean,
): Promise<RequiredAccessDecision> {
  const binding = readImportChunkBinding(
    input.targetVersions,
    input.targetIds,
    input.routeKey,
  );
  if (
    !binding ||
    input.action !== "mcp_destructive" ||
    input.targetType !== IMPORT_CHUNK_TARGET ||
    (input.routeKey !== IMPORT_CHUNK_ROUTE &&
      input.routeKey !== IMPORT_LINK_CHUNK_ROUTE) ||
    input.confirmationRequired !== "typed_count_step_up" ||
    input.workspaceId === null ||
    input.projectId === null ||
    input.organisationId === undefined ||
    !capabilityPolicy ||
    capabilityPolicy.capability !== "instance:admin" ||
    capabilityPolicy.scope !== "instance"
  )
    return { allowed: false, failure: "unsupported", status: 409 };

  const routeDecision = evaluatePolicy(capabilityPolicy, {
    identity,
    target: {},
    scope: instanceScope(),
    inReach: NO_SINGLE_RESOURCE,
  });
  if (!routeDecision.allowed)
    return {
      allowed: false,
      failure: routeDecision.status === 404 ? "reach" : "capability",
      status: routeDecision.status,
    };

  const runQuery = tx
    .select()
    .from(schema.importRunTable)
    .where(
      and(
        eq(schema.importRunTable.id, binding.binding.runId),
        eq(schema.importRunTable.workspaceId, input.workspaceId),
        eq(schema.importRunTable.projectId, input.projectId),
        eq(schema.importRunTable.pluginId, "import.mcp"),
      ),
    );
  const [run] = await (readOnly
    ? runQuery.for("share")
    : runQuery.for("update")
  ).limit(1);
  if (
    !run ||
    !run.projectId ||
    run.projectId !== input.projectId ||
    run.state !== "running" ||
    run.version !== binding.binding.expectedRunVersion
  )
    return { allowed: false, failure: "target_version", status: 409 };
  const chunkQuery = tx
    .select()
    .from(schema.importChunkTable)
    .where(
      and(
        eq(schema.importChunkTable.importRunId, run.id),
        eq(schema.importChunkTable.chunkId, binding.chunkId),
        eq(schema.importChunkTable.state, "pending_approval"),
        eq(schema.importChunkTable.inputDigest, binding.binding.digest),
        eq(schema.importChunkTable.recordCount, binding.binding.recordCount),
        eq(schema.importChunkTable.expectedRunVersion, run.version - 1),
        gt(schema.importChunkTable.expiresAt, sql`clock_timestamp()`),
      ),
    );
  const [chunk] = await (readOnly
    ? chunkQuery.for("share")
    : chunkQuery.for("update")
  ).limit(1);
  if (!chunk || chunk.report.operation !== binding.binding.operation)
    return { allowed: false, failure: "target_version", status: 409 };
  const [project] = await tx
    .select({
      id: projectTable.id,
      organisationId: projectTable.organisationId,
      archivedAt: projectTable.archivedAt,
      deletedAt: projectTable.deletedAt,
    })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, run.projectId),
        eq(projectTable.workspaceId, run.workspaceId),
      ),
    )
    .for("share")
    .limit(1);
  if (
    !project ||
    project.archivedAt ||
    project.deletedAt ||
    project.organisationId !== input.organisationId
  )
    return { allowed: false, failure: "reach", status: 404 };

  if (identity.side !== "staff")
    return { allowed: false, failure: "reach", status: 404 };
  const ancestorProjectIds = await projectAncestryFor(
    tx,
    identity,
    run.workspaceId,
    run.projectId,
  );
  const target = {
    projectId: run.projectId,
    workItemProjectId: run.projectId,
    workspaceId: run.workspaceId,
    ancestorProjectIds,
  };
  const inReach = reaches(identity, {
    projectId: run.projectId,
    workspaceId: run.workspaceId,
    organisationId: project.organisationId,
    ancestorProjectIds,
    ownerTeamId: await projectOwnerTeamFor(
      tx,
      identity,
      run.workspaceId,
      run.projectId,
    ),
  });
  if (!inReach) return { allowed: false, failure: "reach", status: 404 };
  if (!can(identity, "work_item:create", "project", target))
    return { allowed: false, failure: "capability", status: 403 };
  return { allowed: true };
}

async function evaluateMcpApprovalDecisionAccess(
  tx: PendingActionTransaction,
  input: ActionRequiredAccessInput,
  identity: ResolvedIdentity,
): Promise<RequiredAccessDecision> {
  if (
    input.targetIds.length !== 1 ||
    input.confirmationRequired !== "click" ||
    !input.payload ||
    typeof input.payload !== "object" ||
    !("mcp_decision" in input.payload)
  ) {
    return { allowed: false, failure: "unsupported", status: 409 };
  }
  const decisionIntent = input.payload.mcp_decision as {
    action: "approve" | "reject";
    note: string | null;
  };
  const route = policyRegistry.get(MCP_APPROVAL_DECISION_ROUTE);
  if (
    route?.kind !== "capability" ||
    !("capability" in route.policy) ||
    route.policy.capability !== "approval:decide" ||
    route.policy.scope !== "work_item" ||
    route.policy.scopeSource !== "row" ||
    route.policy.reach !== "required"
  ) {
    return { allowed: false, failure: "unsupported", status: 403 };
  }

  const approvalId = input.targetIds[0] ?? "";
  const [anchor] = await tx
    .select({
      id: approvalTable.id,
      workItemId: approvalTable.workItemId,
      workspaceId: approvalTable.workspaceId,
    })
    .from(approvalTable)
    .where(eq(approvalTable.id, approvalId))
    .limit(1);
  if (!anchor) return { allowed: false, failure: "reach", status: 404 };

  // Match the approval engine lock order: work item first, approval second.
  const [target] = await tx
    .select({
      workItemId: workItemTable.id,
      workspaceId: workItemTable.workspaceId,
      projectId: workItemTable.projectId,
      organisationId: projectTable.organisationId,
      deletedAt: workItemTable.deletedAt,
      archivedAt: workItemTable.archivedAt,
      projectDeletedAt: projectTable.deletedAt,
    })
    .from(workItemTable)
    .innerJoin(projectTable, eq(projectTable.id, workItemTable.projectId))
    .where(
      and(
        eq(workItemTable.id, anchor.workItemId),
        eq(workItemTable.workspaceId, anchor.workspaceId),
      ),
    )
    .for("update", { of: workItemTable })
    .limit(1);
  if (
    !target ||
    target.deletedAt ||
    target.archivedAt ||
    target.projectDeletedAt
  ) {
    return { allowed: false, failure: "reach", status: 404 };
  }
  const [approval] = await tx
    .select({
      id: approvalTable.id,
      workItemId: approvalTable.workItemId,
      workspaceId: approvalTable.workspaceId,
      transitionId: approvalTable.transitionId,
      kind: approvalTable.kind,
      requestedBy: approvalTable.requestedBy,
      approverId: approvalTable.approverId,
      state: approvalTable.state,
      createdAt: approvalTable.createdAt,
      expiresAt: approvalTable.expiresAt,
      reminder50SentAt: approvalTable.reminder50SentAt,
      reminder90SentAt: approvalTable.reminder90SentAt,
    })
    .from(approvalTable)
    .where(
      and(
        eq(approvalTable.id, approvalId),
        eq(approvalTable.workItemId, target.workItemId),
        eq(approvalTable.workspaceId, target.workspaceId),
      ),
    )
    .for("update")
    .limit(1);
  if (!approval)
    return { allowed: false, failure: "target_scope", status: 409 };
  if (
    target.workspaceId !== input.workspaceId ||
    target.projectId !== input.projectId ||
    target.organisationId !== input.organisationId
  ) {
    return { allowed: false, failure: "target_scope", status: 409 };
  }

  const ancestorProjectIds = await projectAncestryFor(
    tx,
    identity,
    target.workspaceId,
    target.projectId,
  );
  const ownerTeamId = await projectOwnerTeamFor(
    tx,
    identity,
    target.workspaceId,
    target.projectId,
  );
  const inReach = reaches(identity, {
    projectId: target.projectId,
    workspaceId: target.workspaceId,
    organisationId: target.organisationId,
    ancestorProjectIds,
    ownerTeamId,
  });
  const policyDecision = evaluatePolicy(route.policy, {
    identity,
    target: {
      workItemId: target.workItemId,
      workItemProjectId: target.projectId,
      workspaceId: target.workspaceId,
      organisationId: target.organisationId ?? undefined,
      ancestorProjectIds,
    },
    scope: workItemScopeFromRow({
      workItemId: target.workItemId,
      projectId: target.projectId,
      workspaceId: target.workspaceId,
    }),
    inReach,
  });
  if (!policyDecision.allowed)
    return {
      allowed: false,
      failure: policyDecision.status === 404 ? "reach" : "capability",
      status: policyDecision.status,
    };
  if (
    approval.approverId !== identity.personId ||
    approval.requestedBy === identity.personId
  ) {
    return { allowed: false, failure: "capability", status: 403 };
  }
  const now = new Date();
  if (approval.state !== "pending" || approval.expiresAt <= now)
    return { allowed: false, failure: "unsupported", status: 409 };

  let cabMembers = new Set<string>();
  if (approval.kind === "cab") {
    if (
      !can(identity, "approval:decide_cab", "work_item", {
        workItemId: target.workItemId,
        workItemProjectId: target.projectId,
        workspaceId: target.workspaceId,
        organisationId: target.organisationId ?? undefined,
        ancestorProjectIds,
      })
    ) {
      return { allowed: false, failure: "capability", status: 403 };
    }
    const [membership] = await tx
      .select({ id: teamMemberTable.id })
      .from(teamMemberTable)
      .innerJoin(teamTable, eq(teamTable.id, teamMemberTable.teamId))
      .where(
        and(
          eq(teamMemberTable.userId, identity.userId),
          eq(teamTable.workspaceId, target.workspaceId),
          eq(teamTable.isCab, true),
        ),
      )
      .limit(1);
    if (!membership)
      return { allowed: false, failure: "capability", status: 403 };
    cabMembers = new Set([identity.personId]);
  }
  const verdict = evaluateApprovalDecision({
    approval: {
      id: approval.id,
      transitionId: approval.transitionId,
      kind: approval.kind as "customer" | "cab",
      requestedBy: approval.requestedBy,
      approverId: approval.approverId,
      state: approval.state as
        | "pending"
        | "approved"
        | "rejected"
        | "expired"
        | "withdrawn",
      createdAt: approval.createdAt,
      expiresAt: approval.expiresAt,
      reminder50SentAt: approval.reminder50SentAt,
      reminder90SentAt: approval.reminder90SentAt,
    },
    actingPersonId: identity.personId,
    action: decisionIntent.action,
    note: decisionIntent.note,
    cabMemberIds: cabMembers,
  });
  if (!verdict.ok) {
    return {
      allowed: false,
      failure: verdict.reasons.includes("not_pending")
        ? "unsupported"
        : "capability",
      status: verdict.reasons.includes("not_pending") ? 409 : 403,
    };
  }
  return { allowed: true };
}

async function evaluateHardPurgeAccess(
  tx: PendingActionTransaction,
  input: ActionRequiredAccessInput,
  identity: ResolvedIdentity,
): Promise<RequiredAccessDecision> {
  if (
    input.action !== "purge" ||
    input.routeKey !== "POST /api/instance/purge" ||
    !HARD_PURGE_TARGET_TYPES.includes(
      input.targetType as HardPurgeTargetType,
    ) ||
    input.targetIds.length !== 1 ||
    input.credentialType !== "session" ||
    input.confirmationRequired !== "typed_name_step_up" ||
    input.projectId !== null ||
    (input.targetType === "organisation"
      ? input.workspaceId !== null ||
        input.organisationId !== input.targetIds[0]
      : input.organisationId !== null)
  )
    return { allowed: false, failure: "unsupported", status: 403 };

  const route = policyRegistry.get(input.routeKey);
  if (
    route?.kind !== "capability" ||
    !("capability" in route.policy) ||
    route.policy.scope !== "instance" ||
    route.policy.scopeSource !== "instance" ||
    route.policy.capability !== "instance:admin" ||
    route.policy.elevated !== true ||
    route.policy.sessionOnly !== true
  )
    return { allowed: false, failure: "unsupported", status: 403 };
  const decision = evaluatePolicy(route.policy, {
    identity,
    target: {},
    scope: instanceScope(),
    inReach: NO_SINGLE_RESOURCE,
  });
  if (!decision.allowed)
    return {
      allowed: false,
      failure: "capability",
      status: decision.status === 404 ? 404 : 403,
    };

  const targetId = input.targetIds[0];
  if (!targetId) return { allowed: false, failure: "unsupported", status: 403 };
  const targetType = input.targetType as HardPurgeTargetType;
  if (targetType === "organisation") {
    const initial = await inspectHardPurgeTarget(tx, { targetType, targetId });
    if (initial.status === "not_found")
      return { allowed: false, failure: "target_scope", status: 404 };
    if (initial.status !== "eligible")
      return { allowed: false, failure: "target_version", status: 409 };
    await tx.execute(sql`LOCK TABLE legal_hold IN SHARE MODE`);
    const check = await inspectHardPurgeTarget(tx, { targetType, targetId });
    if (check.status === "not_found")
      return { allowed: false, failure: "target_scope", status: 404 };
    if (check.status !== "eligible")
      return { allowed: false, failure: "target_version", status: 409 };
    const expected = JSON.stringify({
      operationId: check.summary.operationId,
      generation: check.summary.generation,
    });
    const versions =
      typeof input.targetVersions === "object" &&
      input.targetVersions !== null &&
      !Array.isArray(input.targetVersions)
        ? (input.targetVersions as Record<string, unknown>)
        : null;
    if (
      (!versions && input.payload !== undefined) ||
      (versions && versions[targetId] !== expected)
    )
      return { allowed: false, failure: "target_version", status: 409 };
    return { allowed: true };
  }
  // Keep the approval-time fingerprint stable through execution, and preserve the same
  // hold-before-target lock order used by request-time inspection and the purge executor.
  await tx.execute(sql`LOCK TABLE legal_hold IN SHARE MODE`);
  let workspaceId: string | undefined;
  let relatedProjectId: string | undefined;
  if (targetType === "work_item") {
    const [row] = await tx
      .select({
        workspaceId: workItemTable.workspaceId,
        projectId: workItemTable.projectId,
      })
      .from(workItemTable)
      .where(eq(workItemTable.id, targetId))
      .for("update")
      .limit(1);
    workspaceId = row?.workspaceId;
    relatedProjectId = row?.projectId;
  } else {
    const [row] = await tx
      .select({
        workspaceId: projectTable.workspaceId,
        projectId: projectTable.id,
      })
      .from(projectTable)
      .where(eq(projectTable.id, targetId))
      .for("update")
      .limit(1);
    workspaceId = row?.workspaceId;
    relatedProjectId = row?.projectId;
  }
  if (!workspaceId || !relatedProjectId)
    return { allowed: false, failure: "target_scope", status: 404 };
  if (input.workspaceId !== workspaceId)
    return { allowed: false, failure: "target_scope", status: 404 };

  const check = await inspectHardPurgeTarget(tx, { targetType, targetId });
  if (check.status === "not_found")
    return { allowed: false, failure: "target_scope", status: 404 };
  if (check.status !== "eligible")
    return { allowed: false, failure: "target_version", status: 409 };
  if (input.targetVersions != null) {
    const versions =
      typeof input.targetVersions === "object" &&
      !Array.isArray(input.targetVersions)
        ? (input.targetVersions as Record<string, unknown>)
        : null;
    const expected = JSON.stringify({
      targetType,
      targetId,
      workspaceId,
      relatedProjectId,
      summary: check.summary,
    });
    if (!versions || versions[targetId] !== expected)
      return { allowed: false, failure: "target_version", status: 409 };
  } else if (input.payload !== undefined) {
    // A pending purge always captures the eligible target fingerprint before it is approved.
    return { allowed: false, failure: "target_version", status: 409 };
  }
  return { allowed: true };
}

/** Shared persisted credential validation; callers still apply their registered route and item policies. */
export async function resolvePendingActionCredentialIdentity(
  tx: PendingActionTransaction,
  input: Pick<
    ActionRequiredAccessInput,
    "requestedByPersonId" | "credentialType" | "credentialId" | "origin"
  >,
  options: {
    apiKeyPermissions?: string | null;
    existingPendingAction?: boolean;
    readOnly?: boolean;
  } = {},
): Promise<ResolvedIdentity | RequiredAccessDecision> {
  if (input.credentialType !== "session" && input.credentialType !== "api_key")
    return { allowed: false, failure: "credential", status: 403 };
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
        credential: "api_key" | "mcp_key";
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
    const apiKeyQuery = tx
      .select({
        id: apikeyTable.id,
        referenceId: apikeyTable.referenceId,
        userId: apikeyTable.userId,
        enabled: apikeyTable.enabled,
        expiresAt: apikeyTable.expiresAt,
        permissions: apikeyTable.permissions,
      })
      .from(apikeyTable)
      .where(eq(apikeyTable.id, input.credentialId));
    const [apiKey] = options.readOnly
      ? await apiKeyQuery.limit(1)
      : await apiKeyQuery.for("update").limit(1);
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
    const extensionQuery = tx
      .select({ isMcp: apiKeyExtensionTable.isMcp })
      .from(apiKeyExtensionTable)
      .where(eq(apiKeyExtensionTable.apikeyId, input.credentialId));
    const [extension] = await (options.readOnly
      ? extensionQuery
      : extensionQuery.for("update")
    ).limit(1);
    const isMcp = extension?.isMcp === true;
    if (
      (input.origin === "mcp" && !isMcp) ||
      (input.origin === "api" && isMcp)
    ) {
      return { allowed: false, failure: "credential", status: 403 };
    }
    if (isMcp) {
      const [mcpFeature] = await tx
        .select({ enabled: instanceFeatureFlagTable.enabled })
        .from(instanceFeatureFlagTable)
        .where(eq(instanceFeatureFlagTable.featureKey, "feature.mcp"))
        .for("share")
        .limit(1);
      if (mcpFeature?.enabled !== true)
        return { allowed: false, failure: "credential", status: 403 };
    }
    const permissions =
      options.apiKeyPermissions === undefined
        ? apiKey.permissions
        : options.apiKeyPermissions;
    const scope = apiKeyScopeFromStoredPermissions(permissions);
    identityCredential = {
      credential: isMcp ? "mcp_key" : "api_key",
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
  return identity ?? { allowed: false, failure: "credential", status: 403 };
}

async function evaluateWorkspaceDeletionAccess(
  tx: PendingActionTransaction,
  policy: CapabilityPolicy,
  identity: ResolvedIdentity,
  input: ActionRequiredAccessInput,
  mode: "locked" | "read" = "locked",
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
    const calendarQuery = tx
      .select({
        id: serviceCalendarTable.id,
        workspaceId: serviceCalendarTable.workspaceId,
        version: serviceCalendarTable.version,
      })
      .from(serviceCalendarTable)
      .where(eq(serviceCalendarTable.id, targetId));
    const [calendar] =
      mode === "read"
        ? await calendarQuery.limit(1)
        : await calendarQuery.for("update").limit(1);
    if (calendar) {
      target = {
        ...calendar,
        createdBy: null,
        visibility: null,
        sharedWithTeamId: null,
      };
    }
  } else {
    const viewQuery = tx
      .select({
        id: savedViewTable.id,
        workspaceId: savedViewTable.workspaceId,
        version: savedViewTable.updatedAt,
        createdBy: savedViewTable.createdBy,
        visibility: savedViewTable.visibility,
        sharedWithTeamId: savedViewTable.sharedWithTeamId,
      })
      .from(savedViewTable)
      .where(eq(savedViewTable.id, targetId));
    const [view] =
      mode === "read"
        ? await viewQuery.limit(1)
        : await viewQuery.for("update").limit(1);
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
    mode === "locked" &&
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
