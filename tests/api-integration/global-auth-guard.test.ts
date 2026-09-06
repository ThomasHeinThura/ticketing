import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";

/**
 * Direct regression guard for the global authentication middleware.
 *
 * `api.use("*")` in apps/api/src/index.ts is the single control that stands in
 * front of every route mounted below it. It is one line of control flow, and
 * it has already been broken once: unwrapping kaneo's
 * `Sentry.withIsolationScope(async () => {...})` left
 *
 *     return async () => { ...await authenticateApiRequest(c)... };
 *
 * an arrow function that was RETURNED but never INVOKED. The guard body never
 * ran, and every request through it succeeded unauthenticated.
 *
 * The wider integration suite did catch that — fifteen files failed. But it
 * caught it as a diffuse wave of "expected 200 to be 403" across unrelated
 * features, which reads like a fixture problem, not like "the API has no
 * authentication". This file says that one thing directly, so the next such
 * break names itself.
 *
 * Deliberately NOT asserted here: which routes are exempt. That list belongs
 * to #7's route-policy registry, and duplicating it here would make this test
 * a second, drifting source of truth.
 */
describe("the global authentication guard", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  // One route per surviving router mounted below the guard. If any of these
  // ever answers an unauthenticated caller, the guard is not running.
  const protectedRoutes = [
    "/api/project",
    "/api/task/some-task-id",
    "/api/column/some-column-id",
    "/api/activity/some-task-id",
    "/api/comment/some-task-id",
    "/api/time-entry/some-task-id",
    "/api/label/some-label-id",
    "/api/notification",
    "/api/search?query=anything",
    "/api/workspace",
  ];

  it.each(protectedRoutes)(
    "refuses an unauthenticated GET %s with 401",
    async (route) => {
      const { app } = createApp();

      const response = await app.request(route);

      expect(response.status).toBe(401);
    },
  );

  it("refuses an unauthenticated write, not only reads", async () => {
    const { app } = createApp();

    const response = await app.request("/api/project", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Should never be created" }),
    });

    expect(response.status).toBe(401);
  });

  it("refuses a request carrying a syntactically valid but bogus bearer token", async () => {
    const { app } = createApp();

    const response = await app.request("/api/project", {
      headers: { authorization: "Bearer not-a-real-session-token" },
    });

    expect(response.status).toBe(401);
  });

  it("still serves the routes deliberately mounted above the guard", async () => {
    const { app } = createApp();

    // /api/health is registered before api.use("*") on purpose. Asserting it
    // here means a future "fix" that moves the guard to the top of the file
    // fails loudly instead of silently breaking liveness probes.
    const response = await app.request("/api/health");

    expect(response.status).toBe(200);
  });
});
