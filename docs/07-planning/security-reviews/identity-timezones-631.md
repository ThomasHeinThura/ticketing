# Issue #631 — timezone fix review evidence

**Reviewed head:** `c695eb1f9d0dd54e85b11c11886fba77bf75ad31`

The seven-file product/test patch is unchanged from `952ced751cc9684dadf082cbf34d6d287abcbf2b`, cleared by two independent ordinary reviewers and a full independent Sol security reviewer. Fresh ordinary and Sol confirmations bind the accepted-main composition at the head above. This note publishes authentic reports unchanged; historical authors and executions retain their original identities and source coverage. Dispatch metadata and runtime introspection are distinguished in the reports.

Required hosted checks and shipping-image runtime proof are pending. The local Docker daemon and existing SIT health endpoint timed out during the attempted image check; the owned blocked clients were terminated without restarting Docker or changing SIT. No merge, issue closure, SIT acceptance, or stage completion is claimed.

---

## Authentic report: 631-impl-sonnet.md

SHA-256: `0146697d18269b3a749cdb873c4c752b2217d9ad5ae488fd1f358a92f573198e`.

# #631 — identity/session/step-up/comment behaviour across database time zones (Claude Sonnet 5.5)

Branch `codex/identity-db-timezones-631` from origin/main `9bb28099`.

## Method
Own Postgres 18 container (removed by exact id afterwards). The harness convention (see notification-outbox-*-utc tests) is `process.env.TZ` plus `PGOPTIONS="-c timezone=<zone>"` so both the Node process and the database session move. I ran 31 identity/session/step-up/comment/api-key/pending-action/SCIM/OIDC integration files one at a time per zone (UTC, America/New_York, Asia/Yangon). List in the notes tail.

## Reproduction on current main
- UTC: all 31 files pass (366 tests).
- America/New_York: 3 failures — work-item-comment CA-17 edit window x2 (also via comment.test.ts), instance-users-guards "refuses when the requester session is no longer current".
- Asia/Yangon: ~27 failures across instance-users-guards (step-up approve negatives all answer a bare 403 `Forbidden` instead of `step_up_expired`), instance-users (admin grant, deactivation), identity-connection-admin (3), jit-policy-transition (7), local-factor-policy (3), oidc-group-mapping-admin (6), scim-admin (4). Same shape as the historical report (21 Yangon / 2 New York); counts differ because the base differs.

## Cause (actual clock comparisons)
`session.expires_at` and `comment.created_at` are `timestamp without time zone` holding a UTC wall clock (Drizzle writes `toISOString()`, reads `+0000`). Two defects:
1. Bare `now()` compared with `session.expires_at` (auth/repository.ts current-session lock used by every step-up/PA-15 path; pending-action approval; instance users session check; OIDC session tagging x2): PostgreSQL coerces the column through the session TimeZone, so ahead of UTC a live session reads as expired (Yangon: Forbidden) and behind UTC an expired one reads as live (New York).
2. `comment.created_at` was stamped by `DEFAULT now()` (session-local wall clock) but read back as UTC and compared with the 15-minute edit window (CA-17) and used as the first-response time: wrong by the zone offset.
The step-up and pending-action tables are `timestamptz`, so their bare `now()` comparisons are correct and were left alone (the db-time helper documents that wrapping a timestamptz column is itself wrong).

## Fix (no fixture forced to UTC)
- Use the existing `dbNowUtc()` (utils/db-time.ts) for every `session.expires_at` comparison: auth/repository.ts, identity/oidc-login.ts (2), instance/users/repository.ts, pending-action/service.ts.
- create-comment sets `createdAt`/`updatedAt` to `dbNowUtc()` explicitly (same pattern as notification fanout).

## Evidence after the fix
NY and Yangon: the same 31 files, 0 failures (logs /tmp/claude/tz-ny2.log, tz-yg2.log); UTC rerun recorded below. New permanent regression files `identity-clock-ahead-of-utc.test.ts` (Asia/Yangon) and `identity-clock-behind-utc.test.ts` (America/New_York) run work-item-comment, instance-users-guards, instance-users and session-freshness with process and database in the zone (67 tests each). Reverting the source fix makes them fail: 22 failed in Yangon, 3 in New York.

## Residual
Other `timestamp without time zone` columns written with `DEFAULT now()` (not comment) were not audited here; #221 is the general inventory. Only identity/session/step-up/comment suites were run in the three zones.

---

