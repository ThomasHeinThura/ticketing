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
