import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FEATURE_FLAG_DEFAULTS,
  FEATURE_FLAGS,
  LOCKED_FEATURE_DEFAULTS,
  resolveFeatureFlag,
} from "./features";

describe("feature flag registry", () => {
  it("matches the canonical architecture enumeration and selected defaults", () => {
    const authority = readFileSync(
      new URL(
        "../../../docs/01-architecture/plugin-architecture.md",
        import.meta.url,
      ),
      "utf8",
    );
    const registryRows = authority
      .split("\n")
      .filter((line) => line.startsWith("| `feature."));
    const documented = registryRows.flatMap((line) =>
      [...(line.split("|")[1] ?? "").matchAll(/`(feature\.[a-z_]+)`/g)].map(
        ([, key]) => key,
      ),
    );
    expect([...new Set(documented)].sort()).toEqual([...FEATURE_FLAGS].sort());
    expect(FEATURE_FLAG_DEFAULTS["feature.intake"]).toBe(false);
    expect(FEATURE_FLAG_DEFAULTS["feature.scim"]).toBe(true);
    expect(FEATURE_FLAG_DEFAULTS["feature.import"]).toBe(true);
    expect([...LOCKED_FEATURE_DEFAULTS]).toEqual(["feature.import"]);
  });

  it("resolves project, workspace, instance, and locked instance precedence", () => {
    const feature = "feature.intake" as const;
    expect(
      resolveFeatureFlag({
        feature,
        instance: { enabled: false, locked: false },
        workspace: true,
        project: false,
      }),
    ).toEqual({ enabled: false, source: "project" });
    expect(
      resolveFeatureFlag({
        feature,
        instance: { enabled: false, locked: false },
        workspace: true,
      }),
    ).toEqual({ enabled: true, source: "workspace" });
    expect(
      resolveFeatureFlag({
        feature,
        instance: { enabled: true, locked: false },
      }),
    ).toEqual({ enabled: true, source: "instance" });
    expect(
      resolveFeatureFlag({
        feature,
        instance: { enabled: false, locked: true },
        workspace: true,
        project: true,
      }),
    ).toEqual({ enabled: false, source: "instance" });
    expect(resolveFeatureFlag({ feature })).toEqual({
      enabled: false,
      source: "default",
    });
    expect(
      resolveFeatureFlag({
        feature: "feature.import",
        workspace: false,
        project: false,
      }),
    ).toEqual({ enabled: true, source: "default" });
  });
});