## Authentic report: 631-ordinary-a-luna.md

SHA-256: `cf51bb3a64051c36f62edcd11d6a9db3cd1fc45f031e31d5185ae7b757eff60b`.

# #631 ordinary review A — database-timezone session/comment corrections

**Verdict: PASS, no blocking findings.** This review covers the exact diff from `9bb28099a69d1e599e1d7451ebdf6225e380546c` to `952ced751cc9684dadf082cbf34d6d287abcbf2b` (branch `codex/identity-db-timezones-631`). The candidate changes five API files and adds two integration wrapper files.

## Reviewer and method

- **Review role:** ordinary independent reviewer A; fresh context, independent of the implementation author, and did not author, direct, or remediate this candidate.
- **Model provenance:** dispatched explicitly with `model=gpt-6-luna` (confirmed by the orchestrator). The literal served backend/model identity is not introspectable from inside this runtime.
- **Comparison:** exact base and head above, resolved with `git rev-parse`; reviewed candidate content using `git diff`, `git show`, and `git grep` against those object ids. No candidate checkout or mutable worktree source was used.
- **Commands run:** exact-object `git diff --stat`, `git diff --name-status`, targeted `git diff --no-ext-diff --unified=12`, `git show` for `db-time.ts`, both new tests, and the relevant architecture/spec files, `git grep` of all session-expiry comparisons, and `git diff --check` for this base/head pair. The whitespace check passed. I did not run tests, typecheck, lint, PostgreSQL, browser, or Docker.
- The current repository checkout had unrelated dirty files; I did not alter or use them as candidate source.

## Review

The change is consistent with the documented convention: `session.expires_at` and comment timestamps are `timestamp without time zone` values representing UTC wall time, so comparing them to bare `now()` or letting a session-local `DEFAULT now()` stamp comments shifts behavior by the PostgreSQL session timezone. Replacing the four affected expiry predicates with the existing `dbNowUtc()` helper preserves database-owned time and avoids wrapping `timestamptz` step-up/pending-action columns. The two OIDC session-binding paths, step-up lock, instance-user session lock, and pending-action deactivation proof check are all covered by the changes. A candidate-wide `git grep` shows remaining session-expiry uses either compare a caller-supplied `Date` or already use `dbNowUtc()`; I found no uncovered bare SQL `now()` predicate on the session column in this tree.

Comment creation explicitly supplies UTC `createdAt` and `updatedAt`, fixing the `DEFAULT now()` mismatch at the write boundary that feeds the CA-17 edit window and first-response calculations. Both timestamps use the same transaction-start database clock semantics as `dbNowUtc()`.

The new wrappers set Node `TZ` and PostgreSQL `PGOPTIONS` before their first query, assert the session timezone is the requested non-UTC zone, then import the affected comment, instance-user, and session-freshness suites. This is a useful permanent regression shape for both UTC+06:30 and a behind-UTC zone. It does not add a forced-UTC fixture or change schema types.

## Evidence and limits

The implementation evidence at `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/631-impl-sonnet.md` reports 31 integration files passing in New York and Yangon, plus 67 tests in each new wrapper and 22/3 failures when the source fix was reverted. Retained `/tmp/claude/tz-ny2.log` and `tz-yg2.log` show per-file passing summaries, including 31 passing `work-item-comment` tests in each zone; those are author evidence, not tests run by this reviewer. The full three-zone run and the reported revert proof were not independently rerun here.

No blocking correctness issue found in the bounded diff. Residual scope is as the implementation record states: other non-comment `timestamp without time zone` columns stamped by `DEFAULT now()` are not audited by this change. This review does not clear the separate security review required for the touched authentication/identity scope, and the ordinary-review count still follows the semantic tier assigned by the orchestrator.

---

## Authentic report: 631-ordinary-b-luna.md

SHA-256: `731233ac6872d049d6552bd284d4e6bd602700a1d56c95e902ff3cea514a5c59`.

# #631 ordinary review B — GPT-6 Luna

**Model selector:** `gpt-6-luna`, `fork_turns=none` (fresh reviewer context)
**Role:** independent ordinary reviewer B
**Candidate:** `codex/identity-db-timezones-631`, head `952ced751cc9684dadf082cbf34d6d287abcbf2b`
**Base:** `9bb28099a69d1e599e1d7451ebdf6225e380546c`
**Verdict:** CLEAR

## Independence and scope

