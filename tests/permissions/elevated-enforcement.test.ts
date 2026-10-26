import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { elevatedActions, type PolicyRegistry } from "@taskdesk/permissions";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  CONDITIONAL_OPERATION_ENFORCEMENT,
  ELEVATED_ENFORCEMENT,
  hasElevatedEnforcementClassification,
} from "../../apps/api/src/auth/elevated-enforcement";
import { STEP_UP_OPERATION_ROUTES } from "../../apps/api/src/auth/step-up-audit";
import { EXT_OPERATIONS } from "../../apps/api/src/auth/step-up-ext";
import { enforcedPolicySources } from "../../apps/api/src/permissions/enforcement-config";
import { enforceRegisteredPolicy } from "../../apps/api/src/permissions/strict-policy-enforcement";
import { loadPolicyRegistry } from "./api-app";

/**
 * `elevated: true` in a policy map is a declaration, not a mechanism. This suite turns it into a
 * checked one: every elevated route must have exactly one classification in
 * `auth/elevated-enforcement.ts`, the handler named there must contain the consume call it names,
 * and every step-up operation must be registered in the PA-15 allowlist, the route table and the
 * database CHECK. A route that declares `elevated: true` and spends no proof fails here.
 */

const apiSrc = resolve(import.meta.dirname, "../../apps/api/src");
const read = (relative: string) =>
  readFileSync(resolve(apiSrc, relative), "utf8");

