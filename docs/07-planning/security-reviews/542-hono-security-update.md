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
