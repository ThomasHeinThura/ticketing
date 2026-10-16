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

---

## Current CI repair clearance

**Reviewed head:** `569b1a161de71088599fbbfadef8e681519afd50`

One strong independent ordinary review and a fresh full independent Sol review clear the bounded unused-import and four exact historical non-credential finding corrections. The prior source and composition reports remain unchanged. Local web typecheck passed. Hosted checks on the final head and shipping-image runtime proof remain pending; no gate or image pass is inferred.

## Retained report — 631-ci-repair-ordinary-luna.md

Origin SHA-256: `807085ed4ddc55594f69fa11489c5fb338947894a699b384407412eb558ddd02`.

# #631 CI repair delta — independent ordinary review

**Verdict: CLEAR for the bounded delta at exact local head `569b1a161de71088599fbbfadef8e681519afd50`.** No blocking or non-blocking findings.

## Reviewer and scope

- **Model:** GPT-6 Luna, fresh reviewer context dispatched for this review.
- **Role and independence:** one strong ordinary review of the bounded CI/security-scope repair. I did not author, direct, or remediate this candidate or the original #631 source.
- **Base and candidate:** `aea7da52bddab201a6de5882e70551e7da0cc55c` → `569b1a161de71088599fbbfadef8e681519afd50` on `codex/identity-db-timezones-631`.
- **Scope:** the exact three-path delta in `.gitleaksignore`, `apps/api/src/identity/oidc-login.ts`, and `docs/07-planning/decision-log.md`. The original product source was not re-reviewed; prior original-head ordinary and full Sol reviews and current-main composition reviews remain separate evidence.

## Checks and findings

I inspected the exact object diff, the existing immutable-fingerprint entries and CI secret-scan configuration, the affected import use, the four unchanged report lines in the published note, and the new technical disposition. `git diff --check aea7da52..569b1a1` passed. The local checkout is at the candidate SHA, clean, and one commit ahead of the branch's remote tracking ref.

The four added ignores are exact `commit:file:rule:line` fingerprints for `generic-api-key` findings at lines 45, 77, 146 and 178 of the unchanged `aea7da52` publication note. I inspected the restricted local finding metadata without printing the matched values: all four values equal the public A/B and current-main composition report filenames. They are not adjacent report digests. The entries do not broaden to another commit, path, rule, or line, and the reviewer reports and Git history remain unchanged. This matches the repository's existing exact-fingerprint precedent.

I independently inspected the retained private probe summary and structured output. With the candidate ignore list, the original history probe exits 0 with zero findings. A fresh commit containing the same public report prose still produces four filename findings, and the independent synthetic-credential negative control produces a fifth finding. The proof records zero unexpected matches. The local scanner is Gitleaks 8.30.1; the prior hosted failure was Gitleaks 8.24.3. The local probe supports the disposition but does not establish hosted success on this candidate.

The `sql` import removal is correct: the import was unused and no `sql` references remain in this file. The decision-log entry accurately describes this as a technical disposition pending independent ordinary and Sol clearance; it claims no owner authorization or waiver and keeps the required secret scan mandatory.

No tests, typecheck, Docker, image, browser or hosted checks were run by this reviewer. The private existing evidence records the earlier hosted static failure as TS6133 for this import, and the current PR body/check state still needs exact-head refresh.

## Live state and residual gates

At review time, `gh pr view 795` showed the remote PR head still at `aea7da52bddab201a6de5882e70551e7da0cc55c`; this review is for the unpushed local candidate `569b1a1`. Hosted CI has therefore not run on the reviewed head. Earlier hosted checks at `aea7da52` include failures for static, PR-template/security-review, and secret scan; they are not cleared or reused here. The full independent GPT-6 Sol review required for this bounded security/gate repair remains pending, as do candidate-head required checks and shipping-image verification.

**Conclusion:** CLEAR for this exact delta's ordinary review. This report does not claim hosted gate success, image/runtime acceptance, merge readiness, or completion of issue #631.

## Retained report — 631-ci-repair-security-sol.md

Origin SHA-256: `54fa1d34b940bc41e73904c98943fd8a28a9c2da4f16e253d47a2ae43063b8ad`.

