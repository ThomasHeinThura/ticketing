/**
 * Regression tests for the Opus security-review delta on issue #8's runtime-authorization
 * gateway (`docs/07-planning/security-reviews/440-runtime-authorization-wiring.md`).
 *
 * `tests/api/permissions/route-classification-guard.test.ts` exercises
 * `assertRouteIsClassified` against a minimal, hand-built Hono app with a mocked policy
 * registry. These tests exercise it against the REAL `createApp()` -- the real auth guard,
 * the real policy registry, the real router -- because both bugs this delta fixes
 * (B1: a route reachable only via `.all()`/a custom HTTP method fails open; B2: a real HEAD
 * request gets a false 500) are about how Hono's own router attributes a dispatched route,
 * which a hand-built fixture app cannot reproduce faithfully.
 */
import { describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/index";
import { mockAuthenticatedSession } from "./helpers/auth";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

describe("assertRouteIsClassified against the real createApp()", () => {
  it("refuses (500) a route reachable only via .all(), registered below the guard with no policy entry (B1a)", async () => {
    await resetTestDatabase();
    const member = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(member.user);

    const { app } = createApp();
    // Registered directly on the returned `app`, below `api.use("*", <guard>)`'s copied
    // registration (`app.route("/api", api)` already ran inside `createApp()`) -- Hono
    // matches every request path against the whole router, not per originating sub-app, so
    // this still runs through CORS, the auth guard and `assertRouteIsClassified`.
    app.all("/api/__test_all_route_no_policy__", (c) =>
      c.text("should never be reached"),
    );

    const response = await app.request("/api/__test_all_route_no_policy__");

    expect(response.status).toBe(500);
    expect(await response.text()).not.toBe("should never be reached");
  });

  it("refuses (500) a route registered under a custom HTTP method outside HTTP_METHODS, with no policy entry (B1b)", async () => {
    await resetTestDatabase();
    const member = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(member.user);

    const { app } = createApp();
    app.on("PURGE", "/api/__test_purge_route_no_policy__", (c) =>
      c.text("should never be reached"),
    );

    const response = await app.request("/api/__test_purge_route_no_policy__", {
      method: "PURGE",
    });

    expect(response.status).toBe(500);
    expect(await response.text()).not.toBe("should never be reached");
  });

  it("serves a real HEAD request against a classified, working GET route (200, not 500) (B2)", async () => {
    await resetTestDatabase();
    const member = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(member.user);

    const { app } = createApp();
    const response = await app.request(
      `/api/project?workspaceId=${member.workspace.id}`,
      { method: "HEAD" },
    );

    expect(response.status).toBe(200);
  });

  it("still serves a classified GET route normally -- no regression on the happy path", async () => {
    await resetTestDatabase();
    const member = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(member.user);

    const { app } = createApp();
    const response = await app.request(
      `/api/project?workspaceId=${member.workspace.id}`,
    );

    expect(response.status).toBe(200);
  });

  it("still 404s a genuinely unmatched path -- never turned into a 500", async () => {
    await resetTestDatabase();
    const member = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(member.user);

    const { app } = createApp();
    const response = await app.request("/api/__does_not_exist_at_all__");

    expect(response.status).toBe(404);
  });
});
