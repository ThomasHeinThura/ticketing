import { matchGoal, SLA_METRICS, type SlaGoal } from "@taskdesk/domain";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { appendAuditLog } from "../../audit/audit-writer";
import db from "../../database";
import {
  slaGoalTable,
  slaPauseTable,
  workItemTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import type { ActivityActorType } from "../activity";
import { recordWorkItemActivity } from "../activity";
import {
  assertProjectStillLive,
  assertWorkItemStillLive,
} from "../assert-work-item-live";
import { publishWorkItemHint, recordWorkItemEvent } from "../native-event";

type Operation = "pause" | "resume";

/** Manual SLA controls serialize on the same work-item row as workflow transitions. */
export async function changeManualSlaPause(input: {
  key: string;
  workspaceId: string;
  actorId: string;
  actorType: ActivityActorType;
  operation: Operation;
}) {
  const result = await db.transaction(async (tx) => {
    const [item] = await tx
      .select({
        id: workItemTable.id,
        workspaceId: workItemTable.workspaceId,
        typeId: workItemTable.typeId,
        priority: workItemTable.priority,
        firstResponseAt: workItemTable.firstResponseAt,
        resolvedAt: workItemTable.resolvedAt,
        slaPolicyVersionId: workItemTable.slaPolicyVersionId,
        projectId: workItemTable.projectId,
        deletedAt: workItemTable.deletedAt,
        archivedAt: workItemTable.archivedAt,
      })
      .from(workItemTable)
      .where(
        and(
          eq(workItemTable.key, input.key),
          eq(workItemTable.workspaceId, input.workspaceId),
          isNull(workItemTable.deletedAt),
          isNull(workItemTable.archivedAt),
        ),
      )
      .for("update");

    if (!item) throw new HTTPException(404, { message: "Work item not found" });
    assertWorkItemStillLive(item);
    await assertProjectStillLive(tx, item.projectId);
    if (!item.slaPolicyVersionId) {
      throw new HTTPException(409, {
        message: "No running SLA metric can be changed",
      });
    }

    const goals = (await tx
      .select({
        metric: slaGoalTable.metric,
        workItemTypeId: slaGoalTable.workItemTypeId,
        priority: slaGoalTable.priority,
        targetMinutes: slaGoalTable.targetMinutes,
      })
      .from(slaGoalTable)
      .where(
        and(
          eq(slaGoalTable.versionId, item.slaPolicyVersionId),
          eq(slaGoalTable.workspaceId, item.workspaceId),
        ),
      )) as SlaGoal[];

    const configuredMetrics = SLA_METRICS.filter(
      (metric) =>
        matchGoal({ goals }, metric, item.typeId, item.priority) !== null,
    );
    const runningMetrics = configuredMetrics.filter(
      (metric) =>
        (metric !== "first_response" || item.firstResponseAt === null) &&
        (metric !== "resolution" || item.resolvedAt === null),
    );

    if (configuredMetrics.length === 0) {
      throw new HTTPException(409, {
        message: "No running SLA metric can be changed",
      });
    }

    const openRows = await tx
      .select({
        metric: slaPauseTable.metric,
        reason: slaPauseTable.reason,
        startedAt: slaPauseTable.startedAt,
      })
      .from(slaPauseTable)
      .where(
        and(
          eq(slaPauseTable.workItemId, item.id),
          inArray(slaPauseTable.metric, configuredMetrics),
          isNull(slaPauseTable.endedAt),
        ),
      )
      .for("update");
    const now = new Date();

    if (input.operation === "pause") {
      if (runningMetrics.length === 0 || openRows.length > 0) {
        throw new HTTPException(409, {
          message: "An SLA metric is already paused",
        });
      }
      await tx.insert(slaPauseTable).values(
        runningMetrics.map((metric) => ({
          workItemId: item.id,
          metric,
          startedAt: now,
          reason: "manual" as const,
        })),
      );
    } else {
      const manualMetrics = openRows
        .filter((row) => row.reason === "manual")
        .map((row) => row.metric);
      if (manualMetrics.length === 0) {
        throw new HTTPException(409, {
          message: "No manually paused SLA metric can be resumed",
        });
      }
      await tx
        .update(slaPauseTable)
        .set({ endedAt: now })
        .where(
          and(
            eq(slaPauseTable.workItemId, item.id),
            inArray(slaPauseTable.metric, manualMetrics),
            eq(slaPauseTable.reason, "manual"),
            isNull(slaPauseTable.endedAt),
          ),
        );
    }

    const metricNames =
      input.operation === "pause"
        ? runningMetrics
        : openRows
            .filter((row) => row.reason === "manual")
            .map((row) => row.metric);
    const changedAt = now.toISOString();
    await recordWorkItemActivity(tx, [
      {
        workspaceId: item.workspaceId,
        workItemId: item.id,
        actorId: input.actorId,
        actorType: input.actorType,
        verb: "updated",
        field: "sla_pause",
        oldValue: input.operation === "pause" ? "running" : "paused",
        newValue: input.operation === "pause" ? "paused" : "running",
        payload: {
          metrics: metricNames,
          reason: "manual",
          ...(input.operation === "pause"
            ? { startedAt: changedAt }
            : { endedAt: changedAt }),
        },
      },
    ]);
    const changes = [
      {
        field: "sla_pause",
        from: input.operation === "pause" ? "running" : "paused",
        to: input.operation === "pause" ? "paused" : "running",
        visibility: "internal" as const,
      },
    ];
    await appendAuditLog(tx, {
      actorId: input.actorId,
      actorType: input.actorType,
      workspaceId: item.workspaceId,
      projectId: item.projectId,
      action: "work_item.updated",
      entityType: "work_item",
      entityId: item.id,
      before: {
        field: "sla_pause",
        metrics: metricNames,
        state: input.operation === "pause" ? "running" : "paused",
        ...(input.operation === "resume"
          ? {
              reason: "manual",
              startedAtByMetric: Object.fromEntries(
                openRows
                  .filter((row) => row.reason === "manual")
                  .map((row) => [row.metric, row.startedAt.toISOString()]),
              ),
            }
          : {}),
      },
      after: {
        field: "sla_pause",
        metrics: metricNames,
        state: input.operation === "pause" ? "paused" : "running",
        ...(input.operation === "pause"
          ? { reason: "manual", startedAt: changedAt }
          : { reason: "manual", endedAt: changedAt }),
      },
    });
    const event = await recordWorkItemEvent(tx, {
      kind: "work_item.updated",
      workItemId: item.id,
      key: input.key,
      workspaceId: item.workspaceId,
      projectId: item.projectId,
      actorId: input.actorId,
      actorType: input.actorType,
      customerVisible: false,
      payload: {
        key: input.key,
        url: `/agent/work-items/${encodeURIComponent(input.key)}`,
        changes,
      },
    });

    return {
      event,
      changes,
      metricNames,
      workspaceId: item.workspaceId,
      projectId: item.projectId,
      workItemId: item.id,
      key: input.key,
      changedAt: now,
    };
  });

  await publishEvent("work_item.updated", {
    workItemId: result.workItemId,
    key: result.key,
    workspaceId: result.workspaceId,
    projectId: result.projectId,
    changes: result.changes,
    actorId: input.actorId,
    actorType: input.actorType,
  });
  await publishWorkItemHint(result.event, {
    kind: "work_item.updated",
    key: result.key,
    projectId: result.projectId,
    customerVisible: false,
  });

  return {
    key: result.key,
    changedMetrics: result.metricNames,
    changedAt: result.changedAt,
  };
}