I did not author, direct, or remediate this change. I inspected the exact Git objects, not the changing shared checkout. Scope checked: all seven changed files; `utils/db-time.ts`; schema/coding-standard timestamp convention; step-up/session use sites; CA-17; active mission and workflow review requirements; implementation evidence at `~/.codex/taskdesk-evidence/2026-10-15/631-impl-sonnet.md` as a claim list only.

## Findings

No blocking or non-blocking defect found in the bounded fix. PostgreSQL `timestamp without time zone` session expiry values are UTC wall-clock values. `dbNowUtc()` produces that same SQL type via `now() AT TIME ZONE 'UTC'`; the changed SQL predicates therefore avoid PostgreSQL's session-TimeZone coercion. The four changed session checks cover the active-session lock for step-up, both OIDC session-tagging writes, the instance-user freshness guard, and pending-action approval. A source search at the exact head found other session predicates: the existing deletion-target checks already use `dbNowUtc()`, while `getActiveSessionForStepUp` and `required-access.ts` bind JS `Date` values through Drizzle's timestamp encoder, which serializes ISO UTC. Remaining bare `now()` comparisons in the nearby auth code concern `timestamptz` pending-action columns and are correctly left unchanged.

Comment creation explicitly stamps both `createdAt` and `updatedAt` in the database's UTC wall-clock convention. This is consistent with the schema mapping and CA-17's 15-minute author edit window; the first-response timestamp derives from the returned row. The permission check remains before insertion and its mention/notification side effects within the transaction, so this timestamp edit adds no write on denial.

The two permanent timezone wrappers assert both a non-UTC Node offset and the PostgreSQL session setting, then import the relevant existing comment, instance-user and session-freshness suites. The test structure is non-vacuous for the checked source paths. Existing broad timestamp-without-time-zone columns written using local `DEFAULT now()` remain outside this commit's bounded audit, as the implementation report states.

## Evidence and limitations

- Inspected `git diff base head` and relevant exact-head source/docs; `git diff --check base head` passed.
- No tests, PostgreSQL, Docker, or browser runtime were run in this review because the shared carrier test window is reserved. The implementation report's test results are not represented as my runs.
- Residual: the change does not audit every legacy `timestamp` column/default in the repository; no claim is made that all database-timezone issues are closed.

## Verdict

CLEAR for ordinary review B at the exact candidate SHA above. This report does not fill another review role or imply stage completion.

---

## Authentic report: 631-security-sol.md

SHA-256: `ee28c90bbc4334fb1d0f557c363236e3f267d6275ca26e38c7638ea9ec8f284a`.

# #631 independent security review — UTC session and comment clocks

**Verdict: CLEAR for this exact candidate.** No blocking or non-blocking finding in the bounded change.

## Identity, independence, and source

- **Role:** fresh independent full security reviewer. I did not author, direct, or remediate this candidate, and did not conduct either ordinary review.
- **Model provenance:** orchestrator dispatched this context with selector `gpt-6-sol`, `fork_turns=none`; the served backend identity is not introspectable from inside this runtime. This report claims the dispatch, not an independently measured backend version.
- **Branch:** `codex/identity-db-timezones-631`.
- **Reviewed base:** `9bb28099a69d1e599e1d7451ebdf6225e380546c`.
- **Reviewed head:** `952ced751cc9684dadf082cbf34d6d287abcbf2b`.
- **Source:** exact Git objects via `git diff`, `git show`, and `git grep`; no mutable carrier source was used.

## Security analysis

I inspected all seven changed files, the `dbNowUtc()` definition, the schema timestamp mappings, the session and step-up call sites, both timezone wrappers, CA-17, and the author and two independent ordinary-review records. `session.expires_at` is a `timestamp without time zone` that Drizzle writes and reads as a UTC wall clock. The added `now() AT TIME ZONE 'UTC'` expression has the same SQL type and convention. It removes PostgreSQL's session-TimeZone coercion from the active step-up lock, instance-user freshness lock, pending-action deactivation proof, and both OIDC session-provenance updates. Ahead-of-UTC connections can no longer reject an otherwise live session at those gates; behind-UTC connections can no longer admit an expired one through them.

An exact-head search of `sessionTable.expiresAt` found the other predicates use a JavaScript `Date` (encoded as UTC by Drizzle) or already use `dbNowUtc()`. Nearby bare `now()` expiry checks are for `timestamptz` pending actions, so changing them would introduce an offset. The changed comment insert stamps `createdAt` and `updatedAt` in the same UTC wall-clock convention. This repairs the CA-17 edit-window input without moving the authorization check or introducing a write on denial. Both values use one transaction-start database clock, consistent with the previous `DEFAULT now()` timing.

