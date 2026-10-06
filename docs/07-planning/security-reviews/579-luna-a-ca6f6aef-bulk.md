# Ordinary review A — PR #579 P0 bulk corrective delta

- **Reviewer:** fresh independent GPT-6 Luna context; did not author, direct, or remediate the candidate.
- **Exact reviewed head:** `ca6f6aef28447a0837aeb9347791e54e51108e9c`
- **Worktree:** `/Users/heinthura/.codex/worktrees/p0-bulk-integration/Ticketing.v2`
- **Comparison:** corrective delta `a435657e747b8c12ceb5784e1c991a70a175c51c..ca6f6aef28447a0837aeb9347791e54e51108e9c`, with necessary prior realtime/auth/migration seams inspected against the documented contracts.
- **Initial state:** exact HEAD matched; worktree clean.

## Scope and checks

Inspected complete candidate diff and source seams for native WebSocket topic authorization and fanout, session/MFA and workspace/project authority publishers, in-memory and Valkey control adapters, archived-project eligibility, module logger allowlist and observability settings/schema, forward migration 0087 plus journal ordering, and the relevant architecture contracts (`realtime.md`, `auth-runtime-reconfiguration.md`, `auth-and-identity.md`, `observability.md`, `data-model.md`). Also inspected tests and publisher callsites across `apps/api/src`.

Ran the scoped API unit selection from `apps/api`:

- `pnpm exec vitest run --config vitest.config.ts ../tests/api/ws/native-work-item-realtime.test.ts ../tests/api/observability/settings.test.ts`
- **2 files passed, 12 tests passed** (448 ms).

An initial invocation used paths relative to the wrong Vitest root and found no tests (exit 1); corrected to paths relative to the configured API test root and recorded the actual passing run above. `git diff --check a435..HEAD` reported trailing whitespace in two lines of the already-added historical Luna C review record; no candidate source whitespace issue was reported before those entries. No source or Git state was changed.

## Verdict

**PASS — no blocking source finding identified in the reviewed corrective delta.**

The control invalidation schema is closed, requires at least one nonempty target, routes only to local native connections, and is carried on `taskdesk:control`, not browser fanout. Target matching uses stored authorized topic metadata, and each match reauthenticates/re-authorizes against current database state. Both project and work-item topic authorization reject archived/deleted projects; project archive/delete/unarchive publishers follow successful controller mutations. Session delete, MFA enrollment/reset, and workspace membership/role/ownership/lifecycle handlers publish after their awaited mutation functions return. Workspace-scoped events target topic-bearing connections in that workspace; user-scoped events reauthenticate all of that user's connections. Lost publish remains bounded by the documented periodic reauthorization floor.

The Valkey adapter uses a dedicated control subscription and removes its handler/unsubscribes during shutdown; control parse failures do not echo payload contents. Realtime operational failures use the fixed `realtime.failure` allowlisted message without exception text or identifiers. The 0087 check extends the previously closed set with `realtime`; old accepted module keys remain valid, and the forward journal entry follows 0086. The inspected changed API source aligns with these contracts.

## Blockers

None found.

## Non-blocking limits / acceptance evidence

- This scoped review did not run database/container, browser, full integration, build, hosted CI, or runtime traffic checks, as instructed. The report is not evidence for those gates.
- The packet records that hosted G11 is still failing and that the expanded E2E/browser evidence is not yet a new hosted pass. That remains a separate factual gate, not a source defect established by this review.
- The packet's prior runtime receipt lacks complete clean-date evidence; no runtime/date acceptance is asserted here.
- `git diff --check` flags trailing spaces in two lines of the historical C review report, outside the corrective source changes.
- Final observed HEAD remained `ca6f6aef28447a0837aeb9347791e54e51108e9c`; worktree remained clean.
