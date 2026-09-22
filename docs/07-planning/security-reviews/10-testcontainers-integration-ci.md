# Security review — PR #252, issue #10: swap the `integration` job to Testcontainers Postgres 18

**Reviewed head:** `ae690c5c8bd0bf7082cf6a0a9721bf21e7110b12`

**Reviewer:** Claude Opus 5, independent fresh context, spawned as its own subagent. Did not
author, direct, or remediate any part of this change.

**Why this review is required:** `.github/workflows/**` (the CI/gate machinery itself) and
`apps/api/package.json` + `pnpm-lock.yaml` (the dependency graph) are both in the
security-review path list in `docs/04-engineering/ci-cd.md`. Beyond the letter of the rule,
`integration - Postgres 18` is a required status check on `protect-main`, so every future
pull request depends on this job behaving correctly.

**Method:** reviewed in an isolated detached worktree at the exact head SHA above, never on
`main`. Both test paths executed locally against the real Docker daemon on this host; the
CI-unset path used a private database `secrev_pr252_test` on `td-lane-pg`
(`127.0.0.1:55440`), created for this review and used by nothing else. Dependency integrity
checked against the live npm registry, not against the lockfile's own claims.

**Verdict: CLEAR WITH FINDINGS (non-blocking).**

---

## 1. Scope — exactly the six files claimed, and the merge is clean

HEAD is a merge commit (`e6822b3` + `5c5a028`). `origin/main` is `5c5a028…` at review time
and is an ancestor of HEAD. Per `ci-cd.md`'s conservative merge attribution, both per-parent
diffs were checked rather than only the combined diff:

- **main-parent side** (`5c5a028..HEAD`) — the change under review:

```
 .github/workflows/ci-full.yml         |  47 +--
 apps/api/package.json                 |   2 +
 apps/api/tsconfig.tests.json          |   3 +
 apps/api/vitest.integration.config.ts |   4 +
 pnpm-lock.yaml                        | 685 ++++++++++++++++++++++++++++++-
 tests/api-integration/global-setup.ts |  42 +++
```

- **branch-parent side** (`e6822b3..HEAD`) — four files arriving from `main` (#134's
  concurrent-startup-seed-race work). Each verified **blob-identical** to `main`'s copy.

`git diff-tree --cc HEAD` is empty: the merge commit introduced no content of its own.
Nothing outside the six claimed files.

## 2. The `CI`-only guard is airtight, and matches its sibling exactly

`tests/api-integration/global-setup.ts` opens with:

```ts
if (!process.env.CI) {
  return;
}
```

`scripts/ci/test-all.mjs:595` uses the identical predicate for the identical purpose:

```js
if (entry.ciOnly && !process.env.CI) {
```

Same variable, same truthiness test, same direction. This introduces no new,
differently-behaved signal.

The residual question — "could a developer's shell have `CI` set accidentally?" — was
checked from the other end as well: **nothing in this repository sets `CI`.** A grep across
every `package.json` script, `turbo.json`, `scripts/**` and workflow file finds no
assignment of it. So the only way the Testcontainers path activates locally is a developer's
own pre-existing environment.