# #631 CI repair delta — independent full security review

**Verdict: CLEAR for the bounded delta at exact local head `569b1a161de71088599fbbfadef8e681519afd50`.** I found no blocking or non-blocking security defect in this three-file repair. This verdict does not claim hosted gate success or merge readiness.

**Reviewed head:** `569b1a161de71088599fbbfadef8e681519afd50`

## Reviewer, independence, and source

- **Role:** fresh independent full Sol-tier security reviewer. I did not author, direct, remediate, or ordinarily review this candidate or the original #631 product change.
- **Model provenance:** the conductor dispatched this context with selector `gpt-6-sol`, `fork_turns=none`. The served backend/version is not introspectable in this runtime; this states the dispatch, not a measured backend identity.
- **Branch and comparison:** `codex/identity-db-timezones-631`; `aea7da52bddab201a6de5882e70551e7da0cc55c` → `569b1a161de71088599fbbfadef8e681519afd50`. The local checkout was clean and one commit ahead of its remote tracking branch at review time.
- **Scope:** exact-object diff of `.gitleaksignore`, `apps/api/src/identity/oidc-login.ts`, and `docs/07-planning/decision-log.md`; the immutable publication note, the hosted failure log and restricted local scanner metadata; the retained negative-control proof; governing review and secret-scan rules. The previously reviewed #631 product patch was not re-reviewed in this delta pass. I read the prior ordinary/full security source reports and current-main composition confirmations as separate evidence, plus the fresh ordinary delta review.

## Security assessment

The hosted Gitleaks 8.24.3 failure reports four `generic-api-key` fingerprints at lines 45, 77, 146 and 178 of `docs/07-planning/security-reviews/identity-timezones-631.md` in immutable publication commit `aea7da52...`. I compared its logged commit, file, rule and line fields against each proposed `.gitleaksignore` entry. All four match exactly. I inspected the local restricted structured findings without publishing the raw `Match` or `Secret` fields: each `Secret` equals the corresponding public ordinary A/B or current-main composition report filename on that note line. None equals an adjacent report digest, credential, token or access-bearing value. The note and historical commit are unchanged by this repair.

Each ignore entry is bound to one historical commit, one file, one rule and one line. It grants no path-wide, rule-wide, arbitrary-hash or future-commit exemption. This follows the existing exact-fingerprint convention for immutable public review prose. The scanner remains a required CI check; this is a narrow non-secret classification, not a gate waiver. The decision-log entry accurately records technical rationale, its limits and reversal, and expressly claims no Thomas authorization to ignore a real credential.

I independently inspected the retained local proof JSON: scanning current history with the candidate ignore list recorded zero findings; a fresh commit containing identical report prose produced four filename findings, and a separate synthetic-credential negative control produced one more finding. The five fresh findings had unique fingerprints and no unexpected matches. These results support that future copies and actual credential-shaped content remain visible. The local binary was Gitleaks 8.30.1; the final hosted 8.24.3 run on this exact candidate remains required.

The only API code change removes an unused `sql` import. A source search found no `sql` reference left in `oidc-login.ts`; the change does not alter an expression, authorization condition, session expiry check, OIDC binding, or runtime path. The owner's web typecheck log shows the invoked `tsc` commands but has no explicit exit status; I did not run typecheck myself.

## Checks, findings, and remaining gates

I inspected `git diff` and `git log` for both exact objects, the published note lines, hosted scanner finding metadata, restricted local finding metadata, the prior review records, and the retained proof JSON. `git diff --check aea7da52... 569b1a1...` passed. I ran **0** new tests, Gitleaks scans, PostgreSQL checks, Docker/image checks, browser checks, or hosted CI jobs in this reviewer context; the local proof and typecheck are evidence produced by the repair owner, not my runs.

No blocking or non-blocking finding remains within this review scope. The local head is not yet the remote PR head, so required GitHub checks on `569b1a1...` cannot be inferred from earlier runs. The hosted secret scan must confirm this repair with Gitleaks 8.24.3, and the complete required check set, image build/boot/health, and other candidate acceptance gates remain with the conductor. This review does not approve a push, merge, waiver, issue closure, or stage completion.

