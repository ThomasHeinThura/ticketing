import {
  CREDENTIAL_KINDS,
  evaluatePolicy,
  type PolicyRegistry,
  sessionOnlyRoutes,
} from "@taskdesk/permissions";
import { beforeAll, describe, expect, it } from "vitest";
import { loadPolicyRegistry } from "./api-app";
import { identityFor, MATRIX_TARGET } from "./matrix-fixture";

/**
 * Session-only routes, enumerated **from the `sessionOnly` field** in the registry — never from
 * a second hand-kept list, which is how the two would drift.
 *
 * The credential check runs before the route's policy, so a session-only route never reaches
 * the pending-action layer at all: an API key, an `is_mcp` key or an impersonation session is
 * refused `403 session_required`.
 */

describe("session-only routes", () => {
  let registry: PolicyRegistry;
  let routeKeys: string[];

  beforeAll(async () => {
    registry = await loadPolicyRegistry();
    routeKeys = sessionOnlyRoutes(registry);
  }, 120_000);

  it("takes its cases from the registry", () => {
    expect(routeKeys).toEqual(
      registry.entries
        .filter((entry) => entry.policy.sessionOnly === true)
        .map((entry) => entry.routeKey),
    );
  });

  it("refuses every non-session credential, and accepts a browser session", () => {
    for (const routeKey of routeKeys) {
      const entry = registry.get(routeKey);
      if (entry === undefined) throw new Error(`${routeKey} vanished`);

      for (const credential of CREDENTIAL_KINDS) {
        const decision = evaluatePolicy(entry.policy, {
          identity: { ...identityFor("owner"), credential },
          target: MATRIX_TARGET,
          inReach: true,
        });
        if (credential === "session") {
          expect(
            decision.allowed || (!decision.allowed && decision.status !== 403),
            `${routeKey} on a session`,
          ).toBe(true);
          continue;
        }
        expect(decision, `${routeKey} on ${credential}`).toMatchObject({
          allowed: false,
          status: 403,
          code: "session_required",
        });
      }
    }
  });

  it("never marks a public route session-only", () => {
    // The registry refuses this shape outright; asserted here so the reason is recorded where a
    // reader is looking for it.
    for (const entry of registry.entries) {
      if (entry.kind !== "public") continue;
      expect(entry.policy.sessionOnly, entry.routeKey).not.toBe(true);
    }
  });
});
