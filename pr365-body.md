## Task

Clear a work item's assignment: `DELETE /api/work-items/{key}/assign` — `AS-2`'s self-unassign branch, `AS-9`'s never-silently-unassigned guard, and `AS-17`'s `work_item.unassigned` event.

**Spec:** `docs/03-features/assignment.md` (§ Permissions, § API; the edge-case table gained the one row the build decided: unassigning an already-clear item is a no-op)
**Rules in scope:** `AS-2`, `AS-9`, `AS-17` (event; `AS-18`'s fan-out exclusion is out of scope), `WI-6` (activity row), `AS-6` (identity by id)

**Base branch:** this PR is **stacked on #353** (`feat/30-assign-action`) and retargets to `main` when #353 merges. It deliberately reuses #353's `assertCallerHasCapabilityOrSelf`, its `WorkItemAssigneeConflictError` and its 409 schema instead of duplicating them — and #353's merge is blocked on #344, the same dependency this route's audit row has.

**2026-09-27:** merged #353's current head (`12d699d3`) into this branch — #353 had picked up several rounds of `main` since this PR's `543285c` and this branch's checked-in `tests/api-contract/openapi.json` had fallen behind it, which made `contract - OpenAPI drift` and `gate checkers + red probes` fail as inherited staleness, not a new defect. One real, small, this-PR-caused gap surfaced once caught up: `scripts/ci/probes/check-events.test.mjs` still asserted the pre-#365 golden count of 27 published event keys; this PR's own `work_item.unassigned` key is the 28th, so the golden count is now 28. Both fixed at `a2ccc1d`; no route/policy/handler logic changed.

## Implemented by

**Model:** GitHub Copilot (DeepSeek V4.1 Flash)
**Session:** bf2556c8-7381-421a-ae64-cc1340ef38cb

## Reviewed by

**Model:** GitHub Copilot — DeepSeek V4.1 Flash, a fresh, independent reviewer context (per decision-log #345; the reviewer disclosed its actual model rather than echoing a slot label). Verdict **CHANGES NEEDED** at `5ab81a334fd72d3cd791da9ca4076fc8cf14020b`: F1 (blocking) — the authority check and the controller's write were made against *different reads*, so a reassignment between them let a `work_item:update` caller clear the new holder's assignment; demonstrated with a probe. F2 (non-blocking) — `assignment.md`'s DELETE line still named the body-shaped `orSelfTarget`. Both fixed at `543285c3970d` (pin + regression test, mutation-proven; spec line aligned).
**Delta re-review (Claude Sonnet 5, fresh independent context) at `a2ccc1d932b51c36334eb1cfbe2eab4693c19575`: APPROVE.** Confirmed the `a2ccc1d` delta is exactly the claimed merge-with-base + golden-count bump — no route/policy/handler logic changed, the merge conflict resolution in `work-item/index.ts` is a clean union, and the `check-events` count bump correctly reflects the newly-registered `work_item.unassigned` key. Full detail in the review note.
**Session:** two fresh review subagents, both separate from the implementing session

## Security review

**Model:** Opus 5.5, fresh independent context.
**Session:** Completed at `a2ccc1d932b51c36334eb1cfbe2eab4693c19575`. **Verdict: CLEAR.** No HIGH or MEDIUM findings; two LOW test-strength findings (L1, L2) and one informational note (N1), all non-blocking — full detail in the review note.
**Surfaces examined:** the new route's policy entry (`work-item/policy.ts` — first `orOwner` with `row.assignee_id`), the permission vocabulary change (`packages/permissions` `OWNER_PREDICATES` + evaluator dispatch + `rbac.md`), the handler's row-based branch decision (`work-item/index.ts`) and the conditional-write controller.
**Note:** [`docs/07-planning/security-reviews/365-unassign-action.md`](../blob/feat/30-unassign-action/docs/07-planning/security-reviews/365-unassign-action.md)

## Screens opened

n/a — no `apps/web/**` file changed; no route is rendered by this PR.

## Gates

| Gate | Result (pass / n/a / waived) | Decision-log link |
| --- | --- | --- |
| G1 — No bespoke primitives | n/a | |
| G2 — Tokens only | n/a | |
| G3 — Contrast | n/a | |
| G4 — Accessibility | n/a | |
| G5 — Every screen has a URL | n/a | |
| G6 — Every screen has four states | n/a | |
| G7 — Storybook coverage | n/a | |
| G8 — Visual regression | n/a | |
| G9 — Reduced motion | n/a | |
| G10 — Keyboard reachability | n/a | |
| G11 — Performance budgets | n/a | |
| G12 — Portal bundle purity | n/a | |
| G13 — No layout shift on data arrival | n/a | |
| Route coverage (`test:permissions`) | pass | |
| Permission matrix | pass | |

G1–G13: n/a because no `apps/web/**` file changed by this pull request. Route coverage:
82/82 with the new route declared. Permission matrix: fixture gained the route's 8 role
rows, deliberately (owner/admin/manager/lead allow; `work_item:update`-only roles refused
without a row fact, exactly like its POST sibling).

## Checklists

### Any change

- [x] Branch named `feat/…`, `fix/…`, `docs/…`, `chore/…`
- [x] Conventional commit messages
- [x] `pnpm lint` green
- [x] `pnpm typecheck` green — 9/9 turbo tasks
- [x] `pnpm test` green — API unit suite included; web untouched
- [x] No disabled or skipped tests
- [x] No new dependency without a decision-log entry — none added
- [x] No code from an unlicensed source
- [x] Pull request describes what changed and why, and what was deliberately left out

### Backend change

- [x] Every new or changed route has a policy entry — `DELETE /api/work-items/{key}/assign`, declared with the `orOwner` branch the handler actually evaluates; pinned by its own declaration test (the matrix cannot see a row-fact branch)
- [x] `pnpm test:permissions` green — 82/82
- [x] Permission matrix fixture updated if access changed — +8 role rows for the new route; access model itself unchanged
- [x] Zod request and response schemas — no request body; the 200 response is `WorkItemUnassignment` (`assigneeId: null` by type) and the 409 reuses `WorkItemAssigneeConflict`
- [x] Integration tests against a real Postgres — `work-item-unassign.test.ts` 7/7; full API integration suite 1180/1180 (87 files)
- [x] Negative tests for every "must not" — a `work_item:update`-only member clearing a colleague (403, nothing changes); a holder without the branch capability (403); foreign workspace (404/403) and anonymous (401)
- [ ] Mutations write an `activity` row and an `audit_log` row — activity row: yes, via the shared `WI-6` (verb, field) allowlist. **`audit_log` row: blocked and stated, not waived** — the writer now accepts `work_item.unassigned` (#364) but the AU-10 sequencing still requires #344's `audit_log.project_id` before the first project-scoped audit writer merges. Same dependency #353 records.
- [x] Mutations emit their domain event — `work_item.unassigned` with `previousAssigneeId`, after commit (`AS-17`). The notification fan-out that excludes the actor is `AS-18`, a later subscriber slice.
- [x] Migration is forward-only and reviewed — n/a: no migration
- [x] Destructive migration is two-phase — n/a: no migration
- [x] Domain logic lives in `packages/domain` and is pure — n/a: the change is a route, a predicate and its registration; the one rule this route shares (`evaluateAssigneeEligibility`-class logic) lives in `packages/domain` and is untouched
- [x] No secret is logged or serialised — unchanged
- [x] Opus security review completed and recorded in the pull request's `## Security review` section — CLEAR at `a2ccc1d932b51c36334eb1cfbe2eab4693c19575`, note committed

### Frontend change

n/a — no `apps/web/**` file changed.

### New `packages/ui` primitive

n/a — no primitive.

### New feature

n/a — a route of the existing assignment feature (`assignment.md`), whose screen work lands with the assignee control slice.

### New plugin

n/a — no plugin.

### Bug fix

n/a — not a bug fix.

### Phase completion

n/a — no stage is claimed by this pull request.

## Design review H1–H6

<!-- Thomas only. Agents leave this section blank. -->

## Not done

- **The audit row.** Same tracked dependency as #353: #344 (`audit_log.project_id`, AU-10's sequencing) must land first; #364 already makes the event key writable.
- **The `AS-18` notification fan-out.** The event is emitted; excluding the actor from their own notification belongs to the subscriber slice, not this route.
- **Bulk unassign** (`POST /api/work-items/bulk/assign` covers it per the spec's API table) — later slice.
- **The UI's unassign control** — waits on the assignee-field slice, which waits on #340.
- **#353 must merge first** (or make this PR retarget after it) — the base branch is `feat/30-assign-action`; the stacked diff is intentional and will be zero-churn once #353 lands.
- **L1/L2 (Opus review, non-blocking test-strength gaps):** no test pins the UPDATE's `assignee_id = previous` WHERE condition against a stale-read race (L1); the foreign-workspace test asserts `[403, 404]` instead of tightening to the actual `404` the anti-enumeration rule requires (L2). Left as follow-up, not fixed in this PR, per the review note.


