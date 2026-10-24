import {
  createPolicyRegistry,
  elevatedActions,
  elevatedWithoutSessionOnly,
  elevationViolations,
  sessionOnlyRoutes,
} from "@taskdesk/permissions";
import { describe, expect, it } from "vitest";
import { automationPolicies } from "../../../apps/api/src/automation/policy";
import { webhookPolicies } from "../../../apps/api/src/webhook/policy";

/**
 * The two P4 policy maps, validated on their own so a malformed entry or a forgotten elevation
 * fails here, before the coordinator merges them into `apps/api/src/policy-registry.ts` (whose
 * own `route-coverage` and `elevated-actions` suites then cover the mounted routes).
 */
const registry = createPolicyRegistry([
  { name: "apps/api/src/webhook/policy.ts", policies: webhookPolicies },
  { name: "apps/api/src/automation/policy.ts", policies: automationPolicies },
]);

describe("webhook and automation route policies", () => {
  it("builds a valid registry", () => {
    expect(registry.entries.length).toBe(
      Object.keys(webhookPolicies).length +
        Object.keys(automationPolicies).length,
    );
  });

  it("declares every webhook:manage route elevated, or exempt with a reason", () => {
    expect(elevationViolations(registry)).toEqual([]);
  });

  it("makes every elevated route session-only", () => {
    expect(elevatedWithoutSessionOnly(registry)).toEqual([]);
  });

  it("puts creating, editing and rotating a webhook on the elevated list (WH-15, WH-13)", () => {
    expect(
      elevatedActions(registry)
        .map((action) => action.routeKey)
        .sort(),
    ).toEqual([
      "DELETE /api/webhooks/{id}",
      "PATCH /api/webhooks/{id}",
      "POST /api/webhooks",
      "POST /api/webhooks/{id}/rotate-secret",
    ]);
    expect([...sessionOnlyRoutes(registry)].sort()).toEqual([
      "DELETE /api/webhooks/{id}",
      "PATCH /api/webhooks/{id}",
      "POST /api/webhooks",
      "POST /api/webhooks/{id}/rotate-secret",
    ]);
  });

  it("registers only two delete routes, both as pending-action requests: the webhook one elevated and session-only, the automation one a plain click approval", () => {
    const deletes = registry.entries.filter((entry) =>
      entry.routeKey.startsWith("DELETE "),
    );
    expect(deletes.map((entry) => entry.routeKey).sort()).toEqual([
      "DELETE /api/automations/{id}",
      "DELETE /api/webhooks/{id}",
    ]);
    // The automation delete is not authority-granting, so it is neither elevated nor
    // session-only; the elevated/session-only assertions above stay webhook-only.
    expect(
      automationPolicies["DELETE /api/automations/{id}"],
    ).not.toHaveProperty("elevated");
  });

  it("scopes webhook routes to the workspace and requires reach", () => {
    for (const [key, policy] of Object.entries(webhookPolicies)) {
      expect(policy.capability, key).toBe("webhook:manage");
      expect(policy.scope, key).toBe("workspace");
      expect(policy.reach, key).toBe("required");
    }
  });
});
