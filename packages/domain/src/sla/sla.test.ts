/**
 * SLA computation tests — the suite `sla.md` § Testing calls "the most important
 * test suite in the product".
 *
 * All instants are constructed as explicit UTC dates; no test reads a clock. The
 * 8×5 calendar is Europe/London Mon–Fri 09:00–17:00; the 24×7 calendar is UTC
 * with full-day windows every weekday.
 */

import { describe, expect, it } from "vitest";
import type { ServiceCalendar } from "../calendar/types.js";
import {
  computeMetricState,
  computeSlaState,
  coveredMinutesMinusPauses,
  dueAtFor,
  matchGoal,
} from "./sla.js";
import type { SlaPause, SlaPolicy, SlaWorkItemFacts } from "./types.js";

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

/** Mon–Fri 09:00–17:00 Europe/London, no holidays. */
const CALENDAR_8X5: ServiceCalendar = {
  timezone: "Europe/London",
  windows: {
    mon: [{ from: 540, to: 1020 }],
    tue: [{ from: 540, to: 1020 }],
    wed: [{ from: 540, to: 1020 }],
    thu: [{ from: 540, to: 1020 }],
    fri: [{ from: 540, to: 1020 }],
  },
  holidays: [],
};

/** 24×7: every weekday fully covered, UTC. */
const CALENDAR_24X7: ServiceCalendar = {
  timezone: "UTC",
  windows: {
    sun: [{ from: 0, to: 1440 }],
    mon: [{ from: 0, to: 1440 }],
    tue: [{ from: 0, to: 1440 }],
    wed: [{ from: 0, to: 1440 }],
    thu: [{ from: 0, to: 1440 }],
    fri: [{ from: 0, to: 1440 }],
    sat: [{ from: 0, to: 1440 }],
  },
  holidays: [],
};

function policy(
  calendar: ServiceCalendar,
  targetMinutes: number,
  overrides: Partial<SlaPolicy> = {},
): SlaPolicy {
  return {
    calendar,
    atRiskThresholdPct: 75,
    goals: [
      {
        metric: "resolution",
        workItemTypeId: null,
        priority: null,
        targetMinutes,
      },
      {
        metric: "first_response",
        workItemTypeId: null,
        priority: null,
        targetMinutes: 60,
      },
    ],
    ...overrides,
  };
}

