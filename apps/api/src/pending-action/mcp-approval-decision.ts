import type { ResolvedIdentity } from "@taskdesk/permissions";
import { HTTPException } from "hono/http-exception";
import {
  isCabTeamMember,
  loadApprovalTargetByApprovalId,
} from "../approval/repository";
import { decideApprovalInTransaction } from "../approval/service";
import type { ApiKey } from "../openapi";
import { approveClickDeletion } from "./click-deletion-executor";
import { failOnExecutorError } from "./execution-failure";
import {
  MCP_APPROVAL_DECISION_ROUTE,
  type McpApprovalDecision,
} from "./payload";
import { resolvePendingActionCredentialIdentity } from "./required-access";
import { createPendingAction, type PendingActionTransaction } from "./service";

export const MCP_APPROVAL_DECISION_TARGET = "approval_decision" as const;

export async function requestMcpApprovalDecision(input: {
  approvalId: string;
  identity: ResolvedIdentity;
  apiKey: Pick<ApiKey, "id">;
  decision: McpApprovalDecision;
  actorIp?: string | null;
  userAgent?: string | null;
}) {
  if (
    input.identity.credential !== "api_key" &&
    input.identity.credential !== "mcp_key"
  )
    throw new HTTPException(403, { message: "An API key is required" });
  if (!input.identity.personId || !input.apiKey.id)
    throw new HTTPException(403, { message: "no_approver" });
  return createPendingAction({
    requesterPersonId: input.identity.personId,
    credentialType: "api_key",
    credentialId: input.apiKey.id,
    origin: "mcp",
    action: "mcp_destructive",
    routeKey: MCP_APPROVAL_DECISION_ROUTE,
    targetType: MCP_APPROVAL_DECISION_TARGET,
    targetIds: [input.approvalId],
    mcpDecision: input.decision,
    actorId: input.identity.userId,
    actorType: "api_key",
    actorIp: input.actorIp,
    userAgent: input.userAgent,
  });
}

export async function approveMcpApprovalDecision(input: {
  id: string;
  requesterPersonId: string;
  userId: string;
  sessionId: string;
  traceId: string;
}) {
  return approveClickDeletion(input, {
    action: "mcp_destructive",
    targetType: MCP_APPROVAL_DECISION_TARGET,
    routeKey: MCP_APPROVAL_DECISION_ROUTE,
    confirmation: ["click"],
    summaryResult: (result) => result,
    execute: failOnExecutorError(async (tx: PendingActionTransaction, row) => {
      const approvalId = row.targetIds[0];
      const payload = row.payload as {
        mcp_decision?: McpApprovalDecision;
      };
      if (!approvalId || row.targetIds.length !== 1 || !payload.mcp_decision) {
        throw new HTTPException(409, {
          message: "pending_action_target_changed",
        });
      }
      const identity = await resolvePendingActionCredentialIdentity(tx, row, {
        existingPendingAction: true,
      });
      if (!("authority" in identity))
        throw new HTTPException(
          identity.status === 404 ? 404 : identity.status === 409 ? 409 : 403,
          {
            message:
              "MCP key owner or key is no longer eligible to decide this approval",
          },
        );
      const target = await loadApprovalTargetByApprovalId(
        approvalId,
        identity,
        { executor: tx },
      );
      if (!target)
        throw new HTTPException(404, { message: "Approval not found" });
      const isCabMember = await isCabTeamMember(
        identity,
        identity.userId,
        target.workspaceId,
        target.workItemId,
        tx,
      );
      const decided = await decideApprovalInTransaction(tx, {
        approvalId,
        identity,
        actorType: "api_key",
        apiKeyId: row.credentialId ?? undefined,
        action: payload.mcp_decision.action,
        note: payload.mcp_decision.note,
        isCabMember,
        target,
      });
      return {
        approvalId,
        state: decided.state,
      };
    }),
  });
}
