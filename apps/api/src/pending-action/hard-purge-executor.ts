import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../audit/audit-writer";
import { appendPendingActionStepUpAudit } from "../auth/step-up-audit";
import { consumePendingActionProof } from "../auth/step-up-service";
import {
  executeHardPurge,
  HARD_PURGE_TARGET_TYPES,
  type HardPurgeRecord,
  HardPurgeRefused,
  type HardPurgeTargetType,
  removePurgedObjects,
} from "../instance/purge-target";
import {
  approveClickDeletion,
  type ClickDeletionApprovalInput,
} from "./click-deletion-executor";
import { getPendingActionExecutionTarget } from "./deletion-targets";
import { failOnExecutorError } from "./execution-failure";

const HARD_PURGE_ROUTE_KEY = "POST /api/instance/purge" as const;

export function isHardPurgePendingAction(action: {
  action: string;
  targetType: string;
  routeKey: string;
  confirmation: string;
}) {
  return (
    action.action === "purge" &&
    HARD_PURGE_TARGET_TYPES.includes(
      action.targetType as (typeof HARD_PURGE_TARGET_TYPES)[number],
    ) &&
    action.routeKey === HARD_PURGE_ROUTE_KEY &&
    action.confirmation === "typed_name_step_up"
  );
}

function safePurgeResult(record: HardPurgeRecord) {
  return {
    targetType: record.targetType,
    targetId: record.targetId,
    label: record.label,
    workItemIds: record.workItemIds,
    workItems: record.workItemIds.length,
    comments: record.comments,
    attachments: record.attachments,
    storageObjectCount: record.storageObjectKeys.length,
    legalHold: "none",
    retention: "soft_deleted",
    ...(record.organisationPurge
      ? {
          organisations: 1,
          projects: record.organisationPurge.projects,
          workItems: record.organisationPurge.workItems,
          people: record.organisationPurge.people,
          attachments: record.organisationPurge.attachments,
          storageObjectsQueued: record.organisationPurge.storageObjectsQueued,
        }
      : {}),
  };
}

export async function approveHardPurge(input: ClickDeletionApprovalInput) {
  const kind = await getPendingActionExecutionTarget({
    id: input.id,
    requesterPersonId: input.requesterPersonId,
  });
  if (
    kind.action !== "purge" ||
    kind.routeKey !== HARD_PURGE_ROUTE_KEY ||
    !HARD_PURGE_TARGET_TYPES.includes(
      kind.targetType as (typeof HARD_PURGE_TARGET_TYPES)[number],
    ) ||
    kind.confirmationRequired !== "typed_name_step_up"
  )
    throw new HTTPException(409, {
      message: "pending_action_kind_unsupported",
    });

  const targetType = kind.targetType as HardPurgeTargetType;
  const approved = await approveClickDeletion<HardPurgeRecord>(input, {
    action: "purge",
    targetType,
    routeKey: HARD_PURGE_ROUTE_KEY,
    confirmation: ["typed_name_step_up"],
    confirm: async (tx, row) => {
      const summary = row.payloadSummary as Record<string, unknown>;
      if (typeof summary.name !== "string" || input.typedName !== summary.name)
        throw new HTTPException(400, { message: "confirmation_mismatch" });
      const proof = await consumePendingActionProof(tx, {
        token: input.stepUpToken ?? "",
        personId: input.requesterPersonId,
        sessionId: input.sessionId,
        userId: input.userId,
        pendingActionId: row.id,
      });
      if (!proof) {
        await appendPendingActionStepUpAudit(tx, {
          action: "auth.step_up_denied",
          actorId: input.userId,
          personId: input.requesterPersonId,
          pendingActionId: row.id,
          traceId: input.traceId,
        });
        return {
          supplied: {},
          denied: input.stepUpToken
            ? ("step_up_expired" as const)
            : ("step_up_required" as const),
        };
      }
      await appendPendingActionStepUpAudit(tx, {
        action: "auth.step_up_consumed",
        actorId: input.userId,
        personId: input.requesterPersonId,
        pendingActionId: row.id,
        traceId: input.traceId,
      });
      return {
        supplied: { typedNameMatched: true, stepUp: true },
        stepUpTokenId: proof.id,
      };
    },
    summaryResult: safePurgeResult,
    execute: failOnExecutorError(async (tx, row) => {
      const targetId =
        row.targetIds.length === 1 ? row.targetIds[0] : undefined;
      if (!targetId)
        throw new HTTPException(409, {
          message: "pending_action_target_changed",
        });
      let record: HardPurgeRecord;
      try {
        let expectedOrganisationVersion:
          | { operationId: string; generation: number }
          | undefined;
        if (targetType === "organisation") {
          const versions = row.targetVersions;
          const encoded =
            versions && typeof versions === "object" && !Array.isArray(versions)
              ? (versions as Record<string, unknown>)[targetId]
              : undefined;
          if (typeof encoded !== "string")
            throw new HTTPException(409, {
              message: "pending_action_target_changed",
            });
          try {
            const decoded: unknown = JSON.parse(encoded);
            if (
              !decoded ||
              typeof decoded !== "object" ||
              Array.isArray(decoded) ||
              typeof (decoded as Record<string, unknown>).operationId !==
                "string" ||
              !Number.isSafeInteger(
                (decoded as Record<string, unknown>).generation,
              )
            )
              throw new Error("invalid organisation purge version");
            expectedOrganisationVersion = {
              operationId: (decoded as Record<string, unknown>)
                .operationId as string,
              generation: (decoded as Record<string, unknown>)
                .generation as number,
            };
          } catch {
            throw new HTTPException(409, {
              message: "pending_action_target_changed",
            });
          }
        }
        record = await executeHardPurge(
          tx,
          { targetType, targetId },
          expectedOrganisationVersion,
        );
      } catch (error) {
        if (error instanceof HardPurgeRefused)
          throw new HTTPException(409, {
            message: `hard_purge_${error.check.status}`,
          });
        throw error;
      }
      await appendAuditLog(tx, {
        actorId: input.requesterPersonId,
        actorType: "person",
        traceId: input.traceId,
        workspaceId: row.workspaceId,
        // The project target itself is removed in this transaction; keep the durable audit
        // workspace-scoped and identify the exact project in the event body.
        projectId: null,
        action: "hard_purge.executed",
        entityType: targetType,
        entityId: targetId,
        before: null,
        after: safePurgeResult(record),
      });
      return record;
    }),
    afterCommit: async (record) => {
      await removePurgedObjects(record.storageObjectKeys);
    },
  });
  const { executionResult: _executionResult, ...result } = approved;
  return result;
}