function facts(overrides: Partial<SlaWorkItemFacts> = {}): SlaWorkItemFacts {
  return {
    startedAt: new Date("2026-09-14T09:00:00Z"), // a Monday 09:00 UTC
    firstResponseAt: null,
    resolvedAt: null,
    pauses: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// matchGoal — specificity and filtering.
// ---------------------------------------------------------------------------

describe("matchGoal", () => {
  it("returns null when no goal matches the metric", () => {
    const p = policy(CALENDAR_8X5, 240, { goals: [] });
    expect(matchGoal(p, "resolution", null, null)).toBeNull();
  });

  it("prefers an exact type+priority match over wildcards", () => {
    const p = policy(CALENDAR_8X5, 240, {
      goals: [
        {
          metric: "resolution",
          workItemTypeId: null,
          priority: null,
          targetMinutes: 480,
        },
        {
          metric: "resolution",
          workItemTypeId: "t1",
          priority: "P1",
          targetMinutes: 60,
        },
      ],
    });
    const goal = matchGoal(p, "resolution", "t1", "P1");
    expect(goal?.targetMinutes).toBe(60);
  });

  it("prefers an exact type match over an exact priority match", () => {
    const p = policy(CALENDAR_8X5, 240, {
      goals: [
        {
          metric: "resolution",
          workItemTypeId: null,
          priority: "P1",
          targetMinutes: 120,
        },
        {
          metric: "resolution",
          workItemTypeId: "t1",
          priority: null,
          targetMinutes: 90,
        },
      ],
    });
    expect(matchGoal(p, "resolution", "t1", "P1")?.targetMinutes).toBe(90);
  });

  it("excludes goals whose type or priority does not match", () => {
    const p = policy(CALENDAR_8X5, 240, {
      goals: [
        {
          metric: "resolution",
          workItemTypeId: "t1",
          priority: null,
          targetMinutes: 60,
        },
      ],
    });
    expect(matchGoal(p, "resolution", "t2", null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// coveredMinutesMinusPauses — SLA-12.
// ---------------------------------------------------------------------------

describe("coveredMinutesMinusPauses", () => {
  it("counts covered minutes inside one 8×5 day", () => {
    const p = policy(CALENDAR_8X5, 480);
    const from = new Date("2026-09-14T09:00:00Z"); // Mon 09:00 UTC = 10:00 BST
    const to = new Date("2026-09-14T13:00:00Z"); // Mon 13:00 UTC = 14:00 BST
    // 4 wall hours, all inside the 09:00–17:00 local window.
    expect(coveredMinutesMinusPauses(p, from, to, [])).toBe(240);
  });

  it("subtracts a pause's covered minutes only (SLA-12)", () => {
    const p = policy(CALENDAR_8X5, 480);
    const from = new Date("2026-09-14T09:00:00Z");
    const to = new Date("2026-09-14T13:00:00Z");
    const pauses: SlaPause[] = [
      {
        metric: "resolution",
        startedAt: new Date("2026-09-14T10:00:00Z"),
        endedAt: new Date("2026-09-14T11:00:00Z"),
        reason: "waiting_customer",
      },
    ];
    expect(coveredMinutesMinusPauses(p, from, to, pauses)).toBe(180);
  });

  it("a pause spanning a weekend subtracts only covered minutes", () => {
    const p = policy(CALENDAR_8X5, 480);
    // Friday 16:00 UTC → Monday 09:00 UTC, pause over the whole weekend.
    const from = new Date("2026-09-18T16:00:00Z"); // Fri
    const to = new Date("2026-09-21T09:00:00Z"); // Mon
    const pauses: SlaPause[] = [
      {
        metric: "resolution",
        startedAt: new Date("2026-09-18T16:00:00Z"),
        endedAt: new Date("2026-09-21T09:00:00Z"),
        reason: "waiting_customer",
      },
    ];
    // Friday 16:00 UTC = 17:00 BST — the window ends at 17:00 local, so zero
    // covered minutes before the weekend; the weekend itself is uncovered.
    expect(coveredMinutesMinusPauses(p, from, to, pauses)).toBe(0);
  });

  it("an open pause runs to `to`", () => {
    const p = policy(CALENDAR_8X5, 480);
    const from = new Date("2026-09-14T09:00:00Z");
    const to = new Date("2026-09-14T13:00:00Z");
    const pauses: SlaPause[] = [
      {
        metric: "resolution",
        startedAt: new Date("2026-09-14T10:00:00Z"),
        endedAt: null,
        reason: "waiting_customer",
      },
    ];
    expect(coveredMinutesMinusPauses(p, from, to, pauses)).toBe(60);
  });

  it("overlapping pauses never double-subtract", () => {
    const p = policy(CALENDAR_8X5, 480);
    const from = new Date("2026-09-14T09:00:00Z");
    const to = new Date("2026-09-14T13:00:00Z");
    const pauses: SlaPause[] = [
      {
        metric: "resolution",
        startedAt: new Date("2026-09-14T10:00:00Z"),
        endedAt: new Date("2026-09-14T12:00:00Z"),
        reason: "manual",
      },
      {
        metric: "resolution",
        startedAt: new Date("2026-09-14T11:00:00Z"),
        endedAt: new Date("2026-09-14T12:30:00Z"),
        reason: "waiting_customer",
      },
    ];
    // Union of pauses is 10:00–12:30 = 150 covered minutes; 240 − 150 = 90.
    expect(coveredMinutesMinusPauses(p, from, to, pauses)).toBe(90);
  });
});

// ---------------------------------------------------------------------------
// dueAtFor — SLA-4, SLA-5, SLA-6, and the outside-cover edge case.
// ---------------------------------------------------------------------------

describe("dueAtFor", () => {
  it("24×7: covered time equals wall-clock time (SLA-6)", () => {
    const p = policy(CALENDAR_24X7, 240);
    const from = new Date("2026-09-14T09:00:00Z");
    expect(dueAtFor(p, from, 240, [])?.getTime()).toBe(
      new Date("2026-09-14T13:00:00Z").getTime(),
    );
  });

  it("8×5 raised Friday late afternoon is due Monday (the spec's own example)", () => {
    const p = policy(CALENDAR_8X5, 240); // 4-hour target
    // Friday 2026-09-18 16:00 UTC = 17:00 BST — the window's final minute.
    const from = new Date("2026-09-18T16:00:00Z");
    // Monday's 09:00–17:00 BST window = 08:00–16:00 UTC; 4 covered hours from
    // its 09:00 BST open → due 13:00 BST = 12:00 UTC Monday 2026-09-21.
    expect(dueAtFor(p, from, 240, [])?.getTime()).toBe(
      new Date("2026-09-21T12:00:00Z").getTime(),
    );
  });

  it("created outside covered hours: the clock starts at the next window opening", () => {
    const p = policy(CALENDAR_8X5, 60);
    // Saturday — no cover until Monday 09:00 local (08:00 UTC in September BST).
    const from = new Date("2026-09-19T12:00:00Z");
    expect(dueAtFor(p, from, 60, [])?.getTime()).toBe(
      new Date("2026-09-21T09:00:00Z").getTime(),
    );
  });

  it("a closed pause defers the due instant past its end", () => {
    const p = policy(CALENDAR_8X5, 120);
    const from = new Date("2026-09-14T09:00:00Z"); // Mon 10:00 BST
    const pauses: SlaPause[] = [
      {
        metric: "resolution",
        startedAt: new Date("2026-09-14T10:00:00Z"),
        endedAt: new Date("2026-09-14T11:00:00Z"),
        reason: "waiting_customer",
      },
    ];
    // 2 covered hours from 10:00 BST with 1 hour paused → 13:00 BST = 12:00 UTC.
    expect(dueAtFor(p, from, 120, pauses)?.getTime()).toBe(
      new Date("2026-09-14T12:00:00Z").getTime(),
    );
  });

  it("an open pause means no due instant yet", () => {
    const p = policy(CALENDAR_8X5, 120);
    const from = new Date("2026-09-14T09:00:00Z");
    const pauses: SlaPause[] = [
      {
        metric: "resolution",
        startedAt: new Date("2026-09-14T10:00:00Z"),
        endedAt: null,
        reason: "waiting_customer",
      },
    ];
    expect(dueAtFor(p, from, 120, pauses)).toBeNull();
  });

  it("a zero-cover calendar never opens", () => {
    const p = policy({ timezone: "UTC", windows: {}, holidays: [] }, 60);
    expect(dueAtFor(p, new Date("2026-09-14T09:00:00Z"), 60, [])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeMetricState — the six states, boundaries to the minute.
// ---------------------------------------------------------------------------

describe("computeMetricState", () => {
  it("no matching goal yields none (SLA-2)", () => {
    const p = policy(CALENDAR_8X5, 240, { goals: [] });
    const s = computeMetricState(
      p,
      facts(),
      "resolution",
      new Date("2026-09-14T10:00:00Z"),
    );
    expect(s.state).toBe("none");
    expect(s.targetMinutes).toBeNull();
    expect(s.dueAt).toBeNull();
  });

  it("ok under the at-risk threshold", () => {
    const p = policy(CALENDAR_8X5, 240);
    // 60 of 240 covered minutes = 25%.
    const s = computeMetricState(
      p,
      facts(),
      "resolution",
      new Date("2026-09-14T10:00:00Z"),
    );
    expect(s.state).toBe("ok");
    expect(s.consumedMinutes).toBe(60);
  });

  it("at_risk at exactly the threshold (75%)", () => {
    const p = policy(CALENDAR_8X5, 240);
    // 180 of 240 = 75% — the boundary, to the minute.
    const s = computeMetricState(
      p,
      facts(),
      "resolution",
      new Date("2026-09-14T12:00:00Z"),
    );
    expect(s.state).toBe("at_risk");
  });

  it("breached past 100%", () => {
    const p = policy(CALENDAR_8X5, 240);
    const s = computeMetricState(
      p,
      facts(),
      "resolution",
      new Date("2026-09-14T14:00:00Z"), // 300 of 240 covered minutes
    );
    expect(s.state).toBe("breached");
  });

  it("met when resolved within target (SLA-8)", () => {
    const p = policy(CALENDAR_8X5, 240);
    const s = computeMetricState(
      p,
      facts({ resolvedAt: new Date("2026-09-14T12:00:00Z") }),
      "resolution",
      new Date("2026-09-15T09:00:00Z"),
    );
    expect(s.state).toBe("met");
  });

  it("missed when resolved after target", () => {
    const p = policy(CALENDAR_8X5, 240);
    const s = computeMetricState(
      p,
      facts({ resolvedAt: new Date("2026-09-14T14:00:00Z") }),
      "resolution",
      new Date("2026-09-15T09:00:00Z"),
    );
    expect(s.state).toBe("missed");
  });

  it("first_response stops at first_response_at (SLA-7)", () => {
    const p = policy(CALENDAR_8X5, 240);
    const s = computeMetricState(
      p,
      facts({ firstResponseAt: new Date("2026-09-14T09:30:00Z") }),
      "first_response",
      new Date("2026-09-15T09:00:00Z"),
    );
    expect(s.state).toBe("met");
    expect(s.consumedMinutes).toBe(30);
  });

  it("a configurable at-risk threshold is honoured (the review's fix)", () => {
    const p = policy(CALENDAR_8X5, 240, { atRiskThresholdPct: 50 });
    // 120 of 240 = 50% — at_risk under the raised threshold, ok at the default.
    const s = computeMetricState(
      p,
      facts(),
      "resolution",
      new Date("2026-09-14T11:00:00Z"),
    );
    expect(s.state).toBe("at_risk");
  });

  it("an open pause freezes the state and defers dueAt (SLA-13)", () => {
    const p = policy(CALENDAR_8X5, 240);
    const pauses: SlaPause[] = [
      {
        metric: "resolution",
        startedAt: new Date("2026-09-14T10:00:00Z"),
        endedAt: null,
        reason: "waiting_customer",
      },
    ];
    const s = computeMetricState(
      p,
      facts({ pauses }),
      "resolution",
      new Date("2026-09-18T16:00:00Z"), // days later — consumed must not advance
    );
    expect(s.consumedMinutes).toBe(60); // frozen at the pause's start
    expect(s.dueAt).toBeNull();
    expect(s.state).toBe("ok");
  });

  it("a holiday inside the range is not covered", () => {
    const cal: ServiceCalendar = {
      ...CALENDAR_8X5,
      holidays: [{ date: "2026-09-15", name: "Test holiday" }], // Tuesday
    };
    const p = policy(cal, 480);
    // Monday 2026-09-14 09:00 UTC = 10:00 BST → Monday contributes
    // 10:00–17:00 BST = 420; Tuesday is a holiday → 0; Wednesday 09:00 UTC
    // = 10:00 BST → its 09:00–17:00 window contributes 60 by now.
    // 420 + 0 + 60 = 480; without the holiday Tuesday would add 480 more.
    const s = computeMetricState(
      p,
      facts(),
      "resolution",
      new Date("2026-09-16T09:00:00Z"),
    );
    expect(s.consumedMinutes).toBe(480);
  });
});

// ---------------------------------------------------------------------------
// computeSlaState — both metrics.
// ---------------------------------------------------------------------------

describe("computeSlaState", () => {
  it("returns both metrics", () => {
    const p = policy(CALENDAR_8X5, 240);
    const states = computeSlaState(
      p,
      facts(),
      new Date("2026-09-14T10:00:00Z"),
    );
    expect(states.map((s) => s.metric)).toEqual([
      "first_response",
      "resolution",
    ]);
  });

  it("reopen after completion resumes rather than restarts (SLA-9)", () => {
    const p = policy(CALENDAR_8X5, 240);
    // Resolved, then reopened — resolvedAt cleared. Consumed continues from the
    // pre-resolution total, not from 0.
    const s = computeMetricState(
      p,
      facts({ resolvedAt: null }), // reopened: the row's resolvedAt was cleared
      "resolution",
      new Date("2026-09-15T10:00:00Z"), // Tuesday 10:00 UTC = 11:00 BST
    );
    // Monday 10:00–17:00 BST = 420 min; Tuesday's 09:00–17:00 BST window has
    // run 09:00–11:00 BST by now = 120 min → 540 total.
    expect(s.consumedMinutes).toBe(540);
  });
});
