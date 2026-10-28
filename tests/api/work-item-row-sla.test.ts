import type { SlaMetricState } from "@taskdesk/domain";
import { describe, expect, it } from "vitest";
import {
  buildRowSla,
  pickBadgeMetric,
  type WorkItemRowSlaInput,
} from "../../apps/api/src/work-item/row-sla";

const ALL_DAY = [{ from: 0, to: 1440 }];
const CALENDAR = {
  id: "cal-1",
  workspaceId: "ws-1",
  timezone: "UTC",
  windows: {
    sun: ALL_DAY,
    mon: ALL_DAY,
    tue: ALL_DAY,
    wed: ALL_DAY,
    thu: ALL_DAY,
    fri: ALL_DAY,
    sat: ALL_DAY,
  },
  holidays: [],
};
const VERSION = {
  id: "ver-1",
  workspaceId: "ws-1",
  calendarId: "cal-1",
  atRiskThresholdPct: 75,
  effectiveFrom: new Date("2026-01-01T00:00:00Z"),
};
const GOALS = [
  {
    workspaceId: "ws-1",
    versionId: "ver-1",
    metric: "resolution" as const,
    workItemTypeId: null,
    priority: null,
    targetMinutes: 600,
  },
];

function item(over: Partial<WorkItemRowSlaInput> = {}): WorkItemRowSlaInput {
  return {
    id: "wi-1",
    workspaceId: "ws-1",
    projectId: "p-1",
    typeId: "type-1",
    priority: "high",
    slaPolicyVersionId: "ver-1",
    slaStartedAt: new Date("2026-06-01T00:00:00Z"),
    createdAt: new Date("2026-06-01T00:00:00Z"),
    firstResponseAt: null,
    resolvedAt: null,
    ...over,
  };
}

function build(
  items: WorkItemRowSlaInput[],
  now: string,
  extra: Partial<Parameters<typeof buildRowSla>[0]> = {},
) {
  return buildRowSla({
    items,
    versions: [VERSION],
    calendars: [CALENDAR],
    goals: GOALS,
    pauses: [],
    now: new Date(now),
    ...extra,
  });
}

function metric(
  name: SlaMetricState["metric"],
  state: SlaMetricState["state"],
): SlaMetricState {
  return {
    metric: name,
    state,
    dueAt: null,
    targetMinutes: null,
    consumedMinutes: 0,
    consumedPct: 0,
    remainingMinutes: null,
  };
}

describe("pickBadgeMetric (VW-16)", () => {
  it("returns nothing when no goal applies", () => {
    expect(
      pickBadgeMetric([
        metric("first_response", "none"),
        metric("resolution", "none"),
      ]),
    ).toBeUndefined();
  });

  it("shows the most severe state, and resolution on a tie", () => {
    expect(
      pickBadgeMetric([
        metric("first_response", "breached"),
        metric("resolution", "ok"),
      ])?.metric,
    ).toBe("first_response");
    expect(
      pickBadgeMetric([
        metric("first_response", "ok"),
        metric("resolution", "ok"),
      ])?.metric,
    ).toBe("resolution");
    expect(
      pickBadgeMetric([
        metric("first_response", "missed"),
        metric("resolution", "met"),
      ])?.state,
    ).toBe("missed");
    expect(
      pickBadgeMetric([
        metric("first_response", "none"),
        metric("resolution", "at_risk"),
      ])?.state,
    ).toBe("at_risk");
  });
});

describe("buildRowSla (computed on read, never from the cache)", () => {
  it("evaluates an open item against its pinned version", () => {
    // 6 of 10 covered hours consumed: ok, four hours left.
    const sla = build([item()], "2026-06-01T06:00:00Z").get("wi-1");
    expect(sla).toMatchObject({
      metric: "resolution",
      state: "ok",
      remainingMinutes: 240,
    });
    expect(Math.round(sla?.consumedPct ?? 0)).toBe(60);
    expect(sla?.dueAt?.toISOString()).toBe("2026-06-01T10:00:00.000Z");
  });

  it("changes state as the clock moves, with the same stored facts", () => {
    const atRisk = build([item()], "2026-06-01T08:00:00Z").get("wi-1");
    expect(atRisk?.state).toBe("at_risk");
    const breached = build([item()], "2026-06-01T12:00:00Z").get("wi-1");
    expect(breached?.state).toBe("breached");
    expect(breached?.remainingMinutes).toBe(0);
  });

  it("reports a closed item as met or missed from resolved_at", () => {
    const met = build(
      [item({ resolvedAt: new Date("2026-06-01T05:00:00Z") })],
      "2026-06-09T00:00:00Z",
    ).get("wi-1");
    expect(met?.state).toBe("met");
    const missed = build(
      [item({ resolvedAt: new Date("2026-06-01T11:00:00Z") })],
      "2026-06-09T00:00:00Z",
    ).get("wi-1");
    expect(missed?.state).toBe("missed");
  });

  it("does not consume the clock while a pause is open", () => {
    const sla = build([item()], "2026-06-01T08:00:00Z", {
      pauses: [
        {
          workItemId: "wi-1",
          metric: "resolution",
          startedAt: new Date("2026-06-01T02:00:00Z"),
          endedAt: new Date("2026-06-01T06:00:00Z"),
          reason: "waiting_customer",
        },
      ],
    }).get("wi-1");
    // 8h elapsed minus a 4h pause = 4 of 10 hours: still ok.
    expect(sla?.state).toBe("ok");
    expect(sla?.remainingMinutes).toBe(360);
  });

  it("gives an item with no pinned policy no badge", () => {
    expect(
      build([item({ slaPolicyVersionId: null })], "2026-06-01T06:00:00Z").size,
    ).toBe(0);
  });

  it("gives no badge for a missing, not-yet-effective or cross-workspace version, and never throws", () => {
    expect(build([item()], "2026-06-01T06:00:00Z", { versions: [] }).size).toBe(
      0,
    );
    expect(
      build([item()], "2026-06-01T06:00:00Z", {
        versions: [
          { ...VERSION, effectiveFrom: new Date("2026-07-01T00:00:00Z") },
        ],
      }).size,
    ).toBe(0);
    expect(
      build([item({ workspaceId: "ws-other" })], "2026-06-01T06:00:00Z").size,
    ).toBe(0);
    expect(
      build([item()], "2026-06-01T06:00:00Z", { calendars: [] }).size,
    ).toBe(0);
  });

  it("gives no badge when no goal matches the item", () => {
    expect(build([item()], "2026-06-01T06:00:00Z", { goals: [] }).size).toBe(0);
  });

  it("evaluates every row of a page independently", () => {
    const result = build(
      [
        item({ id: "a" }),
        item({ id: "b", slaPolicyVersionId: null }),
        item({ id: "c", resolvedAt: new Date("2026-06-01T01:00:00Z") }),
      ],
      "2026-06-01T09:00:00Z",
    );
    expect([...result.keys()].sort()).toEqual(["a", "c"]);
    expect(result.get("a")?.state).toBe("at_risk");
    expect(result.get("c")?.state).toBe("met");
  });
});
