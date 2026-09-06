import { describe, expect, it } from "vitest";
import {
  BETTER_AUTH_PLUGINS,
  checkPluginList,
  formatPluginListReport,
} from "./better-auth-plugins";

const KEPT = BETTER_AUTH_PLUGINS.filter(
  (plugin) => plugin.verdict === "kept",
).map((plugin) => plugin.id);

describe("the approved plugin list", () => {
  it("gives every plugin exactly one verdict and a unique id", () => {
    const ids = BETTER_AUTH_PLUGINS.map((plugin) => plugin.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("passes when the constructed list is exactly the kept set", () => {
    const result = checkPluginList(KEPT);
    expect(result.ok).toBe(true);
    // two-factor and passkey are approved additions that have not landed yet.
    expect(result.pendingAddition).toEqual(["passkey", "two-factor"]);
  });

  it("fails on a plugin that was removed at fork", () => {
    const result = checkPluginList([...KEPT, "anonymous"]);
    expect(result.ok).toBe(false);
    expect(result.forbiddenPresent).toEqual(["anonymous"]);
  });

  it("fails on a plugin nobody approved — one wildcard mount hides dozens of endpoints", () => {
    const result = checkPluginList([...KEPT, "oauth-proxy"]);
    expect(result.ok).toBe(false);
    expect(result.unknownPresent).toEqual(["oauth-proxy"]);
    expect(formatPluginListReport(result)).toMatch(/on no list/);
  });

  it("fails when a kept plugin quietly disappears", () => {
    const result = checkPluginList(KEPT.filter((id) => id !== "api-key"));
    expect(result.ok).toBe(false);
    expect(result.keptMissing).toEqual(["api-key"]);
  });

  it("tolerates a condemned plugin only while it is listed as pending removal", () => {
    const result = checkPluginList([...KEPT, "bearer"], {
      pendingRemoval: ["bearer"],
    });
    expect(result.ok).toBe(true);
    expect(result.forbiddenPresent).toEqual([]);
  });

  it("fails a pending-removal entry that is already gone — the list only shrinks", () => {
    const result = checkPluginList(KEPT, { pendingRemoval: ["bearer"] });
    expect(result.ok).toBe(false);
    expect(result.baselineStale).toEqual(["bearer"]);
  });
});
