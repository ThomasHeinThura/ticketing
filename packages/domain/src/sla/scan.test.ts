/**
 * `sla-scan` decision tests (SLA-14/15/15a) — every boundary pair, exactly-once by
 * cache-write, and the two boundary readings called out in scan.ts's header.
 */

import { describe, expect, it } from "vitest";
import { scanDecision } from "./scan.js";

describe("scanDecision (SLA-14/SLA-15/SLA-15a)", () => {
  it("ok → at_risk emits sla.at_risk exactly once (then the cache write stops it)", () => {
    const first = scanDecision("ok", "at_risk");
    expect(first.emit).toEqual(["sla.at_risk"]);
    expect(first.nextStoredState).toBe("at_risk");
    expect(first.cacheChanged).toBe(true);
    // The job persists nextStoredState; the next identical tick emits nothing.
    const second = scanDecision(first.nextStoredState, "at_risk");
    expect(second.emit).toEqual([]);
    expect(second.cacheChanged).toBe(false);
  });

  it("at_risk → breached emits sla.breached only", () => {
    const decision = scanDecision("at_risk", "breached");
    expect(decision.emit).toEqual(["sla.breached"]);
    expect(decision.cacheChanged).toBe(true);
  });

  it("ok → breached inside one interval emits sla.breached ONLY — never an unobserved at_risk", () => {
    const decision = scanDecision("ok", "breached");
    expect(decision.emit).toEqual(["sla.breached"]);
  });

  it("steady states emit nothing", () => {
    for (const state of ["ok", "at_risk", "breached", "none"] as const) {
      const decision = scanDecision(state, state);
      expect(decision.emit).toEqual([]);
      expect(decision.cacheChanged).toBe(false);
    }
  });

  it("downward correction emits nothing but re-arms the crossing", () => {
    const down = scanDecision("at_risk", "ok");
    expect(down.emit).toEqual([]);
    expect(down.nextStoredState).toBe("ok");
    expect(down.cacheChanged).toBe(true);
    // …and a later genuine crossing fires again (documented residual).
    expect(scanDecision("ok", "at_risk").emit).toEqual(["sla.at_risk"]);
  });

  it("none → at_risk/breached emits (the cache has never recorded the state)", () => {
    expect(scanDecision("none", "at_risk").emit).toEqual(["sla.at_risk"]);
    expect(scanDecision("none", "breached").emit).toEqual(["sla.breached"]);
    expect(scanDecision("none", "ok").emit).toEqual([]);
  });

  it("none ← ok (goal removed) syncs the cache with no event", () => {
    const decision = scanDecision("ok", "none");
    expect(decision.emit).toEqual([]);
    expect(decision.nextStoredState).toBe("none");
    expect(decision.cacheChanged).toBe(true);
  });

  it("met/missed NEVER emit from scan — SLA-15a gives them to the completed-transition", () => {
    for (const computed of ["met", "missed"] as const) {
      for (const stored of ["ok", "at_risk", "breached"] as const) {
        const decision = scanDecision(stored, computed);
        expect(decision.emit).toEqual([]);
        expect(decision.nextStoredState).toBe(computed);
      }
    }
  });
});
