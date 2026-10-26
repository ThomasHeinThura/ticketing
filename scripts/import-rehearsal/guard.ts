/**
 * Rehearsal guard. This module MUST be the first import of `rehearse.ts`: ES modules evaluate their
 * imports in order, so the checks below run before any application module (and therefore before
 * any database pool or `.env` loader) exists.
 *
 * It refuses, with a fixed message that never echoes a URL or credential, unless ALL hold:
 *   - TASKDESK_DATABASE_URL is set explicitly in the environment (never read from a `.env`);
 *   - the database is not `taskdesk_browser_journey_1022_test` (the live browser database);
 *   - the port is not 62870 (the live browser database server);
 *   - the host is loopback;
 *   - `--confirm-copy=<database name>` repeats the exact database name.
 */
export const LIVE_DB_NAME = "taskdesk_browser_journey_1022_test";
export const LIVE_DB_PORT = "62870";

function refuse(message: string): never {
  process.stderr.write(`import-rehearsal refused: ${message}\n`);
  process.exit(2);
}

const raw = process.env.TASKDESK_DATABASE_URL?.trim();
if (!raw) refuse("TASKDESK_DATABASE_URL must be set explicitly");
let parsed: URL;
try {
  parsed = new URL(raw);
} catch {
  refuse("TASKDESK_DATABASE_URL is not a valid URL");
}
const database = decodeURIComponent(parsed.pathname.replace(/^\//u, ""));
const port = parsed.port || "5432";
if (!/^[A-Za-z0-9_]{1,63}$/u.test(database))
  refuse("the database name must be letters, digits and underscores");
if (database === LIVE_DB_NAME)
  refuse("this is the live browser database; use a restored copy");
if (port === LIVE_DB_PORT)
  refuse("port 62870 is the live browser database server");
if (!["127.0.0.1", "localhost", "[::1]", "::1"].includes(parsed.hostname))
  refuse("the rehearsal database must be on a loopback host");
const confirm = process.argv
  .find((arg) => arg.startsWith("--confirm-copy="))
  ?.slice("--confirm-copy=".length);
if (confirm !== database)
  refuse(
    "pass --confirm-copy=<database name> to confirm this is a restored copy",
  );

// Same defaults the integration harness uses; never override an explicit value.
process.env.NODE_ENV ??= "test";
process.env.TASKDESK_ROLE ??= "all";
process.env.TASKDESK_AGENT_URL ??= "http://localhost:1337";
process.env.KANEO_API_URL ??= "http://localhost:1337";
process.env.TASKDESK_PORTAL_URL ??= "http://portal.localhost:5174";

/** libpq environment for pg_dump / pg_restore, so no credential ever appears on a command line. */
export function pgToolEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PGHOST: parsed.hostname.replace(/^\[|\]$/gu, ""),
    PGPORT: port,
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: database,
  };
}

export const target = {
  database,
  port,
  /** Connection string for the maintenance database, for DROP/CREATE DATABASE. Never print it. */
  adminUrl: (() => {
    const url = new URL(raw);
    url.pathname = "/postgres";
    return url.toString();
  })(),
  url: raw,
};
