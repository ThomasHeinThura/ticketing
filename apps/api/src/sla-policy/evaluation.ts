import type {
  CalendarWindows,
  Holiday,
  SlaMetricState,
  SlaPolicy,
  SlaWorkItemFacts,
} from "@taskdesk/domain";
import { computeSlaState, SLA_METRICS } from "@taskdesk/domain";
import { asc, eq } from "drizzle-orm";
import db from "../database";
import type { Transaction } from "../database/executor";
import { slaPauseTable } from "../database/migration-schema";
import { workItemTable } from "../database/schema";
import {
  getCalendarForEvaluation,
  getPinnedVersionForEvaluation,
  listGoalsForEvaluation,
} from "./repository";

type SlaCalendarEvaluationInput = {
  timezone: string;
  windows: unknown;
  holidays: unknown;
};

/** Evaluate the version persisted on the work item, against its live calendar. */
export async function evaluatePinnedWorkItemSla(
  input: {
    policyVersionId: string | null;
    workspaceId: string;
    workItemTypeId: string | null;
    priority: string | null;
    facts: SlaWorkItemFacts;
    now: Date;
  },
  executor: Pick<typeof db, "select"> = db,
): Promise<SlaMetricState[]> {
  if (!input.policyVersionId) {
    return SLA_METRICS.map((metric) => ({
      metric,
      state: "none",
      dueAt: null,
      targetMinutes: null,
      consumedMinutes: 0,
      consumedPct: 0,
      remainingMinutes: null,
    }));
  }

  const [version] = await getPinnedVersionForEvaluation(
    input.policyVersionId,
    input.workspaceId,
    executor,
  );

  if (
    !version?.effectiveFrom ||
    version.effectiveFrom.getTime() > input.facts.startedAt.getTime()
  ) {
    throw new Error(
      "Work item references a missing or unpublished SLA version",
    );
  }

  const calendars: SlaCalendarEvaluationInput[] =
    await getCalendarForEvaluation(
      version.calendarId,
      input.workspaceId,
      executor,
    );
  const [calendar] = calendars;

  if (!calendar) {
    throw new Error(
      "Published SLA policy version references a missing calendar",
    );
  }

  const goals = await listGoalsForEvaluation(
    input.workspaceId,
    version.id,
    executor,
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

  return computeSlaState(
    policy,
    input.facts,
    input.now,
    input.workItemTypeId,
    input.priority,
  );
}

/** Caller holds the item lock: policy, pauses and completion facts share its transaction. */
export async function evaluateStoredWorkItemSla(
  tx: Transaction,
  itemId: string,
  now: Date,
) {
  const [item] = await tx
    .select()
    .from(workItemTable)
    .where(eq(workItemTable.id, itemId));
  if (!item) throw new Error("Work item disappeared while evaluating SLA");
  const pauses = await tx
    .select()
    .from(slaPauseTable)
    .where(eq(slaPauseTable.workItemId, itemId))
    .orderBy(asc(slaPauseTable.startedAt));
  const metrics = await evaluatePinnedWorkItemSla(
    {
      policyVersionId: item.slaPolicyVersionId,
      workspaceId: item.workspaceId,
      workItemTypeId: item.typeId,
      priority: item.priority,
      facts: {
        startedAt: item.slaStartedAt ?? item.createdAt,
        firstResponseAt: item.firstResponseAt,
        resolvedAt: item.resolvedAt,
        pauses: pauses as SlaWorkItemFacts["pauses"],
      },
      now,
    },
    tx,
  );
  return { item, metrics };
}
