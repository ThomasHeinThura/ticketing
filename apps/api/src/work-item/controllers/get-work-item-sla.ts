import { and, asc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db, { schema } from "../../database";
import { evaluatePinnedWorkItemSla } from "../../sla-policy/evaluation";

export async function getWorkItemSla(key: string, workspaceId: string) {
  const [item] = await db
    .select({
      id: schema.workItemTable.id,
      key: schema.workItemTable.key,
      workspaceId: schema.workItemTable.workspaceId,
      typeId: schema.workItemTable.typeId,
      priority: schema.workItemTable.priority,
      slaStartedAt: schema.workItemTable.slaStartedAt,
      slaPolicyVersionId: schema.workItemTable.slaPolicyVersionId,
      firstResponseAt: schema.workItemTable.firstResponseAt,
      resolvedAt: schema.workItemTable.resolvedAt,
      createdAt: schema.workItemTable.createdAt,
    })
    .from(schema.workItemTable)
    .where(
      and(
        eq(schema.workItemTable.key, key),
        eq(schema.workItemTable.workspaceId, workspaceId),
      ),
    )
    .limit(1);

  if (!item) throw new HTTPException(404, { message: "Work item not found" });

  const now = new Date();
  const startedAt = item.slaStartedAt ?? item.createdAt;
  const pauses = await db
    .select({
      metric: schema.slaPauseTable.metric,
      startedAt: schema.slaPauseTable.startedAt,
      endedAt: schema.slaPauseTable.endedAt,
      reason: schema.slaPauseTable.reason,
    })
    .from(schema.slaPauseTable)
    .where(eq(schema.slaPauseTable.workItemId, item.id))
    .orderBy(asc(schema.slaPauseTable.startedAt));
  const evaluation = await evaluatePinnedWorkItemSla({
    policyVersionId: item.slaPolicyVersionId,
    workspaceId: item.workspaceId,
    workItemTypeId: item.typeId,
    priority: item.priority,
    facts: {
      startedAt,
      firstResponseAt: item.firstResponseAt,
      resolvedAt: item.resolvedAt,
    },
    pauses,
    now,
  });

  return {
    key: item.key,
    startedAt,
    evaluatedAt: now,
    calendarName: evaluation.calendarName,
    metrics: evaluation.metrics.map((metric) => ({
      ...metric,
      pause: (() => {
        const pause = pauses.find(
          (candidate) =>
            candidate.metric === metric.metric && candidate.endedAt === null,
        );
        return pause
          ? { startedAt: pause.startedAt, reason: pause.reason }
          : null;
      })(),
    })),
  };
}
