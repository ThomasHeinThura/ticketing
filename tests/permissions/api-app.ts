/**
 * The one place the permissions suite reaches into the API.
 *
 * It loads the **constructed Hono app** and the **constructed better-auth instance** — not the
 * OpenAPI document, and not a hand-kept list. `apps/api/src/index.ts` builds its app at module
 * load and guards `startServer` behind an is-main-module check, so importing it registers every
 * route without opening a port or a database connection.
 *
 * Lane C's CI job wires `pnpm test:permissions`; it must not write a second route scanner.
 */

import {
  type CollectedRoute,
  collectMiddleware,
  collectRoutes,
  type HonoLikeApp,
  type PolicyRegistry,
  type RouteKey,
} from "@taskdesk/permissions";

export async function loadApiApp(): Promise<HonoLikeApp> {
  const module = await import("../../apps/api/src/index");
  const app = module.default as unknown as HonoLikeApp;
  if (!Array.isArray(app?.routes)) {
    throw new Error(
      "apps/api/src/index.ts no longer default-exports a Hono app with a `routes` array — route coverage cannot enumerate the router",
    );
  }
  return app;
}

export async function loadPolicyRegistry(): Promise<PolicyRegistry> {
  const module = await import("../../apps/api/src/policy-registry");
  return module.policyRegistry;
}

export async function loadRouterRoutes(): Promise<CollectedRoute[]> {
  return collectRoutes(await loadApiApp());
}

export async function loadRouterMiddleware(): Promise<RouteKey[]> {
  return collectMiddleware(await loadApiApp());
}

/** The better-auth plugin ids actually constructed, read off the instance. */
export async function loadBetterAuthPluginIds(): Promise<string[]> {
  const module = await import("../../apps/api/src/auth");
  const auth = module.auth as unknown as {
    options?: { plugins?: Array<{ id?: string }> };
  };
  const plugins = auth?.options?.plugins;
  if (!Array.isArray(plugins)) {
    throw new Error(
      "better-auth's constructed options no longer expose `plugins` — the /auth/* allowlist assertion cannot run, and one wildcard mount hides dozens of endpoints",
    );
  }
  return plugins.map((plugin) => plugin.id ?? "<unnamed>");
}
