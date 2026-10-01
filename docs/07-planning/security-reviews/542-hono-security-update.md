# PR #542 — Hono dependency update: independent review and runtime evidence

**Reviewed head:** `268f4b82db1b6e4e1aa8523fb791df38ad520c30`
**Comparison base:** `c4475d93f98384c79370a4383bad82df75ebb31e`
**Change:** Hono `4.13.5` → `4.13.7` in the API, web, and typed-client workspaces, with the resulting lockfile update. No application source, route, permission, or CI authority code changed.

## Independent reviews

- **Ordinary review:** GPT-6 Luna, fresh independent context, exact head above; [recorded PR review](https://github.com/ThomasHeinThura/ticketing/pull/542#pullrequestreview-5378843598). Verdict: **CLEAR**, with a non-blocking observation that optional/transitive lockfile movement is broader than the direct Hono fix.
- **Security review:** GPT-6 Sol, fresh independent context, exact head above; [full review comment](https://github.com/ThomasHeinThura/ticketing/pull/542#issuecomment-5930777328). Verdict: **CLEAR**, no blocking finding attributable to this change. It examined all four changed files, the Hono override, API startup/error/CORS setup, typed client transport, authenticated WebSocket handlers, and Hono peer compatibility.

The Sol review found no first-party use of `hono/jsx`, `hono/jsx/dom/server`, `renderToString`, or `renderToReadableStream`; the upgrade removes the older vulnerable Hono version, but no currently exploitable application call site was identified. It also found no authority or policy change.

## Review checks and counts

The independent Luna review recorded:

- Frozen install accepted the lockfile; `pnpm check:deps` passed for 9 workspace packages/apps and 1,184 source files.
- `pnpm --filter @taskdesk/libs test`: 2 files / 5 tests passed.
- `pnpm --filter @taskdesk/api typecheck`: passed after workspace prerequisites were built.
- `pnpm --filter @taskdesk/api test:unit`: 67 files / 536 tests passed.

The independent Sol review additionally recorded:

- `pnpm --filter @taskdesk/api test:permissions`: 14 files / 88 tests passed.
- `pnpm audit --prod --audit-level moderate` reported 5 moderate advisories through `ip-address@10.3.1` and `fast-uri@3.1.7`. These exact package versions and their override floors are also present at the comparison base. The hosted dependency-audit job uses the high threshold and passed with those moderate findings present. The graph is not vulnerability-free.

The lockfile contains additional optional/transitive resolution movement, including snapshots identified in the Luna and Sol reviews (`saslprep`/`bson`, `effect`, `lodash`, `nypm`/`tinyexec`, `pkg-types`/`confbox`, `seroval`, `sql-escaper`, `type-fest`, and `valibot`). Both reviewers found no introduced first-party import, authority path, or policy change. Narrowing this churn remains a non-blocking observation.

## Local image build and isolated runtime

Performed against the exact reviewed source tree above, using the existing OrbStack Docker context. This was a local image/runtime check only; it does not claim stage completion, release acceptance, browser verification, or a WebSocket handshake.

- OrbStack Docker client/server: `29.4.0`.
- Dockerfile base: `node:24.20.0-bookworm-slim`, resolved during build to `sha256:ba849c60be29959425b8734d57b8b4b7d56f98edd9504c9af091d5281095a71e`; Corepack installed pnpm `10.32.1`.
- `docker build --progress=plain --tag taskdesk:pr542-268f4b82 .`: passed. Turbo built 5 tasks; final image ID `sha256:f0783d088362e3349477dabb4ebce1a3980a1b38e2cbfccda23aaa8401058d95`, size 443,256,487 bytes. Full output: `/private/tmp/pr542-docker-build-268f4b82.log` (SHA-256 `aa6838a681eb86540ba7630b4e6ca8b615c844729a89eb9f431cace1d7ec6042`).
- Booted project `taskdesk542` with PostgreSQL 18.6 (`postgres:18-alpine`) and Valkey 9.1.2 (`valkey/valkey:9-alpine`). The image config and observed running process both identify the application user as UID/GID 10001 (`taskdesk`).
- Migration container exited with status 0; logs report “Database migrated successfully”, application role setup complete, and migration step complete.
- PostgreSQL, Valkey, and the application all reached healthy status. In-container GETs to `/api/public/health/live` and `/api/public/health/ready` both returned `{"status":"ok"}`.
- The smoke project used network `taskdesk-542-smoke-268f4b82` and only its own Compose-scoped volumes (`taskdesk542_postgres-data`, `taskdesk542_valkey-data`, `taskdesk542_taskdesk-data`). Compose config and container inspection confirmed **no published host ports**. The existing development, WSO2, and other OrbStack containers/volumes were not modified.
- After retaining the build/runtime evidence above, removed only this smoke project’s containers, network, three scoped volumes, and temporary environment/override files. The built image and build log remain available locally.

## Residuals and scope limits

- The 5 pre-existing moderate `ip-address` / `fast-uri` advisories remain; this PR does not repair them.
- Optional/transitive lockfile churn remains broader than the direct Hono update.
- No browser screen or seeded work-item detail was opened, and no manual Chrome claim or live WebSocket handshake is made. This is package metadata only; no UI source or visual behavior changed.
- At the pre-documentation-update CI snapshot, all required CI contexts except `pull request template + security review` were green; integration had completed successfully. The template failure was caused by the Dependabot PR body omitting its required fixed sections. CI on the documentation commit and corrected PR body remains the authority for merge readiness; do not merge unless all required checks are green on that exact head.

## Current-main composition and validation — 2026-10-01 15:45 UTC

The Hono branch was normally merged with accepted `origin/main` at full SHA
`eb68dcdf82da341c750bd5e6d89f061830d73d60`. Merge commit
`57e1f201afebb2d4c41fe5ea74ac9749e83e7d9b` has parents the prior PR candidate
`8a76d3592d20d7320de3b17d73c7a8771c475377` and that accepted main SHA. Relative to accepted
main, the PR changes remain limited to `apps/api/package.json`, `apps/web/package.json`,
`packages/libs/package.json`, `pnpm-lock.yaml`, and this evidence note; no application source
or permission behavior was added by the composition.

The reviews above remain bound to their recorded source `268f4b82`; they are historical
source reviews and do not clear the new current-main composition. Fresh current-delta ordinary
reviews and a fresh GPT-6 Sol security confirmation remain separate required gates. This
composition record is not a reviewer verdict, a waiver, or merge authorization.

Checks run on the composed tree:

- `pnpm install --frozen-lockfile --ignore-scripts`: passed for all 10 workspace projects; lockfile current.
- `pnpm check:deps`: passed, 9 workspace packages/apps and 1,184 source files.
- `pnpm why hono -r --depth 0`: all three direct consumers (`@taskdesk/api`, `@taskdesk/web`,
  `@taskdesk/libs`) resolve Hono 4.13.7. A separate Hono 4.13.12 remains under optional
  `@prisma/dev`; the graph contains two Hono versions.
- Built workspace prerequisites `@taskdesk/domain`, `@taskdesk/permissions`, and
  `@taskdesk/email`; API and web typechecks passed; API and web production builds passed.
- `@taskdesk/libs` tests: 2 files / 5 tests passed. API unit tests: 67 files / 536 tests
  passed. API permission tests: 14 files / 88 tests passed. Web unit tests: 80 files / 351
  tests passed. `git diff --check origin/main...HEAD` passed before this note update.
- Docker image built from the composed runtime tree in OrbStack (Docker 29.4.0): image
  `taskdesk:hono542-eb68dcdf`, ID
  `sha256:f0783d088362e3349477dabb4ebce1a3980a1b38e2cbfccda23aaa8401058d95`, size
  443,256,487 bytes. The image's revision label is `unknown`; the recorded source is the clean
  current-main merge worktree at `57e1f201afebb2d4c41fe5ea74ac9749e83e7d9b`.
- Booted an isolated Compose project `taskdesk542` using its own network
  `taskdesk-542-smoke-eb68dcdf` and three project-scoped volumes. No host ports were
  published. Migration exited 0 and logged successful database migration and application-role
  setup. PostgreSQL, Valkey and TaskDesk reported healthy; in-container live and ready probes
  both returned `{"status":"ok"}`. TaskDesk ran as UID/GID 10001 (`taskdesk`).
- The isolated containers, network and volumes, plus the temporary environment/override
  files, were removed after the probes. No persistent development stack or its volumes were
  modified. The local image remains for evidence.

This does not establish manual browser verification or a live WebSocket handshake. Five
previously recorded moderate advisories through `ip-address@10.3.1` and `fast-uri@3.1.7`
remain; this composition does not claim a vulnerability-free dependency graph. Required
current-source CI and review gates remain authoritative.

## Current-source independent clearance and labelled runtime — 2026-10-01

**Reviewed head:** `e83e0166eb32f3cedcf727df249a8dd3c7ca8933`
**Comparison base:** `eb68dcdf82da341c750bd5e6d89f061830d73d60`

- **Ordinary review:** fresh independent GPT-6 Luna context
  `/root/p0_avatar555_luna2`; [review 5381981171](https://github.com/ThomasHeinThura/ticketing/pull/542#pullrequestreview-5381981171).
  Verdict **CLEAR** for the full five-path dependency/composition diff, with the advisory
  residual below. The reviewer ran libs tests (2 files / 5 tests), libs typecheck,
  dependency inventory (9 workspace packages/apps / 1,184 source files), and diff checks.
  Its permission-suite attempt passed 84 tests but failed four route-coverage assertions
  because the review worktree contained a built `apps/web/dist`; this environment-precondition
  failure is retained, not represented as a passing 88-test reviewer run.
- **Full security review:** fresh independent GPT-6 Sol context
  `/root/p0_hono542_e83_sol_security`; [review 5382077039](https://github.com/ThomasHeinThura/ticketing/pull/542#pullrequestreview-5382077039).
  Verdict **CLEAR for the current public-only static configuration**, with no blocking
  security finding. It reviewed the runtime peer graph, API/auth/CORS/static/WebSocket
  boundaries, typed client, Vite/Docker layout and static tests. It ran 1 API test file /
  19 tests, diff checks, a bounded malformed-static-path reproduction, and the moderate-level
  dependency audit. The audit reported five moderate `ip-address`/`fast-uri` findings; its
  feed did not report the two newer primary advisories below.

The selected Hono 4.13.7 and Node adapter 1.19.17 remain within the affected ranges of
[GHSA-5r4p-p66f-jhc7](https://github.com/honojs/hono/security/advisories/GHSA-5r4p-p66f-jhc7)
and [GHSA-rmxm-3fg6-px4f](https://github.com/honojs/node-server/security/advisories/GHSA-rmxm-3fg6-px4f),
published September 29. This PR does not fix those advisories. Both exclude public-only
static files. The reviewed production layout copies only public built web files to
`/app/public`, strips source maps, stores attachments outside that root and serves protected
data through authenticated API handlers. The Sol reproduction returned 401 for an ordinary
unauthenticated API path, public SPA HTML for its malformed double-encoded counterpart,
and 404 for missing file paths. It found no private byte under the static root; the malformed
path behavior is still present. A protected static subtree or private mount would invalidate
this disposition. [Issue #557](https://github.com/ThomasHeinThura/ticketing/issues/557) tracks
a compatible update: a Hono-only bump cannot fix the separate Node static helper, and the
installed WebSocket adapter's Node-server peer range must be resolved before upgrading it.

The orchestrator independently downloaded exact-source CI job logs: unit/component job
`110454527883` passed 12 tasks (API 67 files / 536 tests, UI 59/291, web 80/351); PostgreSQL
job `110452489618` passed 126 files / 1,579 tests / 5 tasks. These results are scoped to
`e83e0166`; the final note-only head must still pass every required GitHub check.

A fresh Docker build from clean source `e83e0166` passed all five build tasks and produced
`taskdesk:hono542-e83e0166`, image
`sha256:34291f03cb39cd5ffec244c01011b22831cc57bc954c76ae3ed5171b304cf8e0`.
Its OCI revision label matches the full reviewed source above. Evidence:
`/private/tmp/pr542-e83-image-build.log` and `/private/tmp/pr542-e83-image-inspect.json`.
The isolated project `taskdesk542e83` published no host ports; migration exited 0,
PostgreSQL/Valkey/application reached healthy status, the application ran as UID 10001,
and live/ready probes returned `{"status":"ok"}`. The one-shot migration container's
inherited healthcheck is not an application-health claim; its success criterion is exit 0.
Only that disposable project's containers, network and volumes were removed, with cleanup
exit 0. Runtime proof: `/private/tmp/pr542-e83-smoke-proof.json`.

These are real independent source reviews and an isolated image/runtime check. They do not
claim manual browser verification, a live WebSocket handshake, H1 approval, vulnerability-free
dependencies, stage completion or a phase finalizer. No quality gate is waived.
