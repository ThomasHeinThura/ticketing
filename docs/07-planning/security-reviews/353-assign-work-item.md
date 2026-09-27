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

---

## Delta review 2 (Opus 5.5): main-merge attestation

**Reviewer:** Claude Opus 5.5 (`claude-opus-5-5[1m]`), a fresh independent context commissioned by the orchestrating session. It did not author, direct or remediate this change.
**Reviewed head:** `e924f6e71ff0bca2352a66d59b3b78c9146e7606`
**Range reviewed:** `07cbc3b1a662331d831cc292b4ff785bc497d435..e924f6e71ff0bca2352a66d59b3b78c9146e7606` (29 commits)
**Base at review:** `origin/main` `0b1bcc1d82f340a8d624fb053835ce3152d8b51d` (#361)
**Date:** 2026-09-27
**Verdict:** **CLEAR (lightweight confirmation)** at `e924f6e71ff0bca2352a66d59b3b78c9146e7606`. No blocking security finding.

### What the range contains

- First-parent commits:
  - `344b187`: the previous note, docs only.
  - `789845e8ce21aa79c27f3a322a8d19a1f08aba5b`: a main-merge with conflict resolution.
  - `12d699d3ed9694606550f1d5880017fe3a0a08da` and `e924f6e71ff0bca2352a66d59b3b78c9146e7606`: main-merges. `git show --remerge-diff` shows no resolution content for either.
- Everything else is main history that has already been reviewed and merged.
- **The PR's own code is unchanged.** The PR's net diff against its merge-base (`8f545c3` → `07cbc3b`, compared with `0b1bcc1` → `e924f6e`) has identical added and removed lines in every PR file, with two exceptions:
  - `work-item/index.ts`: the `eq`, `db` and `personTable` imports now come from main (#362), and the route description drops "the assignable roster feed" from its list of later slices;
  - `policy.ts`: one blank line.
- These files are byte-identical across the range: `assign-work-item.ts`, `require-workspace-capability.ts`, `work-item-assign.test.ts`, `work-item-assign-policy.test.ts`, `packages/domain/src/index.ts`, `matrix.fixture.json` and `check-events.test.mjs`.
- **`789845e` resolves the conflict as a union.** In `index.ts`, `policy.ts`, `response.ts`, `schema.ts` and `openapi.json`, main's `GET /api/projects/{projectId}/assignable` sits beside the unchanged assign route. The handler and the middleware chain (`[requireWorkItemReach()]`) are intact, and the resolution adds no logic.
- **Main changed none of the authority chain this route depends on:** `require-workspace-capability.ts`, `workspace-member-roles.ts`, `require-work-item-reach.ts`, `workspace-access-middleware.ts`, `packages/permissions`, `database/schema.ts`, `activity.ts` and `domain/assignment`.
  - `apps/api/src/index.ts` only adds the audit router, mounted at `/` for `/instance/audit` and `/workspaces/{id}/audit`. It does not collide with this route.
  - `event-keys.ts` adds the #364 allowlist.

### Suites at this head

Run in a private worktree against a private database (`o353e_test`); both were removed afterwards.

| Suite | Result |
| --- | --- |
| API integration (full) | 91 files, 1242/1242 |
| `work-item-assign.test.ts` | 16/16 |
| `existence-oracle-317.test.ts` + `permissions-shadow-mode.test.ts` | 22/22 |
| API unit | 59 files, 490/490 |
| `pnpm test:permissions` | 12 files, 82/82 |
| `pnpm test:ci-scripts` | 602/602 |
| `pnpm typecheck` | 9/9 tasks |
| `pnpm check:openapi` | matches (111 operations) |
| `pnpm check:events` | 27 keys, all registered |
| `pnpm check:route-policy`, `pnpm check:deps` | pass |

### Mutations, re-run at this head

Each was restored afterwards, and `git status` was clean.

| Mutation | PR suite |
| --- | --- |
| Drop `eq(membershipTable.scopeId, item.projectId)` | **red** (2) |
| Replace the unconditional-assign CAS `isNull(assigneeId)` with `true` | **red** |
| Make the handler's self predicate always `true` | **red** |

### Earlier findings

- **S1, S2, S5:** still closed, and pinned by the mutations above.
- **S3:** still tracked by #359. It remains unreachable, because nothing in `apps/api/src` writes `membership`.
- **D1:** unchanged, and still non-blocking. The CAS write still matches only `id` plus the assignee. It still needs a follow-up issue.
- **D2:** unchanged and latent. It belongs with #324's self/portal shadow coverage.

### New finding

#### D3: NON-BLOCKING (latent; extends S3 / #359). The picker and the write disagree after #373

- **What changed:** #373 made `list-assignable-people.ts` also require `person.side = 'staff'` and `is_placeholder = false`.
- **What did not:** `assign-work-item.ts` still checks only the project-roster `membership` row and `person.active`.
- **The consequence:** the feed's own comment ("the SAME shape … so the picker and the write cannot disagree") no longer holds. Given a directly written roster row, the write would accept a customer-side or placeholder person that the picker hides.
- **Reachability:** none today, for S3's reason.
- **Fix:** give both the write and the feed the same predicate, ideally the single helper #359 already calls for.

### Gates (not security findings)

- `pull request template + security review` stays red until two things happen:
  - this note is recorded;
  - the `audit_log` box is resolved. That waits on #344 / PR #375, per the decision log of 2026-09-25 (#366). It is not mine to clear.
- Every other required check is green at this head.
- **Waivers:** none declared.

### Verdict

**CLEAR (lightweight confirmation)** at `e924f6e71ff0bca2352a66d59b3b78c9146e7606`.

- The PR's code is unchanged since the approved head `07cbc3b1a662331d831cc292b4ff785bc497d435`.
- The only conflict resolution (`789845e`) is a correct union.
- No main-side change touches the route's authority chain.
- The suites and the mutation checks hold at this head.
- D1, D2 and D3 are non-blocking follow-ups.

---

## Delta review 3 (Opus 5.5): the audit_log write

**Reviewer:** Claude Opus 5.5 (`claude-opus-5-5[1m]`), a fresh independent context commissioned by the orchestrating session. It did not author, direct or remediate this change.
**Reviewed head:** `cbd18fc3ed1ea26f09254dc54b86565f2d7a0e1d`
**Range reviewed:** `e924f6e71ff0bca2352a66d59b3b78c9146e7606..cbd18fc3ed1ea26f09254dc54b86565f2d7a0e1d` (`a890593` docs; `de46e94` main-merge bringing in #375, whose only PR-file change is `cbd18fc`'s test hunk; `cbd18fc` feature)
**Date:** 2026-09-27
**Verdict:** **CHANGES NEEDED**, for A1. A1 is a one-line code fix plus a regression test.

### Suites at this head

Run in a private worktree against a private database (`pr353audit_test`); both were removed afterwards.

| Suite | Result |
| --- | --- |
| API integration (full) | 92 files, 1252/1252 |
| `work-item-assign.test.ts` + `audit-log*.test.ts` + `audit-read*.test.ts` | 5 files, 93/93 |
| `pnpm typecheck` | 9/9 tasks |

### Probes

- **12 concurrent assigns on 12 items:** 12 audit rows and 12 distinct `prev_hash` values. `verifyAuditChain` returns ok.
- **Six-way race for one item:** exactly one 200 and exactly one audit row. Its `after` equals the stored holder, and its `before` is `null`. The chain verifies.
- **An uncommitted rival change while the UPDATE runs:** 409, and no audit row. This is safe.
- **A rival change that commits between the pre-read and the UPDATE:** 200, but the recorded `before` is stale (A1).

### Mutations (each restored afterwards; `git status` clean)

| Mutation | PR suite |
| --- | --- |
| `projectId: null` | **red** (AS-1) |
| `after` taken from `expectedCurrentAssigneeId` | **red** (AS-1, AS-3) |
| Drop the `appendAuditLog` call | **red** (3) |
| `actorId: input.assigneeId` (a request-supplied value) | **green**: A2 |
| `actorType: "system"` | **green**: A2 |
| `previousAssigneeId = input.expectedCurrentAssigneeId ?? null` (A1's fix) | green 27/27; the A1 probe goes green |

### The five questions

1. **Forgery:** none. `actorId` and `actorType` come from the session or API key, `workspaceId` from the reach check, and `projectId` and `entityId` from the loaded row. `after` is the roster-validated assignee that the UPDATE wrote. Extra body fields are stripped.
2. **Hash chain:** compatible. The writer supplies the closed field list. `projectId` is stored but not hashed, per #375's precedent. The chain verifies after concurrent writes.
3. **Concurrency:** `after` is correct, but `before` is not (A1).
4. **The no-op case:** it writes no audit row, which the test asserts and the drop-the-call mutation turns red. This is consistent with AU-10: no event and no state change means no audit action. A 409 also writes nothing, because the transaction rolls back.
5. **The advisory lock:** passing `tx` opens a savepoint, and the transaction-level lock is held until the outer commit. There is no double lock. There is no deadlock, because every path takes row locks first and the audit lock last, and audit-read holds no row locks. Future writers must keep that order.

### Findings

#### A1 — BLOCKING (medium; audit-record integrity). `before` is the stale pre-read, not the value the UPDATE matched

- **Where:** `assign-work-item.ts:152`. `previousAssigneeId = item.assigneeId` is read outside the transaction and feeds the audit row's `before`, the activity row's `oldValue`, the event and the response.
- **Reproduction:**
  1. The item is held by `first`.
  2. A transaction holding `LOCK TABLE membership` parks the controller after its pre-read.
  3. A rival change moves the holder to `second` and commits.
  4. The controller is called with assignee `third` and expected `second`.
  5. Result: 200. The real move is `second` → `third`, but every record says `first` → `third`.
- **Impact:** permanent wrong content in an append-only table. The chain stays valid, and the value is not caller-chosen, but the row misstates who was displaced.
- **Fix:** `previousAssigneeId = input.expectedCurrentAssigneeId ?? null`. The UPDATE's own predicate proves this value whenever the UPDATE matches. Optionally, short-circuit `expected === assigneeId`.
- **Regression test:** add the probe above as an integration test.
- **Also:** #365 (unassign) must not copy the pre-read pattern.

#### A2 — NON-BLOCKING (a test gap). `actorId` and `actorType` are unpinned

Add assertions on both, for a session caller and an API-key caller.

#### A3 — NON-BLOCKING (AU-1; shared with `writeAuditRead`). Several AU-1 fields are not recorded

The call passes no `apiKeyId` (though `c.get("apiKey").id` is available), and no `actorIp`, `userAgent` or `traceId`. Add a request-context helper, tracked in an issue.

#### A4 — NON-BLOCKING (for the orchestrator or Thomas). An audit failure rolls back the assignment, contrary to AU-14

This is fail-closed, which is the safer choice for security, but AU-14 says the mutation still succeeds. Record the choice, or catch the error and log it at error level, as `writeAuditRead` does.

#### A5 — NIT

The AS-3 audit assertion uses `.slice(-1)` without `orderBy(seq)`.

### Earlier findings

S1, S2 and S5 are still closed. S3 is still tracked by #359. D1, D2 and D3 are unchanged and non-blocking.

### Gates (not security findings)

- `pull request template + security review` is failing at this head.
- `integration - Postgres 18` was still pending when checked.
- **Waivers:** none checked here.

---

## Delta review 4 (Opus 5.5): A1 fix confirmation

**Reviewer:** Claude Opus 5.5 (`claude-opus-5-5[1m]`), a fresh independent context commissioned by the orchestrating session. It did not author, direct or remediate this change.
**Reviewed head:** `c69976333c470ee0085de359ea34411d9115bc59`
**Range reviewed:** `cbd18fc3ed1ea26f09254dc54b86565f2d7a0e1d..c69976333c470ee0085de359ea34411d9115bc59` (`cc64890` docs; `c699763` the fix, touching only `assign-work-item.ts` and `work-item-assign.test.ts`)
**Date:** 2026-09-27
**Verdict:** **CLEAR (security)** at `c69976333c470ee0085de359ea34411d9115bc59`. A1 is closed. One merge gate is not met: see G1 below.

### The fix

- `previousAssigneeId = input.expectedCurrentAssigneeId ?? null` (line 159). The pre-transaction `item.assigneeId` no longer feeds the audit `before`, the activity `oldValue`, the event or the response. `item.assigneeId` is now read only by the no-op planner and by the no-op early return.
- This is the same value the UPDATE's WHERE clause matches (`expected === null ? IS NULL : = expected`). So whenever the UPDATE matches, it is the true prior holder.
- **First assign:** `expectedCurrentAssigneeId` is `.nullable().optional()` with `.min(1)`, so it can only be absent, `null` or a non-empty string. Absent or `null` becomes `null`. That satisfies the response schema (`z.string().nullable()`) and is valid `JsonValue` for `canonicalRowHash`. A probe confirmed that the response carries `"previousAssigneeId": null` (the key is present) and that the audit row stores `before = {"assigneeId": null}`, with a verifying chain.

### Independent reproduction (my own probe, through the HTTP route rather than the controller)

- **Method:** a transaction holds `LOCK TABLE membership`. `POST /assign` is issued. I poll `pg_stat_activity` until the request is waiting on that lock, so it is parked after its pre-read (no sleep). The rival change then commits on autocommit, the lock is released, and every record is checked.

| Probe | Fixed head | With the fix reverted |
| --- | --- | --- |
| P0: first assign, no race | `before` null, response null, chain ok | same |
| P1: rival first→second commits; caller second→third | 200; response, audit `before`, activity `oldValue` and event all say `second`; chain ok | **red** (records `first`) |
| P2: rival *unassigns*; caller assigns third unconditionally | 200; everything records `null` | **red** (records `first`) |
| P3: caller's stale `expected = first` after the rival moved it to second | 409 with `currentAssigneeId = second`; no audit row, no event | same |
| P4: rival first→second; caller asks second→second | 200, truthful but redundant: see A6 | **red** (records `first`) |

### The implementer's red/green claim

This is verified. With line 159 reverted to `item.assigneeId`, the new A1 test fails at `expect(result.previousAssigneeId).toBe(second.id)`, receiving `first`'s id. That is exactly the A1 symptom. With the line restored, it passes 17/17.

### Mutations (each restored afterwards; `git status` clean)

| Mutation | PR suite |
| --- | --- |
| Revert line 159 to `item.assigneeId` | **red** (the A1 test) |
| Audit `before` alone from `item.assigneeId` | **red** (the A1 test) |
| `projectId: null` | **red** |
| Drop the `appendAuditLog` call | **red** (4) |
| The targeted-reassign CAS `eq(assigneeId, expected)` → `true` | **red** |

### Everything else from delta review 3

The only non-docs change in the range is the one line and the new test. The earlier answers still hold:

- forgery resistance: the actor comes from the session or API key, and the scope from the loaded row;
- hash-chain compatibility;
- the no-op case writes no audit row;
- the advisory-lock order: row locks first, the audit lock last, inside the same transaction.

### Suites at this head

Run in a private worktree against a private database (`pr353a1c_test`); both were removed afterwards.

| Suite | Result |
| --- | --- |
| `pnpm --filter @taskdesk/api typecheck` | pass (after `pnpm typecheck`, 9/9 tasks, builds the workspace packages) |
| `pnpm lint` | 8/8 tasks, no fixes applied |
| `work-item-assign.test.ts` alone | 17/17 |
| API integration (full) | 92 files, **1252/1253**: AS-3 fails, see G1 (reproduced on 2 of 2 full runs) |

### Findings

#### A1: CLOSED

#### G1: BLOCKS THE MERGE (a test defect, not a security finding; A5 is now observable). AS-3's audit assertion depends on row order

- **Where:** `work-item-assign.test.ts`, the AS-3 targeted-reassign test. It reads the item's `audit_log` rows with no `orderBy` and takes `.slice(-1)`.
- **The cause:** on PostgreSQL 18, the planner can answer `WHERE entity_id = …` with a skip scan of `audit_log_entity_type_entity_id_created_at_idx` (`created_at DESC`). `EXPLAIN` confirms that scan on this host. The last element is then the *oldest* row, the first assign with `before = null`.
- **The result:** the assertion fails in the full suite locally, although the stored rows are correct. The same file passes alone, and CI's `integration - Postgres 18` passed at this head, so this depends on the query plan.
- **The fix:** `.orderBy(schema.auditLogTable.seq)`, as the new A1 test already does. It is test-only.

#### A6: NON-BLOCKING. Two residual stale-pre-read edges, neither leaving a false record

- **A redundant write (P4):** if the holder moved to X after the pre-read and the caller sends `assigneeId = X` with `expected = X`, the no-op planner, working from the stale read, does not short-circuit. The UPDATE matches, the version bumps, and one audit row, one activity row and one event record X→X. They are truthful but redundant. Delta review 3's optional short-circuit (`expected === assigneeId`) would remove this.
- **A misleading response:** the no-op early return still answers from the stale pre-read. It writes nothing, so no record is wrong, but its 200 response can name a holder who was already displaced.
- **Carry this into #365 (unassign):** decide from the value the conditional write matched, never from the pre-read.

### Earlier findings

- **A2, A3 and A4:** unchanged; still non-blocking.
- **A5:** superseded by G1.
- **S1, S2 and S5:** still closed.
- **S3:** still tracked by #359.
- **D1, D2 and D3:** unchanged; still non-blocking.

### Gates (not security findings)

- **G1:** above. The fix changes the head, so the new head needs an exact-head re-attestation that its diff is only the `orderBy` line.
- **Behind `main`:** the branch is `BEHIND` `origin/main` (`52c5aef`, six commits: #381, #382, #385, #386, #387, #388). None of them touches a PR file, and GitHub reports it `MERGEABLE`. The main-merge also changes the head, and needs the same re-attestation.
- **Required checks:** `pull request template + security review` is failing at this head. Every other required check is green, including `integration - Postgres 18`.
- **Waivers:** none checked here.
