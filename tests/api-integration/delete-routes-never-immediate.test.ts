import { existsSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { auth } from "../../apps/api/src/auth";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { loadRouterRoutes } from "../permissions/api-app";

/**
 * P0 deletion audit (PA-1 / PA-2 / PA-4 / PA-10): no DELETE route may remove business data
 * immediately. Every DELETE route in the live router either answers 202 (a durable pending
 * action awaiting the requester's approval) or 410 (retired), or is on the explicit allow-list
 * below with the reason it is safe. A new DELETE route that is neither fails this test until it
 * is converted or deliberately added here with a reason.
 *
 * The enumeration is Hono's real router (not the OpenAPI document alone, which cannot see
 * `/auth/*`); the contract (which statuses a route can answer) is read from the live OpenAPI
 * document served by the same app. A route outside the document must be allow-listed.
 *
 * Deletions the OpenAPI document cannot see are covered separately: the better-auth POST/GET
 * routes (`/api/auth/*`) are enumerated live from `auth.api` and must each appear in
 * AUTH_DESTRUCTIVE_ROUTES with a reason (M1: delete-user erases workspaces and was invisible to
 * this guard). The PATCH /api/task/bulk `delete` operation (410, task row survives) has its
 * runtime assertion in task-target-reach.test.ts ("operation delete answers 410 ... leaves the
 * task row in place"); the contract-level check below only proves the 410 is declared.
 */

const normalise = (key: string) =>
  key.replace(/\{[^}]+\}|:[A-Za-z0-9_]+/g, "{}");

/** `METHOD path` -> reason it is not a deletion needing approval. */
const ALLOWED_IMMEDIATE: Record<string, string> = {
  // Unlinks: remove a relationship, never the linked records or their history.
  "DELETE /api/label/{id}/task":
    "unlink: drops the per-task link row of a label (a catalogue label is refused with 400 and never deleted); label deletion is DELETE /api/label/{id} (202)",
  "DELETE /api/work-items/{key}/assign":
    "unlink: clears the assignee; journaled as an activity, no row removed",
  "DELETE /api/work-items/{key}/watch":
    "unlink: the caller stops watching; own subscription only",
  "DELETE /api/work-items/{key}/parent":
    "unlink: clears parent_id; journaled, both work items survive",
  "DELETE /api/v2/work-items/{key}/parent":
    "unlink: versioned twin of the parent clear; both work items survive",
  "DELETE /api/workspace/{workspaceId}/members/{userId}":
    "unlink: removes a membership (the person and their work survive); owner and last-owner guards apply",
  // Own-settings housekeeping with no shared business data.
  "DELETE /api/user/avatar":
    "own avatar only: clears the caller's profile picture (session user, no shared data)",
  "DELETE /api/notification/clear-all":
    "own inbox only: marks the caller's notifications cleared (session user, no shared data)",
  "DELETE /api/notification-preferences/workspaces/{workspaceId}":
    "own preferences only: resets the caller's per-workspace overrides to defaults",
  // Setting rows, session-only.
  "DELETE /api/workflow-rule/{id}":
    "sessionOnly (requireSessionOnly, 403 session_required for any API/MCP key): a column-routing setting with no history; the browser user is the human decision",
  // Delegated to another authenticator, not the TaskDesk credential model.
  "DELETE /api/auth/*":
    "better-auth surface (session sign-out, own API key revoke); refused or scoped inside better-auth, not business data",
  "DELETE /scim/v2/Users/{id}":
    "SCIM deprovision under a per-connection SCIM bearer token: deactivates the identity, with the identity-connection guards",
  "DELETE /scim/v2/Groups/{id}":
    "SCIM group removal under a per-connection SCIM bearer token; removes a mapping group, not business data",
};

/**
 * Non-DELETE operations whose request body offers a `delete` operation (enum containing
 * "delete"): `METHOD path` -> reason it cannot delete immediately. Each must also be proven by
 * a runtime probe; keep reasons concrete.
 */
