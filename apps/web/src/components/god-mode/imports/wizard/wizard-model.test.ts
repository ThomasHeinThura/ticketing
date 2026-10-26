import { describe, expect, it } from "vitest";
import {
  clampStep,
  decodeTarget,
  defaultStepFor,
  encodeTarget,
  targetOptionsFor,
} from "./wizard-model";

const labels = {
  ignore: "Ignore",
  placeholder: "Placeholder",
  group: (g: string) => g,
  priority: (p: string) => p,
};

describe("wizard step gating", () => {
  it("opens only the steps the run's phase allows", () => {
    expect(clampStep("reconcile", "created")).toBe("discover");
    expect(clampStep("execute", "discovered")).toBe("dry-run");
    expect(clampStep("execute", "dry_run_ready")).toBe("execute");
    expect(clampStep("reconcile", "completed")).toBe("reconcile");
    expect(clampStep("connect", "completed")).toBe("connect");
  });
  it("defaults to the next piece of work", () => {
    expect(defaultStepFor("created")).toBe("discover");
    expect(defaultStepFor("discovered")).toBe("mapping");
    expect(defaultStepFor("dry_run_ready")).toBe("dry-run");
    expect(clampStep(undefined, "executing")).toBe("execute");
  });
});

describe("target codec", () => {
  it("round-trips every target kind, including ids that contain a colon", () => {
    for (const target of [
      { kind: "target", id: "a:b:c" },
      { kind: "group", group: "started" },
      { kind: "priority", value: "urgent" },
      { kind: "placeholder" },
      { kind: "ignore" },
    ] as const) {
      expect(decodeTarget(encodeTarget(target) ?? "")).toEqual(target);
    }
    expect(encodeTarget(null)).toBeUndefined();
    expect(decodeTarget("group:nonsense")).toBeNull();
    expect(decodeTarget("target:")).toBeNull();
  });
});

describe("targetOptionsFor", () => {
  const catalogue = {
    type: [{ id: "t1", name: "Bug" }],
    person: [{ id: "p1", name: "Ana" }],
  };
  it("never offers ignore for type or state", () => {
    expect(
      targetOptionsFor("type", catalogue, labels).map((o) => o.value),
    ).toEqual(["target:t1"]);
    expect(targetOptionsFor("state", catalogue, labels)).toHaveLength(5);
    expect(
      targetOptionsFor("state", catalogue, labels).some(
        (o) => o.value === "ignore",
      ),
    ).toBe(false);
  });
  it("offers a placeholder only for people", () => {
    expect(
      targetOptionsFor("person", catalogue, labels).map((o) => o.value),
    ).toEqual(["placeholder", "ignore", "target:p1"]);
    expect(
      targetOptionsFor("label", catalogue, labels).map((o) => o.value),
    ).toEqual(["ignore"]);
  });
});
