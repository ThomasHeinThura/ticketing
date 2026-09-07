import {
  AUTHORITY_GRANTING,
  elevatedActions,
  elevatedWithoutSessionOnly,
  elevationViolations,
  isInstanceRoute,
  type PolicyRegistry,
  renderElevatedActionsMarkdown,
} from "@taskdesk/permissions";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPolicyRegistry } from "./api-app";
import { documentedElevatedRoutes } from "./rbac-doc";

/**
 * The elevated-action list is generated from the registry, never hand-maintained.
 *
 * rbac.md carries the single table of actions that require a fresh authentication, and says so
 * explicitly: "Edit the registry, not this table; a hand-added row here that no policy declares
 * fails the generation check, and a policy that declares `elevated: true` and is missing here
 * fails it too."
 *
 * The document's table names routes that mostly do not exist yet — they arrive with P1 and P4.
 * The check is therefore scoped to routes the router actually has, which makes it true today
 * and arms itself, route by route, as each one lands.
 */

describe("elevated actions", () => {
  let registry: PolicyRegistry;
  const documented = documentedElevatedRoutes();

  beforeAll(async () => {
    registry = await loadPolicyRegistry();
  }, 120_000);

  it("reads a non-empty elevated table out of rbac.md", () => {
    // If this ever hits zero, the parser has drifted and every assertion below goes vacuous.
    expect(documented.length).toBeGreaterThan(10);
  });

  it("declares elevated: true on every documented elevated route that exists", () => {
    const missing = documented.filter(
      (routeKey) =>
        registry.has(routeKey) &&
        registry.get(routeKey)?.policy.elevated !== true,
    );
    expect(missing).toEqual([]);
  });

  it("declares no elevated route that rbac.md's single list does not carry", () => {
    const undocumented = elevatedActions(registry)
      .map((action) => action.routeKey)
      .filter((routeKey) => !documented.includes(routeKey));
    expect(undocumented).toEqual([]);
  });

  it("makes every elevated route session-only", () => {
    // An elevated route that forgets sessionOnly is reachable from a personal API key, an MCP
    // key or an impersonation session — which is the whole hole the credential check closes.
    expect(elevatedWithoutSessionOnly(registry)).toEqual([]);
  });

  it("catches an authority-minting route that nobody remembered to declare", () => {
    // Every /api/instance/* route, and every route whose capability is in AUTHORITY_GRANTING,
    // must carry elevated: true or an explicit elevated: false with a written reason.
    expect(elevationViolations(registry)).toEqual([]);
  });

  it("names only capabilities that exist in AUTHORITY_GRANTING", () => {
    expect(AUTHORITY_GRANTING.length).toBeGreaterThan(0);
    expect(new Set(AUTHORITY_GRANTING).size).toBe(AUTHORITY_GRANTING.length);
  });

  it("holds an explicit, reasoned exemption for the instance routes that are not elevated", () => {
    for (const entry of registry.entries) {
      if (!isInstanceRoute(entry.routeKey)) continue;
      if (entry.policy.elevated === true) continue;
      expect(entry.policy.elevated, entry.routeKey).toBe(false);
      expect(
        (entry.policy.elevationExemptionReason ?? "").trim(),
        entry.routeKey,
      ).not.toBe("");
    }
  });

  it("renders the table rbac.md is meant to carry", () => {
    const rendered = renderElevatedActionsMarkdown(registry);
    expect(rendered.startsWith("| Route | Capability | Session-only |")).toBe(
      true,
    );
    // Printed so a retrofit can paste it straight into the document rather than hand-writing it.
    if (elevatedActions(registry).length > 0) console.info(rendered);
  });
});
