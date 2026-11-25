// Test-harness settings for `pnpm test:release` (scripts/sit/release-suite.mjs). They live
// under tests/ because the application never reads them.
export const sitAgentOrigin =
  process.env.SIT_AGENT_ORIGIN ?? "https://ticketing.localhost";
export const sitPortalOrigin =
  process.env.SIT_PORTAL_ORIGIN ?? "https://portal.localhost";
export const sitAccountsFile = process.env.SIT_ACCOUNTS_FILE;
