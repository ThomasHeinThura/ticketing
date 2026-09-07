/**
 * Enumerating the router means importing the API's Hono app, and the app's module graph reads
 * its bootstrap environment at import time. These defaults keep `pnpm test:permissions`
 * runnable with no environment at all — which is the point: CI wires one command, not a
 * checklist of variables. Anything already set by the caller wins.
 *
 * These are bootstrap values only, and each is in
 * `docs/05-operations/configuration-reference.md`. Nothing here reaches a database: the app is
 * constructed, never started, because `index.ts` guards `startServer` behind an is-main check.
 */
const DEFAULTS: Record<string, string> = {
  NODE_ENV: "test",
  TASKDESK_AUTH_SECRET: "permissions-suite-secret-with-at-least-32-chars",
  TASKDESK_AGENT_URL: "http://localhost:5173",
  TASKDESK_PORTAL_URL: "http://localhost:5174",
  TASKDESK_DATABASE_URL:
    "postgresql://postgres:postgres@127.0.0.1:1/taskdesk_route_enumeration_only",
};

for (const [key, value] of Object.entries(DEFAULTS)) {
  if (process.env[key] === undefined || process.env[key] === "") {
    process.env[key] = value;
  }
}
