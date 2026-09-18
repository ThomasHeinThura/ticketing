import { describe, expect, it } from "vitest";
import type { ServiceCalendar } from "../calendar/types.js";
import {
  canClosePause,
  isAutomaticPause,
  pinPolicyVersion,
  resolveSlaPolicy,
  scanEventForTransition,
  validateOpenPause,
} from "./policy.js";
import type { SlaPause, SlaPolicy, SlaPolicyVersion } from "./types.js";

const CALENDAR: ServiceCalendar = {
  timezone: "UTC",
  windows: { mon: [{ from: 0, to: 1440 }] },
  holidays: [],
};

function policy(targetMinutes: number): SlaPolicy {
  return {
    calendar: CALENDAR,
    atRiskThresholdPct: 75,
    goals: [
      {
        metric: "resolution",
        workItemTypeId: null,
        priority: null,
        targetMinutes,
      },
    ],
  };
}

function version(
  number: number,
  effectiveFrom: string,
  targetMinutes = 480,
): SlaPolicyVersion {
  return {
    number,
    effectiveFrom: new Date(effectiveFrom),
    calendar: CALENDAR,
    atRiskThresholdPct: 75,
    goals: [
      {
        metric: "resolution",
        workItemTypeId: null,
        priority: null,
        targetMinutes,
      },
    ],
  };
}

describe("resolveSlaPolicy — SLA-1's four levels, first match wins", () => {
  it("prefers the work item type override over everything", () => {
    const type = policy(60);
    const ws = policy(480);
    expect(
      resolveSlaPolicy({
        workItemType: type,
        requestType: policy(120),
        project: policy(240),
        workspaceDefault: ws,
      }),
    ).toBe(type);
  });

  it("falls through to request type, then project, then workspace default", () => {
    const requestType = policy(120);
    const project = policy(240);
    const ws = policy(480);
    expect(
      resolveSlaPolicy({
        workItemType: null,
        requestType,
        project,
        workspaceDefault: ws,
      }),
    ).toBe(requestType);
    expect(
      resolveSlaPolicy({
        workItemType: null,
        requestType: null,
        project,
        workspaceDefault: ws,
      }),
    ).toBe(project);
    expect(
      resolveSlaPolicy({
        workItemType: null,
        requestType: null,
        project: null,
        workspaceDefault: ws,
      }),
    ).toBe(ws);
  });

  it("returns null when no source has a policy (SLA-2 → none)", () => {
    expect(
      resolveSlaPolicy({
        workItemType: null,
        requestType: null,
        project: null,
        workspaceDefault: null,
      }),
    ).toBeNull();
  });
});

describe("pinPolicyVersion — SLA-3's pin-at-creation", () => {
  it("pins the version effective at creation", () => {
    const v1 = version(1, "2026-01-01T00:00:00Z");
    const v2 = version(2, "2026-06-01T00:00:00Z");
    expect(
      pinPolicyVersion([v1, v2], new Date("2026-03-15T00:00:00Z")),
    ).toBe(v1);
    expect(
      pinPolicyVersion([v1, v2], new Date("2026-07-01T00:00:00Z")),
    ).toBe(v2);
  });

  it("pins at the exact effective_from instant (inclusive)", () => {
    const v1 = version(1, "2026-01-01T00:00:00Z");
    const v2 = version(2, "2026-06-01T00:00:00Z");
    expect(
      pinPolicyVersion([v1, v2], new Date("2026-06-01T00:00:00Z")),
    ).toBe(v2);
  });

  it("returns null when the policy's first version went live after creation", () => {
    const v1 = version(1, "2026-06-01T00:00:00Z");
    expect(pinPolicyVersion([v1], new Date("2026-03-15T00:00:00Z"))).toBeNull();
  });

  it("changing a policy later never rewrites the pin (SLA-3's sentence, as behaviour)", () => {
    const v1 = version(1, "2026-01-01T00:00:00Z", 240);
    const v2 = version(2, "2026-06-01T00:00:00Z", 60);
    const pinnedAtCreation = pinPolicyVersion(
      [v1, v2],
      new Date("2026-03-15T00:00:00Z"),
    );
    // Even after v2 exists, the pin for the March item is still v1.
    expect(pinnedAtCreation).toBe(v1);
    expect(pinnedAtCreation?.goals[0]?.targetMinutes).toBe(240);
  });
});

