import { can, reaches } from "@taskdesk/permissions";
import { and, eq, gt, isNotNull, isNull, or } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { loadApiKeyKind } from "../api-key/repository";
import db, { schema } from "../database";
import type { Transaction } from "../database/executor";
import { lockWorkspaceLabelNames } from "../label/repository";
import {
  type ResolveIdentityInput,
  resolveIdentity,
} from "../permissions/resolve-identity";
import {
  loadProjectAncestorIdsFor,
  loadProjectOwnerTeamIdFor,
} from "../project/hierarchy.repository";
import { dbNowUtc } from "../utils/db-time";
import {
  apiKeyCapabilitySubset,
  apiKeyScopeFromStoredPermissions,
} from "../utils/require-api-key-permission-scope";
import { resolveAssigneeEligibility } from "./assignee-eligibility";

export type CreateAuthorization = {
  userId: string;
  apiKey?: { id: string };
  impersonatedBy?: string | null;
};
export type InitialWorkItemFields = {
  startDate?: Date | null;
  dueDate?: Date | null;
  labelIds?: string[];
  assigneeId?: string;
};

/** Read live configuration under row locks; caller supplies a serializable transaction. */
export async function prepareWorkItemCreation(
  tx: Transaction,
  input: InitialWorkItemFields & {
    projectId: string;
    workspaceId: string;
    typeId: string;
    authorization?: CreateAuthorization;
  },
) {
  // Catalogue writers lock this family before project/item rows.
  if (input.labelIds !== undefined)
    await lockWorkspaceLabelNames(tx, input.workspaceId, []);
  const [workspace] = await tx
    .select()
    .from(schema.workspaceTable)
    .where(eq(schema.workspaceTable.id, input.workspaceId))
    .for("share");
  const [project] = await tx
    .select()
    .from(schema.projectTable)
    .where(
      and(
        eq(schema.projectTable.id, input.projectId),
        eq(schema.projectTable.workspaceId, input.workspaceId),
        isNull(schema.projectTable.deletedAt),
        isNull(schema.projectTable.archivedAt),
      ),
    )
    .for("update");
  if (!workspace || !project)
    throw new HTTPException(404, { message: "Project not found" });
  const needsAuthority =
    input.startDate !== undefined ||
    input.dueDate !== undefined ||
    input.labelIds !== undefined ||
    input.assigneeId !== undefined;
  if (!input.authorization && needsAuthority)
    throw new HTTPException(403, {
      message: "Initial fields require an authenticated authorization context",
    });
  if (input.authorization) {
    const auth = input.authorization;
    let identityInput: ResolveIdentityInput = {
      userId: auth.userId,
      credential: auth.impersonatedBy ? "impersonation" : "session",
    };
    if (auth.apiKey) {
      const [key] = await tx
        .select()
        .from(schema.apikeyTable)
        .where(
          and(
            eq(schema.apikeyTable.id, auth.apiKey.id),
            eq(schema.apikeyTable.enabled, true),
            or(
              isNull(schema.apikeyTable.expiresAt),
              gt(schema.apikeyTable.expiresAt, dbNowUtc()),
            ),
          ),
        )
        .for("share");
      if (
        !key ||
        (key.referenceId !== auth.userId && key.userId !== auth.userId)
      )
        throw new HTTPException(403, { message: "Invalid API credential" });
      // MC-14: an MCP key is a distinct credential kind with its own clamp, read from the key's
      // `api_key` extension row, never assumed to be a plain key.
      const keyKind = await loadApiKeyKind(auth.apiKey.id, tx);
      identityInput = {
        userId: auth.userId,
        credential: keyKind.isMcp ? "mcp_key" : "api_key",
        apiKey: {
          enabled: true,
          ownerUserId: auth.userId,
          capabilities: apiKeyCapabilitySubset(
            apiKeyScopeFromStoredPermissions(key.permissions),
          ),
        },
      };
    }
    const identity = await resolveIdentity(identityInput, tx);
    // PR-2/PR-3: inherited project membership and authority, read at call time.
    const ancestorProjectIds = identity
      ? await loadProjectAncestorIdsFor(
          tx,
          tx,
          identity,
          project.workspaceId,
          project.id,
        )
      : [];
    const target = {
      projectId: project.id,
      workItemProjectId: project.id,
      workspaceId: project.workspaceId,
      ancestorProjectIds,
    };
    if (
      identity?.side !== "staff" ||
      !reaches(identity, {
        projectId: target.projectId,
        workspaceId: target.workspaceId,
        organisationId: project.organisationId,
        ancestorProjectIds,
        ownerTeamId: await loadProjectOwnerTeamIdFor(
          tx,
          identity,
          project.workspaceId,
          project.id,
        ),
      })
    )
      throw new HTTPException(404, { message: "Project not found" });
    if (!can(identity, "work_item:create", "project", target))
      throw new HTTPException(403, { message: "Insufficient permissions" });
    if (
      (input.startDate !== undefined ||
        input.dueDate !== undefined ||
        input.labelIds !== undefined) &&
      !can(identity, "work_item:update", "work_item", target)
    )
      throw new HTTPException(403, {
        message: "Initial dates and labels require work item update permission",
      });
    if (
      input.assigneeId !== undefined &&
      !can(identity, "work_item:assign", "work_item", target) &&
      !(
        identity.personId === input.assigneeId &&
        can(identity, "work_item:update", "work_item", target)
      )
    )
      throw new HTTPException(403, {
        message: "Insufficient assignment permissions",
      });
  }
  const [type] = await tx
    .select()
    .from(schema.workItemTypeTable)
    .where(
      and(
        eq(schema.workItemTypeTable.id, input.typeId),
        eq(schema.workItemTypeTable.workspaceId, input.workspaceId),
      ),
    )
    .for("share");
  if (!type)
    throw new HTTPException(400, {
      message: "Work item type does not belong to the project's workspace",
    });
  const states = await tx
    .select()
    .from(schema.stateTable)
    .where(eq(schema.stateTable.projectId, project.id))
    .orderBy(schema.stateTable.id)
    .for("share");
  const defaultState = states.find((state) => state.isDefault);
  if (!defaultState)
    throw new HTTPException(400, {
      message: "Project has no default state configured",
    });
  const templates = await tx
    .select()
    .from(schema.stateTemplateTable)
    .where(eq(schema.stateTemplateTable.workspaceId, input.workspaceId))
    .orderBy(schema.stateTemplateTable.id)
    .for("share");
  const liveTemplates = new Set(
    templates
      .filter((template) => !template.archivedAt)
      .map((template) => template.id),
  );
  const [workflow] = type.workflowId
    ? await tx
        .select()
        .from(schema.workflowTable)
        .where(
          and(
            eq(schema.workflowTable.id, type.workflowId),
            eq(schema.workflowTable.workspaceId, input.workspaceId),
          ),
        )
        .for("share")
    : [];
  const [version] = workflow?.activeVersionId
    ? await tx
        .select()
        .from(schema.workflowVersionTable)
        .where(
          and(
            eq(schema.workflowVersionTable.id, workflow.activeVersionId),
            eq(schema.workflowVersionTable.workflowId, workflow.id),
            isNotNull(schema.workflowVersionTable.publishedAt),
          ),
        )
        .for("share")
    : [];
  const edges = version
    ? await tx
        .select()
        .from(schema.workflowTransitionTable)
        .where(eq(schema.workflowTransitionTable.versionId, version.id))
    : [];
  if (
    !liveTemplates.has(defaultState.stateTemplateId) ||
    !edges.some(
      (edge) =>
        (edge.fromStateTemplateId === null ||
          edge.fromStateTemplateId === defaultState.stateTemplateId) &&
        edge.toStateTemplateId !== defaultState.stateTemplateId &&
        liveTemplates.has(edge.toStateTemplateId) &&
        states.some(
          (state) => state.stateTemplateId === edge.toStateTemplateId,
        ),
    )
  )
    throw new HTTPException(422, {
      message:
        "The type's published workflow cannot leave this project's default state",
    });

  if (input.assigneeId !== undefined) {
    // Freeze the real roster/person facts until insertion; missing/foreign IDs share the same failure.
    await tx
      .select({ id: schema.personTable.id })
      .from(schema.personTable)
      .where(eq(schema.personTable.id, input.assigneeId))
      .for("share");
    await tx
      .select({ id: schema.membershipTable.id })
      .from(schema.membershipTable)
      .where(
        and(
          eq(schema.membershipTable.scope, "project"),
          eq(schema.membershipTable.scopeId, project.id),
          eq(schema.membershipTable.personId, input.assigneeId),
        ),
      )
      .orderBy(schema.membershipTable.id)
      .for("share");
    const eligibility = await resolveAssigneeEligibility(
      tx,
      project.id,
      input.assigneeId,
    );
    if (!eligibility.eligible)
      throw new HTTPException(400, {
        message: "That person must be active and on this project's roster",
      });
  }
  return { workspace, project, type, defaultState };
}

/** Retry only aborted transactions; post-commit publication is outside this boundary. */
export async function withCreationTransaction<T>(
  run: (tx: Transaction) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(run, { isolationLevel: "serializable" });
    } catch (error) {
      let nested: unknown = error;
      let retryable = false;
      for (
        let depth = 0;
        depth < 5 && nested && typeof nested === "object";
        depth++
      ) {
        const failure = nested as { code?: string; cause?: unknown };
        if (failure.code === "40001" || failure.code === "40P01") {
          retryable = true;
          break;
        }
        nested = failure.cause;
      }
      if (!retryable) throw error;
      if (attempt >= 9)
        throw new HTTPException(409, {
          message:
            "Creation configuration changed concurrently; retry the request",
        });
      // An ordinary burst shares one project counter. Spread retries so aborted
      // snapshots do not all race into the next serializable round together.
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.min(100, 5 * 2 ** attempt) + Math.floor(Math.random() * 10),
        ),
      );
    }
  }
}