The two new wrappers assert non-UTC Node and PostgreSQL session settings and import the relevant comment, instance-user, and session-freshness suites. This is meaningful coverage of the ahead and behind boundary. I found no bypass of step-up, session expiry, OIDC binding, comment edit authority, or pending-action state in the candidate diff.

## Commands and limits

I resolved both exact object IDs; ran `git diff --stat`, targeted exact-object `git diff`, `git show` for changed source/tests and the DB time helper, `git grep` for session-expiry sites, and `git diff --check 9bb28099a69d1e599e1d7451ebdf6225e380546c 952ced751cc9684dadf082cbf34d6d287abcbf2b` (pass). I read the governing workflow, CI security-scope list, architecture/spec clauses, and all supplied review records. I ran **0 tests** and **0** PostgreSQL, Docker, or browser checks because the carrier regression author held the runtime window. The separate Claude Sonnet 5.5 implementation record reports 31 files/366 tests passing in UTC before the fix; after the fix, those 31 files passed in New York and Yangon, and the two permanent wrappers passed 67 tests each. It reports revert probes of 22 Yangon and 3 New York failures. These are author evidence, not my executions. Both ordinary Luna reports are clear at this exact head.

Other legacy `timestamp without time zone` defaults are outside #631's bounded fix. Required hosted status checks on the final exact candidate and composition onto current `main` remain separate; this verdict makes no merge, issue-closure, or stage claim.

---

## Authentic report: 631-main-composition-luna.md

SHA-256: `2464556e067ee6a01f0725b336faf97b3973fc9fe9afc4c404178c941e842c65`.

# #631 current-main composition confirmation

**Verdict: CLEAR for composition of the reviewed #631 source onto accepted current `main`, at exact head `c695eb1f9d0dd54e85b11c11886fba77bf75ad31`.** No new product review finding. This confirms source equivalence and current-main conservation only; it does not claim CI, image, runtime, browser, acceptance, or merge readiness.

## Reviewer and independence

- **Role:** ordinary independent composition reviewer, fresh context; I did not author, direct, or remediate #631 or this composition commit.
- **Model:** GPT-6, assigned the Luna-tier ordinary composition confirmation. No more specific served-model version is exposed in this context.
- **Compared:** reviewed source base `9bb28099a69d1e599e1d7451ebdf6225e380546c`; reviewed product head `952ced751cc9684dadf082cbf34d6d287abcbf2b`; accepted current `main` `e9df2294fa580fd2885343bbef0cec28e81ead4c`; composition head `c695eb1f9d0dd54e85b11c11886fba77bf75ad31`.
- **Existing evidence inspected:** ordinary Luna reports `631-ordinary-a-luna.md` and `631-ordinary-b-luna.md`, implementation record `631-impl-sonnet.md`, and security Sol report `631-security-sol.md`. Both ordinary reviews and the full security review cover the same exact product head `952ced…`; they found no blockers. Their own stated test/runtime limits remain in force.

## Checks performed

- Verified `c695eb1f` has exactly two parents: reviewed #631 head `952ced…` and accepted-main merge `e9df…`.
- Confirmed `git ls-remote origin refs/heads/main` returns `e9df2294fa580fd2885343bbef0cec28e81ead4c`, matching the composition's accepted-main parent.
- Confirmed `git merge-base --is-ancestor e9df… c695eb1f` succeeds.
- `git diff 952ced… c695eb1f --name-only` lists only `docs/07-planning/integration-execution-queue.md` and `docs/07-planning/status.md`; the diff adds 45 and 46 lines respectively. `git diff --quiet 952ced… c695eb1f -- apps/api tests` succeeds, so no product or test input changed after review.
- Compared product/test patches: `git diff 9bb280… 952ced… -- apps/api tests | git patch-id --stable` and `git diff origin/main c695eb1f -- apps/api tests | git patch-id --stable` both produce patch ID `633c0c7d1ffd78ba76931b7625791026521b3964`. The #631 product/test delta is preserved exactly against current `main`.
- `git diff --check 952ced… c695eb1f` passes. The checkout was clean at the inspected head.

## Limits and residuals