const ALLOWED_DELETE_OPERATION: Record<string, string> = {
  "POST /api/work-items/bulk":
    "operation delete only records a bulk pending action and answers 202 (pending-action-bulk-work-item-deletion.test.ts); the other operations answer 200",
};

/**
 * Non-OpenAPI mutating better-auth routes that remove or disable something. Enumerated live
 * from `auth.api` (any route whose path names delete/remove/revoke/unlink/disable/sign-out), so
 * a plugin enabled later fails this test until it is classified here. `coveredBy` names the
 * integration test that exercises the route with a real credential; the anonymous probe below
 * runs for every entry.
 */
const DESTRUCTIVE_PATH = /delete|remove|revoke|unlink|disable|sign-out/u;
const AUTH_DESTRUCTIVE_ROUTES: {
  path: string;
  reason: string;
  coveredBy: string;
}[] = [
  {
    path: "/delete-user",
    reason:
      "account erasure: erases sole-access workspaces, so it takes the legal-hold fence and the other-access refusal (409) before deleting anything; the requester must re-authenticate",
    coveredBy: "account-erasure-legal-hold.test.ts",
  },
  {
    path: "/delete-user/callback",
    reason:
      "email-token variant of delete-user: runs the same beforeDelete erasure path and the same fences",
    coveredBy: "pending-action-credential-revocation.test.ts",
  },
  {
    path: "/api-key/delete",
    reason:
      "own API key only: deleting the key removes a credential, no business data; bound pending actions are invalidated, not executed",
    coveredBy: "pending-action-credential-revocation.test.ts",
  },
  {
    path: "/admin/remove-user",
    reason:
      "better-auth admin plugin hard-deletes a user; every /admin/* endpoint is refused 404 by the auth before-hook (authority lives in /api/instance/*)",
    coveredBy: "auth-admin-routes-refused.test.ts",
  },
  {
    path: "/admin/revoke-user-session",
    reason:
      "admin plugin session revoke; refused 404 by the /admin/* before-hook like every admin endpoint",
    coveredBy: "auth-admin-routes-refused.test.ts",
  },
  {
    path: "/admin/revoke-user-sessions",
    reason:
      "admin plugin sessions revoke; refused 404 by the /admin/* before-hook like every admin endpoint",
    coveredBy: "auth-admin-routes-refused.test.ts",
  },
  {
    path: "/revoke-session",
    reason: "own session revoke: credentials only, no business data",
    coveredBy: "pending-action-credential-revocation.test.ts",
  },
  {
    path: "/revoke-sessions",
    reason: "own sessions revoke: credentials only, no business data",
    coveredBy: "pending-action-credential-revocation.test.ts",
  },
  {
    path: "/revoke-other-sessions",
    reason: "own other sessions revoke: credentials only, no business data",
    coveredBy: "pending-action-credential-revocation.test.ts",
  },
  {
    path: "/sign-out",
    reason: "ends the caller's own session: credentials only",
    coveredBy: "pending-action-credential-revocation.test.ts",
  },
  {
    path: "/unlink-account",
    reason:
      "removes the caller's own linked login method; no business data (linking is disabled by default)",
    coveredBy: "pending-action-credential-revocation.test.ts",
  },
  {
    path: "/two-factor/disable",
    reason:
      "own second factor; requires the password and is step-up gated elsewhere; no business data",
    coveredBy: "pending-action-credential-revocation.test.ts",
  },
];

type Operation = {
  responses: Record<string, unknown>;
  requestBody?: unknown;
};
let documented: Map<string, string[]>;
let routerDeletes: string[];
let deleteOperationRoutes: { key: string; statuses: string[] }[];