describe("validateOpenPause — SLA-11's one-open-row and 409 rules", () => {
  const openAutomatic: SlaPause = {
    metric: "resolution",
    startedAt: new Date("2026-09-14T10:00:00Z"),
    endedAt: null,
    reason: "waiting_customer",
  };
  const openManual: SlaPause = {
    ...openAutomatic,
    reason: "manual",
  };

  it("allows an open when the metric has none", () => {
    expect(validateOpenPause([], "resolution", "manual")).toBeNull();
    expect(validateOpenPause([], "resolution", "waiting_customer")).toBeNull();
  });

  it("ignores open pauses of OTHER metrics (the row is per metric)", () => {
    const otherMetric: SlaPause = {
      ...openAutomatic,
      metric: "first_response",
    };
    expect(validateOpenPause([otherMetric], "resolution", "manual")).toBeNull();
  });

  it("refuses a manual pause over an automatic one as the named 409 case", () => {
    expect(
      validateOpenPause([openAutomatic], "resolution", "manual"),
    ).toBe("manual_over_automatic");
  });

  it("refuses any other second open (uniqueness) as pause_already_open", () => {
    expect(
      validateOpenPause([openAutomatic], "resolution", "waiting_customer"),
    ).toBe("pause_already_open");
    expect(validateOpenPause([openManual], "resolution", "manual")).toBe(
      "pause_already_open",
    );
    expect(
      validateOpenPause([openManual], "resolution", "waiting_customer"),
    ).toBe("pause_already_open");
  });

  it("isAutomaticPause knows the transition-effect reasons", () => {
    expect(isAutomaticPause("waiting_customer")).toBe(true);
    expect(isAutomaticPause("resolved")).toBe(true);
    expect(isAutomaticPause("manual")).toBe(false);
  });
});

describe("canClosePause — an automatic close never closes a manual pause", () => {
  it("an automatic close closes its own automatic row", () => {
    expect(canClosePause("waiting_customer", "waiting_customer")).toBe(true);
    expect(canClosePause("resolved", "resolved")).toBe(true);
  });

  it("an automatic close does NOT close a manual pause", () => {
    expect(canClosePause("manual", "waiting_customer")).toBe(false);
    expect(canClosePause("manual", "resolved")).toBe(false);
  });

  it("a manual close closes whatever open row exists", () => {
    expect(canClosePause("manual", "manual")).toBe(true);
    expect(canClosePause("waiting_customer", "manual")).toBe(true);
  });
});

describe("scanEventForTransition — SLA-15's once-each edge rule", () => {
  it("fires on the transition INTO at_risk and breached", () => {
    expect(scanEventForTransition("ok", "at_risk")).toBe("sla.at_risk");
    expect(scanEventForTransition("at_risk", "breached")).toBe("sla.breached");
    expect(scanEventForTransition("ok", "breached")).toBe("sla.breached");
  });

  it("is silent when the state is unchanged (once each, per item, per metric)", () => {
    expect(scanEventForTransition("at_risk", "at_risk")).toBeNull();
    expect(scanEventForTransition("breached", "breached")).toBeNull();
    expect(scanEventForTransition("ok", "ok")).toBeNull();
  });

  it("never emits met/missed — those belong to the completed transition, not the scan", () => {
    expect(scanEventForTransition("at_risk", "met")).toBeNull();
    expect(scanEventForTransition("breached", "missed")).toBeNull();
    expect(scanEventForTransition("none", "at_risk")).toBe("sla.at_risk");
  });

  it("a retreat from breached back to at_risk re-fires at_risk (edge semantics — see SLA-15's clarified sentence)", () => {
    // Pauses can lower consumedPct, so a breached item CAN retreat to at_risk
    // and breach again. The cache stores only the current state, so "once each"
    // is implementable only as per-transition-into-the-state edge semantics:
    // each genuine state change into at_risk/breached fires its event.
    expect(scanEventForTransition("breached", "at_risk")).toBe("sla.at_risk");
    expect(scanEventForTransition("at_risk", "breached")).toBe("sla.breached");
  });
});