If that did happen, the failure mode is benign and loud, not silent and corrupting: the
Testcontainers client would attempt a Docker pull and either succeed (an ephemeral,
self-contained database — it cannot reach or truncate a lane's shared database, because
`global-setup.ts` *overwrites* `TASKDESK_DATABASE_URL` with its own container's URI) or fail
with an explicit Docker error. It cannot produce a wrong-but-green run. `CI=false` as a
literal string would also be truthy here — but that is inherited behaviour identical to
`test-all.mjs`, not something this change introduces.

One narrow, genuine regression vector: a developer who *already* has `CI` set and has no
Docker daemon would find `pnpm test:integration` newly broken. Accepted as negligible.

## 3. Teardown genuinely runs — verified in Vitest's own source and empirically

Not assumed from documentation. Read in the installed `vitest@4.1.11` build:

- `cli-api…js:10809` `_initializeGlobalSetup()` stores the returned function as
  `globalSetupFile.teardown`, throwing if it is not a function.
- `:10823` `_teardownGlobalSetup()` awaits each stored teardown in reverse order.
- `:13997` `Vitest.close()` runs teardown **before** closing the server, for every project,
  and collects (does not swallow silently, does not rethrow) teardown errors.
- `close()` is reached on the normal exit path whether the suite passed or failed.

Empirically confirmed both ways on this host:

- Full suite, `CI=true`: exited 0, and immediately afterwards no `postgres:18-alpine` or
  `testcontainers/ryuk` container remained.
- Deliberate failing probe test, `CI=true`: the suite failed as intended, and the Postgres
  container was still stopped and removed.

**Where the guarantee genuinely stops:** `Vitest.exit()` arms a `teardownTimeout` timer
(default 10s) that force-`process.exit()`s if close hangs, and no teardown runs at all on
`SIGKILL` or a hard crash. That residual case is covered by Testcontainers' Ryuk reaper
(see §6), which is enabled by default, and by the runner VM being destroyed with the job.
Not a defect.

## 4. No credential or connection-string leak path

The container is created with `.withUsername("postgres").withPassword("postgres")`, and
`container.getConnectionUri()` therefore yields
`postgres://postgres:postgres@localhost:<ephemeral-port>/taskdesk_test`.

- **Same class as previously accepted:** ephemeral container, random host port, single-tenant
  runner destroyed with the job, fixture data only, no production reachability.
- **This is a net *reduction* in credential exposure, not an increase.** The `services:`
  block it replaces used `POSTGRES_HOST_AUTH_METHOD: trust` — no password at all — on a
  *fixed, predictable* `5432:5432` publish, with the full connection string written into a
  job-level `env:` visible to every step in the job. The new shape has an actual password, a
  random port, and the URI lives only in the Vitest main process's `process.env` — it is not
  exported to the job environment and no subsequent workflow step can read it.
- **No log or error path prints it.** Grepped every reference to `TASKDESK_DATABASE_URL`:
  `setup.ts:41` prints only the database *name*; `helpers/database.ts:32,40` print only the
  name; `prepare-database-startup.ts:39` prints host/port/database, never credentials. No
  `console.log(process.env)`-shaped dump exists anywhere outside two unrelated unit tests
  that snapshot-and-restore env without printing it.
- **GitGuardian's one finding is this literal.** Independently confirmed: the only
  credential-shaped addition in the entire non-lockfile diff is `.withPassword("postgres")`.
  The repository's own `supply chain - secret scan` and `supply chain - dependency audit`
  checks both pass at this head. Same false-positive class already settled for this project.

The connection URI's scheme is `postgres://` (not `postgresql://`) and its database name is
`taskdesk_test`; `setup.ts`'s `assertTestDatabaseUrl` `_test`-suffix guard is satisfied and
`deriveTestDatabaseUrl` returns it unmodified. No mangling.

## 5. Supply chain — all 82 new lockfile entries verified against the live npm registry

Not sampled. Every package/version key added to `pnpm-lock.yaml` by this change (82 unique)
was fetched from `registry.npmjs.org` and its published `dist.integrity` compared byte-for-
byte with the lockfile's `resolution.integrity`:

```
packages to verify: 82
ALL INTEGRITY HASHES MATCH npm REGISTRY
```

Every one also resolves to a `https://registry.npmjs.org/…` tarball. The diff adds **no**
`git+`, `file:`, `link:` or alternate-registry resolution, and no token or credential.

The two direct dependencies are the genuine, official packages, not typosquats:

| Package | Version | Weekly downloads | Repository | Maintainer |
| --- | --- | --- | --- | --- |
| `testcontainers` | 12.1.0 | ~4.56M | `github.com/testcontainers/testcontainers-node` | `cristianrgreco` |
| `@testcontainers/postgresql` | 12.1.0 | ~2.36M | same repository | same |

`testcontainers` has been on npm since 2018 with 298 published versions; `12.1.0` was
published 2026-08-04. `engines: {node: '>= 22.22'}` is satisfied by the workflow's pinned
Node 24.

The transitive tree (dockerode, docker-modem, ssh2, archiver, tar-fs, protobufjs, `@grpc/*`)
is the expected testcontainers-node dependency set. Note `tar-fs@3.1.3` and `tar-fs@2.1.5`
are both above their respective path-traversal fix lines. pnpm's default build-script
blocking is in force — `cpu-features`, `protobufjs` and `ssh2` postinstall scripts are
*ignored*, not run, so no new arbitrary install-time code executes in CI.

## 6. Nothing was lost with the `services:` block — readiness is strictly stronger

The removed block provided exactly three things, all replaced:

| Removed | Replacement |
| --- | --- |
| `image: postgres:18-alpine` | `new PostgreSqlContainer("postgres:18-alpine")` — same image, same tag |
| `env: POSTGRES_USER/DB`, `ports: 5432:5432` | module sets `POSTGRES_DB/USER/PASSWORD`; Testcontainers publishes an ephemeral host port |
| `--health-cmd "pg_isready -U postgres" --health-interval 5s --health-retries 20` | see below |
| job-level `env: TASKDESK_DATABASE_URL` | set by `global-setup.ts` before any worker spawns |

The job's three steps (`checkout`, `./.github/actions/setup`, `pnpm test:integration`) are
unchanged. No other step referenced the service.

**On the readiness question specifically** — read from
`@testcontainers/postgresql@12.1.0`'s actual source, not from documentation. The constructor
sets `Wait.forAll([Wait.forHealthCheck(), Wait.forListeningPorts()])` with a 120s startup
timeout, and `start()` injects its own healthcheck because the `postgres:18-alpine` image
ships none (`docker inspect` confirms `Config.Healthcheck: null`):

```js
test: ["CMD-SHELL", `PGPASSWORD=… pg_isready --host localhost --username … --dbname …`],
interval: 250, timeout: 1000, retries: 1000
```

That is `pg_isready` polled every 250ms against the *actual target database*, plus a
listening-port check, all of which must pass before `start()` resolves — and
`getConnectionUri()` is only reachable after `start()` resolves. Strictly stronger than the
old 5s-interval / 20-retry service healthcheck, which also only probed the default database.
A fast-starting-but-not-ready container cannot produce a first-connection flake here.

`pnpm test:integration` fans out through turbo to exactly one package script
(`apps/api`'s `vitest run --config vitest.integration.config.ts`), so there is no sibling
integration suite left running without the `globalSetup` hook. `apps/api/vitest.config.ts`
(the unit suite) globs `tests/api/**` only and does not pick up `global-setup.ts`; the
integration config's own `include` matches `*.test.ts` only, so the hook is never collected
as a test.

## 7. Runner permissions were not widened

`.github/workflows/ci-full.yml` has exactly one `permissions:` block, top-level:

```yaml
permissions:
  contents: read
```

It is **unchanged** by this diff. The only diff lines containing the word "permissions" are
inside the new explanatory comment. No job-level `permissions:` block was added, no
`--privileged`, no Docker-in-Docker step, no additional action. Empirically consistent with
the real `workflow_dispatch` run passing on GitHub's own infrastructure.

## 8. Both test paths executed at this head

| Path | Command | Result |
| --- | --- | --- |
| Testcontainers | `env -u TASKDESK_DATABASE_URL CI=true pnpm test:integration` | **599 passed (66 files)**, exit 0, container torn down |
| Local / lane | `env -u CI TASKDESK_DATABASE_URL=…/secrev_pr252_test pnpm test:integration` | **599 passed (66 files)**, exit 0, **no container started** |

Identical results both ways. The CI-unset run confirms the guard holds: no
`postgres:18-alpine` and no `ryuk` container appeared at any point during it.

---

## Findings (all non-blocking)

**F1 — Ryuk introduces a new Docker-socket trust edge on the runner.** Testcontainers starts
a reaper sidecar by default. Verified on this host: `testcontainers/ryuk:0.14.0`, bind-
mounting `/var/run/docker.sock:rw` (not `--privileged`, but socket access is equivalent to
root on the host). This image is pulled from Docker Hub **by mutable tag**, is not covered by
`pnpm-lock.yaml`'s integrity guarantees, and did not exist in the old `services:` shape.

On an ephemeral, single-tenant GitHub-hosted runner, with `permissions: contents: read` and
no secrets available to fork `pull_request` runs, the blast radius is bounded — this is
Testcontainers' standard, widely-deployed design and not a reason to block. Two defensible
postures, for the orchestrating session to pick (neither is required by this review):

- Leave as-is: keeps the teardown backstop for the `SIGKILL`/hard-crash case in §3.
- Add `TESTCONTAINERS_RYUK_DISABLED: "true"` to the `integration` job's `env:`. On a runner
  VM that is destroyed with the job, the reaper protects against nothing, and dropping it
  removes both the socket-mounted container and one Docker Hub pull. It would *not* affect
  local runs, which never reach this code.

**F2 — Two Docker Hub pulls by tag are now inside the required check's critical path.**
`postgres:18-alpine` (unchanged from before) and `testcontainers/ryuk:0.14.0` (new) are both
fetched at test time. Anonymous Docker Hub rate limiting on GitHub-hosted runners is a real,
if intermittent, failure mode for a check every pull request depends on. Worth knowing about
if `integration - Postgres 18` starts failing for reasons unrelated to any diff. Pinning by
digest would also close F1's mutable-tag half.

**F3 — The pull-request body's test count is stale: 595/595 should now read 599/599 (66
files).** The merge from `main` at this head brought in #134's
`tests/api-integration/concurrent-startup-seed-race.test.ts` (+4 tests). 595 was correct
pre-merge. `CLAUDE.md` requires the merging session to verify "the expected suite/file
counts, not just exit code zero" — the expected count at `ae690c5` is **599 tests across 66
files**, confirmed twice above. Body text only; no code change needed.

**F4 — The new comment in `ci-full.yml` is now stale.** It says the Docker-socket behaviour
is "unverified by an actual GitHub Actions run from this change — see the PR for that
confirmation." A real `workflow_dispatch` run on this exact branch has since confirmed it
(4m26s, green). The comment is self-consistent as written (it defers to the PR), so this is
optional tidying, not a correction that has to land before merge.

**F5 — GitGuardian's failing check is the `.withPassword("postgres")` literal and nothing
else.** Independently confirmed by scanning the whole diff for credential-shaped additions;
the lockfile adds no token, no non-registry resolution. Same ephemeral-test-credential class
already settled for this project, and §4 shows the change reduces rather than increases
credential exposure. The repository's own secret-scan gate passes.

---

## Not checked

- GitHub's actual runner image contents were not inspected directly; the permissions claim
  rests on the real `workflow_dispatch` run passing plus the unchanged `permissions:` block,
  not on independent inspection of the runner image.
- The `integration - Postgres 18` check does not currently appear in this pull request's
  check rollup (`ci-full.yml` triggers on `labeled` / `synchronize` / `ready_for_review` /
  `merge_group`). That is a merge-readiness matter for the orchestrating session — branch
  protection needs the required check actually present and green on this SHA — not a
  security finding, and outside this review's remit.
- No attempt was made to re-prove the `workflow_dispatch` run; it was taken as given.
