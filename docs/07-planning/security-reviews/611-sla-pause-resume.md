# PR #611 — independent review record for the SLA pause batch

**Reviewed head:** `43cd20366e432704ba5a4eb2c6877e511b7331f9`
**Comparison base:** `a319442f1804c1733c08bfb63157d6191199e801` (PR #513's preserved source head)
**PR:** [#611 — feat(sla): complete defined pause persistence](https://github.com/ThomasHeinThura/ticketing/pull/611)
**Review date:** 2026-10-09

This note binds the reviews and verification below to the source candidate `43cd203`. Any
later commit on the PR must remain inside `docs/07-planning/security-reviews/` to retain that
binding. The note is review evidence, not feature acceptance, phase completion, or merge
approval.

## Source and review history

The reviewed source sequence is:

| Head | Source delta |
| --- | --- |
| `ed37764ada0d82fe99a373ccb09bff2d49247537` | Initial defined SLA pause persistence candidate, on top of PR #513's `a319442f`. |
| `95927e4635f2cc2e7b66fe2ee94b82297ef7bf7e` | Structural ordered-effect state fix: later authored pause/resume effects observe earlier writes and conflicts roll back both metrics. |
| `d409c0158e396b8e0aa8d1f8902ba79d02f4b1b1` | Branch-local provisional migration journal and snapshot at idx 102; remove duplicate test-only DDL. |
| `43cd20366e432704ba5a4eb2c6877e511b7331f9` | Check parent-project liveness inside manual pause transaction; add project-freeze race and manual-interval preservation regressions. |

### Ordinary reviews

- **GPT-6 Luna — migration scope at `d409c0158e396b8e0aa8d1f8902ba79d02f4b1b1` (`/root/sla_d409_luna_migrations`): APPROVE for that scope.** The review checked the migration, snapshot, journal prefix, and pause/resume persistence invariants. It found the missing regression for preserving a manual interval and did not run tests or builds.
- **GPT-6 Luna — authority scope at `d409c0158e396b8e0aa8d1f8902ba79d02f4b1b1` (`/root/sla_d409_luna_authority`): REQUEST CHANGES.** Blocking finding: the manual pause transaction did not recheck the parent project's live state after reach middleware. It required the shared transactional invariant and a forced-boundary no-write regression.
- **GPT-6 Luna — current delta at `43cd20366e432704ba5a4eb2c6877e511b7331f9` (`/root/sla_43cd_delta_luna`): APPROVE, no blocking finding.** The reviewer checked the full candidate and the focused delta, confirmed the project lock/check and the two regressions, and ran `git diff --check`; it did not run runtime tests, a build, Docker, or browser checks.
- **GPT-6 Luna — authority delta at `43cd20366e432704ba5a4eb2c6877e511b7331f9` (`/root/sla_d409_luna_authority`, continuing its prior independent review): prior P2 finding resolved; no new blocking finding.** It confirmed the project `FOR SHARE` behavior and no-write result after the freezer wins; it did not run tests, a build, or Docker.

### Required security review

- **GPT-6 Sol — full independent security review at `43cd20366e432704ba5a4eb2c6877e511b7331f9` (`/root/sla_43cd_full_security_sol`): CLEAR for the implemented security scope.** The reviewer was a fresh independent context and did not author, direct, or remediate the candidate. The review covered manual pause route reach/workspace/API-key scope/capability checks, transaction and two-metric conflict behavior, work-item and parent-project locks, workflow pause/resume effect ordering, SLA read scoping, and migration/schema/snapshot consistency. It found no blocking security issue. This does not clear pending product contracts, red required checks, or merge gates.

The author context is GPT-6 Luna (`/root/p2_sla_existing_completion`). The review identities
above are the canonical collaboration-task context IDs supplied by the orchestrator; they
are not provider session UUIDs. No opaque provider-session UUID was included in the review
handoffs, and none is inferred here. Author and reviewer contexts are distinct.

## Verification and exact-head status

### Checks actually run at `43cd203`

- Author-run API integration: `work-item-transition.test.ts` plus `sla-policy.test.ts`, **2 files / 26 tests passed**, using `CI=true` and an owned Testcontainers PostgreSQL 18 `*_test` database. Vitest exited normally and its global teardown stopped the disposable container.
- Author-run API typecheck: passed.
- Author-run Biome checks on changed source/test files and `git diff --check`: passed.
- The prior migration/snapshot unit check `workspace-role-unique-schema-drift.test.ts`: **1 file / 1 test passed** at `d409c0158e396b8e0aa8d1f8902ba79d02f4b1b1`; `drizzle-kit generate` reported no schema changes. The migration files were unchanged at `43cd203`.
- Sol-run `pnpm check:route-policy`: **14 files / 89 tests passed**.
- Sol-run `pnpm check:openapi`: failed during export under Node `v26.10.0` with `RangeError: Maximum call stack size exceeded` in Zod/Zod-to-OpenAPI. No image, Docker, database integration, or browser check was run in the Sol review context.

### Controlled OpenAPI comparison

After the Sol review, the exporter was run once on `43cd203` and once on a disposable,
detached worktree at exact parent `a319442f1804c1733c08bfb63157d6191199e801`, using the
same local Node `v26.10.0`, same lockfile/dependency installation, and the direct
`@taskdesk/api openapi:export` command (no build or dependency change). Both exports failed
with the same stack: Zod error initialization → `safeParse` → `isNullableSchema` in
`@asteasolutions/zod-to-openapi@9.1.0`, then `generateSchemaWithMetadata`, and HTTP 500.

The new manual-pause route has no request body and reuses `workItemSlaSchema`. The exact
parent already imports that schema and uses it on the existing `GET /work-items/{key}/sla`
operation. `sla-response.ts`, the existing response schema, the exporter, package manifest,
and lockfile are unchanged between parent and candidate; the new `sla_pause` table is not
an OpenAPI schema. The failure is therefore reproduced on the preserved parent and is not
introduced by the new pause route or its response. The precise inherited schema that
triggers the Zod-to-OpenAPI recursion was not isolated; no speculative exporter fix was
included. Defer that investigation to a dependency-safe OpenAPI baseline task.

### Hosted checks observed at `43cd203`

The exact-head GitHub check snapshot was mixed; this note does not relabel red jobs as
passing. Green checks included route policy/permission matrix, build, domain coverage,
helm lint/template, accessibility, CI configuration, secret scan, and GitGuardian. Red
checks included OpenAPI drift, integration PostgreSQL 18, unit/component, static, registers,
gate checkers, dependency audit, PR template/security review, protected-route E2E, G8 visual
regression, and G11 performance. Static, registers, OpenAPI, unit's web route-tree failures,
and the 119-failed/21-passed integration summary were already red on the #513 base in the
earlier read-only #611 CI comparison; the OpenAPI inherited status is additionally confirmed
by the controlled source comparison above. Other red results are recorded as red only; this
note does not assign an unverified cause. The PR-template check also predates this review
note/body link. A note-only push will trigger new hosted checks; their results remain
authoritative.

The provisional migration at idx 102 remains branch-local and has no final/global number
allocation. Parent migration journal entries 0–101, `0101_productive_hawkeye.sql`, and
`0101_snapshot.json` remain unchanged; their SHA-256 hashes are respectively
`0229167d3a5afc49bbd520d73256fd24c4b3e537d8f69c332193ab822cac7ec6` and
`518878db91595576af915fac64a1fc614d383af71425bbb4cdc87f884263a7e7`.

## Pending paths and acceptance limits

- Completion/reopen `resolved` pause continuity and manual-resume interaction with an open
  resolved interval remain pending the human product decision. Those paths are absent.
- SLA pause-detail response DTO/UI shape remains pending approval and is absent.
- The chosen two-metric manual pause behavior is recorded in the SLA owning spec. CA-7 maps
  an activity field named `sla_pause` to internal visibility, but does not mandate an
  activity row for every pause; the canonical event catalogue has no pause/resume event.
  No event or audit key was invented.
- Browser verification and image build/boot/health evidence are **BLOCKED / not established**.
  The source change is backend-only; no UI screen was changed or opened.
- The hosted CI snapshot contains required red checks, including the inherited OpenAPI
  failure. No check is waived. This review note does not claim PR acceptance, SLA slice
  completion, P2 phase completion, deployment, or merge authorization.

## Evidence record hashes

The private reviewer reports and controlled exporter logs are retained under
`/Users/heinthura/.codex/taskdesk-evidence/2026-10-09/`:

| Evidence | SHA-256 |
| --- | --- |
| `p2-sla-43cd-luna-delta.md` | `aaade2f5965f8147f299cfb3e7d94d1c446203a765d988113f732216ef510f4c` |
| `p2-sla-43cd-luna-authority.md` | `f50a2765045861dc9b4ed2a17cce4a028017beb220faa8b34de767dab10a7e6b` |
| `p2-sla-d409-luna-migrations.md` | `1adc02bcafa9db9f65d040647e9b5c5ce3f30c93c451ac47735eb1110bfa909a` |
| `p2-sla-d409-luna-authority.md` | `9f11ed28a29926b51e5d2ed0228ae80e4c53c2aff772ddab851f34bbc7c2217c` |
| `p2-sla-43cd-sol-security.md` | `8be19b3f03f164088cc5aa649239c651ec16ff3d58835b853a48544db812a789` |
| `p2-openapi-43cd-node26.log` | `c8e89285d2b21ef377889aee4bafd2d8c0202e7b4c48a8ebd37ea109c4f6611a` |
| `p2-openapi-a319-node26.log` | `c4c9a01d0753f5d934c53c240c8e470c8f59c25f50b0233aa75daad48b4fc66f` |