`gh pr view 631` could not resolve a pull request numbered 631 in the configured GitHub repository, so this check does not assert a live PR state or review/check rollup. The live `main` ref was confirmed through `git ls-remote`. Current exact-head required CI, image/boot, browser evidence, and fresh independent GPT-6 Sol current-head confirmation are still pending. The prior reports' author-run tests and review-only scopes are not upgraded by this composition check.

**Conclusion:** existing reviews remain reusable because intervening changes touch only dated planning records and leave all reviewed product/test inputs unchanged. Composition preserves accepted `main` and the exact reviewed #631 source patch. No acceptance or completion claim is made.

---

## Authentic report: 631-main-composition-sol.md

SHA-256: `0ad46d40fbabe8aa57610980fcf535e055b1b2acfd312bda5aa0c18da63d725a`.

# #631 current-main independent security composition confirmation

**Verdict: CLEAR for the exact composition head `c695eb1f9d0dd54e85b11c11886fba77bf75ad31`.** No blocking or non-blocking security finding in the current-main import. This is a lightweight exact-head confirmation of unchanged, previously fully reviewed security source; it does not replace or relabel that full review.

## Reviewer, independence, and scope

- **Role:** fresh independent security composition reviewer. I did not author, direct, remediate, or ordinarily review the #631 source or this composition. I did not conduct its prior full security review.
- **Model provenance:** the conductor dispatched this fresh context with selector `gpt-6-sol`, `fork_turns=none`. The served backend/version is not introspectable from inside this runtime; this records the dispatch, not a measured backend identity.
- **Original reviewed base/head:** `9bb28099a69d1e599e1d7451ebdf6225e380546c` → `952ced751cc9684dadf082cbf34d6d287abcbf2b`.
- **Accepted current main:** `e9df2294fa580fd2885343bbef0cec28e81ead4c`, independently confirmed by `git ls-remote origin refs/heads/main` during this review.
- **Current candidate:** branch `codex/identity-db-timezones-631`, exact head `c695eb1f9d0dd54e85b11c11886fba77bf75ad31`, whose parents are the original reviewed #631 head and accepted current main. This is issue #631, with no claim that PR #631 exists.

## Checks and security conclusion

I read the active mission, governing review/evidence rules, CI security scope, both original independent ordinary reports, the original independent full Sol security report, the implementation record, and the fresh ordinary composition report. I inspected the exact-object product/test diff and the imported planning-record delta. The previous full Sol report cleared all seven #631 files at `952ced...`: five API edits use the existing `dbNowUtc()` for session expiry or comment stamps, and two PostgreSQL/Node non-UTC wrappers cover the affected suites. It found no authorization, expiry, OIDC, comment-edit, or pending-action bypass. Its runtime limitations remain as written.

Exact-object Git checks establish:

- `git diff --name-status 9bb280... e9df...` contains only `docs/07-planning/status.md` and `docs/07-planning/integration-execution-queue.md`: 91 additions, no product, test, build, dependency, deployment, security-control, or review-rule change on accepted main since the original source base. I read these records; they preserve checkpoint/queue facts and explicitly leave #631 acceptance and current-head gates outstanding. The #793 merge itself adds 36 lines to those two files.
- `git diff --quiet 952ced... c695eb... -- apps/api tests` passes. The intervening candidate import contains only the same 91 planning-record additions; the five source files, two tests, and the existing `dbNowUtc()` helper are unchanged from the fully reviewed source.
- `git diff 9bb280... 952ced... -- apps/api tests | git patch-id --stable` and the corresponding `git diff e9df... c695eb...` both yield `633c0c7d1ffd78ba76931b7625791026521b3964`. The seven-file product/test patch is identical against accepted main.
- `git merge-base --is-ancestor e9df... c695eb...` and `git diff --check 9bb280... c695eb...` pass; the inspected checkout is clean.

The new main records do not affect source behavior, the test inputs, or gate pass/fail semantics. The original full security review remains applicable to the exact same product/test patch on current main. This current-head confirmation closes only the security composition question, after the fresh ordinary composition review also cleared it.

## Limits and residuals

I ran **0 tests**, **0** PostgreSQL checks, and **0** image, container, browser, or hosted CI checks in this review; the conductor owns the current runtime window. The original author report's zone runs and revert probes are author evidence, not my executions. Existing legacy timestamp defaults beyond the bounded #631 fix remain outside this verdict. Required hosted checks, exact-head image/boot/runtime acceptance, authentic review publication, and any issue/PR disposition remain separate. No merge, release, stage, or issue closure is claimed.
