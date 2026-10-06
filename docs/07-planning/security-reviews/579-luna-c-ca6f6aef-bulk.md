# Independent ordinary review C

- **Reviewer:** GPT-6 Luna, fresh independent context; no author, fixer, or implementation role.
- **Exact candidate head:** `ca6f6aef28447a0837aeb9347791e54e51108e9c`
- **Reviewed delta:** `a435657e747b8c12ceb5784e1c991a70a175c51c..ca6f6aef28447a0837aeb9347791e54e51108e9c`
- **Repository:** `/Users/heinthura/.codex/worktrees/p0-bulk-integration/Ticketing.v2`
- **Packet:** `/Users/heinthura/.codex/taskdesk-evidence/2026-10-04/p0-bulk-review-ca6f6aef/packet.md`
- **HEAD/worktree:** exact requested HEAD confirmed before and after review. Worktree was clean before report creation; no source or Git mutation performed. This report is the only output written.

## Scope and review

Read the required repository guidance (`AGENTS.md`, agent workflow, `CLAUDE.md`, current status, newest decision log), the supplied packet, and the relevant realtime, data-model, observability, auth/runtime contracts and source. Inspected the complete delta and necessary existing seams for session/MFA/role/member/project invalidation, private control-channel targeting and lifecycle, archived-project authorization, logging, and migration `0087`.

The changes generally match the selected contract: invalidation is emitted after the traced committed writes; user targets reauthenticate matching user connections, workspace/project targets reauthorize matching topics; adapters keep control messages off browser sockets; the 60-second refresh remains; both native project and work-item authorization reject archived projects; and `0087` preserves the six old log modules while allowing `realtime` in the DB constraint. No additional authority grant or route was found in this scope.

## Checks actually performed

- `pnpm --filter @taskdesk/api exec vitest run --config vitest.config.ts ../../tests/api/ws/native-work-item-realtime.test.ts ../../tests/api/observability/settings.test.ts` — **2 files, 12 tests passed**.
- `git diff --check a435657e747b8c12ceb5784e1c991a70a175c51c ca6f6aef28447a0837aeb9347791e54e51108e9c` — reports two trailing-whitespace lines in the pre-existing committed review note `docs/07-planning/security-reviews/579-luna-c-a435657e-bulk.md` (lines 3–4); no source formatting issue observed in the reviewed delta.
- Exact HEAD confirmed as `ca6f6aef28447a0837aeb9347791e54e51108e9c` after review.

The first scoped Vitest invocation used paths relative to the wrong working directory and found no tests; corrected invocation above is the passing run. I did not run Docker, builds, browser/E2E, Turbo, PostgreSQL, broad suites, or hosted checks. Packet-reported hosted G11/E2E/a11y results, PG pending state, checker/G8 structural failures, runtime evidence, fixture failure, and zero clean dates remain packet evidence/limitations, not claims from this review. No stage or hosted acceptance is claimed.

## Verdict: BLOCK

### Blocking finding

1. **Native hint failure still logs arbitrary exception text outside the finite allowlist.** In `apps/api/src/ws/index.ts`, `broadcastNativeWorkItemHint` catches adapter publication errors and calls `console.error("Failed to publish native work-item realtime hint:", error)`. This is the same native realtime path whose new `realtime.failure` event and allowlisted logger were introduced in this delta. Adapter/client exceptions can contain arbitrary connection/configuration text; passing the error object bypasses the observability field/message allowlists and can expose sensitive runtime details. Replace it with the finite `logTaskDesk` record (module `realtime`, message `realtime.failure`, result `failed`, no exception object), consistently with the new socket failure sites, and add/adjust a focused assertion if the existing logging tests can cover it. Location: `apps/api/src/ws/index.ts`, `broadcastNativeWorkItemHint` catch around line 351.

### Non-blocking limits

- The packet reports current checker and G8 config-structure failures under active author remediation. I did not rerun those checks; they remain unresolved acceptance evidence, not findings attributed to this source delta.
- Current hosted checks are not all green on the exact candidate per packet (PG pending); representative traffic setup failed before traffic and there are zero clean UTC dates. This review does not establish runtime acceptance or phase completion.
- The migration's forward-only shape and snapshot/journal correspondence were inspected statically; no database migration execution was performed.
- The scoped tests do not exercise multi-replica Valkey control delivery or full real-database lifecycle behavior.
