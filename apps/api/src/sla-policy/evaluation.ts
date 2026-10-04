import type {
  CalendarWindows,
  Holiday,
  SlaMetricState,
  SlaPause,
  SlaPolicy,
  SlaWorkItemFacts,
} from "@taskdesk/domain";
import { computeSlaState, SLA_METRICS } from "@taskdesk/domain";
import { and, eq } from "drizzle-orm";
import db, { schema } from "../database";

/** Evaluate the version persisted on the work item, against its live calendar. */
export async function evaluatePinnedWorkItemSla(input: {
  policyVersionId: string | null;
  workspaceId: string;
  workItemTypeId: string | null;
  priority: string | null;
  facts: Omit<SlaWorkItemFacts, "pauses">;
  pauses: SlaPause[];
  now: Date;
}): Promise<{ metrics: SlaMetricState[]; calendarName: string | null }> {
  if (!input.policyVersionId) {
    return {
      metrics: SLA_METRICS.map((metric) => ({
        metric,
        state: "none",
        dueAt: null,
        targetMinutes: null,
        consumedMinutes: 0,
        consumedPct: 0,
        remainingMinutes: null,
      })),
      calendarName: null,
    };
  }

  const [version] = await db
    .select({
      id: schema.slaPolicyVersionTable.id,
      calendarId: schema.slaPolicyVersionTable.calendarId,
      atRiskThresholdPct: schema.slaPolicyVersionTable.atRiskThresholdPct,
      effectiveFrom: schema.slaPolicyVersionTable.effectiveFrom,
    })
    .from(schema.slaPolicyVersionTable)
    .where(
      and(
        eq(schema.slaPolicyVersionTable.id, input.policyVersionId),
        eq(schema.slaPolicyVersionTable.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);

  if (
    !version?.effectiveFrom ||
    version.effectiveFrom.getTime() > input.facts.startedAt.getTime()
  ) {
    throw new Error(
      "Work item references a missing or unpublished SLA version",
    );
  }

  const [calendar] = await db
    .select({
      name: schema.serviceCalendarTable.name,
      timezone: schema.serviceCalendarTable.timezone,
      windows: schema.serviceCalendarTable.windows,
      holidays: schema.serviceCalendarTable.holidays,
    })
    .from(schema.serviceCalendarTable)
    .where(
      and(
        eq(schema.serviceCalendarTable.id, version.calendarId),
        eq(schema.serviceCalendarTable.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);

  if (!calendar) {
    throw new Error(
      "Published SLA policy version references a missing calendar",
    );
  }

  const goals = await db
    .select({
      metric: schema.slaGoalTable.metric,
      workItemTypeId: schema.slaGoalTable.workItemTypeId,
      priority: schema.slaGoalTable.priority,
      targetMinutes: schema.slaGoalTable.targetMinutes,
    })
    .from(schema.slaGoalTable)
    .where(
      and(
        eq(schema.slaGoalTable.workspaceId, input.workspaceId),
        eq(schema.slaGoalTable.versionId, version.id),
      ),
    );

  const policy: SlaPolicy = {
    calendar: {
      timezone: calendar.timezone,
      windows: calendar.windows as CalendarWindows,
      holidays: calendar.holidays as Holiday[],
    },
    atRiskThresholdPct: version.atRiskThresholdPct,
    goals,
  };

  return {
    metrics: computeSlaState(
      policy,
      { ...input.facts, pauses: input.pauses },
      input.now,
      input.workItemTypeId,
      input.priority,
    ),
    calendarName: calendar.name,
  };
}
