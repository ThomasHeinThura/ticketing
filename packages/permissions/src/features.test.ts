import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FEATURE_FLAG_DEFAULTS,
  FEATURE_FLAGS,
  INSTANCE_ONLY_FEATURES,
  LOCKED_FEATURE_DEFAULTS,
  resolveFeatureFlag,
} from "./features";

describe("feature flag registry", () => {
  it("matches the canonical architecture enumeration and selected defaults", () => {
    const authority = readFileSync(
      new URL("../../../docs/technical/features.md", import.meta.url),
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
    const defaults = Object.fromEntries(
      registryRows.map((line) => {
        const cells = line.split("|").map((cell) => cell.trim());
        expect(["true", "false"]).toContain(cells[2]);
        expect(["true", "false"]).toContain(cells[3]);
        return [cells[1]?.replace(/`/g, ""), cells[2] === "true"];
      }),
    );
    expect(defaults).toEqual(FEATURE_FLAG_DEFAULTS);
    const locked = registryRows
      .filter((line) => line.split("|")[3]?.trim() === "true")
      .map((line) => line.split("|")[1]?.trim().replace(/`/g, ""));
    expect(locked.sort()).toEqual([...LOCKED_FEATURE_DEFAULTS].sort());
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

  it("ignores workspace and project overrides of instance-only flags (P4R2-M2)", () => {
    expect([...INSTANCE_ONLY_FEATURES].sort()).toEqual([
      "feature.mcp",
      "feature.scim",
    ]);
    expect(
      resolveFeatureFlag({
        feature: "feature.scim",
        instance: { enabled: true, locked: false },
        workspace: false,
        project: false,
      }),
    ).toEqual({ enabled: true, source: "instance" });
    expect(
      resolveFeatureFlag({
        feature: "feature.mcp",
        workspace: true,
        project: true,
      }),
    ).toEqual({ enabled: false, source: "default" });
  });
});