## Accepted shipping-image main composition

**Reviewed head:** 92f899dc528a1bc51ac47ea878a0148b9dbc5ed7

Accepted main09dd5acf9b66579f6f1bb89622fac9ddbd7de1b6 is normally merged. All five API files and both timezone tests remain byte-identical to publicatione9e94a77a4939ab065c887f40065f6d8fcf39ab5. Prior original full reviews and bounded CI-repair clearances remain at their actual heads. A new strong ordinary context and separate fresh lightweight Sol confirmation clear this mechanical import, including additive preservation of both fingerprint/decision records; the author handoff is not a review. No new scanner exclusion or gate semantics are introduced. Current publication-SHA full hosted checks and actual image/runtime proof remain pending.

### Source report — 795-current-image-main-composition-luna.md

Source SHA-256: `3fff3791f0787f824444cffb517b8822521c326aa72482d7727b625dc4b7d467`.

# PR795 accepted-main composition handoff

**Result:** DONE — composed and committed locally; not pushed, not reviewed by this author context, and not merge-ready on this evidence alone.

**Branch:** `codex/identity-db-timezones-631`
**Candidate:** `92f899dc528a1bc51ac47ea878a0148b9dbc5ed7`
**Parents:** publication `e9e94a77a4939ab065c887f40065f6d8fcf39ab5`; pinned accepted main `09dd5acf9b66579f6f1bb89622fac9ddbd7de1b6`.
**Reviewed product source:** `569b1a161de71088599fbbfadef8e681519afd50`.

## Composition and conservation

Performed a normal local `git merge --no-commit --no-ff 09dd5acf...` into the clean e9e94a77 worktree. The only conflicts were additive records in `.gitleaksignore` and `docs/07-planning/decision-log.md`. Resolved by retaining both complete, independent #631 and #780 fingerprint records and both independent decision-log entries. No semantic/product conflict was present.

The following #795 source, test, and authentic review-note Git blobs match publication e9e94a77 exactly:

- `apps/api/src/auth/repository.ts` — `00a26f96fe3414f8f6a5cd70f89a1e23779009f7`
- `apps/api/src/identity/oidc-login.ts` — `5083b417e7d62f98121b90af109e220e7bf93200`
- `apps/api/src/instance/users/repository.ts` — `dcd9f1775313b7ba3818427872e0f7dc5bc74c18`
- `apps/api/src/pending-action/service.ts` — `45118fc39b01b60c5cb2b9a65e43f4ffbeee7159`
- `apps/api/src/work-item/controllers/create-comment.ts` — `8efa98ccd7954fcdd4fe3228c3c7ba608b17eb14`
- `tests/api-integration/identity-clock-ahead-of-utc.test.ts` — `91a17f9f8316870078c7bbfc423817ff14b680b0`
- `tests/api-integration/identity-clock-behind-utc.test.ts` — `545dfc0962877051be32e47166ea7c7caad11768`
- `docs/07-planning/security-reviews/identity-timezones-631.md` — `53aa0b4f90f636df3a2310d341ea44a8fcb13bda`

The four original #631 exact-fingerprint lines and their complete technical disposition remain byte-identical within `.gitleaksignore` and the decision log. All 12 accepted-main paths not involved in those two additive conflicts match pinned 09dd5acf byte-for-byte. The candidate is a descendant of pinned accepted main; `git diff --check 09dd5acf..92f899dc` passes.

The unchanged authentic #631 note retains two independent ordinary reports and a full independent Sol source report at 952ced75, ordinary and Sol composition clearances at c695eb1f, and ordinary plus full Sol CI-repair clearances at 569b1a16. This author context did not act as a reviewer and adds no review verdict.

## Verification run on local candidate

- API typecheck — PASS (`pnpm --filter @taskdesk/api typecheck`).
- Web typecheck — PASS (`pnpm --filter @taskdesk/web typecheck`).
- Shipping-image smoke checker unit tests — PASS, 31/31 (`node --test scripts/ci/run-shipping-image-smoke.test.mjs`; mocked/failure-path tests only).
- Restored task-description regression unit test — PASS, 2/2 (`pnpm --filter @taskdesk/web exec vitest run --config vitest.config.ts src/components/task/task-description.test.tsx`).
- Exact Git blob conservation checks and accepted-main path checks — PASS.
- Merge-base ancestry and candidate diff check against pinned accepted main — PASS.
- Commit hook reported “Checked 2 files … No fixes applied.”

