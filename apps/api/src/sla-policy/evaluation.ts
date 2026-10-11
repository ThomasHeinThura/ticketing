import type {
  CalendarWindows,
  Holiday,
  SlaMetricState,
  SlaPolicy,
  SlaWorkItemFacts,
} from "@taskdesk/domain";
import { computeSlaState, SLA_METRICS } from "@taskdesk/domain";
import {
  getCalendarForEvaluation,
  getPinnedVersionForEvaluation,
  listGoalsForEvaluation,
} from "./repository";

/** Evaluate the version persisted on the work item, against its live calendar. */
export async function evaluatePinnedWorkItemSla(input: {
  policyVersionId: string | null;
  workspaceId: string;
  workItemTypeId: string | null;
  priority: string | null;
  facts: SlaWorkItemFacts;
  now: Date;
}): Promise<SlaMetricState[]> {
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
  );

  if (
    !version?.effectiveFrom ||
    version.effectiveFrom.getTime() > input.facts.startedAt.getTime()
  ) {
    throw new Error(
      "Work item references a missing or unpublished SLA version",
    );
  }

  const [calendar] = await getCalendarForEvaluation(
    version.calendarId,
    input.workspaceId,
  );

  if (!calendar) {
    throw new Error(
      "Published SLA policy version references a missing calendar",
    );
  }

  const goals = await listGoalsForEvaluation(input.workspaceId, version.id);

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
