import type { SlaMetric } from "@taskdesk/domain";
import { and, asc, eq, isNull } from "drizzle-orm";
import db, { schema } from "../database";
import { slaPauseTable } from "../database/migration-schema";
import { evaluatePinnedWorkItemSla } from "../sla-policy/evaluation";

/**
 * SLA-21: the customer-safe SLA projection on a requester's own work item. Exactly two
 * fields, a coarse state and the due instant of the resolution target. Policy identity,
 * thresholds, minutes, percentages, the calendar, pause intervals and pause reasons are
 * never part of it: pauses still shape the evaluated state and due instant, but nothing
 * about them is exposed.
 */
export type PortalSla = {
  state: "on_track" | "at_risk" | "breached" | "met" | "missed";
  dueAt: string | null;
};

const STATE_LABEL = {
  ok: "on_track",
  at_risk: "at_risk",
  breached: "breached",
  met: "met",
  missed: "missed",
} as const satisfies Record<string, PortalSla["state"]>;

/**
 * The caller has already proven the work item is the requester's own (the portal detail
 * query filters on `requester_id`). Returns `null` when no SLA applies or the policy
 * cannot be evaluated, so a configuration problem never fails the customer's page.
 */
export async function loadPortalSla(
  workItemId: string,
  requesterId: string,
  now: Date = new Date(),
): Promise<PortalSla | null> {
  const [item] = await db
    .select({
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
        eq(schema.workItemTable.id, workItemId),
        eq(schema.workItemTable.requesterId, requesterId),
        isNull(schema.workItemTable.deletedAt),
      ),
    )
    .limit(1);
  if (!item?.slaPolicyVersionId) return null;
  try {
    const pauses = await db
      .select({
        metric: slaPauseTable.metric,
        startedAt: slaPauseTable.startedAt,
        endedAt: slaPauseTable.endedAt,
        reason: slaPauseTable.reason,
      })
      .from(slaPauseTable)
      .where(eq(slaPauseTable.workItemId, workItemId))
      .orderBy(asc(slaPauseTable.startedAt));
    const metrics = await evaluatePinnedWorkItemSla({
      policyVersionId: item.slaPolicyVersionId,
      workspaceId: item.workspaceId,
      workItemTypeId: item.typeId,
      priority: item.priority,
      facts: {
        startedAt: item.slaStartedAt ?? item.createdAt,
        firstResponseAt: item.firstResponseAt,
        resolvedAt: item.resolvedAt,
        pauses: pauses.map((pause) => ({
          ...pause,
          metric: pause.metric as SlaMetric,
        })),
      },
      now,
    });
    const resolution = metrics.find((metric) => metric.metric === "resolution");
    if (!resolution || resolution.state === "none") return null;
    return {
      state: STATE_LABEL[resolution.state],
      dueAt: resolution.dueAt ? resolution.dueAt.toISOString() : null,
    };
  } catch {
    return null;
  }
}