function exposesDeleteOperation(
  node: unknown,
  components: Record<string, unknown>,
  seen = new Set<string>(),
): boolean {
  if (Array.isArray(node))
    return node.some((item) => exposesDeleteOperation(item, components, seen));
  if (!node || typeof node !== "object") return false;
  const record = node as Record<string, unknown>;
  if (typeof record.$ref === "string") {
    if (seen.has(record.$ref)) return false;
    seen.add(record.$ref);
    const target = record.$ref
      .replace(/^#\//, "")
      .split("/")
      .reduce<unknown>(
        (value, part) => (value as Record<string, unknown> | undefined)?.[part],
        { components } as unknown,
      );
    return exposesDeleteOperation(target, components, seen);
  }
  if (Array.isArray(record.enum) && record.enum.includes("delete")) return true;
  if (record.const === "delete") return true;
  return Object.values(record).some((value) =>
    exposesDeleteOperation(value, components, seen),
  );
}

beforeAll(async () => {
  const { app } = createApp();
  const response = await app.request("/api/openapi");
  expect(response.status).toBe(200);
  const spec = (await response.json()) as {
    paths: Record<string, Record<string, Operation>>;
    components?: Record<string, unknown>;
  };
  documented = new Map();
  deleteOperationRoutes = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      if (method === "delete" || !operation?.requestBody) continue;
      if (!exposesDeleteOperation(operation.requestBody, spec.components ?? {}))
        continue;
      deleteOperationRoutes.push({
        key: `${method.toUpperCase()} /api${path}`,
        statuses: Object.keys(operation.responses),
      });
    }
  }
  for (const [path, item] of Object.entries(spec.paths)) {
    const operation = item.delete;
    if (!operation) continue;
    const key = path.startsWith("/scim/")
      ? `DELETE ${path}`
      : `DELETE /api${path}`;
    documented.set(normalise(key), Object.keys(operation.responses));
  }
  routerDeletes = (await loadRouterRoutes())
    .filter((route) => route.method.toUpperCase() === "DELETE")
    .map((route) => route.routeKey);
}, 120_000);

const allowed = (key: string) =>
  Object.entries(ALLOWED_IMMEDIATE).find(
    ([allowedKey]) => normalise(allowedKey) === normalise(key),
  );

describe("API integration: no DELETE route deletes immediately", () => {
  it("enumerates a non-trivial DELETE route set", () => {
    expect(routerDeletes.length).toBeGreaterThan(20);
    expect(documented.size).toBeGreaterThan(20);
  });

  it("every DELETE route declares 202 or 410 and no immediate 2xx, unless allow-listed with a reason", () => {
    const violations: string[] = [];
    for (const key of routerDeletes) {
      const entry = allowed(key);
      if (entry) {
        expect(entry[1].length, `${key} needs a reason`).toBeGreaterThan(20);
        continue;
      }
      const statuses = documented.get(normalise(key));
      if (!statuses) {
        violations.push(
          `${key}: not in the OpenAPI document and not allow-listed`,
        );
        continue;
      }
      const success = statuses.filter((status) => status.startsWith("2"));
      if (!statuses.includes("410") && !success.includes("202"))
        violations.push(
          `${key}: answers ${statuses.join("/")}, neither 202 nor 410`,
        );
      const immediate = success.filter((status) => status !== "202");
      if (immediate.length > 0)
        violations.push(
          `${key}: also declares immediate ${immediate.join("/")}`,
        );
    }
    expect(violations).toEqual([]);
  });

  it("every non-DELETE operation that accepts a delete operation declares 202 or 410, unless allow-listed with a reason", () => {
    // A deletion reachable through POST/PATCH/PUT (PA-1 names "bulk action") is judged like a
    // DELETE route; PATCH /api/task/bulk used to hard-delete tasks this way.
    expect(deleteOperationRoutes.map((route) => route.key)).toContain(
      "PATCH /api/task/bulk",
    );
    const violations: string[] = [];
    for (const { key, statuses } of deleteOperationRoutes) {
      const entry = Object.entries(ALLOWED_DELETE_OPERATION).find(
        ([allowedKey]) => normalise(allowedKey) === normalise(key),
      );
      if (entry) {
        expect(entry[1].length, `${key} needs a reason`).toBeGreaterThan(20);
        expect(statuses, key).toContain("202");
        continue;
      }
      if (!statuses.includes("410") && !statuses.includes("202"))
        violations.push(
          `${key}: accepts a delete operation but answers ${statuses.join("/")}, neither 202 nor 410`,
        );
    }
    expect(violations).toEqual([]);
  });

  it("the delete-operation allow-list has no stale entries", () => {
    const live = new Set(deleteOperationRoutes.map((r) => normalise(r.key)));
    expect(
      Object.keys(ALLOWED_DELETE_OPERATION).filter(
        (key) => !live.has(normalise(key)),
      ),
    ).toEqual([]);
  });

  it("the four retired legacy deletes answer 410 in the contract", () => {
    for (const key of [
      "DELETE /api/task/{id}",
      "DELETE /api/comment/{id}",
      "DELETE /api/activity/comment",
      "DELETE /api/task-relation/{id}",
    ]) {
      const statuses = documented.get(normalise(key));
      expect(statuses, key).toContain("410");
      expect(
        statuses?.filter((status) => status.startsWith("2")),
        key,
      ).toEqual([]);
    }
  });

  it("the allow-list has no stale entries (each names a live DELETE route)", () => {
    const live = new Set(routerDeletes.map(normalise));
    const stale = Object.keys(ALLOWED_IMMEDIATE).filter(
      (key) => !live.has(normalise(key)),
    );
    expect(stale).toEqual([]);
  });
});

