// #10: `integration on Testcontainers Postgres 18` is the documented shape
// (docs/04-engineering/ci-cd.md, docs/04-engineering/testing-strategy.md,
// docs/01-architecture/tech-stack.md all say "Testcontainers"). The inherited
// suite instead relied on `.github/workflows/ci-full.yml`'s own plain
// `services:` Postgres container -- that block's own comment admitted this
// was unfinished work. This file is the actual Testcontainers move.
//
// It is CI-only and additive: local and per-worktree lane runs (#113) keep
// using whatever `tests/api-integration/setup.ts` already resolves
// (TASKDESK_DATABASE_URL env var > `.env` fallback > the per-worktree
// derived default) -- nothing here changes that path or its priority order.
// `process.env.CI` is the same signal `scripts/ci/test-all.mjs` already uses
// to distinguish CI from a local run; GitHub Actions sets it to `"true"`.
//
// Vitest runs `globalSetup` once, in the main process, before any worker is
// spawned. Worker processes/threads inherit `process.env` at spawn time, so
// setting `TASKDESK_DATABASE_URL` here -- before `setup.ts` (a `setupFiles`
// entry, which runs per worker/file) ever reads it -- is sufficient; no
// change to `setup.ts`'s own resolution logic is needed. `ensureTestDatabaseExists`
// / `ensureTestDatabaseMigrated` (tests/api-integration/helpers/database.ts)
// already create the database and run migrations lazily against whatever
// `TASKDESK_DATABASE_URL` points to, so a fresh Testcontainer needs nothing
// beyond a reachable connection string.
export default async function setup() {
  if (!process.env.CI) {
    return;
  }

  const { PostgreSqlContainer } = await import("@testcontainers/postgresql");

  const container = await new PostgreSqlContainer("postgres:18-alpine")
    .withDatabase("taskdesk_test")
    .withUsername("postgres")
    .withPassword("postgres")
    .start();

  process.env.TASKDESK_DATABASE_URL = container.getConnectionUri();

  return async () => {
    await container.stop();
  };
}