No PostgreSQL, Docker build/boot, browser, full test suite or hosted GitHub check was run. No old hosted result was transferred to this candidate. Fresh hosted checks and current shipping-image proof are still required after publication; any changed-main compatibility beyond the pinned 09dd5acf base is for the conductor to reconcile. PR body was not changed and this branch was not pushed.

### Source report — 795-current-image-main-ordinary-luna.md

Source SHA-256: `7b0b55dac555276bf9c2833dccd4ff98e66a512d5aed799a33c4cb4e8ca28fcd`.

# PR795 current-image/main composition — independent ordinary review

**Verdict: CLEAR for the accepted-main composition at exact candidate `92f899dc528a1bc51ac47ea878a0148b9dbc5ed7`.** No blocking or non-blocking findings in this composition scope.

## Reviewer and scope

- **Model dispatch:** GPT-6 Luna selector `gpt-6-luna`; fresh independent context, spawned with `fork_turns=none`. No platform-reported model-version string was available to attest.
- **Role and independence:** ordinary review of the current local PR795 composition. I did not author, direct, or remediate the candidate or its merge resolution.
- **Base and candidate:** publication `e9e94a77a4939ab065c887f40065f6d8fcf39ab5` plus pinned accepted main `09dd5acf9b66579f6f1bb89622fac9ddbd7de1b6`, composed at `92f899dc528a1bc51ac47ea878a0148b9dbc5ed7`.
- **Scope:** composition and conflict resolution; claimed exact-blob conservation; whether accepted-main imports add a scanner exclusion or CI gate pass/fail behavior; review-history preservation. I read `AGENTS.md`, `docs/04-engineering/agent-workflow.md`, `CLAUDE.md`, and `/Users/heinthura/.codex/taskdesk-evidence/2026-10-15/takeover/795-current-image-main-composition-luna.md` and checked its material composition claims against Git objects.

## Checks and findings

The candidate is a merge commit with parents `e9e94a77...` and `09dd5acf...`; the pinned accepted-main commit is an ancestor. `git diff --check 09dd5acf...92f899dc` passed, and the checkout was clean.

I independently compared Git blob IDs. All eight PR-owned paths are byte-identical to publication `e9e94a77`: the five API source files, two timezone integration tests, and `identity-timezones-631.md`. All 12 other paths changed since publication are byte-identical to pinned accepted main. This accounts for the full 14-path publication-to-candidate diff.

The only additive conflicts were `.gitleaksignore` and `docs/07-planning/decision-log.md`. The resulting ignore file retains all four exact #631 fingerprints from the publication and the exact #780 fingerprint from accepted main. The #780 entry is limited to one immutable commit, file, rule and line; it does not create a path-wide, rule-wide or future-commit exclusion. The decision log retains both complete, independent records. The accepted-main workflow, CI policy, and shipping-image smoke checker imports match the accepted-main blobs exactly. No changed CI-control file differs from accepted main, and this merge introduces no new scanner exclusion or gate pass/fail semantics.

I inspected the current PR-owned source delta relative to accepted main. It remains the previously reviewed bounded timezone correction: UTC-wall-clock comparisons for the session expiry checks and explicit UTC timestamps for comment creation/update. This composition adds no route, permission, identity-provider authority, or other runtime behavior beyond that published patch. The published security note is unchanged and still contains the prior source, composition, and CI-repair review records; this review does not replace or broaden those clearances.

Checks actually run: Git ancestry check; `git diff --check`; exact Git blob comparisons for all eight PR-owned paths and 12 accepted-main imports; name/status accounting of the full diff; manual inspection of the two conflict resolutions and the relevant CI/scanner policy. No tests, PostgreSQL, Docker/image, browser, or hosted CI checks were run in this review context.

## Residuals

