// Test-harness settings for `pnpm test:release` (scripts/sit/release-suite.mjs). They live
// under tests/ because the application never reads them.
export const sitAgentOrigin =
  process.env.SIT_AGENT_ORIGIN ?? "https://ticketing.localhost";
export const sitPortalOrigin =
  process.env.SIT_PORTAL_ORIGIN ?? "https://portal.localhost";
export const sitAccountsFile = process.env.SIT_ACCOUNTS_FILE;
// Optional name, slug, key or id that pins which workspace and project the journeys use; unset
// means the signed-in user's first workspace and the first project that accepts a task.
export const sitReleaseWorkspace = process.env.SIT_RELEASE_WORKSPACE;
export const sitReleaseProject = process.env.SIT_RELEASE_PROJECT;
