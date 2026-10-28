import type {
  CalendarWindows,
  Holiday,
  SlaGoal,
  SlaMetric,
  SlaMetricState,
  SlaPause,
  SlaPolicy,
  SlaState,
} from "@taskdesk/domain";
import { computeSlaState } from "@taskdesk/domain";
import { inArray } from "drizzle-orm";
import type { Executor } from "../database/executor";
import { slaPauseTable } from "../database/migration-schema";
import {
  serviceCalendarTable,
  slaGoalTable,
  slaPolicyVersionTable,
} from "../database/schema";
import { projectsWithFeatureEnabled } from "../feature-flag/enforce";

/** What a list row's SLA badge needs (`VW-16`, `SLA-18`): one metric, its state and clock. */
export type WorkItemRowSla = {
  metric: SlaMetric;
  /** Never `none`: a row with no applicable goal has no badge at all. */
  state: Exclude<SlaState, "none">;
  dueAt: Date | null;
  remainingMinutes: number | null;
  consumedPct: number;
};

export type WorkItemRowSlaInput = {
  id: string;
  workspaceId: string;
  projectId: string;
  typeId: string | null;
  priority: string | null;
  slaPolicyVersionId: string | null;
  slaStartedAt: Date | null;
  createdAt: Date;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
};

type VersionRow = {
  id: string;
  workspaceId: string;
  calendarId: string;
  atRiskThresholdPct: number;
  effectiveFrom: Date | null;
};
type CalendarRow = {
  id: string;
  workspaceId: string;
  timezone: string;
  windows: unknown;
  holidays: unknown;
};
type GoalRow = SlaGoal & { workspaceId: string; versionId: string };
type PauseRow = {
  workItemId: string;
  metric: string;
  startedAt: Date;
  endedAt: Date | null;
  reason: string;
};

/** Worst first. A closed item that missed a goal outranks one that met it. */
const SEVERITY: Record<SlaState, number> = {
  breached: 5,
  at_risk: 4,
  missed: 3,
  ok: 2,
  met: 1,
  none: 0,
};

/**
 * The one metric a compact badge shows: the most severe state, resolution on a tie. `none`
 * for both metrics means no goal applies, so there is nothing to badge.
 */
export function pickBadgeMetric(
  metrics: readonly SlaMetricState[],
): SlaMetricState | undefined {
  let best: SlaMetricState | undefined;
  for (const metric of metrics) {
    if (metric.state === "none") continue;
    if (
      !best ||
      SEVERITY[metric.state] > SEVERITY[best.state] ||
      (SEVERITY[metric.state] === SEVERITY[best.state] &&
        metric.metric === "resolution")
    )
      best = metric;
  }
  return best;
}

/**
 * Pure half of the row SLA: evaluates every item against its pinned version with the same
 * `computeSlaState` the detail route uses (`SLA-5`: one implementation). An item with no
 * pinned policy, a missing or not-yet-effective version, or a missing calendar simply has no
 * badge: a list never fails because one row's policy cannot be read.
 */
export function buildRowSla(input: {
  items: readonly WorkItemRowSlaInput[];
  versions: readonly VersionRow[];
  calendars: readonly CalendarRow[];
  goals: readonly GoalRow[];
  pauses: readonly PauseRow[];
  now: Date;
}): Map<string, WorkItemRowSla> {
  const result = new Map<string, WorkItemRowSla>();
  const versionKey = (workspaceId: string, id: string) =>
    `${workspaceId}:${id}`;
  const versions = new Map(
    input.versions.map((row) => [versionKey(row.workspaceId, row.id), row]),
  );
  const calendars = new Map(
    input.calendars.map((row) => [versionKey(row.workspaceId, row.id), row]),
  );
  const goals = new Map<string, SlaGoal[]>();
  for (const goal of input.goals) {
    const key = versionKey(goal.workspaceId, goal.versionId);
    const list = goals.get(key) ?? [];
    list.push({
      metric: goal.metric,
      workItemTypeId: goal.workItemTypeId,
      priority: goal.priority,
      targetMinutes: goal.targetMinutes,
    });
    goals.set(key, list);
  }
  const pausesByItem = new Map<string, SlaPause[]>();
  for (const pause of [...input.pauses].sort(
    (left, right) => left.startedAt.getTime() - right.startedAt.getTime(),
  )) {
    const list = pausesByItem.get(pause.workItemId) ?? [];
    list.push({
      metric: pause.metric as SlaMetric,
      startedAt: pause.startedAt,
      endedAt: pause.endedAt,
      reason: pause.reason,
    });
    pausesByItem.set(pause.workItemId, list);
  }

  for (const item of input.items) {
    if (!item.slaPolicyVersionId) continue;
    const startedAt = item.slaStartedAt ?? item.createdAt;
    const version = versions.get(
      versionKey(item.workspaceId, item.slaPolicyVersionId),
    );
    if (
      !version?.effectiveFrom ||
      version.effectiveFrom.getTime() > startedAt.getTime()
    )
      continue;
    const calendar = calendars.get(
      versionKey(item.workspaceId, version.calendarId),
    );
    if (!calendar) continue;
    const policy: SlaPolicy = {
      calendar: {
        timezone: calendar.timezone,
        windows: calendar.windows as CalendarWindows,
        holidays: calendar.holidays as Holiday[],
      },
      atRiskThresholdPct: version.atRiskThresholdPct,
      goals: goals.get(versionKey(item.workspaceId, version.id)) ?? [],
    };
    let metrics: SlaMetricState[];
    try {
      metrics = computeSlaState(
        policy,
        {
          startedAt,
          firstResponseAt: item.firstResponseAt,
          resolvedAt: item.resolvedAt,
          pauses: pausesByItem.get(item.id) ?? [],
        },
        input.now,
        item.typeId,
        item.priority,
      );
    } catch {
      continue;
    }
    const badge = pickBadgeMetric(metrics);
    if (!badge) continue;
    result.set(item.id, {
      metric: badge.metric,
      // `pickBadgeMetric` never returns a `none` metric.
      state: badge.state as WorkItemRowSla["state"],
      dueAt: badge.dueAt,
      remainingMinutes: badge.remainingMinutes,
      consumedPct: badge.consumedPct,
    });
  }
  return result;
}