This verdict covers the local composition only. No current image/boot/health proof or hosted checks on this exact candidate were established here. I did not verify a remote PR head or review status. Historical test counts in the author handoff remain author evidence. Those acceptance checks and any PR disposition remain separate conductor work.

**Conclusion:** CLEAR for the exact current-main composition at `92f899dc528a1bc51ac47ea878a0148b9dbc5ed7`; no composition finding remains. This report makes no claim of image acceptance, current hosted CI success, merge readiness, release, or issue/stage completion.

### Source report — 795-current-image-main-security-sol.md

Source SHA-256: `968cf339681a122916880d9dfb46642f2731967644307318aa575ba1ac0c0c11`.

# PR795 accepted-main composition — independent security confirmation

**Verdict: CLEAR for the mechanical composition at exact local candidate `92f899dc528a1bc51ac47ea878a0148b9dbc5ed7`.** No blocking or non-blocking finding in this review scope.

## Identity, independence, and scope

- **Model dispatch:** `gpt-6-sol`, fresh context spawned with `fork_turns=none` for this security review. This records the requested selector, not a measured serving-model version.
- **Independence:** I did not author, direct, adjudicate, or remediate this candidate or either conflict resolution. I read the prior ordinary review as evidence and checked material claims directly against Git objects.
- **Exact commits:** candidate `92f899dc528a1bc51ac47ea878a0148b9dbc5ed7`, first parent/publication `e9e94a77a4939ab065c887f40065f6d8fcf39ab5`, second parent/pinned accepted main `09dd5acf9b66579f6f1bb89622fac9ddbd7de1b6`.
- **Scope:** whether current-main composition changed previously reviewed #631 security behavior, scanner exclusions, CI gate semantics, or review history. This is a lightweight confirmation of the composition. The retained full Sol source and CI-repair reviews remain separate clearances at their recorded heads.

## Checks and assessment

The candidate is a two-parent merge with the publication and pinned accepted main as its exact parents; pinned main is an ancestor. The worktree was clean. `git diff --check 09dd5acf..92f899dc` passed. The publication-to-candidate diff contains 14 paths: 12 accepted-main imports plus the two additive conflict files.

I independently compared Git blob IDs. All eight PR-owned blobs — five API files, two timezone integration tests, and `identity-timezones-631.md` — equal publication `e9e94a77` byte for byte. All 12 other changed paths equal pinned accepted main `09dd5acf` byte for byte, including `.github/workflows/ci-full.yml`, `docs/04-engineering/ci-cd.md`, and both shipping-image smoke files. There is no independently edited CI control or shipping-image checker in this candidate.

The only conflict resolutions are `.gitleaksignore` and `docs/07-planning/decision-log.md`. The ignore file retains the four publication #631 fingerprints (immutable commit `aea7da52`, one review note, `generic-api-key`, lines 45/77/146/178) and accepted main's one #780 fingerprint (immutable commit `33f2ec22`, its review note, `generic-api-key`, line 260). Every active fingerprint line from both parents is present. The candidate adds only the four #631 exact fingerprints relative to accepted main; it adds no path-wide, rule-wide, or future-commit scanner exemption. The decision-log diff relative to accepted main adds only the complete #631 technical disposition; the existing #780/conductor record remains intact. The #631 disposition section is identical to publication.

I inspected the five-file API diff relative to accepted main. It contains only the published replacement of `now()` with `dbNowUtc()` in session-expiry comparisons and explicit UTC timestamps for comment creation/update. The exact blob comparison confirms no new route, authority, tenancy, or clock behavior was introduced by this merge. The unchanged #631 note retains the original two ordinary source reviews, full Sol source review, prior composition reviews, and ordinary/full Sol CI-repair clearances. This pass confirms their code and note were conserved; it does not relabel earlier heads as this head.

## Limits

No PostgreSQL, Docker/image build or boot, browser, full test suite, hosted CI, remote PR-head, or release proof was run or checked here. Historical test results are not claimed as candidate runtime acceptance. The exact candidate still needs its applicable hosted checks and current image/boot/health evidence under the normal flow. This verdict addresses only the local composition at `92f899dc528a1bc51ac47ea878a0148b9dbc5ed7`.
