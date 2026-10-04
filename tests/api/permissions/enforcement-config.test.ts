import { describe, expect, it, vi } from "vitest";
import {
  PolicyEnforcementConfigError,
  parseEnforcedPolicySources,
} from "../../../apps/api/src/permissions/enforcement-config";

const SOURCES = [
  "apps/api/src/project/policy.ts",
  "apps/api/src/workspace/policy.ts",
  "apps/api/src/task/policy.ts",
] as const;

describe("TASKDESK_POLICY_ENFORCE config", () => {
  it("keeps strict enforcement off unless exact sources are selected", () => {
    expect(parseEnforcedPolicySources(undefined, SOURCES).size).toBe(0);
    expect(parseEnforcedPolicySources("", SOURCES).size).toBe(0);
    expect(
      parseEnforcedPolicySources(SOURCES.slice(0, 2).join(","), SOURCES),
    ).toEqual(new Set(SOURCES.slice(0, 2)));
  });

  it.each(["unknown", ",", `${SOURCES[0]},${SOURCES[0]}`, ` ${SOURCES[0]}`])(
    "refuses malformed or unregistered source selections (%s)",
    (value) => {
      expect(() => parseEnforcedPolicySources(value, SOURCES)).toThrow(
        PolicyEnforcementConfigError,
      );
    },
  );

  it("requires all other router sources before the task source", () => {
    expect(() => parseEnforcedPolicySources(SOURCES[2], SOURCES)).toThrow(
      PolicyEnforcementConfigError,
    );
    expect(parseEnforcedPolicySources(SOURCES.join(","), SOURCES)).toEqual(
      new Set(SOURCES),
    );
    expect(() =>
      parseEnforcedPolicySources(
        `${SOURCES[2]},${SOURCES[0]},${SOURCES[1]}`,
        SOURCES,
      ),
    ).toThrow(PolicyEnforcementConfigError);
  });

  it("refuses an invalid source before the production API module can boot", async () => {
    const previous = process.env.TASKDESK_POLICY_ENFORCE;
    vi.resetModules();
    process.env.TASKDESK_POLICY_ENFORCE =
      "apps/api/src/not-registered/policy.ts";
    try {
      await expect(import("../../../apps/api/src/index")).rejects.toThrow(
        /TASKDESK_POLICY_ENFORCE must contain unique/,
      );
    } finally {
      if (previous === undefined) {
        delete process.env.TASKDESK_POLICY_ENFORCE;
      } else {
        process.env.TASKDESK_POLICY_ENFORCE = previous;
      }
      vi.resetModules();
    }
  });
});