describe("elevated enforcement", () => {
  let registry: PolicyRegistry;
  let elevated: string[];

  beforeAll(async () => {
    registry = await loadPolicyRegistry();
    elevated = elevatedActions(registry).map((action) => action.routeKey);
  }, 120_000);

  it("classifies every elevated route, and nothing that is not elevated", () => {
    expect(
      elevated.filter((route) => !(route in ELEVATED_ENFORCEMENT)),
    ).toEqual([]);
    expect(
      Object.keys(ELEVATED_ENFORCEMENT).filter(
        (route) => !elevated.includes(route),
      ),
    ).toEqual([]);
  });

  it("keeps every exemption reasoned from the contract", () => {
    for (const [route, entry] of Object.entries(ELEVATED_ENFORCEMENT)) {
      if (entry.kind === "exempt")
        expect(entry.reason.length, route).toBeGreaterThan(40);
    }
  });

  it("keeps the click-confirmed RL-8 role deletion exception explicit", () => {
    const route = "DELETE /api/workspace/{workspaceId}/roles/{roleId}";
    const entry = ELEVATED_ENFORCEMENT[route];
    expect(entry?.kind).toBe("exempt");
    if (entry?.kind !== "exempt") throw new Error("missing RL-8 exemption");
    expect(entry.reason).toContain("RL-8");
    expect(entry.reason).toContain("click-level pending action");
    expect(entry.reason).toContain("excludes it from PA-15 operation proofs");
    expect(read("workspace/workspace-deletion-target.ts")).toContain(
      'confirmation: "click"',
    );
  });

  it("classifies admin-target suspension separately from route-wide elevation", () => {
    const route = "POST /api/instance/users/{id}/suspend";
    const entry = CONDITIONAL_OPERATION_ENFORCEMENT[route];
    expect(entry).toMatchObject({
      kind: "conditional_operation",
      operation: "instance_admin_suspend",
      handler: "instance/users/index.ts",
      consumer: "consumeInstanceAdminSuspendProof",
    });
    expect(entry?.when).toContain(
      "locked target user currently has role admin",
    );
    expect(STEP_UP_OPERATION_ROUTES.instance_admin_suspend).toBe(route);
    const policy = registry.get(route)?.policy;
    expect(policy?.elevated).toBe(false);
    expect(policy?.sessionOnly).toBe(true);
    expect(read("instance/users/index.ts")).toContain(
      "consumeInstanceAdminSuspendProof",
    );
  });

  it("fails closed at runtime when an allowed elevated route lacks a classification", async () => {
    const route = "POST /api/workspace/{workspaceId}/roles";
    const policy = registry.get(route);
    expect(policy?.policy.elevated).toBe(true);
    expect(hasElevatedEnforcementClassification(route)).toBe(true);
    if (!policy) throw new Error("missing workspace role route policy");

    const classification = ELEVATED_ENFORCEMENT[route];
    if (!classification)
      throw new Error("missing elevated route classification");
    const sources = enforcedPolicySources as Set<string>;
    const wasEnforced = sources.has(policy.source);
    sources.delete(policy.source);
    delete ELEVATED_ENFORCEMENT[route];
    const next = vi.fn(async () => new Response("mutation ran"));
    try {
      await expect(
        enforceRegisteredPolicy(
          {
            req: {
              method: "POST",
              path: "/api/workspace/{workspaceId}/roles",
              matchedRoutes: [],
            },
          } as never,
          next as never,
          { method: "POST", path: "/api/workspace/{workspaceId}/roles" },
        ),
      ).rejects.toMatchObject({
        status: 500,
      });
      expect(next).not.toHaveBeenCalled();
    } finally {
      ELEVATED_ENFORCEMENT[route] = classification;
      if (wasEnforced) sources.add(policy.source);
    }
  });

  it("finds the named consume call in the named handler file", () => {
    for (const [route, entry] of Object.entries(ELEVATED_ENFORCEMENT)) {
      if (entry.kind === "exempt") continue;
      const source = read(entry.handler);
      if (entry.kind === "pending_action") {
        expect(source, `${route}: ${entry.handler}`).toContain(
          `confirmation: "${entry.confirmation}"`,
        );
        continue;
      }
      expect(source, `${route}: ${entry.handler}`).toContain(entry.consumer);
    }
    for (const [route, entry] of Object.entries(
      CONDITIONAL_OPERATION_ENFORCEMENT,
    )) {
      expect(read(entry.handler), `${route}: ${entry.handler}`).toContain(
        entry.consumer,
      );
    }
  });

  it("registers every operation with the route it is bound to", () => {
    for (const [route, entry] of Object.entries(ELEVATED_ENFORCEMENT)) {
      if (entry.kind !== "operation" && entry.kind !== "conditional_operation")
        continue;
      expect(STEP_UP_OPERATION_ROUTES[entry.operation], route).toBe(route);
    }
    for (const [route, entry] of Object.entries(
      CONDITIONAL_OPERATION_ENFORCEMENT,
    )) {
      expect(STEP_UP_OPERATION_ROUTES[entry.operation], route).toBe(route);
    }
  });

  it("has no PA-15 operation that no classified operation route uses", () => {
    const used = new Set(
      [
        ...Object.values(ELEVATED_ENFORCEMENT),
        ...Object.values(CONDITIONAL_OPERATION_ENFORCEMENT),
      ].flatMap((entry) =>
        entry.kind === "operation" || entry.kind === "conditional_operation"
          ? [entry.operation]
          : [],
      ),
    );
    const unused = Object.keys(STEP_UP_OPERATION_ROUTES).filter(
      (operation) => !used.has(operation as never),
    );
    expect(unused).toEqual([]);
  });

  it("mirrors the operation allowlist in the database CHECK", () => {
    const schema = read("database/schema.ts");
    const check =
      /step_up_operation_route[\s\S]*?"(\(operation_key IS NULL\)[^"]*)"/u.exec(
        schema,
      )?.[1];
    expect(check, "step_up_operation_route CHECK not found").toBeDefined();
    const pairs = [
      ...(check ?? "").matchAll(
        /operation_key = '([a-z_]+)'::text\) AND \(route_key = '([^']+)'::text/gu,
      ),
    ].map((match) => [match[1], match[2]]);
    expect(Object.fromEntries(pairs)).toEqual(STEP_UP_OPERATION_ROUTES);
  });

  it("builds challenge and proof schemas for every extension operation", () => {
    for (const operation of EXT_OPERATIONS)
      expect(STEP_UP_OPERATION_ROUTES, operation).toHaveProperty(operation);
  });
});
