# PR #698 security review record: work-item approvals section with withdraw (AP-20)

PR #698 adds the work-item approvals section (AP-20) with a Withdraw action to the agent work-item detail. It is the successor to historical #586's UI half.

How it works:
- Approvals are read from the existing `GET /api/work-items/{key}/approvals`.
- Withdraw uses the existing `POST /api/admin/approvals/{id}/withdraw` for instance-admin sessions and `POST /api/approvals/{id}/withdraw` otherwise.
- No server code changes.

The PR is security-scope because it adds `apps/web/e2e/approval-withdrawal.spec.ts` and extends the `packages/ui/src/styles/pairs.json` gate manifest.

The code came from a Claude Sonnet 5.5 implementation lane. The baseline commit came from a Sonnet evidence lane using the v11 pinned-image machinery. The conductor (Claude Opus 5.5) made the merge commit `effdbc49`. The reviewers below are fresh, independent contexts that did not author, direct or remediate the change.

## Review chain

- Ordinary review A by Claude Sonnet 5.5 (spec fit, withdraw routing, server enforcement, tests, G8): APPROVE at `eb13f397`.
- Ordinary review B by Claude Sonnet 5.5 (#586 absorption, AP-19/AP-21 status, accessibility): APPROVE at `eb13f397`. Its accessibility notes N1–N3 were fixed by the implementer in `3e12c386`.
- Ordinary delta review by the same reviewer-B context: APPROVE at `3e12c386`. Each fix was reverted to confirm it is covered, and the empty state was measured unchanged.
- Security review by Claude Opus 5.5: CLEAR at `3e12c386`. It ran six integration authority probes against the withdraw and read routes: a forged admin role, another workspace, an API key on the admin route, a non-requester, a terminal approval, and customers.
- Security rebind by the same Claude Opus 5.5 context: CLEAR at `effdbc49`. That commit merges `main` `af663a0c`. The `pairs.json` resolution was verified record by record, every other file equals git's own auto-merge, and the approval surfaces are byte-identical.

**Reviewed head:** `eb13f397898911697c4a6a215e8378a1ba5773c4`
**Reviewed head:** `3e12c386f923ce14557e67bfaeb9cb55de5b6520`
**Reviewed head:** `effdbc49e8cbe9736c75f5d0f9ad569612d1e7d2`

## Context index

Paths are private evidence paths under `/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/`. The SHA-256 is of the file bytes and matches the embedded copy below.

| # | Report (private path) | Role | Model | Head | Verdict | SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `698-ordinary-a-sonnet.md` | Ordinary review A (64b70f93..eb13f397) | Claude Sonnet 5.5 | `eb13f397` | APPROVE | `26050e3a42773ec9b2109c1559110078eae36e659b4aa27bdbef7c31ce39e82f` |
| 2 | `698-ordinary-b-sonnet.md` | Ordinary review B (64b70f93..eb13f397) | Claude Sonnet 5.5 | `eb13f397` | APPROVE | `1dc3dd86ef1a123abf3e5e891e9f881609d91303d399d2b6dc671f68022fea61` |
| 3 | `698-3e12-ordinary-b-sonnet.md` | Ordinary delta review (eb13f397..3e12c386) | Claude Sonnet 5.5 | `3e12c386` | APPROVE | `d2228ba0b65f2642dc9af9d972d2efd3540f8cb257c3b9ec2a54fb11371df7a9` |
| 4 | `698-security-opus.md` | Security review (64b70f93..3e12c386) | Claude Opus 5.5 | `3e12c386` | CLEAR | `4a4ea5e3afec56ba31c5b5108738df90fed745066f5c5c46e662c78062cc4954` |
| 5 | `698-effd-security-rebind-opus.md` | Security rebind (3e12c386..effdbc49) | Claude Opus 5.5 | `effdbc49` | CLEAR | `22e165c260c47ad610145e29c8a06c4589339f536baf52d81ebebc8139221524` |

## Embedded reports

Each report is embedded byte for byte between its BEGIN and END markers, copied by a script that reads the file bytes. The marker carries the SHA-256 of those bytes. Where a report did not end with a newline, one newline follows it before the END marker, outside the hashed bytes.

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/698-ordinary-a-sonnet.md; Claude Sonnet 5.5; sha256 26050e3a42773ec9b2109c1559110078eae36e659b4aa27bdbef7c31ce39e82f) -->
# PR #698 ordinary review A (Claude Sonnet 5.5, fresh independent context)

Model: Claude Sonnet 5.5 (reviewer A). Did not author, direct or remediate the change.
Reviewed head: eb13f397898911697c4a6a215e8378a1ba5773c4
Base: origin/main 64b70f93 (branch codex/approvals-detail-withdraw)
Scratch worktree /Users/heinthura/.codex/worktrees/review-698-a (detached at head), removed after the run. No branch edit, push, comment or merge. No Docker containers created.