describe("API integration: non-OpenAPI better-auth deletion routes are inventoried (M6)", () => {
  const live = Object.values(
    auth.api as unknown as Record<
      string,
      { path?: string; options?: { method?: string | string[] } }
    >,
  )
    .filter(
      (endpoint) =>
        typeof endpoint?.path === "string" &&
        DESTRUCTIVE_PATH.test(endpoint.path),
    )
    .map((endpoint) => ({
      path: endpoint.path as string,
      method: [endpoint.options?.method ?? "GET"].flat().join(","),
    }));

  it("enumerates the live better-auth surface", () => {
    expect(live.map((route) => route.path)).toContain("/delete-user");
  });

  it("every destructive better-auth route is inventoried with a reason", () => {
    const known = new Set(AUTH_DESTRUCTIVE_ROUTES.map((route) => route.path));
    expect(
      live.filter((route) => !known.has(route.path)),
      "classify the new route in AUTH_DESTRUCTIVE_ROUTES",
    ).toEqual([]);
    for (const route of AUTH_DESTRUCTIVE_ROUTES) {
      expect(route.reason.length, route.path).toBeGreaterThan(30);
      expect(
        existsSync(new URL(`./${route.coveredBy}`, import.meta.url)),
        `${route.path} names a missing test ${route.coveredBy}`,
      ).toBe(true);
    }
  });

  it("the inventory has no stale entries", () => {
    const livePaths = new Set(live.map((route) => route.path));
    expect(
      AUTH_DESTRUCTIVE_ROUTES.filter((route) => !livePaths.has(route.path)),
    ).toEqual([]);
  });

  it("an anonymous call to any inventoried route deletes nothing", async () => {
    const { app } = createApp();
    const counts = async () => ({
      users: (
        await db.select({ id: schema.userTable.id }).from(schema.userTable)
      ).length,
      sessions: (
        await db
          .select({ id: schema.sessionTable.id })
          .from(schema.sessionTable)
      ).length,
      keys: (
        await db.select({ id: schema.apikeyTable.id }).from(schema.apikeyTable)
      ).length,
      workspaces: (
        await db
          .select({ id: schema.workspaceTable.id })
          .from(schema.workspaceTable)
      ).length,
    });
    const before = await counts();
    for (const route of AUTH_DESTRUCTIVE_ROUTES) {
      const method = live.find(
        (candidate) => candidate.path === route.path,
      )?.method;
      const post = method?.includes("POST") ?? true;
      const response = await app.request(`/api/auth${route.path}`, {
        method: post ? "POST" : "GET",
        headers: { "content-type": "application/json" },
        ...(post ? { body: "{}" } : {}),
      });
      // Sign-out legitimately answers 200 for an anonymous caller (nothing to end), so the
      // proof is the unchanged row counts below; admin endpoints must be refused outright.
      if (route.path.startsWith("/admin/"))
        expect(response.status, route.path).toBe(404);
    }
    expect(await counts()).toEqual(before);
  });
});
