import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { elevatedActions, type PolicyRegistry } from "@taskdesk/permissions";
import { beforeAll, describe, expect, it } from "vitest";
import { ELEVATED_ENFORCEMENT } from "../../apps/api/src/auth/elevated-enforcement";
import { STEP_UP_OPERATION_ROUTES } from "../../apps/api/src/auth/step-up-audit";
import { EXT_OPERATIONS } from "../../apps/api/src/auth/step-up-ext";
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
  });

  it("registers every operation with the route it is bound to", () => {
    for (const [route, entry] of Object.entries(ELEVATED_ENFORCEMENT)) {
      if (entry.kind !== "operation" && entry.kind !== "conditional_operation")
        continue;
      expect(STEP_UP_OPERATION_ROUTES[entry.operation], route).toBe(route);
    }
  });

  it("has no PA-15 operation that no elevated route uses", () => {
    const used = new Set(
      Object.values(ELEVATED_ENFORCEMENT).flatMap((entry) =>
        entry.kind === "operation" || entry.kind === "conditional_operation"
          ? [entry.operation]
          : [],
      ),
    );
    // `instance_admin_suspend` is spent by the user-suspension pending action, not a route of its
    // own on the elevated list.
    const unused = Object.keys(STEP_UP_OPERATION_ROUTES).filter(
      (operation) =>
        !used.has(operation as never) && operation !== "instance_admin_suspend",
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