## Files examined
Spec: docs/03-features/approvals.md (AP-6, AP-7, AP-19, AP-20, AP-21, API paragraph and route table). Evidence: approvals-ui-impl-sonnet.md, 698-baseline-acquisition-report.md, reconcile-586-513-sonnet.md (#586 section).
Code: apps/web/src/components/work-item/work-item-approvals.tsx (+test), work-item-detail.tsx (+test), fetchers/approval/get-work-item-approvals.ts, withdraw-approval.ts (+test), hooks/queries/approval/use-get-work-item-approvals.ts, hooks/mutations/approval/use-withdraw-approval.ts, e2e/approval-withdrawal.spec.ts, i18n/en-US,de-DE,ja-JP + schema, packages/ui/src/styles/pairs.json, both versions of work-item-detail-linux.png. Server: apps/api/src/approval/index.ts (read route, both withdraw routes, formatApproval), apps/api/src/approval/service.ts withdrawApproval.

## Commands run (in the scratch worktree) and results
- pnpm install --frozen-lockfile: ok
- pnpm typecheck: 9/9 tasks successful
- apps/web vitest full: 142 files, 603 tests passed
- check:i18n: all 20 locales in sync; check:tokens (+contrast): pass, 418 pairs; check:ui: pass; check:route-policy: pass; check:inventory: pass
- VITE_API_URL="" pnpm build, then playwright e2e/approval-withdrawal.spec.ts: 3 passed (requester route, admin route, 409 plus refetch)
- Mutation checks (each reverted afterwards, worktree clean):
  1. dropped the `state === "pending"` guard on the Withdraw button: 1 test failed ("hides Withdraw once the approval is no longer pending")
  2. 409 mapped to the generic message: 1 failed ("shows a clear message for a 409 withdrawal failure")
  3. forced asInstanceAdmin false: 1 failed (AP-7 admin route test)
  4. onSettled changed to onSuccess in the mutation hook: all 77 tests in components/work-item PASS (see finding 1)

## Checks against the brief
1. Spec fit. AP-20: "The work item detail shows an approvals section whenever any approval exists or may be requested." Whether an approval "may be requested" depends on workflow gate data the read API does not expose, so always rendering with an empty state is a reasonable, conservative reading, not a deviation. Showing it is the only reading that cannot violate either limb. Non-blocking note: it is shown to viewers who could never request one; a later request-dialog slice can narrow it.
2. Withdraw. Button only when `canWithdraw && state === "pending"` (work-item-approvals.tsx:~158). Admin route chosen via user.role === "admin" (same convention), requester route otherwise; fetcher test covers both. 409 / 403+404 / other each map to a distinct message and approvals are invalidated on settle. Server independently enforces: requester route has allowInstanceAdmin false; admin route requires isCurrentInstanceAdmin (403) and the service re-checks active instance admin under lock with session credential, evaluateApprovalWithdrawalDecision gives 403 for unauthorised and 409 for non-pending, 404 for missing or out-of-reach (apps/api/src/approval/index.ts:131-160, 470-495; service.ts:356-). Client gating is not the only guard.
3. Read route. GET /api/work-items/{key}/approvals: reach check then 404, staff additionally need work_item:read (403 in handler), customers see only approvals they requested or are addressed. Response (responseRow) carries ids, display names, state, timestamps, decisionNote, flags; nothing beyond what a work_item:read staff viewer sees on the item. Declared 401/404 only in the OpenAPI responses although the handler can return 403 (pre-existing, outside this PR).
4. Fetchers and hooks follow the repo shape (hono client, HttpError with status, default exports, query keys, staleTime 0 + refetchOnMount always). Invalidation after withdraw is only ["approvals"]; the work item detail and activity keys (["work-items","detail"|"activity",key]) are not invalidated. Withdraw does not change the item row, so non-blocking, but the brief expected both (finding 2).
5. States and UI: loading skeleton with sr-only text and aria-busy, retryable error alert, empty, ready, plus a withdraw error alert. All via @taskdesk/ui primitives and tokens; all 20 catalogs carry workItems.detail.approvals.* in English copy (matches existing repo practice, e.g. realtimeUnavailable in de-DE is English); schema regenerated; check:i18n passes.
6. pairs.json: the diff is purely additive (5 ids in the declared list for text-muted-foreground, 5 matching occurrence records with the caller chain WorkItemDetail -> WorkItemApprovals). Records correspond to real text-muted-foreground uses in the component (empty p, three label spans, reach-lost span); check:tokens + contrast pass at 418 pairs, which regenerates and verifies against source. Legitimate.
7. G8. Old and new work-item-detail-linux.png compared visually at 1280x720: identical down to the Description divider; new Approvals heading, "No approvals on this work item." and divider inserted; Activity & comments and Details shift down by about 105 px with unchanged styling. Only change is the new section. The acquisition report (pinned playwright:v1.63.0-noble image, 15/15 visual pass after update, only one PNG changed) is consistent.
8. Tests non-vacuous: three of four mutations fail as expected; the invalidation behaviour is untested at unit level (finding 1). The e2e "409 + refetch" scenario passes but does not demonstrate failure if onSettled were onSuccess only for the 409 case -- not mutated here.

## Findings
1. NON-BLOCKING: refetch-on-failure (onSettled) is not covered by a unit test. Replacing onSettled with onSuccess in apps/web/src/hooks/mutations/approval/use-withdraw-approval.ts:15 leaves every work-item and hook test green. The stated 409/403/404 refetch behaviour is only guarded by the e2e spec. Suggest a hook/component test asserting invalidation after a rejected withdraw.
2. NON-BLOCKING: invalidation covers only ["approvals"] (use-withdraw-approval.ts:15); the brief and a reasonable reading of "refresh work item and approvals" would also cover ["work-items","detail",key] / activity if withdrawal later surfaces there. No current defect.
3. NON-BLOCKING: no confirmation dialog before Withdraw (impl note justifies: re-requestable). Acceptable.
4. NON-BLOCKING: AP-19 (My Work lens and portal list) and AP-21 are not implemented; the implementer disclosed this. PR scope is AP-20 plus withdraw, so not a defect of this PR but the PR body must not claim AP-19.

No blocking findings.

## Residual risk
Mock-only e2e (page.route); no real-API browser run. Admin-route detection relies on session user.role, a hint only, server recheck verified by reading. Did not run API integration tests or the full e2e suite (Docker). Did not run the Linux visual spec locally (relied on the acquisition report plus manual image comparison). Security-scope paths (apps/web/e2e/**, pairs.json gate manifest) still need the GPT-6 Sol tier per the implementer note.

## Verdict
APPROVE
<!-- END REPORT (sha256 26050e3a42773ec9b2109c1559110078eae36e659b4aa27bdbef7c31ce39e82f) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/698-ordinary-b-sonnet.md; Claude Sonnet 5.5; sha256 1dc3dd86ef1a123abf3e5e891e9f881609d91303d399d2b6dc671f68022fea61) -->
# PR #698 ordinary review B (Claude Sonnet 5.5, fresh independent context)

**Reviewed head:** eb13f397898911697c4a6a215e8378a1ba5773c4
**Base:** merge-base 64b70f939a662163c00423184179e9c3993b8dbe (origin/main has since moved to a0992497; diffs below use the merge-base)
**Verdict: APPROVE** (no blocking findings; three non-blocking UX notes)

Reviewer B did not author or direct the change. No branch edit, push, comment or merge. Scratch worktree /Users/heinthura/.codex/worktrees/review-698-b (removed at end). No docker containers created.

## Files examined
work-item-approvals.tsx, work-item-detail.tsx (+ test), work-item-approvals.test.tsx, fetchers approval/{get-work-item-approvals,withdraw-approval}.ts (+ test), hooks, apps/web/e2e/approval-withdrawal.spec.ts, i18n/*.json and schema.json, packages/ui/src/styles/pairs.json, approvals.md AP-19..21, 635-approvals.md, reconcile-586-513-sonnet.md, recipient-resolvers.ts, notification-dropdown.tsx.

## Commands run and results
- `pnpm install --frozen-lockfile`: ok.
- `pnpm --filter @taskdesk/web exec vitest run src/components/work-item src/fetchers/approval`: 12 files, 80 tests passed.
- `pnpm check:i18n`: all 18 locales in sync with en-US, OK.
- `pnpm check:ui`: passed (0 unlisted imports, 0 tracked rows).
- web build:agent + build:portal, then `pnpm check:bundle-size`: agent initial 227.9/350 KB gzip, agent work-list route graph 293.3/350, portal 161.5/200. All within budget. (First build attempt failed only because workspace deps were not yet built; turbo build of deps fixed it. Environment, not a PR defect.)
- `playwright test e2e/approval-withdrawal.spec.ts` (playwright.config.ts): 3/3 passed (requester route, admin route, 409 terminal).
- Scratch axe-core 4.13.0 run (temporary spec in my copy, deleted) on the work-item detail with the approvals fixture, light and dark: violations only `landmark-one-main` (html, page-level, harness) and `region` on `section:nth-child(2)`. Neither is the approvals section by selector position (it is a labelled section, a region landmark, and is the later sibling); no contrast, name, list or button violations. I could not conclusively attribute `section:nth-child(2)` to a pre-existing section; treat as pre-existing harness noise, residual.
- Scratch focus probe: after keyboard Withdraw, `document.activeElement` is BODY (see N1).

## Findings
- **N1 (non-blocking, a11y)** work-item-approvals.tsx:172-188. The Withdraw button unmounts after the refetch, so focus drops to BODY (probe-confirmed). Suggest moving focus to the section heading or the row, in a follow-up.
- **N2 (non-blocking, a11y)** work-item-approvals.tsx:74-88 and 164-166. Failure is announced (role="alert"), but success has no live-region announcement; the badge just changes to Withdrawn. Probe found zero live regions inside the section. The loading wrapper at :106-111 has aria-live on a container that is replaced, which is of little use.
- **N3 (non-blocking, a11y)** :172-187. With several pending approvals every button reads "Withdraw request" with no row context (kind or approver). Consider an aria-label or aria-describedby tied to the row.
- **N4 (non-blocking, i18n)** New keys are English in all 17 non-en catalogs. Consistent with #692 (e961c120 added English `retry`/`tryAgain` to de-DE), but 3e8b7834 (#673) added translated strings, so precedent is mixed. check:i18n requires parity only, so it passes. Track a translation sweep.
- Positive: heading structure is correct (h1 title, h2 per section, section labelled by its heading); `<ul>/<li>` list semantics; withdrawal is gated by canWithdraw and state pending, with the admin route for instance-admin; 409 and 403/404 map to distinct messages and the list refetches; four states covered; no new hard-coded strings.

## pairs.json
Versus the merge-base: 418 records unchanged in count; 5 new occurrence ids (all in work-item-approvals.tsx, text-muted-foreground), 0 removed, 0 existing ids changed. No duplicate record objects. The duplicate-id pattern (each id appearing in two records) is pre-existing (866 before, 871 after = the 5 new ids following the same pattern). No spurious duplicates introduced.

## #586 absorption (unit -> location -> evidence)
Own #586 commits are 8 (per reconcile report; c2fd8153 is inherited). Re-verified against current trees.

| Unit | Location | Evidence |
|---|---|---|
| 54858055 API-key scope on approvals | main | apps/api/src/approval/repository.ts (apiKeyHasCapabilityScope block); approval-lifecycle.test.ts wrong-scope-key test; approvals.md key-scope rule. Landed via #635. |
| 7ba6fa25 API half (requester withdraw, canWithdraw) | main | POST /approvals/{id}/withdraw and /admin/approvals/{id}/withdraw in apps/api/src/approval/index.ts:239-270; canWithdraw. |
| 7ba6fa25 web fetcher/hook for withdraw | #698 | NOT on main at a0992497 or the merge-base (the reconcile report said it was; that was incorrect). #698 adds fetchers/approval/withdraw-approval.ts(+test) and hooks/mutations/approval/use-withdraw-approval.ts. |
| 7ba6fa25 UI half (Withdraw button, detail section) | #698 | work-item-approvals.tsx, with admin vs requester routing that #586 lacked, plus i18n keys, error and reload states. |
| d5b2842e terminal withdrawal conflicts | main | packages/domain/src/approvals/approvals.ts evaluateApprovalWithdrawalDecision; approval-lifecycle.test.ts terminal withdrawal tests. #698 e2e covers the 409 UI path. |
| 38f96f3b CI scope alignment, MCP SDK audit | main | @modelcontextprotocol/sdk ^1.31.0 in apps/api and packages/mcp package.json (per reconcile; not re-diffed by me). |
| 12cac9c1 e2e approval-withdrawal.spec.ts | #698 | apps/web/e2e/approval-withdrawal.spec.ts (3 tests, pass locally). visual.spec.ts on main has no stale approval-withdrawal entry to remove. |
| c89c11c0, b499ad3b, b67a865a docs/review notes | historical | Evidence only, in the decision log. Not to be carried. |
| 54858055/others inherited train and c2fd8153 | not #586 | Inherited bulk-integration content. |

Result: every #586 unit is on main, in #698, or historical documentation. Nothing is silently dropped. **#586 can close as absorbed once #698 merges** (API and scope units are already on main; UI plus e2e units arrive with #698).

## AP-19 / AP-21 status
- **AP-19** ("Waiting on my approval" My Work lens and portal Approvals page): NOT on main. API exists (`GET /me/approvals`, `GET /portal/approvals`, apps/api/src/approval/index.ts:279,294) but grep finds no web consumer of either route, no My Work lens, and the portal has only index, sign-in and catalogue routes. 635-approvals.md:57 records it as "OUT OF SCOPE, web slice S9". No decision-log hold or deferral entry names AP-19 specifically (grep of decision-log and status.md found none), so it is a scheduled-slice item, not a deliberate hold. Recommendation: its own successor PR (web slice S9 staff lens plus portal screen, with decide dialog if in scope), tracked by the linked issue so it is not dropped.
- **AP-21**: partially on main. In-app inbox rows are written for approval.* events (recipient-resolvers.ts, approval-notifications.test.ts; 635 NB-1 resolved for in-app), but email is still absent (`channels: []`, "stays with the notification worker slice"). Web: notification-dropdown.tsx only handles resourceType "task" for navigation (line 221), so approval rows likely have no click-through (not exercised by me). Recommendation: separate follow-up for (a) approval row routing in the inbox UI and (b) email via the notification worker slice (held to S4 per 635:58); neither belongs in #698.

## Residual risk
- Axe `region` node attribution uncertain (see above). No hosted/Linux visual re-check by me (reviewer A covered the G8 baseline).
- Approval-row click-through in the inbox not verified.
- Opus-sampled and Sol security reviews are separate gates; the e2e spec path is security-scope per the reconcile report.
<!-- END REPORT (sha256 1dc3dd86ef1a123abf3e5e891e9f881609d91303d399d2b6dc671f68022fea61) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/698-3e12-ordinary-b-sonnet.md; Claude Sonnet 5.5; sha256 d2228ba0b65f2642dc9af9d972d2efd3540f8cb257c3b9ec2a54fb11371df7a9) -->
# PR #698 delta ordinary review B: eb13f397..3e12c386 (Claude Sonnet 5.5, fresh independent context)

**Reviewed head:** 3e12c386f923ce14557e67bfaeb9cb55de5b6520
**Delta base:** eb13f397898911697c4a6a215e8378a1ba5773c4 (previously reviewed, APPROVE in 698-ordinary-b-sonnet.md)
**Verdict: APPROVE** (no blocking findings; one non-blocking test gap)

Reviewer B did not author or direct the change. No edits to the branch, no push, comment or merge. Scratch worktree /Users/heinthura/.codex/worktrees/review-698-b2, removed afterwards. No docker containers created.

## Files examined
Delta is one commit (3e12c386): work-item-approvals.tsx, work-item-approvals.test.tsx, i18n catalogs and schema.json (withdrawFor, withdrawn), hooks/mutations/approval/use-withdraw-approval.ts (unchanged, read for timing).

## Commands and results
- `pnpm check:i18n`: all locales in sync. `pnpm check:ui`: pass.
- vitest work-item + fetchers/approval: 12 files, 85 tests pass. Full web vitest: 142 files, 608 tests pass (matches the reported 142/608).
- `playwright e2e/approval-withdrawal.spec.ts` after `pnpm build`: 3/3 pass.
- Mutation testing (each fix reverted in turn in my scratch copy, restored after, `git status` clean):
  - remove focus call: 2 tests fail (N1 success and failure).
  - remove tabIndex={-1}: 2 tests fail.
  - remove the announcement: 1 test fails (N2 success).
  - remove role="status": 2 tests fail (success announced, failure not announced).
  - remove aria-label: N3 naming test and others fail.
  - keep the label while pending: 1 test fails ("disables Withdraw while in flight").
  - remove the pre-announcement clear (`setAnnouncement("")`): NO test fails (see N5).
- Layout probe (scratch spec, deleted) on the built app with an empty approvals list: status paragraph computed `position:absolute`, 1px by 1px; section height 56 px = h2 28 + gap 8 + empty text 20, so the absolute paragraph contributes neither height nor flex gap. Page scrollHeight 720 unchanged by the paragraph being the section's sibling at the top (not at the page end).

## Assessment of the fixes
- **2.4.3 Focus Order (N1):** correct. The hook's onSettled returns the invalidateQueries promise, so mutate-level onSettled runs after the refetch, when the Withdraw button has gone; focus moves to the labelled section heading (tabIndex -1, programmatic only, not in the tab order). Done on both success and failure, which is appropriate since the failure alert has role="alert".
- **4.1.3 Status Messages (N2):** correct. A persistent role="status" (implicit polite) region exists before the content changes, which is what screen readers need; text is set on success only; failure keeps role="alert".
- **2.5.3 Label in Name (N3):** correct. The aria-label "Withdraw request — <kind>, <approver>" starts with the visible text "Withdraw request", so the visible label is contained in the accessible name. The label is dropped while that row is pending so the name matches the visible "Withdrawing…". Other rows keep theirs while disabled, which is fine.
- **Empty state:** sr-only paragraph is out of flow (absolute, 1px), so the section geometry is identical to eb13f397 (56 px, same child offsets). Only DOM additions are that empty paragraph and tabindex on the h2, neither visible. G8 baseline remains valid by CSS reasoning plus the measured probe; I did not pixel-diff against the Linux PNG (different OS rasterization locally).

## Findings
- **N5 (non-blocking, test gap)** work-item-approvals.tsx startWithdraw: `setAnnouncement("")` before each mutation (so a second withdrawal re-announces identical text) has no test; removing it leaves the suite green. Suggest one test that withdraws twice and asserts the region was emptied between. No behavioral defect found.
- No blocking findings. Residual: no real screen-reader run; pixel diff not executed.
<!-- END REPORT (sha256 d2228ba0b65f2642dc9af9d972d2efd3540f8cb257c3b9ec2a54fb11371df7a9) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/698-security-opus.md; Claude Opus 5.5; sha256 4a4ea5e3afec56ba31c5b5108738df90fed745066f5c5c46e662c78062cc4954) -->
# PR #698 security review (sampled big reviewer)

- **Model:** Claude Opus 5.5 (claude-opus-5-5), fresh independent context. This context did not author, direct or remediate the candidate. Role: an independent security sample. Per CLAUDE.md, this does **not** replace the required GPT-6 Sol security gate.
- **Reviewed head:** 3e12c386f923ce14557e67bfaeb9cb55de5b6520
- **Merge base:** 64b70f939a662163c00423184179e9c3993b8dbe (origin/main was a0992497d68206b517a7f452f04fbbbbb3cc6f54 at review time)
- **Date:** 2026-10-13
- **Branch hygiene:** used a scratch detached worktree at /Users/heinthura/.codex/worktrees/review-698-sec, removed afterwards. No edit, push, comment or merge on the candidate branch. The candidate worktree is still at 3e12c386 and clean.
- **Docker:** Testcontainers created one Postgres container and one Ryuk reaper. Both were removed automatically, and I confirmed this against a `docker ps -a` snapshot taken before the run. I removed no containers myself. The `taskdesk-*` containers were not touched.

## Diff scope (merge base..head)

There are 32 files: web code and tests (11 files), 18 i18n catalogs plus their schema, `packages/ui/src/styles/pairs.json` and one visual baseline PNG. **No server code changes.** The API routes this review challenges are already on main. I reviewed them as the authority the new UI relies on.

## Surfaces examined

- apps/api/src/approval/index.ts: the read route (:336-366), `withdrawApprovalForIdentity` (:131-163), the requester route (:470-482), and the admin route (:259-277, :483-495) with its `requireSessionOnly` middleware (:265).
- apps/api/src/approval/service.ts `withdrawApproval` (:356-452). It takes a lock on the work item and the approval, rechecks the admin under the lock (:381-383) only for a session credential, and has a conditional `state = 'pending'` update (:407). The audit marker is at :449.
- apps/api/src/approval/repository.ts: `loadApprovalTargetByApprovalId` (:322-363), `canWithdrawApproval` (:775-829) and `isActiveInstanceAdmin` (:147-167).
- packages/domain/src/approvals/approvals.ts `evaluateApprovalWithdrawalDecision` (:306-315). It authorizes only the requester or an instance admin, and the action only applies to a pending approval.
- apps/api/src/utils/require-session-only.ts. It refuses API keys and impersonation sessions.
- apps/api/src/instance/observability/audit-failure-notifier.ts `isCurrentInstanceAdmin`. It reads `user.role` from the DB and requires an active staff person. It never reads the session object.
- apps/api/src/utils/csrf-protection.ts and index.ts:1361. CSRF is enforced for every unsafe method under the auth guard. Only safe methods and a resolved API key are exempt, and there are no path exemptions.
- packages/libs/src/hono.ts. The shared client adds `X-TaskDesk-CSRF` to every unsafe method.
- The new web code: work-item-approvals.tsx, withdraw-approval.ts, get-work-item-approvals.ts, the two hooks, and the work-item-detail.tsx wiring.
- apps/web/e2e/approval-withdrawal.spec.ts, apps/web/playwright.config.ts and apps/web/src/test/e2e-secret-redaction.test.ts.
- The pairs.json diff: a structural JSON comparison of the base against the head.
- Prior notes, read but not relied on: 698-ordinary-a-sonnet.md, 698-ordinary-b-sonnet.md, 698-3e12-ordinary-b-sonnet.md and approvals-ui-impl-sonnet.md.

## Tests and reproductions run (scratch worktree at 3e12c386)

1. **Independent integration probe.** I wrote a scratch file, `tests/api-integration/zz-698-sec-probe.test.ts`. It was never committed and was deleted afterwards. It ran with `CI=true`, Testcontainers Postgres 18 and the serialized integration config. **Result: 6/6 passed.**
   - P1. A workspace owner whose DB role is `user` calls the admin route with a session that claims `role: "admin"`: **403**. The tenant's own approver, also with a forged session role, also gets **403**. The approval stays pending and there are 0 withdrawal audit rows. The session's role field grants nothing.
   - P2. Staff from another workspace: the requester route gives **404**, the admin route gives **403**, and `GET /work-items/{key}/approvals` gives **404**, with no approval id in the body. The approval stays pending. An instance admin has instance-wide authority by design (AP-7). There is no per-tenant instance admin, so "an admin of another tenant" maps to a workspace owner or admin elsewhere, which is refused.
   - P3. The API key of an instance admin, carrying `approval:request` and `instance:admin`, on the admin route: **403 `session_required`**. An impersonation session on the admin route: **403**. As a positive control, the same admin with a real session gets **200** and the approval becomes withdrawn.
   - P4. A non-requester who has reach (the named approver) on the requester route: **403**. A workspace owner who is neither the requester nor an instance admin: refused. The approval stays pending and there are 0 audit rows.
   - P5. An approved, terminal approval: the requester route gives **409** and the admin route with an instance-admin session gives **409**. A non-requester gets **403**, not 409, so the terminal state is not disclosed to someone without authority. The state stays approved and there are 0 audit rows.
   - P6. The read route for customers. On the portal host it gives **404**. A customer-portal session on the agent host gets **401**. Only when I forced an agent-flagged session for a customer did I get **200**. Even then the customer saw only the approval addressed to them, with `canWithdraw: false`, and not the CAB approval. A second, unrelated customer got 200 with `approvals: []`. The customer's withdrawal attempt got **403**, and the approval stayed pending.
2. **Existing approval integration suites.** I ran approval-lifecycle, approval-gate-semantics, approval-tenant-checks, approval-portal and approval-closure-and-clock with `CI=true` and Testcontainers, serialized. **5 files, 48/48 passed.** They already cover: an admin key on the admin route (403), a recheck for an inactive admin, an admin-route race that produces exactly one event and one audit row, and the `via: admin_route` audit marker.
3. **Web unit tests.** e2e-secret-redaction, work-item-approvals, work-item-detail and withdraw-approval: **4 files, 37/37 passed.** That includes the #686 redaction guard.
4. **e2e spec.** `playwright test e2e/approval-withdrawal.spec.ts` against a built dist (`VITE_API_URL=""`): **3/3 passed.**
5. **CSRF in the browser.** I edited the scratch spec temporarily to record the `x-taskdesk-csrf` header on the withdraw POST, then restored it. Both the requester-route POST and the admin-route POST carried `x-taskdesk-csrf=visual-csrf-token`. The deliberate assertion mismatch made 2 tests fail, which was expected; the spec was then restored.
6. **`pnpm check:tokens`.** This runs check-tokens and check-contrast: **"418 declared, source-grounded pairs meet thresholds in light/dark built CSS."**
7. **pairs.json structural diff.** The base and head both have 418 pair records. Only records 16 and 17 changed: `--color-muted-foreground` on `--color-background` (light and dark), body category, `minRatio` 4.5 unchanged. In each, 6 occurrences and 5 occurrenceIds were **appended**, and the existing prefix is preserved byte for byte. Nothing was removed, and no `fg`, `bg`, `minRatio`, `category`, `backdrop` or class field changed. The sixth occurrence reuses the existing `AlertDescription` occurrence id with a new caller chain, so the id set still equals the occurrence ids. The only `-` lines in the textual diff are a trailing-comma change.

## Challenge answers

1. **Withdraw authority is enforced by the server alone.**
   - Requester ownership comes from the domain rule `requestedBy === actingPersonId`. It is evaluated before the lock and again under the lock.
   - Instance-admin authority needs `requireSessionOnly`, then `isCurrentInstanceAdmin` (DB role and an active staff person), then a recheck under the lock that applies only when `credential === "session"`.
   - Reach is checked through `loadApprovalTargetByApprovalId`, which returns 404 outside reach, and through `canWithdrawApproval` (reach and `approval:request`).
   - State is checked by the domain rule and by the conditional update under the lock.
   - On the client, `user.role === "admin"` (work-item-approvals.tsx:58-59, :70; withdraw-approval.ts:24-26) only picks the URL. P1 and P3 show that it grants nothing.
2. **Read route.** Staff without reach get 404, and staff with reach but without `work_item:read` get 403. Customers are filtered to rows they requested or are named on (index.ts:356-363), and in practice the route is unreachable from the portal (P6). The UI shows the requester and approver display names, kind, state and dates. It does not show `decisionNote`, emails or ids. The detail page lives under `/agent/...` (routes/agent/_layout/_authenticated/agent/work-items/$key.tsx), so it is staff-only.
3. **e2e spec.** It is fully mocked with `page.route`. Its only credential-like values are literal fakes: `visual-token`, `visual-csrf-token` and `ada@example.test`. It has no real logins, keys or env reads, and it renders none of the MFA secret markers. So the #686 guard rightly does not include it in the set of secret-rendering specs, and the guard test passes. The global `trace: retain-on-failure` setting and the explicit `approval-withdrawn.png` screenshot can only capture fixture data.
4. **pairs.json.** The changes are additive occurrence records only. No threshold or rule is weakened, and the contrast gate is green.
5. **CSRF.** Both withdraw calls go through `@taskdesk/libs` `client`, which adds the CSRF token to unsafe methods (observed in the browser). The server enforces CSRF globally under the auth guard, with no path exemption for `/api/approvals` or `/api/admin/approvals`.

## Findings

- **F1 (non-blocking, pre-existing server code, not in this diff):** apps/api/src/approval/service.ts:356-412. On the requester route, reach and `approval:request` are checked before the transaction (index.ts:147-151 via `canWithdrawApproval`) but are not rechecked under the lock. Only requester identity and state are rechecked there. A requester whose reach is revoked at the same moment as their withdrawal could still withdraw their own pending approval. The impact is low: the action withdraws the caller's own request, and the alternative would deny it. I note it only for completeness.
- **F2 (non-blocking, audit accuracy):** work-item-approvals.tsx:58-59 and :70, and service.ts:449. An instance admin who is also the requester is always sent to the admin route. The audit row for withdrawing their own request then records `via: "admin_route", onBehalfOfPersonId: <self>`. The record is still truthful about which route was used and is not an authority gap. A follow-up could prefer the requester route when `requester.id` is the viewer's own person.
- **F3 (non-blocking, robustness):** work-item-approvals.tsx:58-59. A user whose `user.role` is `admin` but whose person is inactive or not staff is sent to the admin route. They get a 403 even for their own approval, where the requester route would have succeeded. This is fail-closed and not a security issue.
- **F4 (non-blocking, e2e hygiene):** apps/web/e2e/approval-withdrawal.spec.ts:217-220 writes a full-page screenshot to the test output on every run, and playwright.config.ts:19 keeps traces on failure. Both are acceptable today because all data is fixture data. If the spec is ever moved to a real backend, it should adopt the #686 `test.use({ trace: "off", video: "off", screenshot: "off" })` and the `redactSecretErrorContext` pattern.

There are no blocking findings.

## Residual risk / not checked

- I did not run the full integration suite (about 180 files) or the full e2e and visual suites. I ran only the approval suites, my probe, and the targeted web tests.
- The e2e spec is mock-only. I found no real-backend browser journey for withdrawal, and the CSRF header was observed only against the mock. Server CSRF enforcement was verified by reading the code, not by sending a POST without a token to these routes.
- I did not exercise customer access to the agent SPA through a real portal-host session. The 404 and 401 results come from Hono app requests with a mocked session.
- The pixel content of the visual baseline PNG was not inspected for security purposes. It contains only fixture text.
- The probe file was deleted with the scratch worktree. Its cases are described above.
- This sample does not satisfy the GPT-6 Sol security gate that CLAUDE.md requires for security-scope paths (`apps/web/e2e/**` and the pairs.json gate manifest).

## Verdict

**CLEAR.** I found no blocking security finding at 3e12c386f923ce14557e67bfaeb9cb55de5b6520. The mandatory GPT-6 Sol security review is still required before merge.
<!-- END REPORT (sha256 4a4ea5e3afec56ba31c5b5108738df90fed745066f5c5c46e662c78062cc4954) -->

<!-- BEGIN REPORT (/Users/heinthura/.codex/taskdesk-evidence/2026-10-13/698-effd-security-rebind-opus.md; Claude Opus 5.5; sha256 22e165c260c47ad610145e29c8a06c4589339f536baf52d81ebebc8139221524) -->
# PR #698 security rebind after merging main (sampled big reviewer)

- **Model:** Claude Opus 5.5 (claude-opus-5-5). This is the same fresh, independent context that cleared 3e12c386 in `698-security-opus.md`. It did not author, direct or remediate the candidate or this merge. This is not the GPT-6 Sol gate.
- **Reviewed head:** effdbc49e8cbe9736c75f5d0f9ad569612d1e7d2
- **Parents:** 3e12c386f923ce14557e67bfaeb9cb55de5b6520 (previously CLEAR) and af663a0cd65e872c2b368d69e29392e89acfbad3 (origin/main)
- **Merge base of the parents:** 64b70f939a662163c00423184179e9c3993b8dbe
- **Date:** 2026-10-13
- **Hygiene:** I used a scratch detached worktree at /Users/heinthura/.codex/worktrees/review-698-effd-sec and removed it afterwards. I made no branch edits, pushes, comments or merges. Docker `ps -a` snapshots before and after the integration run are identical: Testcontainers cleaned up its own containers, I removed none, and the `taskdesk-*` containers were not touched. Port 4178 was taken by another lane's server (PID 68950, from review-696-b2), which I left running. I ran Playwright through a temporary copy of the config on port 4198 and deleted that copy afterwards.

## 1. Non-conflicting files equal git's own merge

`git merge-tree --write-tree 3e12c386 af663a0c` produced tree 2515e89c8cf63a596959f25f5fa4cebfc0e2c857. It reported one content conflict, in `packages/ui/src/styles/pairs.json` (stages 1/2/3 = d7aa044f/29edcffd/d5efb7fe). Every other file merged automatically, including the 18 i18n catalogs and `i18n/schema.json`.

`git diff --stat 2515e89c effdbc49` lists **only** `packages/ui/src/styles/pairs.json`. So every non-conflicting file in the merge commit is byte-identical to git's automatic merge.

## 2. pairs.json resolution

I ran a per-record, per-field three-way check. It compares the base (64b70f93), ours (3e12c386), theirs (af663a0c) and the result (effdbc49), each with 418 records, matched by position.

- **Scalar fields:** in every record, every scalar field is equal across ours, theirs and the result. That covers `fg`, `bg`, `minRatio`, `category`, `backdrop`, `foregroundClass`, `backgroundClass`, `usage` and `surfaceContext`. 0 mismatches. `minRatio` is unchanged from the base in all 418 records.
- **Lists (`occurrences`, `occurrenceIds`):** in every record, the result's set equals the union of ours and theirs. Neither parent deleted anything relative to the base, so nothing was dropped. There are 0 invented entries and 0 duplicates.
- **Id consistency:** in every record, the `occurrenceIds` set equals the set of occurrence `id`s.
- **Records touched:**
  - 6 to 9: one occurrence and one id each, from main (#692's session-error and density surfaces).
  - 16 and 17: ours added 6 occurrences and 5 ids, theirs added 1 and 1. The result has 187 occurrences and 138 ids, which is the exact union.
- **`pnpm check:tokens`** at effdbc49: **"418 declared, source-grounded pairs meet thresholds in light/dark built CSS."**

## 3. What main brings, and whether it affects approval or CSRF behaviour

The commits in 64b70f93..af663a0c are #692 (3e8b7834 density, f9a6adc7 and b6407283 session guard, 33a86688 motion, 72e74362 portal ThemeProvider, d8b11322 pairs) and #700 (views.md docs).

- `git diff --stat 3e12c386 effdbc49` over `apps/api`, `packages/libs`, `packages/domain`, `packages/permissions`, `apps/web/src/components/work-item`, `apps/web/src/fetchers`, `apps/web/src/hooks`, `apps/web/e2e`, `apps/web/playwright.config.ts` and `apps/web/src/test` is **empty**. That covers the withdraw routes, the service, the repository and the domain rule; the read route; the CSRF middleware and the client CSRF injection; the approvals UI, fetchers and hooks; and the e2e spec and redaction guard. All are byte-identical to what I probed at 3e12c386.
- Main also does not touch `apps/web/src/components/providers/auth-provider` or `apps/web/src/lib`, so the `useAuth().user.role` value that selects the route is unchanged.
- **#692 session guard** (apps/web/src/routes/agent/_layout/_authenticated.tsx) is client-side route gating only:
  - `getSession` now retries a bounded number of times (250, 750 and 1500 ms) on 408, 429, 5xx or a network failure.
  - It throws a retryable `SessionUnavailableError` instead of redirecting to sign-in.
  - A 200 with null data, or a definitive 4xx, still resolves as before, so sign-out redirection is unchanged.
  - It sends no mutations and no CSRF requests, and it changes neither the user object nor any server authorization.
  - A transient failure now leaves the user on an error screen rather than signing them out. Server-side authorization of approval routes is unaffected.
- The other #692 changes (density preference, motion.css, portal ThemeProvider, i18n keys) are presentational or concern user preferences. None touch approvals, authentication middleware or CSRF.

## Tests run at effdbc49

- **Web vitest** (e2e-secret-redaction, `components/work-item/*`, `fetchers/approval/*`, `routes/agent/_layout/_authenticated.test.tsx`): **14 files, 99/99 passed.**
- **Playwright** `e2e/approval-withdrawal.spec.ts` against a built dist (`VITE_API_URL=""`): **3/3 passed.**
- **Integration** (`CI=true`, Testcontainers, serialized): approval-lifecycle, approval-gate-semantics, approval-tenant-checks, approval-portal and approval-closure-and-clock. **5 files, 48/48 passed.**
- **`pnpm check:tokens`:** passed (418 pairs). **`pnpm check:i18n`:** all locales in sync.
- I did not rerun the scratch authority probe (P1 to P6). The server and client approval code it exercised is byte-identical to 3e12c386, and the results there were 6/6.

## Findings

- None new. The non-blocking findings F1 to F4 in `698-security-opus.md` carry over unchanged.

## Residual risk

- I did not run the full web, integration or visual suites. The conductor reports web vitest at 144 files / 621 tests, plus typecheck, check:i18n and check:visual-scope. I did not reproduce those beyond what is listed above.
- The pairs.json check matches records by position. Record order and count are identical across the base, both parents and the result, so this is sound here.
- This sample does not satisfy the GPT-6 Sol security gate, which must still be recorded at effdbc49.

## Verdict

**CLEAR** at effdbc49e8cbe9736c75f5d0f9ad569612d1e7d2.
<!-- END REPORT (sha256 22e165c260c47ad610145e29c8a06c4589339f536baf52d81ebebc8139221524) -->
