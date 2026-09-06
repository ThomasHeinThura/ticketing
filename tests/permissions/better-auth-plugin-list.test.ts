import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BETTER_AUTH_PLUGINS,
  checkPluginList,
  formatPluginListReport,
  type PluginListBaseline,
} from "@taskdesk/permissions";
import { beforeAll, describe, expect, it } from "vitest";
import { loadBetterAuthPluginIds, loadPolicyRegistry } from "./api-app";

/**
 * The `/auth/*` mount, covered the only way it can be.
 *
 * A delegated policy allowlists the mount; it does not enumerate what is behind it. `/auth/*`
 * is one handler whose endpoint set is the better-auth **plugin list**, rebuilt at runtime from
 * database configuration, so `app.routes` shows a single wildcard where dozens of endpoints
 * live. The control that closes the gap is this one: the constructed plugin list must equal the
 * approved list.
 */

const BASELINE_PATH = fileURLToPath(
  new URL("./better-auth-plugins-pending-removal.json", import.meta.url),
);

const baseline = JSON.parse(
  readFileSync(BASELINE_PATH, "utf8"),
) as PluginListBaseline & { readonly $comment?: unknown };

describe("the better-auth plugin list", () => {
  let constructed: string[];

  beforeAll(async () => {
    constructed = await loadBetterAuthPluginIds();
  }, 120_000);

  it("reads the constructed list off the real better-auth instance", () => {
    expect(constructed.length).toBeGreaterThan(0);
  });

  it("equals the approved list, allowing only what #6 has yet to remove", () => {
    const result = checkPluginList(constructed, baseline);
    if (!result.ok) console.error(formatPluginListReport(result));
    expect(result.forbiddenPresent).toEqual([]);
    expect(result.unknownPresent).toEqual([]);
    expect(result.keptMissing).toEqual([]);
    expect(result.baselineStale).toEqual([]);
  });

  it("keeps the fork-time removals condemned, whatever the runtime rebuild does", () => {
    // anonymous, deviceAuthorization, bearer and organization are removed at fork. They are
    // tolerated today only because they are named in the pending-removal list, which shrinks to
    // nothing when #6 lands.
    const removed = BETTER_AUTH_PLUGINS.filter(
      (plugin) => plugin.verdict === "removed",
    ).map((plugin) => plugin.id);
    expect(removed).toContain("anonymous");
    expect(removed).toContain("bearer");
    expect(removed).toContain("device-authorization");
    expect(removed).toContain("organization");

    for (const id of baseline.pendingRemoval) {
      expect(removed, `${id} is in the pending-removal list`).toContain(id);
    }
  });

  it("declares the mount as a delegated surface, with a reason", async () => {
    const registry = await loadPolicyRegistry();
    const entry = registry.get("GET /api/auth/*");
    expect(entry?.kind).toBe("delegated");
    if (entry !== undefined && entry.kind === "delegated") {
      expect(
        "reason" in entry.policy && entry.policy.reason.length,
      ).toBeGreaterThan(0);
    }
  });
});
