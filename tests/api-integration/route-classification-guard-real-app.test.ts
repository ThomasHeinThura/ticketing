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
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../../apps/api/src/index";
import { policyRegistry } from "../../apps/api/src/policy-registry";
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

  // B3, fresh Opus delta pass, live-reproduced: a route-scoped `.use()` middleware
  // registered ahead of an unclassified handler used to be picked as "the" attributed
  // route (its own key is not one of the two framework-declared catch-alls), so a
  // classified registry entry for THAT middleware's key let the real, unclassified route
  // behind it through -- borrowing the middleware's clearance instead of having none of
  // its own. `assertRouteIsClassified` must check every entry the request dispatched
  // through, not just the first non-catch-all one.
  it("refuses (500) an unclassified route sitting behind a route-scoped .use() middleware that DOES have a policy entry (B3)", async () => {
    await resetTestDatabase();
    const member = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(member.user);

    const { app } = createApp();
    const middlewareKey = "ALL /api/__test_probe3__/*";
    const realEntry = policyRegistry.get("get /api/project");
    if (!realEntry) {
      throw new Error("expected a real registry entry to reuse for the spy");
    }
    const originalGet = policyRegistry.get.bind(policyRegistry);
    const getSpy = vi
      .spyOn(policyRegistry, "get")
      .mockImplementation((routeKey: string) =>
        routeKey === middlewareKey ? realEntry : originalGet(routeKey),
      );

    try {
      app.use("/api/__test_probe3__/*", async (_c, next) => {
        await next();
      });
      app.get("/api/__test_probe3__/x", (c) =>
        c.text("should never be reached"),
      );

      const response = await app.request("/api/__test_probe3__/x");

      expect(response.status).toBe(500);
      expect(await response.text()).not.toBe("should never be reached");
    } finally {
      getSpy.mockRestore();
    }
  });

  // F4, fresh Opus delta pass (third round on this same mechanism), live-reproduced:
  // stopping the walk at the first non-ALL matched entry was ITSELF still a prediction --
  // a specific-method handler can call `next()` and hand the request on, exactly like
  // `.use()` does. `assertRouteIsClassified` no longer predicts a terminal route at all;
  // it checks every matched entry except the two declared catch-alls, unconditionally.
  function spyRegistryFor(classifiedKey: string) {
    const realEntry = policyRegistry.get("get /api/project");
    if (!realEntry) {
      throw new Error("expected a real registry entry to reuse for the spy");
    }
    const originalGet = policyRegistry.get.bind(policyRegistry);
    return vi
      .spyOn(policyRegistry, "get")
      .mockImplementation((routeKey: string) =>
        routeKey === classifiedKey ? realEntry : originalGet(routeKey),
      );
  }

  it("refuses (500) an unclassified route behind a classified GET pass-through handler that calls next() (F4a)", async () => {
    await resetTestDatabase();
    const member = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(member.user);

    const { app } = createApp();
    const getSpy = spyRegistryFor("GET /api/__test_f4a__/*");

    try {
      app.get("/api/__test_f4a__/*", async (_c, next) => {
        await next();
      });
      app.get("/api/__test_f4a__/x", (c) => c.text("should never be reached"));

      const response = await app.request("/api/__test_f4a__/x");

      expect(response.status).toBe(500);
      expect(await response.text()).not.toBe("should never be reached");
    } finally {
      getSpy.mockRestore();
    }
  });

  it("refuses (500) an unclassified route behind a classified multi-method pass-through handler (F4b)", async () => {
    await resetTestDatabase();
    const member = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(member.user);

    const { app } = createApp();
    const getSpy = spyRegistryFor("POST /api/__test_f4b__/*");

    try {
      app.on(["GET", "POST"], "/api/__test_f4b__/*", async (_c, next) => {
        await next();
      });
      app.post("/api/__test_f4b__/x", (c) => c.text("should never be reached"));

      const response = await app.request("/api/__test_f4b__/x", {
        method: "POST",
      });

      expect(response.status).toBe(500);
      expect(await response.text()).not.toBe("should never be reached");
    } finally {
      getSpy.mockRestore();
    }
  });

  it("refuses (500) an unclassified literal route behind a classified parameter route that conditionally calls next() (F4c)", async () => {
    await resetTestDatabase();
    const member = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(member.user);

    const { app } = createApp();
    const getSpy = spyRegistryFor("GET /api/__test_f4c__/{id}");

    try {
      app.get("/api/__test_f4c__/:id", async (c, next) => {
        if (c.req.param("id") === "special") {
          await next();
          return;
        }
        return c.text("param handler ran");
      });
      app.get("/api/__test_f4c__/special", (c) =>
        c.text("should never be reached"),
      );

      const response = await app.request("/api/__test_f4c__/special");

      expect(response.status).toBe(500);
      expect(await response.text()).not.toBe("should never be reached");
    } finally {
      getSpy.mockRestore();
    }
  });

  it("GET /api/invitation/pending still returns 200 after F4's fix (its former sibling GET /api/invitation/{id} is now deprecated/permanently disabled, not deleted, but still a genuinely different, classified route)", async () => {
    await resetTestDatabase();
    const member = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(member.user);

    const { app } = createApp();
    const response = await app.request("/api/invitation/pending");

    expect(response.status).toBe(200);
  });

  // F5, fourth Opus delta pass, live-reproduced: exempting a matched entry by its KEY
  // STRING ("ALL /*" / "ALL /api/*") assumed the key identifies the reviewed CORS/
  // compress/static-serving/auth-guard middleware -- it only identifies where something
  // is MOUNTED. None of these five shapes needs a policyRegistry spy (unlike B3/F4): each
  // one registers an UNCLASSIFIED handler directly at one of the two declared catch-all
  // keys, which the old key-based exemption let straight through.
  it("refuses (500) an unclassified app.all() fallback registered directly at ALL /api/* (F5-D1)", async () => {
    await resetTestDatabase();
    const member = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(member.user);

    const { app } = createApp();
    app.all("/api/*", (c) => c.text("should never be reached"));

    const response = await app.request("/api/__test_f5_d1_anything__");

    expect(response.status).toBe(500);
    expect(await response.text()).not.toBe("should never be reached");
  });

  it("refuses (500) an unclassified .use('/api/*', ...) that itself answers a request (F5-D2)", async () => {
    await resetTestDatabase();
    const member = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(member.user);

    const { app } = createApp();
    app.use("/api/*", async (c) => c.text("should never be reached"));

    const response = await app.request("/api/__test_f5_d2_anything__");

    expect(response.status).toBe(500);
    expect(await response.text()).not.toBe("should never be reached");
  });

  it("refuses (500) an unclassified handler reached via .mount() at ALL /api/* (F5-D3)", async () => {
    await resetTestDatabase();
    const member = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(member.user);

    const { app } = createApp();
    app.mount("/api", async () => new Response("should never be reached"));

    const response = await app.request("/api/__test_f5_d3_anything__");

    expect(response.status).toBe(500);
    expect(await response.text()).not.toBe("should never be reached");
  });

  it("refuses (500) an unclassified sub-router's own .all('*') mounted at /api (F5-D4)", async () => {
    await resetTestDatabase();
    const member = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(member.user);

    const { app } = createApp();
    const { Hono } = await import("hono");
    const sub = new Hono();
    sub.all("*", (c) => c.text("should never be reached"));
    app.route("/api", sub);

    const response = await app.request("/api/__test_f5_d4_anything__");

    expect(response.status).toBe(500);
    expect(await response.text()).not.toBe("should never be reached");
  });

  it("refuses (500) an unclassified app.all('*', ...) registered directly at ALL /* (F5-D5)", async () => {
    await resetTestDatabase();
    const member = await createWorkspaceMember({ role: "admin" });
    mockAuthenticatedSession(member.user);

    const { app } = createApp();
    app.all("*", (c) => c.text("should never be reached"));

    const response = await app.request("/api/__test_f5_d5_anything__");

    expect(response.status).toBe(500);
    expect(await response.text()).not.toBe("should never be reached");
  });
});