/**
 * The SLA badge facts for a page of rows, computed on read from the stored facts (ADR 0009;
 * the `work_item_sla_cache` is for the scan's edge detection and is never the answer). Four
 * bounded `IN` lookups for the whole page, however many rows it has, and none at all when no
 * row has a pinned policy version.
 */
export async function loadWorkItemRowSla(
  executor: Executor,
  items: readonly WorkItemRowSlaInput[],
  now: Date = new Date(),
): Promise<Map<string, WorkItemRowSla>> {
  const candidates = items.filter((item) => item.slaPolicyVersionId);
  if (candidates.length === 0) return new Map();
  // P4R1-M2 / P4R2-M2: no SLA badge while `feature.sla` is off for the item's project
  // (project override, workspace override, instance). One read for the whole page.
  const slaOn = await projectsWithFeatureEnabled(
    "feature.sla",
    candidates.map((item) => item.projectId),
    executor,
  );
  const pinned = candidates.filter((item) => slaOn.has(item.projectId));
  if (pinned.length === 0) return new Map();
  const versionIds = [
    ...new Set(pinned.flatMap((item) => item.slaPolicyVersionId ?? [])),
  ];
  const versions = await executor
    .select({
      id: slaPolicyVersionTable.id,
      workspaceId: slaPolicyVersionTable.workspaceId,
      calendarId: slaPolicyVersionTable.calendarId,
      atRiskThresholdPct: slaPolicyVersionTable.atRiskThresholdPct,
      effectiveFrom: slaPolicyVersionTable.effectiveFrom,
    })
    .from(slaPolicyVersionTable)
    .where(inArray(slaPolicyVersionTable.id, versionIds));
  if (versions.length === 0) return new Map();
  const [calendars, goals, pauses] = await Promise.all([
    executor
      .select({
        id: serviceCalendarTable.id,
        workspaceId: serviceCalendarTable.workspaceId,
        timezone: serviceCalendarTable.timezone,
        windows: serviceCalendarTable.windows,
        holidays: serviceCalendarTable.holidays,
      })
      .from(serviceCalendarTable)
      .where(
        inArray(serviceCalendarTable.id, [
          ...new Set(versions.map((version) => version.calendarId)),
        ]),
      ),
    executor
      .select({
        workspaceId: slaGoalTable.workspaceId,
        versionId: slaGoalTable.versionId,
        metric: slaGoalTable.metric,
        workItemTypeId: slaGoalTable.workItemTypeId,
        priority: slaGoalTable.priority,
        targetMinutes: slaGoalTable.targetMinutes,
      })
      .from(slaGoalTable)
      .where(inArray(slaGoalTable.versionId, versionIds)),
    executor
      .select({
        workItemId: slaPauseTable.workItemId,
        metric: slaPauseTable.metric,
        startedAt: slaPauseTable.startedAt,
        endedAt: slaPauseTable.endedAt,
        reason: slaPauseTable.reason,
      })
      .from(slaPauseTable)
      .where(
        inArray(
          slaPauseTable.workItemId,
          pinned.map((item) => item.id),
        ),
      ),
  ]);
  return buildRowSla({
    items: pinned,
    versions,
    calendars,
    goals: goals as GoalRow[],
    pauses,
    now,
  });
}
