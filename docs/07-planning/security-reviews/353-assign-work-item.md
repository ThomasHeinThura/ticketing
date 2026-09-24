# Security review — assign and reassign a work item (issue #30, `POST /api/work-items/{key}/assign`)

**Reviewer:** Opus 5.5, fresh independent context commissioned by the orchestrating session. Did not author, direct, or remediate this change.
**Reviewed head:** `f781fe088696cee4658b2c8e0b1538ce6e4727d0`
**Pull request:** #353 (part of #30)
**Date:** 2026-09-24
**Verdict:** CHANGES NEEDED. The runtime authority is sound; two blocking items are one missing tenant-scope regression test (S1) and a red required CI check (S2). The gate items at the end also block the merge.

## Head verification

- `gh pr view 353 --json headRefOid` returned `f781fe088696cee4658b2c8e0b1538ce6e4727d0`, branch `feat/30-assign-action`, `MERGEABLE`.
- Commits `origin/main..head`: `37a6b28` (feature), `d9e5aca` (test cleanup), `f781fe0` (fix round for the ordinary review). All three have the author `GitHub Copilot (DeepSeek V4.1 Flash) <agent@taskdesk.local>`. That matches `## Implemented by`.
- The branch is one commit behind `origin/main` (`7bebaf6`, #351, docs only). It does not affect anything reviewed here.
- Worktree at the exact head, private database `pr353_opus_test` on td-lane-pg.

## Surfaces examined

- `apps/api/src/utils/require-workspace-capability.ts`: the new `assertCallerHasCapabilityOrSelf`, and the unchanged `assertCallerHasCapability` / `builtInRoleHasCapability`.
- `apps/api/src/work-item/index.ts`: the route declaration, the handler, the caller-person lookup and the self predicate.
- `apps/api/src/work-item/controllers/assign-work-item.ts`: the whole file.
- `apps/api/src/work-item/policy.ts`, `response.ts`, `schema.ts`.
- `apps/api/src/work-item/require-work-item-reach.ts`, which is unchanged.
- `packages/permissions/src/evaluator.ts`: `selfTargetPredicateHolds` and the `orSelfTarget` branch.
- `apps/api/src/database/schema.ts`: `person` (`person_user_unique`), `membership`.
- `apps/api/src/audit/audit-writer.ts` and `actions.ts` (`validateAction`).
- `packages/domain/src/assignment/assignment.ts` (#287).
- Tests: `tests/api-integration/work-item-assign.test.ts`, `tests/permissions/work-item-assign-policy.test.ts`, and the matrix fixture diff.
- Specs and notes: `assignment.md` (AS-1 to AS-9, § API, § Edge cases, § Testing), `rbac.md` (role table, `orSelfTarget`), `definition-of-done.md`, and the decision-log entries dated 2026-09-23. Prior security notes: #307 and #322 on main, #326 on its branch, and #320's S3 and D0 on its branch.

## Suites at this head

| Suite | Result |
| --- | --- |
| `work-item-assign.test.ts` (integration, real Postgres) | 13/13 |
| API unit (`vitest.config.ts`) | 57 files, 450/450 |
| `pnpm test:permissions` | 11 files, 81/81; 5/5 tasks |
| `pnpm check:openapi` | matches (107 operations) |
| `node --test 'scripts/ci/**/*.test.mjs'` | **494/495. One failure: `check-events.test.mjs:106`** (S2) |
| `check-pr-template.mjs --body` (live PR body) | 4 problems (see Gates) |

## Probes

These were run through `createApp().app.request(...)`, which is the full Hono middleware stack: session and API-key authentication, reach, validation and the handler, against real Postgres. I used a scratch suite, and removed it afterwards.

1. **Assignee validation: one answer for every non-rostered id.** A lead assigning each of the following got a byte-identical `400 "That person is not on this project's roster…"`, and the row stayed unassigned:
   - a nonexistent id;
   - a person rostered on a project in **another workspace**;
   - a staff person in **another organisation**;
   - a **customer-side** person;
   - a same-organisation person who is not on the roster;
   - the project's own id;
   - a SQL-shaped string.

   So #290's "foreign equals nonexistent" rule holds, and nothing is an oracle. A member who names anyone but themselves gets 403 *before* the roster lookup, and the response is identical for a rostered colleague and a nonexistent id. So the roster is not probeable below `work_item:assign`.
2. **Latent: the roster row alone is trusted.** Where I inserted a project-roster `membership` row directly in SQL, assignment succeeded (200) for four people who should arguably not be assignable: a cross-organisation staff person, a customer-side person, a user with `banned = true`, and a rostered person with no `workspace_member` row. No API path writes `membership` today (`grep` finds no writer in `apps/api/src`), so none of this is reachable. See S3.
3. **Who may assign.** Every case below behaved as the spec requires:

   | Caller | Target | Result |
   | --- | --- | --- |
   | member | self | 200 |
   | member | another person | 403 |
   | member | self, taking an item a colleague holds, no expectation | 409, naming the holder |
   | member | self, taking an item a colleague holds, `expectedCurrentAssigneeId` set | 200 (the spec's "assign to self, confirmation if taking") |
   | viewer | self | 403 |
   | `workspace_member.role = customer` | self | 403 (AS-4) |
   | built-in `lead` name backed only by an `is_system = false` row | another person | 403 (#322's genuine-row rule) |
   | built-in `member` name with no role row | self | 403 |
   | custom role string | self | 403 |
   | duplicated `workspace_member` rows (lead + member) | another person | 403 (`isUnambiguousMembership`) |
   | non-member of the workspace | anyone | 404, byte-identical to an unknown key |

   API keys:

   | Key owner | Target | Result |
   | --- | --- | --- |
   | member | another person | 403 |
   | member | self | 200 |
   | lead | another person | 200 |
   | viewer | self | 403 |
   | bogus key | — | 401 |

   API-key activity rows carry `actor_type = api_key` and the owner's id.
4. **The `require-workspace-capability.ts` change.** It is additions only. `assertCallerHasCapability`, `builtInRoleHasCapability` and `requireWorkspaceCapability` are byte-unchanged, and the new function has exactly one caller (`work-item/index.ts:402`). So no other route's authority moves. Both `builtInRoleHasCapability` calls are `await`ed. It uses the same `workspaceMemberRoles` → `isUnambiguousMembership` → `roles[0]` reduction as the strict function, and the self branch cannot grant unless `isSelfTarget` is true *and* the role genuinely holds `work_item:update`. No widening.
5. **The policy matches enforcement.** The declared predicate is `body.assigneeId === identity.personId`. The evaluator's `selfTargetPredicateHolds` requires `body.assigneeId != null && === personId`. The handler requires `callerPerson !== undefined && callerPerson.id === assigneeId`, with `callerPerson` from `person.user_id = session userId`. Because `person_user_unique` is global, this is the same row `resolveIdentity` returns. A caller with no person row gets `false` from both. `assigneeId` is `z.string().min(1)`, so null never reaches the comparison. The two are equivalent. The new `work-item-assign-policy.test.ts` pins the declaration.
6. **Activity, event and leakage.**
   - The response, the 409 body and the error message carry opaque ids and a version only, with no names or emails.
   - The activity row is `internal`, workspace-stamped, written in the same transaction, `field = assigneeId`, old → new ids.
   - `work_item.assigned` is published after commit, with ids and `workspaceId`/`projectId`.
   - A no-op re-assign writes and emits nothing.
   - Extra body fields (`workspaceId`, `projectId`, `version`, `actorId`) are stripped and inert.
   - Archived items, soft-deleted items and items in a soft-deleted project all get 404.
7. **Concurrency.** Six members self-assigned the same unassigned item concurrently, over API keys. Exactly one got 200 and five got 409, each naming the winner. The final `version = 2`, with exactly one activity row. This is the spec's § Testing concurrent case, and it holds.
8. **#320 patterns.** There is no top-level `OR`. The conditional write is `and(eq(id), isNull | eq(assignee_id))`, which drizzle parenthesises as one `AND` list. There is no name join. The roster join is id-to-id and scoped by `scope = 'project' AND scope_id = item.projectId`, and `item` itself is re-checked against the reach-resolved `workspaceId` (`assign-work-item.ts:94`).
9. **Mutation checks.** Each was restored afterwards, and `git status` was clean. The mutations were made in `assign-work-item.ts`.

   | Mutation | PR suite | My probe |
   | --- | --- | --- |
   | Drop `eq(membershipTable.scopeId, item.projectId)`, so any project's roster qualifies (a cross-tenant assignment) | **13/13, still green** | red |
   | Drop `eq(membershipTable.scope, "project")` | **13/13, still green** | — |
   | Disable the roster refusal entirely | red (`AS-5 … not on the project roster`) | — |

## Findings

### S1 — BLOCKING (a missing regression test; the code is correct). The tenant scope of the roster check is unpinned

- **Where:** `apps/api/src/work-item/controllers/assign-work-item.ts:105-110`, and `tests/api-integration/work-item-assign.test.ts:345`.
- **The gap:** the only thing that stops a lead in workspace A from pointing `work_item.assignee_id` at a person from workspace B is `scope_id = item.projectId` in the roster join. #320's S3 made this exact invariant WI-10's acceptance condition, because the list and detail views will render the assignee.
- The suite's AS-5 negative uses a person with **no membership row at all**. So deleting the `scopeId` condition, which turns the check into "rostered on *any* project anywhere", leaves the whole suite green. The same is true of the `scope = 'project'` condition. #290's "foreign id and nonexistent id get the same answer" is also not asserted anywhere in the PR.
- **Fix (tests only):** add an integration case where the target is rostered on a project in **another workspace** (and ideally a second project in the same workspace). Assert a 400 byte-identical to a nonexistent id, with the row untouched. Then re-run the mutation above and confirm it goes red.

### S2 — BLOCKING (a required check is red). `gate checkers + red probes` fails on this head

- **Where:** `scripts/ci/probes/check-events.test.mjs:106` asserts `/26 published event key/`.
- This PR adds the 27th published key (`work_item.assigned`). `check:events` itself passes and reports "27 … every one registered in events.md", but the pinned count in the probe test was not updated.
- It reproduces locally (494/495), and it is the failure in CI run 35905759785, job 107333039417.
- The PR body's "`pnpm test` green" did not cover `scripts/ci/**`.
- **Fix:** update the pinned count to 27 in the same PR.

### S3 — NON-BLOCKING (latent). A roster row is trusted without an organisation, side or ban check

- **Where:** `assign-work-item.ts:101-112`.
- Assignability is "a `membership(scope = project, scope_id = project)` row exists and `person.active`". Probe 2 shows that a cross-organisation person, a customer-side person, a banned user and a person with no workspace membership are all assignable once such a row exists.
- This is unreachable today, because nothing writes `membership`. The first membership writer (project-member management, or SCIM group sync `derived_from`) becomes the only guard.
- **Recommendation:** add `person.side = 'staff'` and `person.organisation_id = workspace.organisation_id` (or an explicit rule for customer-org projects) to the same join as defence in depth. Or make "roster rows are same-organisation staff only" an acceptance criterion of the first membership writer. `GET /api/projects/{id}/assignable` must use the identical predicate, so that the picker and the write cannot disagree.

### S4 — NON-BLOCKING (accuracy). The audit-row explanation cites the wrong blocker

- The PR body says the `audit_log` write is "blocked by #198" and that it "500s with the writer's own 'not wired yet' error". Neither is accurate:
  - `AUDIT_ACTIONS_NOT_YET_WIRED` holds only `legal_hold.placed`/`lifted`, and #198 is the purge-job and legal-hold issue.
  - `work_item.assigned` would fail `validateAction`'s *second* branch ("unknown audit action … does not yet validate events.md-keyed domain-event actions", `audit-writer.ts:243-250`).
- The real prerequisites are two:
  - the events-key allowlist in `apps/api/src/audit/actions.ts`, which I could not find a tracking issue for;
  - #344 (`audit_log.project_id`). The AU-10 decision (2026-09-23) says #344 "must land before the first project-scoped audit writer merges", and assignment is project-scoped.
- The security conclusion is unchanged: no audit row is written, the activity row records the actor, and the gap is shared with `PATCH` and create. **Whether this mutation may merge without its `audit_log` row is not mine to clear.** `definition-of-done.md:31` requires the row, and the unticked box blocks the template gate until the dependency lands or Thomas decides.

### S5 — NON-BLOCKING. The pure domain rules from #287 are re-implemented inline

- `evaluateAssigneeEligibility` and `planAssignment` in `packages/domain/src/assignment/assignment.ts` encode AS-5 and the no-op rule. The controller re-implements both inline and orders them differently: it checks eligibility before the no-op, while `planAssignment` treats `new === current` as a no-op unconditionally. This is the ordinary review's F4.
- It is not a security defect: the controller's order is the stricter one. But it is two sources for one rule, and the "Domain logic lives in `packages/domain`" line is marked n/a in the PR body when a domain rule does exist.

### S6 — NON-BLOCKING (a note for #323, the policy shadow mode). The shadow evaluator needs the parsed body for this route

- `selfTargetPredicateHolds` reads `context.body.assigneeId`.
- If #323's request-path shadow comparison evaluates this route from middleware, before the body exists, every legitimate member self-assign will log as a runtime-allow / declared-deny divergence.
- #323 should either supply `body` for `orSelfTarget` routes or evaluate them post-validation. This is not a defect in this PR.

## Things checked and found sound

- No authority widening in `require-workspace-capability.ts`; all awaits are present.
- The genuine-row rule (#322) and the duplicate-row fail-closed rule apply to both branches.
- The declaration and runtime predicate are equivalent (probe 5), and the declaration is pinned.
- Uniform 404 for cross-workspace keys, with identical bodies (#307).
- No roster oracle below `work_item:assign`.
- Foreign and nonexistent assignee ids get identical answers.
- The conditional write is race-safe (probe 7), and the version increment is atomic (F1 fix verified).
- A customer can never assign (AS-4).
- No person data beyond opaque ids leaves the route.
- The activity row is internal and in-transaction; the event is published after commit.
- The API-key path uses the owner's role. The key-scope limitation is the known, documented latent note in `assertCallerHasCapability`'s contract, not a regression.

## Gates (checked at this head; these are not security findings, but each blocks the merge)

- **Ordinary review is not at the exact head.** The DeepSeek V4 Pro review and the GPT 5.6 Sol alignment check are both at `d9e5aca`. The head is `f781fe0`, the author's own fix round: the atomic version bump, a new policy test, and the split anonymous test. No independent reviewer has cleared that commit.
- **Reviewer independence needs the orchestrator's check.** The author and both reviewers are all "GitHub Copilot" contexts, on different models. The 2026-09-23 lane-agent entry says "the same agent or tool is never both author and ordinary reviewer". The later 2026-09-23 fallback entries route ordinary review to a fresh Claude Sonnet context, or to the currently available model, commissioned by the orchestrating session. Whether a Copilot-hosted reviewer of a Copilot-authored PR satisfies that is for the orchestrator to decide. I am recording it, not deciding it.
- **CI:** `gate checkers + red probes` is failing (S2). `pull request template + security review` is failing: `check-pr-template.mjs --body` reports 4 problems. The security-review section is blank (this note fills it), the independent-review box is unticked, and the audit-row box is unticked (S4).
- **Attribution:** it reconciles. All three commits are `GitHub Copilot (DeepSeek V4.1 Flash) <agent@taskdesk.local>`, as `## Implemented by` states.
- **Waivers:** the `## Gates` table declares none.

## Verdict

**CHANGES NEEDED** at `f781fe088696cee4658b2c8e0b1538ce6e4727d0`, for S1 (the missing cross-tenant roster regression test) and S2 (the red CI probe). Neither needs a production-code change. The authority model itself — capability, self branch, reach, genuine-row, uniform 404, assignee scoping and concurrency — held under every probe. A delta review of the fix commit is needed; it should confirm that the S1 mutation goes red and that CI is green. S3–S6 do not block. The audit-row question (S4) and the gate items above belong to the orchestrator and Thomas, not to this review.

---

## Delta review (Opus 5.5)

**Reviewer:** Opus 5.5, a fresh independent context commissioned by the orchestrating session. It did not author, direct or remediate this change.
**Reviewed head:** `07cbc3b1a662331d831cc292b4ff785bc497d435`
**Base at review:** `origin/main` `8f545c3c1ae8ee3d5ac9b22d830ff52ab1fce918` (includes #323, #354, #334, #338)
**Date:** 2026-09-24
**Verdict:** **APPROVED (security)** at `07cbc3b1a662331d831cc292b4ff785bc497d435`. No blocking security finding. Two gate items outside this review still block the merge (see "Gates").

### Scope

- Every commit `f781fe0..07cbc3b`:
  - `e5edae3`, read in full;
  - the merges `d660629`, `65dfdee` and `07cbc3b`. `git show --remerge-diff` shows no conflict-resolution content in any of them.
- The whole PR diff against `origin/main`, re-read against main's new semantics:
  - #323/#354: the shadow markers and the shadow evaluator;
  - #334: `sees_all` per workspace;
  - #338: the existence-oracle standard.
- `gh pr view 353` reports head `07cbc3b1a662331d831cc292b4ff785bc497d435`, which matches `origin/feat/30-assign-action`.
- I used a private worktree and a private database, `o353_test`, on td-lane-pg. Both were removed afterwards.

### Suites at this head

| Suite | Result |
| --- | --- |
| `tests/api-integration/work-item-assign.test.ts` | 16/16 |
| `tests/api-integration/existence-oracle-317.test.ts` | 7/7 |
| `tests/api-integration/permissions-shadow-mode.test.ts` | 15/15 |
| API unit (`vitest.config.ts`) | 58 files, 488/488 |
| `pnpm test:permissions` | 11 files, 81/81; 5/5 tasks |
| `node --test 'scripts/ci/**/*.test.mjs'` | 508/508 |
| `pnpm check:openapi` | matches (107 operations) |
| `pnpm check:events` | 27 keys, all registered |

CI (`statusCheckRollup` at this head): every required check is green except **`pull request template + security review`**. The rest of this note explains why. Three checks are `NOT ENABLED` and were skipped.

### Mutations (each restored afterwards; `git status` clean)

| Mutation | PR suite |
| --- | --- |
| Drop `eq(membershipTable.scopeId, item.projectId)` (the S1 tenant scope) | **red**: both new AS-5 cases |
| Put eligibility before the no-op again (the old order) | **red**: the deactivated-holder test |
| Drop the CAS clause (`isNull` / `eq(assigneeId, expected)`) | **red**: two AS-3 cases |
| Make the handler's self predicate always `true` | **red**: AS-2 "member assigning someone else" |

### Earlier findings: are they closed?

- **S1: closed.** A person rostered only on another workspace's project gets a 400. That response is byte-identical (`text()` equality) to the one for a nonexistent id, and the row is left untouched. A person rostered only on a sibling project in the same workspace is also refused. The `scopeId` mutation turns both cases red.
  - Residual: dropping `eq(scope, "project")` is still not pinned. It is harmless, because `scope_id` is a UUID keyed to this project, so a non-project row cannot collide with it without a deliberate insert.
- **S2: closed.** The probe now pins 27, and the CI-scripts suite passes 508/508.
- **S3: tracked, not closed** (#359, open). It is still unreachable, because nothing in `apps/api/src` writes `membership`. It remains non-blocking.
- **S4: corrected.** The body now cites #360 and #344 and leaves the audit box unticked. See item 4 below.
- **S5: closed.** The controller calls `planAssignment` and `evaluateAssigneeEligibility` from `@taskdesk/domain`. They are named exports; there is no star export.
- **S6: still latent.** It now lives on `main`; see D2.

### The five questions

1. **An assignee outside the roster?** No. The roster join is `and(scope = 'project', scope_id = item.projectId, person_id = input)`, with `item` re-checked against the reach-resolved `workspaceId`. The two S1 tests pin it. The only caveat is S3: a directly written `membership` row is trusted.
2. **Assigning on a foreign key?** No. `requireWorkItemReach` resolves the key and turns a reach 403 into a 404. The controller also re-checks `item.workspaceId !== workspaceId`, and 404s.
3. **An existence oracle?** None found:
   - foreign and missing keys both get 404;
   - foreign and nonexistent assignees both get the same byte-identical 400, now asserted;
   - a member naming anyone but themselves gets 403 before the roster lookup.

   The capability check runs before the controller's archived-item 404. So a viewer gets 403 and a lead gets 404 for an archived item, but only inside a workspace the caller already reaches. That is not a cross-tenant signal.
4. **`and()` / `or()` grouping?** There is no `or()` anywhere in the diff. Every `where` is a single `and(...)`. The only raw `sql` is the `version + 1` expression.
5. **Is the CAS race-safe?** Yes, between assigns:
   - the write is `UPDATE ... WHERE id = $id AND (assignee_id IS NULL | assignee_id = $expected)`;
   - under READ COMMITTED, Postgres re-evaluates the predicate after acquiring the row lock, so exactly one of two concurrent writers matches;
   - a stale `expectedCurrentAssigneeId` matches no row and gets 409, carrying the current holder;
   - the CAS mutation goes red.

   It is **not** race-safe against archive or project soft-delete. See D1.

### Policy

- The declaration and rbac.md agree:
  - `work_item:assign` is primary, held by lead, manager, admin and owner;
  - `orSelfTarget(body.assigneeId === identity.personId, work_item:update)`: a member may self-assign, and a viewer or customer may not.
- I confirmed the capability sets against the compiled `BUILT_IN_ROLES`. `require-workspace-capability.ts` is still additions-only relative to main; the #354 markers in `requireWorkspaceCapability` are untouched.

### Shadow markers (#354)

**The legacy outcome is correct wherever it is known.** Tracing the marker:

| Case | What happens | Result |
| --- | --- | --- |
| Request reaches the handler | `requireWorkItemReach` sets `allowed` | — |
| Handler 403 | The middleware sees `allowed` together with a 403 and downgrades it to `unknown` | No false allow |
| 200 | Recorded as allowed | Correct |
| Controller 400 / 404 / 409 | Recorded as allowed | Correct: the capability had already passed |

The one inexact case is a **body-validation 400**. Validation runs before the handler's capability check, so for a viewer it records "allowed" although that viewer's capability was never evaluated (D2).

A live probe with `TASKDESK_POLICY_SHADOW=on` sent five requests:

- member self-assign → 200;
- member assigning another person → 403;
- lead assigning another person → 200;
- viewer with a bad body → 400;
- lead self-assign → 200.

All five filed as `unevaluated / reach_unavailable`. No person has `sees_all` today (`resolve-identity.ts` always resolves `false`), so there is no false disagreement at this head.

### Activity, event and audit

- The activity row is written by `recordWorkItemActivity(tx, …)` inside the same `db.transaction` as the CAS write.
- `publishEvent("work_item.assigned")` runs after the transaction resolves.
- The no-op path writes nothing and emits nothing.
- The `audit_log` box is **unticked, and not claimed or waived**. It names #360 (open; PR #364 open) and #344 (open). The `## Gates` table declares no waiver.

### The disclosed behaviour change

A re-assign of a since-deactivated holder now returns 200. **This is safe.**

- It is a pure no-op. Nothing is written or emitted, and it returns the stored version.
- The caller has already passed reach and capability-or-self.
- The response echoes only ids the caller supplied or can already read.
- No new assignment is created, so AS-5's "refuse assigning a deactivated person" is not bypassed.

The same no-op-first order also covers a holder who has since left the roster, and a stale `expectedCurrentAssigneeId` when the input already equals the holder. Both are safe for the same reason. The new test asserts no event but not "no activity row / version unchanged". That is a minor gap in the test, not a defect.

### Findings

#### D1: NON-BLOCKING (integrity race; not authority or tenant). The CAS write does not re-check the freeze invariant

- **Where:** `apps/api/src/work-item/controllers/assign-work-item.ts:88-98` (the pre-read) and `:167-174` (the write).
- **The gap:** the controller checks `archivedAt`, `deletedAt` and `item.workspaceId` on a read *outside* the transaction. Its write matches only `id` plus the assignee CAS.
- **Failure scenario:**
  1. A lead's assign passes the pre-read.
  2. An admin soft-deletes the project, or the item is archived or deleted, before the `UPDATE` runs.
  3. The `UPDATE` still matches. It writes the assignee, bumps `version`, writes an activity row and publishes `work_item.assigned` for a frozen item.

  This violates #202 / #204's freeze invariant. `update-work-item.ts:121-175` guards exactly this case in-transaction (`FOR UPDATE` plus `projectNotDeleted` in the `WHERE`).
- **Same window:** the roster/active check is outside the transaction too. A person deactivated or removed from the roster in that window can still be assigned.
- **Impact:** no authority, tenant or disclosure effect. The window is milliseconds, and the actor was already authorized.
- **Fix:** add `isNull(archivedAt)`, `isNull(deletedAt)` and PATCH's `projectNotDeleted` expression to the CAS `where`, and 404 on zero rows when the item is gone. Optionally re-check the roster under the transaction.
- **Recommendation:** a follow-up issue, or fold the fix into the main-merge round this PR needs anyway. If the fix is folded in, the delta needs a fresh Opus look.

#### D2: NON-BLOCKING (latent; shadow evidence quality). The handler-level decision is invisible to the shadow

This carries forward the earlier S6.

- **The legacy side:** the marker is the reach marker, not the capability decision.
  - A 403 is downgraded to `unknown`. The evidence is lost, but it is not false.
  - A body-validation 400 records `allowed` for a caller whose capability was never checked.
- **The policy side:** `buildShadowPolicySide` supplies no `body`, so `orSelfTarget` can never hold.
- **Failure scenario:** once reach facts load for ordinary members (`sees_all`, or a later slice), every legitimate member self-assign will file as `legacy_allow_policy_deny`, and a viewer's malformed body as a false allow. Today it is unreachable: all five probe requests filed `reach_unavailable`.
- **Fix, in shared code:**
  - wrap `assertCallerHasCapabilityOrSelf` in the handler with `markShadowLegacyAuthorizationUnknown` / `setShadowLegacyAuthorization`, the pattern `task/index.ts` bulk-update uses;
  - have the shadow file `orSelfTarget` policies with no body as `unevaluated: self_target_unavailable`.
- **Recommendation:** a follow-up issue against #8's next slice. It does not block this PR.

### Gates (not security findings; each blocks the merge)

- **The PR conflicts with current `main`.** `origin/main` moved to `9060512` (#340) after this review's base. `gh` reports `CONFLICTING` on `tests/api-contract/openapi.json`.
  - #340 adds an independent `GET /api/workspace/{workspaceId}/work-item-types` route in the same `work-item/index.ts` and `policy.ts`. Those two files auto-merge; only the regenerated OpenAPI contract conflicts.
  - Merging `main` changes the head, and this approval does not carry over to it automatically. Merging main before an Opus review is the project's rule. So the post-merge head needs a narrow Opus attestation: the merge diff limited to #340's content, plus `check:openapi` and the matrix.
- **`pull request template + security review` is red.** At this head:
  - the independent-review box is unticked (this note is the Opus part of it);
  - the `audit_log` box is unticked, honestly, pending #360 / PR #364 and #344.

  The second item stays a blocker until those land or Thomas decides. It is not mine to clear.
- **Waivers:** none declared.

### Verdict

**APPROVED (security)** at `07cbc3b1a662331d831cc292b4ff785bc497d435`.

- S1, S2 and S5 are closed, and pinned by mutation.
- The checks on tenant scope, foreign keys, existence oracles, query grouping, the assign-vs-assign CAS, the self-assign policy and after-commit event placement all hold.
- The disclosed deactivated-holder 200 is safe.
- D1 and D2 are non-blocking follow-ups.

The merge still needs the main-merge attestation and the audit-row gate above.
