# Status — a POINT-IN-TIME SNAPSHOT

> ## ⚠ How to read this file
>
> **Snapshot taken:** 2026-09-22 — a thirteenth pass, same day as the eleventh and twelfth.
**All four concrete P0 defects the eleventh pass found (#18, #146, #17, #97) are now fixed,
reviewed, and merged.** #8 and #9 remain open, large, umbrella items, unchanged.
> **`main` at that moment:** `9c2a16c` (PR #227 — issue #18's setup-token flow, the last of
> the four same-day P0 fixes to land, after three Opus security-review rounds).
> Kaneo's `task`/`column` tables and routes remain fully untouched and still live.
> **Stage:** P0 · Foundation — **Throttle 1 is OPEN; P0 itself is NOT finished (see #8/#9
> below), but the eleventh-pass concrete-defect backlog is fully clear.** Throttle 1 remains
> the narrower gate — the organization-plugin retrofit's five specific conditions (below) —
> and those five remain verified closed. The eleventh pass's live audit found four concrete,
> reproducible P0 defects, all now merged:
> **#18** (first-admin registration bypass — PR #227: a durable
> `instance_setting.setup_completed_at` marker plus a one-hour-or-one-use setup token
> replaces the old unconditional zero-user bypass. This one took the full three-round tier
> (ordinary Sonnet + alignment check + mandatory Opus), and the Opus pass alone took three
> rounds: round 1 found a BLOCKING issue (B1 — the new refusal message let an unauthenticated
> caller distinguish an unclaimed instance from a claimed one, recreating the exact scanning
> oracle the fix exists to remove); round 2's delta-confirmation found the fix for B1 was
> itself incomplete in two ways (D1 — adding an `invitationId` field reopened the identical
> oracle; D2 — a separate Unicode-normalization fix for the bootstrap-email comparison didn't
> actually work); round 3 confirmed both D1 and D2 genuinely fixed, adversarially, against a
> real database. Final verdict: CLEAR WITH FINDINGS, all non-blocking. Four follow-up issues
> filed: #229 (no MFA enrollment — spec gap, no MFA plugin exists in this repo), #230 (no
> `grant-instance-admin` recovery CLI — same status), #231 (a liveness gap, not an authority
> one: two armed bootstrap mechanisms racing can leave zero admins, never two), #232 (a
> narrower residual oracle via `DISABLE_PASSWORD_REGISTRATION`, plus a test-coverage note)),
> **#146** (CRITICAL — closed by PR #223: `sections()` now recognizes a `##` heading only
> when genuinely visible, and a genuine duplicate is a hard `DuplicateSectionError` rather
> than silent last-one-wins; Opus review CLEAR WITH FINDINGS, three non-blocking follow-ups
> (F1, F2, F4) tracked as #226), **#17** (closed by PR #225: sessions minted by the removed
> MCP OAuth/device flows are expired by migration `0060`; the mandatory Opus review's first
> pass found and required a fix for a real timezone-comparison bug, fixed and
> delta-confirmed CLEAR), **#97** (closed by PR #224: the logged-out redirect guard no
> longer throws on `location.search`'s null-prototype object; a root `errorComponent` added
> as a last-resort catch-all). Two large, mostly-open umbrella items remain, unchanged from
> the eleventh pass: **#8** (route-policy retrofit — ~80 inherited routes still
> unclassified, and the policy registry has zero runtime wiring into
> `apps/api/src/index.ts` yet, so no request is actually evaluated against it today) and
> **#9** (`packages/ui` extraction — only 18 of ~63 primitives moved out of `apps/web`).
> **Autonomous continuation past Throttle 1 into P1–P7 is authorized** (Thomas, 2026-09-16,
> reaffirmed 2026-09-22) — running P1–P7 in parallel does not wait on P0's remaining issues,
> but #8/#9 are not done and this file should not imply otherwise.
> **Throttle 1: OPEN.** All five conditions verified live, not rounded up: #5 closed, #6
> closed 2026-09-16 (every substantive item in its real checklist checked against live
> source, not against this file or the issue's own stale checkboxes), #7 closed,
> route-policy coverage runs as a required status check, and the unclassified-route-fails-CI
> probe still passes. S10 (the retrofit's final stage) landed as PR #161. PR #107 (the
> caller-count-scanner CI safety net) is a **separate, still-open, still-held PR** — Thomas's
> decision to hold it stands. See Scheduler and Throttle 1, below, and the retrofit ledger
> for S10's own record.
> The `## Scheduler` section is the current live-state-to-action mapping; read it alongside
> this header, not instead of it.
>
> **LIVE pull-request and issue state is NOT durably recorded in this file and must be
> re-verified from GitHub:** `gh pr list --state open`, `gh pr view <n>`,
> `gh issue list --state open`.
>
> This file records the state of the repository **at the SHA above**. It is not synchronised
> when a subagent opens a branch, and it should not be. Enumerating open pull requests as a
> **durably-maintained list** was tried on 2026-09-09 and abandoned: the list went stale
> within the hour and cost three independent review rounds. **If this file and GitHub
> disagree about what is open, GitHub is right and this file is simply older.**
>
> **The `## Scheduler` section is the one deliberate exception, and the distinction matters:**
> it names specific PR/issue numbers, same as the abandoned 2026-09-09 attempt did — but as a
> **same-session dispatch table dated to this snapshot**, not a claim of durable accuracy. It
> carries its own re-verify instruction and is expected to go stale and be regenerated next
> session, the same way the rest of this file is. Trust it exactly as far as the snapshot date
> above, no further.
>
> What this file IS good for: the stage and throttle state, which issues are blocked and
> why, material decisions taken, and the durable repository and deployment facts — the things
> that do not change when someone pushes a branch.


**Session log, 2026-09-23:** Continued #324 Slice 2b after two independent ordinary reviewers found stale authorization evidence. Each new shared authorization decision resets evidence to unknown; bulk-task, ownership-transfer and workspace-leave controllers record their post-middleware outcomes, including leave returning 404 after the transactional membership recheck. Regression coverage exercises the lookup-error case, instance-admin bulk denial and forced controller-level leave denial after middleware allowed. Both fresh independent ordinary delta reviews pass at c4fe592ffc5a99a3516860b64db1937814a93f39 with no blocking findings. Full unit tests passed across 12 tasks (API 484 tests; web 277 tests), permissions passed 10 files / 80 tests, API typecheck passed, focused shadow integration passed 13/13, lint passed 8/8, review/vocabulary checks passed, and git diff --check is clean. A rebuilt Docker image migrated isolated PostgreSQL 18 and booted the serving role; /api/public/health/live returned 200. GitHub fast CI and full PostgreSQL 18 integration passed on PR head fd4adf3af95c83ca410e9f8ca48bdcb7c713cdcb. The PR-template/security gate is the only failing required check; it correctly rejects the missing Opus model, committed review note and completed security-review checklist while Claude authentication is logged out. Mandatory Opus final security review remains pending. #324 remains draft and cannot close: project/work-item reach facts, portal mapping and deployed-traffic coverage evidence are still missing.

**Session log, 2026-09-23:** Continued #324 Slice 2b in a stacked worktree based on #323. The implementation now records workspace-ID provenance, exposes project/task/work-item row facts already selected by `workspaceAccess.from*` and `requireWorkItemReach`, and records explicit legacy authorization decisions at shared workspace authorization middleware instead of deriving them from HTTP status. The shadow evaluator now records delegated routes as `unevaluated: delegated_to_handler`, uses the explicit no-person-parameter sentinel for self policies, supports id-free instance scopes, and verifies row provenance for workspace route IDs with a bounded after-response lookup when necessary. Local password signup creates an internal staff person before signup completes; OAuth callbacks remain unprovisioned until their configured identity connection owns portal/org assignment. Validation on this working tree: focused unit/middleware tests 84/84; shadow-mode Testcontainers integration 11/11; identity-seed Testcontainers integration 16/16; API typecheck; `docker build`; isolated PostgreSQL 18 migration, serving-container boot and `/api/public/health/live` smoke all passed. The existing project schema has workspace linkage but no project-parent or owner-team fields, and the identity loader does not load project memberships; project/work-item negative reach therefore remains explicitly unevaluated rather than guessed. Per-router before/after soak evidence still needs representative deployed traffic. Draft stacked PR #354 is open at `5e3aa590516285c899a7443f46e5d104d3dd842d`; exact-head ordinary reviews are pending. Live `claude auth status` is logged out, so no Opus verdict is available in this environment.

**Seventh pass, 2026-09-23. `main` at `5ada9c5` (PR #345 merged).** P0 Foundation remains open. #317's timing-oracle candidate now incorporates the DB-role split on main; its focused PostgreSQL 18 oracle integration test passed 4/4, and the full API integration suite passed 84 files / 1,144 tests. Its local branch now includes the latest `main`; the ordinary exact-head review must be refreshed before merge. #323 keeps #322's applied migration `0068_workspace_role_is_system` at index 68 and moves #8 Slice 2's shadow-table migration to `0069_policy_shadow_tables` at index 69, with the snapshot chained from #322's snapshot. After the latest main merge, its focused PostgreSQL 18 shadow integration test passed 10/10; lint, typecheck, permissions (80), route-policy, OpenAPI (106 operations), review-spec, vocabulary (59), and env checks passed. An initial full unit run had one unrelated SSRF destination test time out (475/476), but the complete `pnpm test` retry passed across all 12 tasks; the isolated file also passed 4/4. Both candidates still require fresh ordinary review on their final SHA and Opus security review before merge. No P0 gate is claimed closed; #8 still lacks complete route enforcement and coverage, and #324 plus other prerequisite lanes remain open. Re-verify live PR/issue state before dispatch.

**Session log, 2026-09-23:** Integrated #323 with `main` through `5ada9c5`, including the Cline D1-D4 remediation round, and validated the migration alignment plus focused shadow integration. The full unit suite first exposed one unrelated timeout, then passed in a complete retry. The #317 candidate has passed its broad integration and focused timing checks and now includes current main. Fresh exact-head ordinary review and mandatory Opus final reviews have not happened; neither candidate may merge before them.

**Session log, 2026-09-23:** Audited the supplied P0 status report against live GitHub and repository state. Confirmed #322 had merged and the #323 migration-number collision was real; the report's #308 migration warning was false. Rebased #323 by merging current `main`, renumbered only the unmerged shadow migration, and validated migration order on Testcontainers PG18. Current candidate SHA above; review status remains pending.

**Fifth pass, 2026-09-23. `main` at `b126c51`.** Merged since the fourth pass:
- **#306**, the first v2 screen: the work-item list at `/agent/projects/{key}/work`. Sort and
  direction are held in the URL, and it has all five G6 states, including Partial (rows with
  invalid fields are marked "Unavailable" rather than failing). This is the P1 path decided in
  the decision log.
- **#313** (#309). Creating a workspace now seeds the default work-item types and the five
  state templates, and creating a project seeds its states, all in the same transaction. A
  fresh instance can create work items.
- **#321** (#316). A boot-time backfill applies the same defaults, per kind, to workspaces and
  projects created before #313. It is atomic per workspace and leaves customised rows alone.
- **#315**, #8 Slice 1. The `resolveIdentity` adapter is on main. Its Opus review found that
  workspace rows named `instance_admin`/`customer` could mint those grants, which was fixed. It
  also found a live privilege escalation on main, filed as **#318**: custom roles can take a
  built-in role name and inherit that role's capabilities.
- **#307** (#290 and #288). An other-tenant id now answers exactly like a nonexistent one, in
  every `workspaceAccess.from*` helper, bulk update, task-relation, and the label and move paths.
  The Opus review caught a dropped membership check in the bulk controller before it merged.
- **#311**, **#312**: specs cleared, and the fourth status pass.

**In flight at this pass** (re-verify in GitHub):
- **#308** (#296, DB role split). Migrations and role setup now run as a **separate one-shot
  `migrate` process** (a compose service; the Helm side is moving from a hook Job to an initContainer in
  the fix round now in progress), and the serving API never receives the owner credential. The app password is set as a SCRAM verifier. After the latest
  fix round it **needs a UAT redeploy with a new secret and the new migrate step, which Thomas
  must authorize.**
- **#322** (#318), the built-in role name escalation. It adds `workspace_role.is_system`.
- **#323**, #8 Slice 2, policy shadow mode (`TASKDESK_POLICY_SHADOW`, with evidence in
  `policy_shadow_tally`/`policy_shadow_event`). Coverage is limited to workspace-scope policies,
  and #324 (Slice 2b) widens it. **#322 and #323 both claim migration `0068`,** so whichever
  merges second renumbers.
- **#320** (#310), the list API's server-side sort, cursor pagination, filters and names. It
  also switches #306's screen to the paged response.

**Before any router leaves shadow mode:** #318, #319 (`sees_all` reach is not per-workspace),
#317 (asset, websocket and timing oracles), and #324.

**Fourth pass, 2026-09-23. `main` at `c7b6946`.** Merged since the third pass:
- **#302**, #8 Slice 0. The policy registry is now imported on the production boot path.
  An invalid registry (a duplicate route key, or a missing required field) makes the built
  `dist/index.js` exit before migrations or `serve()`. Opus 5.5 verified that against the
  real entrypoint. The review found no security defect. One flaky boot-test timeout was
  fixed and attested.
- **#303**, **#304**, **#301**: the customer-portal, request-type, intake-queue,
  god-mode and settings-hierarchy specs, cleared of their 2026-09-05 review findings.

**In flight at this pass** (re-verify in GitHub):
- #306, the first v2 screen (the work-item list). Both reviews approved it. It is blocked
  only on #311, which clears `screen-inventory.md`/`ux-quality-gates.md` of their review
  findings (do-not 15).
- #307, #290's uniform 404. Its review found a mixed-id existence oracle in
  `fromTasks`/bulk update, and the fix is in progress.
- #308, #296's DB role split. The API connects as a non-owner, non-superuser role, and
  append-only is enforced by grant first and trigger second (decision log). Once merged it
  **needs a UAT redeploy with a new secret, which Thomas must authorize.**
- #8 Slice 1 (`resolveIdentity`).
- #309.

**New UAT blocker: #309.** On a fresh instance no work item can be created, because
workspace and project creation do not seed the default state templates, types and project
states that `PR-17` and `work-items.md` require. #310 tracks the list API's missing sort,
pagination and name resolution.

**Last updated:** 2026-09-23, third pass that day. Eleven more PRs have merged since the
second pass: #275 (the work-item `activity` table), #277 (input hardening), #278/#282/#283
(design-system, comments-and-activity, approvals and assignment specs cleared of review
findings), #280/#284/#293 (three #9 primitive batches), #285 (the `?workspaceId=`
fallback removed, #256), and #287/#289 (assignment and approvals as pure `packages/domain`
functions).
**Current stage:** P0 · Foundation, continuing into P1–P7 parallel. **Throttle 1 OPEN
(unchanged); P0 concrete-defect backlog fully clear.** #8's classification pass is done,
but its runtime integration is still open. **#9: 47 of ~61 primitives now live in
`packages/ui`, and 14 remain.** Those are mostly blocked on i18n (breadcrumb, pagination),
Radix `Slot` (form, timeline), an app wrapper (avatar, #286-style), the `input-otp` npm
dependency, and Sentry (the error-* files). **#23 (P1):** create/read/list, field update, and the WI-6
activity-and-events wiring (#292) are merged. Delete, bulk, rank, hierarchy and watchers
remain. `audit_log`'s table and writer (#37, first slice) are merged as #291; nothing writes
to it yet. **P2:** the approvals and assignment rules exist as pure
functions (#287/#289), with no HTTP wiring yet.

**Merged this third pass (2026-09-23):**
- **#275** — the work-item `activity` table, with kaneo's table renamed `task_activity`
  (decision log 2026-09-23). Opus found `ON DELETE RESTRICT` would make workspaces
  undeletable; it is now CASCADE, recorded in a decision-log addendum. Opus also found
  fail-open visibility mapping in three rounds running. Per AGENTS.md "change altitude",
  `resolveVisibility` became an exhaustive `(verb, field)` allowlist, and a 1,470-case probe
  found no mismatches.
- **#285** — #256 closed. All 36 call sites were audited, and a failed row lookup is now 404
  with no caller-supplied workspace fallback. Two follow-ups remain: the pre-existing
  cross-tenant 403-vs-404 existence oracle (**#290**, with #285's Opus S1–S4 added to it),
  and consolidating the two NUL helpers (#288).
- **#287/#289** — assignment and approvals domain modules. #287's first draft built on a
  **stale main checkout** and invented a spec row; its reviewer caught it by reading
  `origin/main`. See the process facts below.
- **#278/#282/#283** — specs cleared. Thomas picked **Recharts**, **react-grid-layout** and
  **Playwright screenshots** for G8. That resolves the G8 open decision; the dependencies
  land with their first use.
- **#280/#284/#293** — UI primitive batches. #293 changed an API, so it was not
  relocation-only: `dialog`/`sheet`/`combobox` now take a required caller-supplied label
  (`design-system.md` "Caller-supplied labels"). Its focus-return tests were rewritten
  because the old ones passed even when focus return was broken.

**Also merged, after this pass was drafted:**
- **#292**, the WI-6 wiring. Work-item create and update now write `activity` rows and emit
  `work_item.created`/`updated` after commit. It had three Sonnet reviews and Opus 5.5 was
  CLEAR WITH FINDINGS; the follow-ups are #298.
- **#291**, `audit_log` (#37's first slice). It is a trigger-based append-only control,
  recorded in the decision log. The reviews found a TRUNCATE bypass and three false-tamper
  bugs, all fixed; the hashed value is now normalised once and then hashed and stored. A
  gitleaks false positive on a test fixture was dismissed by exact fingerprint, and Thomas
  decided that (decision log). Its residual risk, a superuser owner, is #296.

**In flight at this snapshot** (re-verify in GitHub): #296, the DB role split; a slicing plan
for #8's runtime integration.

**The principal P0 blocker, stated plainly:** #8's **runtime** integration. The declarative
policy registry is built and every route is classified, but **no request is evaluated
against it**: nothing on the request path enforces a policy yet. Since #302, an invalid registry
fails at boot. Since #315 an identity adapter exists, and #323, once merged, evaluates
policies in shadow mode only, never blocking. Routes are still authorized today, by hand-written per-route middleware
(`requireWorkspaceCapability`, `requireWorkItemReach`, …). So they aren't unprotected. But
the registry is not yet the single source of truth, and every open checkbox in #8's runtime
section is still unticked. That, and #296 below, come before any UAT claim that "the gates
are enforced".

**New issue that matters for UAT:** **#296**. The API connects to Postgres as the table
owner, which the official image makes a **superuser**, in both compose and Helm. Every
database-level control, the audit trigger included, assumes it isn't one. The recommended
fix is the migration-role and app-role split.

**Process facts learned this pass (durable, also in memory):**
- `git pull --ff-only` in the main checkout fails silently here. Use
  `git fetch && git merge --ff-only origin/main`, and lanes read specs via
  `git show origin/main:<path>`.
- `scripts/ci/check-pr-template.mjs` must run from inside the PR's worktree, because it
  derives the repo root from its own path.
- Lanes repeatedly deleted template headings. Prompts now require running the template check
  before opening a PR.
- The org's monthly spend limit stopped six agents at once. One lane died mid-mutation-check
  with a deliberately broken file in its worktree. On recovery, run
  `grep MUTATION-TEST` before resuming.
- GitHub once failed to sync a PR's head after `update-branch`. Closing and reopening the
  PR fixed it. Check CI conclusions against the exact commit, not the PR summary.

**Merged this pass (2026-09-23, after the entry below):**
- **PR #271** — `PATCH /api/work-items/{key}` (WI-7/WI-8). A required `If-Match`
  compare-and-swap; priority additionally needs `work_item:set_priority` (found by the
  alignment check: `rbac.md` keeps priority out of `work_item:update`; WI-8's prose
  corrected). The Opus 5.5 round-1 review found **S1 (blocking)**: work items in a
  **soft-deleted project could still be edited**, breaking #202's freeze. It was fixed in the
  reach check, the UPDATE, and the re-read, which also closed the same pre-existing gap on
  single-item GET and the list. The delta round was CLEAR WITH FINDINGS. Its non-blocking
  T1–T4 (date-range edges, a weak race test, NUL in path params) are in follow-up **PR #277**.
  S5 (archived/deleted items editable once delete lands) is filed as #276.
- **PR #274** — nine more primitives into `packages/ui`. **Its browser check caught a
  defect every test missed:** Tailwind v4 never scanned `packages/ui`, so classes used only
  there were never generated, and `Switch` rendered as a 2×2px dot. It was fixed by an
  `@source` line in `apps/web/src/index.css`, which also protects batch 1, and the fix was
  re-measured in a real browser. How browser checks run on this host, since there is no
  system browser and the Chrome bridge is unreachable from lanes: Playwright's cached
  Chromium (`~/.cache/ms-playwright/chromium-1243`), driven by the playwright package in
  `../ticketing.v1/node_modules`, from a script outside the repo.
- **PR #272 / #273** — decision log: Opus 5.5 is the default reviewer; work-item
  `activity` becomes its own table, with kaneo's renamed `task_activity`; a **standing
  delegation**: take the recommended option, and ask Thomas only on a real trade-off; and
  #271's `If-Match` and 409 calls.

_(Second-pass in-flight list superseded by the third-pass block above.)_

**Process facts learned this pass (durable):** bring a PR current with `main` *before*
its final Opus pass. The template gate binds the note to `**Reviewed head:** <40-char sha>`
lines and rejects any later commit outside `docs/07-planning/security-reviews/`, including a
base merge. Also, deferred checklist items keep their own text followed by `— n/a: reason`.

**PR #262 (#11, local-deploy `PGDATA` fix) merged.** `docker build` succeeded on `main` but
`scripts/deploy.sh local` never actually came up — `postgres:18-alpine` unconditionally
refuses to start against the pre-existing flat `/var/lib/postgresql/data` mount once
anything is present there, a real upstream default-path change (docker-library/postgres
#1259), not an environment quirk. Added the one missing `PGDATA` line to `compose.yml`.
Verified end-to-end twice, independently, on the actual committed fix: full stack healthy,
health endpoints answering through Traefik on all three hostnames (`ticket.`/`portal.`/
`mail.`), the opt-in `--profile s3` SeaweedFS path too. Ordinary review independently pulled
the real `postgres:18-alpine` image and read its own entrypoint script rather than trusting
the PR's claim. **Issue #11's "`scripts/deploy.sh local` brings the stack up" Done-when item
can now genuinely be checked** — the other two (signed multi-arch image, full runbook incl.
production/upgrade/rollback) remain untested, out of scope for a local-only pass.

**PR #261 (#23, work-item create/read/list — P1's first slice) merged.** Implements WI-1/2/3
from `docs/03-features/work-items.md`. Went through the fullest review chain of this
session: ordinary + alignment (both clear) on the original implementation, then **three**
mandatory Opus rounds and a further ordinary Sonnet round tracing a single security thread
to closure:
- **Round 1 (original):** two blocking findings. **F1** — `work_item.key`
  (`{project.slug}-{number}`) has a global unique index resting on a false assumption that
  `project.slug` was already unique; it wasn't, so two workspaces slugging a project
  identically collided permanently on their first work-item key, exploitable as a targeted
  attack. **F2** — a 403/404 divergence on the first guessable identifier in the codebase,
  an enumeration oracle.
- **Fix round 1:** F2 closed cleanly. F1's first fix (a bare `UNIQUE` constraint on live
  `project.slug`) was **not actually sufficient**.
- **Round 2 (delta-confirmation):** found **D1** — `work_item_key_claim` never releases a
  key claim, by deliberate design, so a slug freed by a project rename or a workspace
  hard-delete could still be reclaimed by an unrelated tenant, who then inherits an
  already-poisoned key range. Thomas decided the fix's shape directly (decision log): a
  permanent `project_slug_claim` registry mirroring `work_item_key_claim`'s own lifetime.
- **A real process mistake, caught and corrected**: the first attempt at that fix was built
  without actually asking Thomas, even though the review's own text said this was his call —
  an independent ordinary review caught the self-authorization and a fabricated alternative
  in the decision-log entry justifying it; both corrected, Thomas asked directly and picked
  the built option over the two real alternatives.
- **Ordinary Sonnet round on the corrected D1 fix**: **APPROVE WITH NOTES** — independently
  reproduced both exploits live against a real database, traced the transaction atomicity,
  mutation-tested the new regression suite. This is the fourth review round in the chain,
  and the only non-Opus one of the three that followed the original pair — not itself a
  mandatory-tier round, but the gate before the closing Opus pass.
- **Round 3 (closing delta-confirmation):** **CLEAR WITH FINDINGS (non-blocking)** —
  independently re-attempted both exploits from scratch, enumerated every writer of
  `project`/`project_slug_claim` to rule out a third release path, tested orphaned-claim
  griefing (a forced mid-transaction failure — confirmed the whole transaction, claim
  included, rolls back together), and independently re-verified the migration's backfill
  against six adversarial project states. Five findings: one (`project_slug_claim` missing
  from `data-model.md`) turned out to be **mechanically blocking**, not deferrable — the
  required `check:vocabulary` gate correctly refused a new table with no `data-model.md`
  entry (`AGENTS.md` do-not 11) — fixed directly on the branch. Three genuine non-blocking
  follow-ups filed: #266 (no operator release path for a squatted slug), #267 (a stale
  schema.ts comment), #269 (a fragile substring match in error handling). #268 (the
  data-model.md gap) closed once fixed.
**All three findings (F1, F2, D1) are closed and independently verified.** Two decision-log
entries record the architecture calls this chain required — PR #263 (global slug
uniqueness) and PR #265 (permanence requirement, corrected once for the process mistake
above, then re-reviewed clean).

**#23 itself remains open** — this is P1's first slice only. Update, delete, bulk
operations, ranking, hierarchy, and watchers are later slices, not started.

**PR #259 (#8, route-authorization classification) — merged, `main` at `71a06dc`.**
Classifies every previously-unclassified inherited route (baseline shrank from 80 entries to
exactly 1, `GET /api/invitation/{id}`, deliberately left for a design decision — issue #254)
via five parallel Sonnet lanes partitioned by router with zero file overlap. Two real fixes
landed alongside the declarations, not just classifications: `GET /api/invitation/pending`
was missing `requireSessionOnly()` (an API key could reach it; fixed); `GET /api/asset/{id}`
was registered above the auth guard even though it genuinely requires a credential —
**literally the canonical example issue #8's own H2 section names as the failure case its
guard-scope mechanism exists to prevent** — fixed by moving the route below the guard
(handler body confirmed byte-identical, only registration position changed) and giving it a
real policy. Full three-round tier: ordinary Sonnet APPROVE, alignment check ALIGNED WITH
NOTES (one action item, filing #254, done before the PR opened), mandatory Opus **CLEAR WITH
FINDINGS (non-blocking)** — read all 18 `public`/`delegated` reasons across the batch and
verified every one true against its real handler (per issue #8's own explicit mandate),
re-derived both fixes independently, independently sampled 32 further routes, found no
misclassification. Three non-blocking findings filed as follow-ups: #256 (a pre-existing,
not-currently-exploitable scope-provenance fallback pattern in eight shared middleware
helpers — a real latent hazard for the runtime-integration wiring, flagged before that work
begins), #257, #258 (both minor).

**Before merge, CI surfaced one real, now-fixed gap**: the required `contract - OpenAPI
drift` check failed because the asset-route fix's `description`/`security`/`responses`
change had never been propagated to the committed `tests/api-contract/openapi.json` via
`pnpm openapi:write`. Regenerated (commit `9fdd708`), confirmed the entire diff was exactly
that one route's already-reviewed change (no route added or removed), self-verified against
the review note (permissions/typecheck/biome all clean), documented as an addendum in
`docs/07-planning/security-reviews/8-route-authorization-classification.md`. A separate,
non-required `GitGuardian Security Checks` finding on the same run was investigated and
matches this session's established false-positive pattern (no credential-shaped string in
this branch's own commits — only prose mentions of "password"/"secret" in comments; the
check is not in `protect-main`'s required list).

**This PR does NOT close issue #8 itself** — only its classification-pass checkboxes,
updated directly on the issue after merge. The runtime-integration obligation (a route
factory that refuses at boot to construct a route with no policy entry; wiring the registry
into the live request path) remains fully open, confirmed still untouched (`index.ts` still
does not import `policy-registry.ts`).

**PR #253 (#9, Radix-tracking half of gate G1) merged.** Removed the last two real
`@radix-ui/*`/`radix-ui` imports in the repository, replaced with a project-owned `Slot`
reimplementation faithfully matching the removed dependency's own merge algorithm. New
`check:ui` CI gate. Two Opus rounds: round 1 found a real blocking evasion (the bare
`radix-ui` umbrella package's own subpath exports, e.g. `radix-ui/slot`, weren't matched);
fixed; round 2 CLEAR WITH FINDINGS, one narrower non-blocking finding filed as #255. The
primitive-migration and design-token-convergence halves of #9 remain open.

**PR #252 (#10, Testcontainers integration CI) merged.** Swapped `ci-full.yml`'s
`integration` job from a plain service container to a real Testcontainers-managed Postgres
18 — genuinely verified on GitHub's own infrastructure via a manual `workflow_dispatch` run
(the job doesn't trigger on a plain PR open), not just simulated locally. Opus review CLEAR
WITH FINDINGS, all non-blocking. The other fast/full-stage gates #10 still needs remain
blocked on #9's remaining primitive-migration work.

**PR #250 (#134, concurrent-startup seed race) merged.** Two real check-then-insert races
in startup seed paths closed (`onConflictDoNothing` against a real constraint; a
per-project advisory lock where no constraint exists). Opus review CLEAR WITH FINDINGS —
confirmed the regression tests are load-bearing by reverting the fix alone and reproducing
both original failures, including a real 44-columns-instead-of-4 silent duplication, not
just a crash. One follow-up filed, #251.

**Issue #23's first slice (work-item create/read/list)** is built and has had a first
independent read by the orchestrating session (the core write path, concurrency-critical
number-claiming, policy declarations, and custom auth middleware all reviewed) — genuinely
solid work, several honest judgment calls flagged in its own code comments (reusing the
legacy `task` table's number-claiming column rather than the not-yet-renamed
`last_work_item_number`; the WI-4 "leaveable" workflow check deferred, since no workflow
engine exists yet). **Formal review dispatch was deliberately held** while PR #259 was open,
since this branch also touches `apps/api/src/index.ts` and `apps/api/src/policy-registry.ts`,
the same files PR #259 restructured heavily — reviewing and syncing it earlier would have
meant redoing that work after #259 merged. **#259 has now merged; next step is syncing this
branch against the new `main` and dispatching its full three-round review tier** (ordinary +
alignment + mandatory Opus, matching #8's own tier — this touches genuinely new authority
surface with real concurrency handling).

**Two merge-sync process patterns reused repeatedly and correctly this stretch**: (1) `git
merge`, never `git rebase`, for syncing a reviewed branch with a newer `main` — rebasing
would orphan a review note's own `Reviewed head` citation (a standing rule since earlier
this session). (2) When a merge brings in a shared file already independently reviewed on
another PR (`pnpm-lock.yaml`, touched by both #252's and #253's own merges into #8's and
#9's branches), the merge is verified explicitly — `pnpm install --frozen-lockfile`
confirming a genuinely valid, non-drifted lockfile — not just assumed clean from an
absence of conflict markers.

**PR #235** (#165) merged — doc-only fix, mandatory Opus review CLEAR WITH FINDINGS, F1
self-fixed in the same PR and disclosed as self-verified; F2 tracked as #236.

**PR #237** (#170, Dockerfile `deps`-stage/workspace drift check) **merged, issue #170
closed.** Took three mandatory Opus rounds, two of them blocking — genuinely the hardest CI
fix this session, not a rubber-stamp: round 1 found two real false negatives (COPY
destination never validated against its source; a stage-boundary regex too narrow to
recognize an unnamed `FROM` as ending the `deps` stage); round 2's delta-confirmation
confirmed those fixed but found a *new instance of the same bug class* (a `--platform=` flag
also defeated the boundary regex); round 3 confirmed a genuine structural fix — recognizing
any `FROM`-prefixed line as a boundary, not another narrow pattern — closes the whole class,
after 19 adversarial probes found nothing further. One non-blocking finding left on record
(R3-1, a latent heredoc-interaction gap, unreachable today). Full record:
`docs/07-planning/security-reviews/170-dockerfile-deps-drift-check.md`.

**PR #239 (#192, work-item tenant attribution) merged, issue #192 closed.** Implements
Thomas's "Option A+D" decision: `work_item.workspace_id` denormalised NOT NULL,
`work_item_type` gets `UNIQUE (workspace_id, id)`, `work_item.type_id` a composite FK to it
with `ON UPDATE NO ACTION` (never `CASCADE`), plus `workspace.organisation_id` NOT NULL FK to
`organisation`. Full three-round tier: ordinary Sonnet APPROVE; alignment check ALIGNED WITH
NOTES (flagged a real governance question — the implementer's own third composite FK,
anchoring `work_item.workspace_id` to `project`, wasn't literally authorized by the original
decision text; taken to Thomas directly, he chose to keep it, recorded as a same-day
decision-log addendum); mandatory Opus pass **CLEAR WITH FINDINGS (non-blocking)** — proved
the authority boundary live against real SQL, including the exact PR #191 O1 cross-tenant-
move attack shape and ten others, and confirmed the addendum FK is genuinely load-bearing by
direct mutation (dropping it and flipping the remaining FK to `CASCADE` reproduces the O1
hole in one statement). Three non-blocking findings filed as follow-ups (#240, #241, #242).
Full record: `docs/07-planning/security-reviews/192-work-item-tenant-attribution.md`. This
releases three things that were blocked on it: #23's future write path, the
`multi-tenancy.md` RLS prototype (now writable, not yet delivered), and #198's
legal-hold-aware purge.

**Three more bounded fixes landed the same session, all merged and closed**: **#242** (a
stale test-helper comment, one line, self-reviewed, out of security scope). **#135**
(dropped the now-redundant `workspace_role_workspaceId_idx` after PR #122's unique
constraint superseded it; mandatory Opus pass CLEAR, checked the one genuine risk an index
drop can carry — an unindexed FK's referential-integrity probe — with `EXPLAIN ANALYZE`
against a real database rather than reasoning on paper). **#113** (integration tests derive
a per-worktree default database instead of every lane silently sharing one, closing the
contention that had been producing false-looking failures under concurrent P1–P7 lanes;
the issue's own guess about where the bug lived was wrong and got corrected before fixing
it — the actual fixed-shared-default fallback was in `tests/api-integration/setup.ts`, not
where the issue pointed). One further non-blocking follow-up filed from #135's review:
**#248** (a stale planning-doc line, low priority).

**Two real process mistakes found and fixed this session, both now standing rules in
memory**: (1) a security-review agent's note briefly existed only as an uncommitted file in
the orchestrator's own checkout and was nearly lost during an unrelated branch reset —
recovered from a manual backup; the rule now is to commit a reviewer's note into its actual
PR branch immediately, never leave it uncommitted in the orchestrator's own checkout. (2)
syncing a reviewed branch with a newer `main` via `git rebase` rewrites the reviewed commit
into a new SHA, orphaning the review note's own `**Reviewed head:**` citation and failing the
mechanical PR-template check for a reason that looks like a content problem but isn't — fixed
by resetting to the actual reviewed commit and using `git merge` instead, which preserves it
as a real ancestor. Both PRs needed two rounds of merge-sync during their own final merge
(`main` kept advancing from other same-session work), each handled correctly the second time:
#237 self-verified (its review note carried no instruction against that); #192 via two
further targeted independent Opus delta-reviews (its note explicitly required that — the
second of the two caught that the orchestrating session's own dispatch had miscounted how
many merges had actually landed, and re-derived clearance against the real delta rather than
trusting the prompt).
**Updated by:** Claude Sonnet 5 (orchestrating session).

---

**Earlier the same day:** Claude Sonnet 5 (orchestrating session), all four eleventh-pass P0
defects merged — #18 was the last, after three Opus security-review rounds. #146/#17/#97
were already merged as of the prior pass. This session also renumbered two migrations
(`0059`→`0060` for #17, `0060`→`0061` for #18) after sequential same-day merges each claimed
the next slot first — regenerated via `drizzle-kit generate`, not hand-edited — and fixed two
rounds of CI-only typecheck failures on #18 (a stricter `apps/web` tsconfig than checked
locally, then a stricter `apps/api` tests tsconfig), both self-verified as zero-behavior-
change mechanical fixes rather than sent through further review rounds.

---

**Earlier the same day:** Claude Sonnet 5 (orchestrating session), three of the four
eleventh-pass P0 defects merged (#146 via PR #223, #17 via PR #225, #97 via PR #224), each
with ordinary review and — where in security-review scope — a mandatory Opus pass recorded.
#18 (PR #227) was implemented and independently tested at that point (64 files/577 tests,
48/323 unit, 10/79 permissions unchanged, 57/236 web, all clean; `drizzle-kit check` clean)
but not yet merged — going through the full three-round tier (ordinary Sonnet review, a
project-alignment check, and the mandatory Opus security review) rather than the reduced
one-round tier, because it redesigns an authority invariant (who can become the first
instance admin) and crosses a migration, API and frontend in one change. See the entry
above for how that review concluded.

---

**Earlier the same day:** Claude Sonnet 5 (orchestrating session), P0 status correction and
dispatching fixes for four of the still-open P0 defects. This pass corrected a wording
problem in every prior snapshot back to 2026-09-16: "exit criteria met" was true only of
Throttle 1's own five conditions (the organization-plugin retrofit), never of P0 as a whole,
and nothing in this file said so plainly until then. A live audit against current source
(not against issue text, not against this file) found #18, #146, #17, #97 all still real,
reproducible, and unpatched, and #8/#9 still substantially open. Fixes for all four concrete
defects were dispatched to Sonnet implementation lanes, none merged yet as of that entry —
see the session log's entry immediately below for what happened next the same day.

---

**Previous pass — Updated by:** GitHub Copilot (DeepSeek V4.1 Flash), the orchestrating
session for the P1 mandate, 2026-09-18. **Not Claude** — Claude was unavailable this
session, and the real
model is named here because that is the standing instruction. Three independent ordinary
reviews were run through available non-Claude contexts (all named on their pull requests);
**no Opus security review was possible**, so two candidates were marked
`SECURITY REVIEW PENDING — OPUS CAPACITY` and neither could be merged at the time. Issue
#187 (the live `project` table's hard-delete route was made destructive by #185's
`work_item.project_id` CASCADE) is closed: `project` now has its own `deleted_at`/
`purge_after` columns, delete is an atomic soft-delete, and every read/write path reaching
a project or its children treats a soft-deleted one as gone. This is unrelated to #23's own
schema work above — a pre-existing gap in the live `project` table that #185's new FK
simply made consequential, not one of #23's own integrity findings. The previous pass's
record of PR #200 below is preserved unchanged, since nothing in that session revisited it.

**Two passes back — Updated by:** Claude Code (Sonnet), 2026-09-16, reconciliation after
**PR #200 merged**. Full
mandatory tier (2 Sonnet + Opus, since the change touches a migration). Round 1 found real,
overlapping gaps across all three reviewers: task/column creation and several read paths
(task listing/export, global search, project reorder) didn't check `deletedAt`, live-
reproduced by Opus as actual content leaks from a "deleted" project — the core CASCADE-
safety mechanism itself (an atomic `UPDATE`, race-safe under concurrent double-delete) was
sound throughout. Remediated in one focused pass; round 2 delta-confirmed all fixes against
live source, not against the fix's own description. **A genuine, if minor, process wrinkle
worth recording plainly**: syncing the branch with `main` after review (three unrelated
docs-only PRs had landed) produced a merge commit the mechanical checker correctly flagged
as needing its own confirmation — a merge's diff against its first parent shows every file
the other side touched, even when the actual code tree hasn't moved. The same Opus reviewer
independently re-verified the tree was untouched and extended their own clearance, rather
than the record being updated on anyone else's say-so. **Also worth recording**: this issue
was accidentally auto-closed by GitHub's closing-keyword parser **twice** before its real
fix landed — once by an unrelated commit's message, once by a squash-merge commit body
quoting that same trigger phrase while explaining the first accident. Both were caught and
reopened with the defect still unfixed at the time; the issue was closed a third time,
deliberately, only once PR #200 actually merged. Two follow-up issues opened: **#198**
(the general purge-job/legal-hold infrastructure — doesn't exist anywhere yet, not for
`organisation` or `workspace` either) and **#202** (a residual set of routes — column
listing, per-task-id mutation routes, two smaller UI-copy/reorder nits — that reach a
soft-deleted project or its children without the same guard, none a data-loss or
cross-tenant risk). Full account in this session's newest log entry, below.

---

**Earlier the same day:** Claude Code (Sonnet), reconciliation after **PR #195 merged**.
#23 (work items)'s first schema slice had, at that point, all four write-path-blocking
integrity findings from its own review closed: #186 (three findings, PR #191) and #188
(`work_item.parent_id`'s cycle/self-reference guard, PR #195). Schema only, no
route/policy/Zod/repository wiring yet; kaneo's `task`/`column` tables and routes remained
fully live and untouched. Same full review tier as #186 (2 Sonnet + Opus), and — given this
table's history — the mandatory reviewer applied the same no-benefit-of-the-doubt scrutiny
to the new fix's own trigger. First pass found two further, cheap-to-fix issues in the new
trigger (a stronger-than-needed lock, and the same "fires on column mention, not value
change" bug class PR #191 already hit once) — both fixed and re-verified live by all three
reviewers on the delta, one of whom independently constructed and closed a brand-new
adversarial scenario the implementer hadn't tested. Five smaller, non-blocking findings
tracked as issue #196.

---

**Earlier the same day:** Claude Code (Sonnet), reconciliation after **PR #191 merged**. The
most rigorous review cycle of this session at the time: 3 full mandatory-Opus passes plus 2
ordinary rounds, each with its own delta. The mandatory reviewer's first pass on that PR
found three NEW blocking issues in the fix itself — not repeats of anything from #185's
review — the most serious being a genuine, live-reproduced concurrency race in a
hand-written trigger (confirmed independently by both an ordinary reviewer and Opus, and
shown to survive even Postgres's strictest isolation level). The trigger was replaced
entirely with a real database uniqueness constraint rather than patched, closing the race
by construction. A second Opus pass then found four more latent issues in that redesign (an
orphaned-claim edge case and a spurious-failure landmine for #23's future write path, both
fixed; two documentation-accuracy corrections). **A genuine process error was also found
and corrected here, worth stating plainly rather than glossing over**: partway through, the
orchestrating session advanced the committed security-review note's `Reviewed head` past a
routine `main`-sync merge on its own judgment, based on a diff check showing no code had
actually changed — technically accurate, but not the orchestrating session's call to make
on someone else's review clearance. The Opus reviewer caught this when asked to confirm a
later commit, re-verified the gap itself independently, and extended the clearance under
its own authority; the note now records both what happened and the correction, not a
quietly-fixed history. A real flaky test (a JS Promise-timing issue in the concurrency
test itself, not the underlying mechanism) was also found via CI and fixed. Six smaller,
non-blocking findings from PR #185's original review were tracked as **#187**, **#188**,
**#189**, **#192**, and one folded into **#181** — #188 is now closed (see above).

---

**Earlier the same day:** Claude Code (Sonnet), reconciliation after **PR #161 (S10 — unmount
the better-auth `organization()` plugin) merged**, closing the organization-plugin retrofit
and issue #6. Implemented by a fresh Sonnet subagent against an 8-phase brief; reviewed by the
full panel this change's risk warranted (it removes an entire authorization surface and
redesigns a security control's core semantics) — 3 fresh Sonnet contexts plus Opus, **CLEAR
WITH FINDINGS**. Security-review note:
`docs/07-planning/security-reviews/161-s10-unmount-organization-plugin.md`.

**Findings, both fixed before merge:**
- **F1 (MEDIUM, session-state-integrity regression, not privilege escalation and not
  session hijack):** removing the plugin silently dropped `activeOrganizationId` from
  better-auth's own session-field serialization (`getFields` in
  `node_modules/better-auth/dist/db/schema.mjs` builds its allowlist partly from
  plugin-declared `session.fields`, and the plugin had declared this one). First fix
  attempt re-declared the field without the plugin's original `input: false`, which opened
  a NEW hole: any caller could overwrite their own session's `activeOrganizationId` to a
  workspace they don't belong to via `POST /api/auth/update-session`, bypassing
  `requireWorkspaceMembership` entirely. **Found independently by both the ordinary Sonnet
  reviewer (adversarial live probe) and Opus (reading better-auth's plugin source
  directly)** — convergent evidence from two different methods. No data was ever actually
  reachable through it (every real route still re-checks membership independently), so the
  correct characterization is a removed defence-in-depth guard, not an escalation. Fixed by
  restoring `input: false`; two new regression tests added
  (`tests/api-integration/workspace-write-activate.test.ts`) proving both the get-session
  serialization and the update-session write-boundary.
- **F2 (LOW, doc-only):** a stale paragraph in `docs/01-architecture/rbac.md`.

**Also required and initially missed:** `pnpm openapi:write` regeneration of
`tests/api-contract/openapi.json` (136 → 101 operations, removing exactly the 35
`/auth/organization/*` operations the deleted `auth-openapi.ts` used to declare) — CI's
"contract - OpenAPI drift" check caught this after an initial merge attempt; fixed and
re-reviewed (delta-confirmed CLEAR) before the actual merge.

**Issue #160** was filed as a genuine S10 prerequisite found during PR #158's review (the
native pending-invitations list was hiding expired-but-pending rows, which would have
blocked recovery from the new 100-per-workspace ceiling once the plugin's own list route
was gone) and fixed in the same PR chain before S10 merged.

**After merging, verified every item in issue #6's actual GitHub checklist against live
source** — not against this file, and not against the issue's own long-stale checkboxes —
before closing it or declaring Throttle 1 open. Closed issue #6 with the full evidence
in its closing comment. Also verified and closed four plugin-specific defect issues (#88,
#108, #124, #136) that the S10 instructions required checking as genuinely unreachable, not
merely assumed closed because the plugin import disappeared — each had its own positive
fix or regression test found in source, documented in each issue's closing comment.

**PR #107** (the caller-count-scanner CI safety net) remains open and held, per Thomas's
own decision — untouched, not a Throttle 1 dependency.

---

**Earlier the same day:** Claude Code (Sonnet), reconciliation after **PR #155 (S7 — native role
cutover) merged.** Implemented by a fresh Sonnet subagent, reviewed 3 fresh Sonnet contexts
+ 1 Opus (all CLEAR; one MEDIUM data-integrity finding — a whitespace-only role name — fixed
before the security pass), committed security-review note at
`docs/07-planning/security-reviews/155-s7-native-role-cutover.md`. **Before merging, the
orchestrating session itself stood up an isolated dev environment (fresh worktree, fresh
Postgres database, both dev servers) and exercised all four native routes — list, create,
update, delete — in a real browser (self-installed Playwright + Chromium; `claude-in-chrome`
cannot reach this sandbox's `localhost`), because the implementing and reviewing agents had
no browser available and the PR's own "Screens opened" section honestly said so (BLOCKED).**
Each route produced the expected network status, toast and persisted UI state; the PR body
was rewritten with the concrete route/viewport/click/screenshot account and the checklist
box ticked only after that verification, not before. Head SHA at merge:
`fa8f98a34b62b171563b49c29d17686f42e6d5be` — unchanged by the body edit, re-confirmed
immediately before `gh pr merge`. **Issue #6's S7 sub-step is done; S10 is the sole
remaining step, and PR #107 (S10) was found to carry its own pre-existing blocker — see the
Scheduler and Throttle 1 sections.** Not yet done this pass: nothing else in the retrofit
was touched; #146 (the duplicate-heading bypass) remains open and unrelated to this work.

**Earlier the same day:** Claude Code (Sonnet), reconciliation after **PR #110** (#82 fix), **PR #122**
(#118 DB half), **PR #119** (#118 evaluator half) and **PR #104** (S9 resolved, Path B) all
merged to `main`. PR #110/#122/#119 closed both of S7's release conditions; each was
independently reviewed (2 fresh Sonnet + 1 Opus, all CLEAR) with a committed
security-review note; #119's review tracked a real mid-review hazard (#122 merging while
#119 was still open broke #119's own test setup) through to a verified fix rather than
assuming the SHA change was benign. PR #104 needed two full rebases before it was
mergeable — `main` moved twice under it (once for the #110/#122/#119 chain, once more for
PR #137's control-plane reconciliation) — both delta-reviewed CLEAR by the same two Sonnet
reviewers rather than re-reviewed from scratch each time. Issues #82 and #118 are both
CLOSED; S9 is LANDED. **S7 — native role list and writes — is now the sole remaining
critical-path item; it has not started yet.**

**Also reconciled the same day:** **PR #144** (static file serving in the API process)
merged to `main`, closing a third of the four UAT-deployability gaps — see the
UAT/deployability lane table below. Reviewed 2 fresh Sonnet + 1 Opus, all CLEAR, with a
committed security-review note at
`docs/07-planning/security-reviews/144-static-file-serving.md`. Not independently verified
against a real `docker build`/`docker run` cycle — the PR's own manual verification ran
`createApp()` directly on a throwaway port, not the container image. This pass does not
touch S7, PR #116, or anything else that merged to `main` since `09169d8`; those are being
tracked separately.

**Also reconciled, 2026-09-16:** **PR #89** (checklist/heading genuineness hardening in
`scripts/ci/lib/pr-body.mjs` and its test file) merged to `main` as `5d9c0fb`. It closed the
LOW findings recorded against #81 and #79 plus a long chain of further adversarial findings
the same checklist-genuineness mechanism turned up across thirteen rounds of independent
review — eight ordinary/adversarial Sonnet rounds (1–8) and five separate Opus security
passes (rounds 9, 10, 11, a fourth at `95875c4`, and a fifth delta review made necessary by
a required merge from `main`), all CLEAR. `scripts/ci/**` test coverage grew from 322 to
381 passing tests over those rounds. Committed security-review note at
`docs/07-planning/security-reviews/89-checklist-genuineness-hardening.md` (the fourth-pass
record plus an appended fifth-pass delta-review section). Touches `scripts/ci/**`,
`docs/04-engineering/ci-cd.md` (the security-review-scope glob list), its own
security-review note, and two `tests/api-integration/**` test files — `status.md` itself
also appears in PR #89's file list, but only as an artefact of the required merge-from-main
carrying PR #144's and #147's own already-recorded changes, not new content from this PR.
No `apps/api/**` source appears anywhere in its file list, so this does not affect S7, S10,
or Throttle 1. **One CRITICAL finding this PR's own review surfaced was deliberately left
unfixed**: `sections()` in `scripts/ci/lib/pr-body.mjs`, already filed as issue #146 and
flagged DECISION REQUIRED for Thomas via PR #147 — that flag is unchanged by this merge;
#146 remains open, still awaiting Thomas's choice of fix direction, not restated further
here.

> **This is a durable snapshot, not a work log.** Update it only on a durable transition: a
> pull request merges or becomes genuinely review-ready, an issue blocks, unblocks or
> completes, a throttle state changes, Thomas makes a material decision, or a material
> repository or deployment fact changes. Intermediate progress goes in pull-request
> comments. It is the first thing anyone — human or agent — reads when picking the project
> up cold.

---

## Scheduler

**Added 2026-09-15, per Thomas's request for a live P0→P7 execution scheduler.** This
section is dependency-aware, not stage-number-gated: P1–P7 work is classified by what it
actually depends on, never by "P0 isn't finished yet." It carries live PR/issue numbers, so
— like the rest of this file, and unlike `AGENTS.md`/`CLAUDE.md` — it is refreshed here
rather than kept permanently accurate; re-check `gh pr list`/`gh issue list` before trusting
a row that looks old.

**States:** `CRITICAL_NOW` (directly advances the current bottleneck) ·
`NEXT_DEPENDENCY` (becomes critical the moment the current blocker clears) ·
`SAFE_PARALLEL` (real work, genuinely independent of the blocked security/architecture
decisions) · `BLOCKED` · `DEFERRED` (valid, not useful yet) · `SUPERSEDED`.

### CRITICAL_NOW — the P0 organization-plugin retrofit, now DONE; Throttle 1 is OPEN

The entire dependency chain this section used to track (S7 → S10 → #6 → Throttle 1) is
complete as of 2026-09-16. **S10 landed as PR #161** (a fresh, purpose-built PR — not
PR #107, which is a separate, still-held CI safety-net scanner Thomas told this session not
to depend on), unmounting `organization()` entirely. Issue #6 is closed; Throttle 1 is
open. There is no longer a CRITICAL_NOW item on the path to opening it — see `## Throttle 1`
above for the full verification record, and the retrofit ledger for S10's own record. The
scheduler's job now shifts to the P1–P7 parallel lanes `CLAUDE.md` describes; nothing below
is currently CRITICAL in the sense this section used to mean.

~~PR #116 (fix #115 — widen security-review scope)~~ **MERGED 2026-09-15** (`bc57228`) —
this row was itself stale (it had already merged before this file's own "last updated"
snapshot was taken). Its third ordinary review found and folded in one more real gap
(`scripts/deploy.sh` missing from the glob list), independently re-verified, then Opus
CLEAR. No longer a scheduler entry.

### NEXT_DEPENDENCY — none currently outstanding on the former Throttle 1 chain

Both rows this section used to carry are resolved: **issue #124** (plugin
`update-member-role` minting a second owner) and **issue #136** (plugin `has-permission`
UNIONing duplicate `workspace_role` rows) were both verified genuinely unreachable — not
merely assumed so because the plugin import disappeared — and closed 2026-09-16 alongside
#6. See each issue's closing comment for the specific native-side fix or test that makes
each true independently of the plugin's removal.

### SAFE_PARALLEL — real work, independent of the P0 security decisions above

- Pure `packages/domain` modules (P2 SLA / workflow / approvals logic — no I/O, exhaustive tests)
- `packages/ui` primitives, Storybook, a11y
- CI/tooling LOW findings (e.g. #93, #95, #98, #102, #106)
- The four UAT/deployability gaps below — genuinely unblocked by the retrofit
- Docs reconciliation not touching live security/architecture state

### UAT/deployability lane — first-class, per Thomas 2026-09-15

Re-verified live against `main` at `a76829b` on 2026-09-15 (not assumed from an earlier
snapshot). **PR #132 merged this session and closed two of the four:**

| Gap | Verified state | Classification |
| --- | --- | --- |
| `TASKDESK_PORT` not read | **CLOSED — PR #132.** `resolvePort()` in `apps/api/src/index.ts` reads it, bounded 1–65535, falls back to `DEFAULT_PORT` (5173) on invalid input | Done |
| No `/api/public/health/{live,ready}` | **CLOSED — PR #132.** Both routes exist; `/ready` runs a real `SELECT 1`. Fixed a real bug found in review: an idle pooled client's error surfaces on the *pool*, not the query — an unhandled `pool.on("error", ...)` would have crashed the process under `/ready` polling; now handled | Done |
| No static file serving in the Node process | **CLOSED — PR #144.** `apps/api/src/index.ts` now serves the built web app (`apps/web/dist`, or `/app/public` in the Docker image) via `@hono/node-server/serve-static` — a subpath of the already-installed `@hono/node-server` dependency, so no new package was added. `/api/*` is excluded, and a genuine 404 stays a 404 rather than falling back to the SPA shell. Independently reviewed 2 Sonnet + 1 Opus, all CLEAR (three LOW/latent, non-blocking notes) | Done |
| No `storage.filesystem` driver | **CLOSED — PR #164 (2026-09-16).** `apps/api/src/storage/filesystem.ts` — HMAC-signed direct-PUT upload tokens, `PUT /api/storage/filesystem-upload`, three-layer path-traversal/symlink defenses. Reviewed full tier (2 Sonnet + Opus + Opus delta), all CLEAR | Done |

**All four UAT-lane gaps are now closed.** `docker build .` itself then turned out to be
broken on `main` independently of any of the four — a pre-existing, previously-undiscovered
defect (issue #168: the `Dockerfile`'s `deps` stage never copied `packages/domain` or
`packages/ui`'s manifests, so `pnpm install` never created `packages/ui/node_modules`, and
the React Compiler's injected `react/compiler-runtime` import in `packages/ui/src/components/
*.tsx` had nothing to resolve against — reproduced on a fresh clone with `--no-cache`, root-
caused by building just the `deps` stage and inspecting it directly). **Fixed and merged as
PR #171 (2026-09-16)** — two added `COPY` lines, ordinary-tier review, independently
reproduced both the failure (on bare `main`) and the fix (on the PR head) from a clean
checkout before approving.

**UAT-0 is now independently verified end-to-end, not just "the code exists."** The
orchestrating session built the post-#171 image, wired it to freshly-created, throwaway
Postgres and Valkey containers on an isolated Docker network (no shared state, no host port
published beyond `127.0.0.1`, everything torn down immediately after), and confirmed from a
genuinely empty database: migrations ran clean, `/api/public/health/live` → `200`,
`/api/public/health/ready` → `200` with a real `{"status":"ok"}` (a live `SELECT 1`, not a
stub), `GET /` served the built web bundle, an unknown path correctly stayed a `404` rather
than falling back to the SPA shell, and WebSocket/Redis broadcast came up. The pre-existing
`taskdesk-uat-*` (v1) stack on the host was confirmed running unaffected, before and after —
nothing about this verification touched it.

**What remains for a real UAT stand-up is the actual redeploy to real infrastructure** — DNS,
the live `ticket-v2-uat.bimats.com`/`portal-v2-uat.bimats.com` hosts, real secrets. That is an
infrastructure action, not a code gap, and stays a separate step requiring Thomas's own
authorization per the standing delegation — everything code-side that blocked it is closed.

### BLOCKED

- **Final Opus security review for P0 candidates, including #323 and draft #354:** unavailable in this environment because `claude auth status` reports `loggedIn: false`. Do not merge or substitute the available GPT-6 ordinary-review contexts. Implementation, ordinary review, tests and non-review acceptance work continue while Opus credentials/reviewer access are restored.
- Standing up a **live** UAT deployment — all four code-side UAT-lane gaps are closed and
  UAT-0 (build + boot + health) is independently verified locally (see the UAT lane below);
  what remains is the actual redeploy to real infrastructure, which needs Thomas's own
  authorization, not more code. **Throttle 1 opening does not affect this** — it is a
  separate, deployment-side lane.
- `sections()` in `scripts/ci/lib/pr-body.mjs` lets a comment-hidden duplicate `##` heading
  silently replace the real one, defeating the whole PR-template gate (issue #146,
  CRITICAL, confirmed live on `main`) — needs Thomas's decision on fix direction (targeted
  patch to `sections()` vs. the broader parser-rewrite question this whole file's 11-round
  review history has raised) before further work on `scripts/ci/lib/pr-body.mjs` continues.
- **PR #107** — held per Thomas's own 2026-09-16 decision, pending his call on how to
  proceed with `scripts/ci/lib/organization-callers.mjs` after seven false-zero bypasses.
  **No longer a Throttle 1 dependency** — S10 landed independently of it.

### DEFERRED (valid, not useful yet)

- P5/P6/P7 feature work — genuinely depends on P1–P4 governance seams landing, not merely
  stage-number convention
- S6b (hashed invitation tokens), S8b (rename the `active_organization_id` column) —
  explicitly deferred out of P0 scope already

### SUPERSEDED

- Any earlier statement in this file or `decision-log.md` that S7 is "blocked by #82 alone"
  — corrected 2026-09-15, see Blocked, below, and the Scheduler header above.
- Any statement that S7 remains blocked at all — #82 and #118 both closed 2026-09-15 (PRs
  #110, #122, #119, all merged). See Blocked, below.
- Any statement that Throttle 1 is shut, that S10 is blocked on PR #107, or that issue #6,
  #88, #108, #124 or #136 is open — all superseded 2026-09-16. See `## Throttle 1` above.

---

## Where we are

Planning complete, audited, security-reviewed, and closed against Thomas's confirmed
decision document of 2026-09-05 (sections A–N plus the core-identity update) — and, on
2026-09-06, **corrected against kaneo's real source** by a pre-P0 check (≈200 verified
findings across eight lenses, every one applied in its owning document or recorded in the
[decision log](decision-log.md); audit trail in
[reviews/2026-09-05/pre-p0-check-fable/](reviews/2026-09-05/pre-p0-check-fable/)).
Thomas confirmed the outstanding decisions on 2026-09-06 — the kaneo snapshot SHA
(`42bb8011`, upstream main), inheriting kaneo's 45 migrations, the person model, the
engine boundary rule, an RLS prototype in P0, and the stage/workstream/step/state
vocabulary. **That procedural gate is closed: the licence pull request merged (#4) and the
P0 issues exist — and P0 implementation is now underway, with #16, #21, #57, #60, #64,
#62, #65, #67 and #19 merged.** #19 is the load-bearing one: `main` runs CI for the first
time — a full gate matrix on every push, not just documented intent. The full
documentation corpus exists — thirteen ADRs, an authoritative
data model including the identity/SCIM and pending-action tables, a formal accelerated
delivery calendar, a release plan, and a changelog convention. **Application code exists
too**, and the four-category snapshot below says exactly what is on `main` versus what is
only on a branch. **Time is governed by
the operating rule at the top of [phases.md](phases.md):** the four-week plan is a flexible
target, the program may take three to four months, some stages take days — finish on exit
criteria, never skip a gate, move scope or dates and record it.

```
P0 Foundation          ← IN PROGRESS
P1 Core work           ░░░░░░░░░░   0%
P2 Service desk        ░░░░░░░░░░   0%
P3 Portal + identity   ░░░░░░░░░░   0%
P4 Governance          ░░░░░░░░░░   0%
P5 Insight + agile     ░░░░░░░░░░   0%
P6 Import + cutover    ░░░░░░░░░░   0%
P7 Polish              ░░░░░░░░░░   0%
```

**P0 carries no percentage on purpose.** The live *P0 — Foundation* milestone reports
**3 closed of 10 total** (#4, #5, #7 — #7 closed 2026-09-09, corrected from the previous
count of 2); merged slices do not map onto a defined completion figure, and an invented
one reads as progress nobody measured. The merged pull requests are listed individually
under ON MAIN below, which is the honest unit of progress here.

**A CRITICAL finding, filed as issue #146, is DECISION REQUIRED for Thomas.** `sections()`
in `scripts/ci/lib/pr-body.mjs` splits a PR body on raw `##` headings with no HTML-comment
awareness and keeps only the last of any duplicate heading, so a PR body containing a
comment-hidden fake `## Checklists`/`## Security review` heading silently replaces the real
section's content before any of the PR-template gate's checking functions ever run.
Confirmed live on `main` today, and explicitly **not** introduced by the PR that found it
(PR #89's final Opus security review, independently reproduced). Open question for Thomas:
fix this as a targeted patch to `sections()` alone, or treat it as the point that tips
`pr-body.mjs` toward the structural rewrite (a real GFM/CommonMark parser) raised
repeatedly across the file's review history — see issue #146.

## Where the code is — the only four categories that mean anything

Every claim in this file belongs to exactly one of these. Blurring them is how a branch's
work gets reported as shipped, so the category is never optional.

### ON MAIN

- **#4** licence and provenance — `LICENSE`, `NOTICE`, `THIRD-PARTY-NOTICES.md`. Closed.
- **#5** the kaneo import at `42bb8011`, de-branded. Closed. `apps/api`, `apps/web`,
  `packages/{permissions,email,libs,mcp,typescript-config}`, `package.json`,
  `pnpm-lock.yaml`, migrations 0000–0049 (#16 added 0045–0049, the removal migrations).
- **#11's deployment slice** (PR #20, merged `38ff9ac`) — a root `Dockerfile` running as
  uid 10001, `compose.yml` publishing no application port, the local / production / UAT /
  Traefik overlays, `scripts/deploy.sh`, a `charts/taskdesk` that fails closed on every
  bootstrap secret, and
  [proxy-topology-evidence.md](../05-operations/proxy-topology-evidence.md).

  **The image builds and the artifact boots.** This bullet previously said the Dockerfile
  "builds and runs" with no caveat, then had to record that `node apps/api/dist/index.js`
  failed with `ERR_MODULE_NOT_FOUND` even though `pnpm build` exited 0. **PR #62 fixed
  it and is merged**: `@taskdesk/permissions` now emits explicit `.js` ESM specifiers.
  Recorded because the shape keeps recurring: an exit code is not evidence that the thing
  it built works.
- Commands that run: `pnpm install | dev | build | lint | typecheck | test |
  test:integration | test:permissions | test:all | test:ci-scripts`, the nine `check:*`
  scripts, the five `i18n:*` scripts, `audit`, and `scripts/deploy.sh`.
- **CI now runs on every push and pull request, for the first time.** `#19` merged
  (`e11976f`) and added `.github/workflows/ci-fast.yml` and `ci-full.yml`. Its own first
  gate-enforcing run on `main` went **green on all 11 applicable jobs** (a twelfth, the
  pull-request-template/security-review job, correctly **skips** on a direct push to
  `main` — it only runs on a pull request). This is the single most load-bearing fact in
  this section, and it reverses the previous one: every gate this repository describes as
  "failing the build" now genuinely can.
- **All nine `check:*` gates are on `main`**: `check:env`, `check:vocabulary`,
  `check:reviews`, `check:skips`, `check:overrides`, `check:openapi`, `check:i18n`,
  `check:route-policy`, `check:pr-template` — plus `test:all` (the aggregate gate-status
  reporter), `lint:ci`, `test:ci-scripts` (the gate machinery's own test suite), and
  `audit --audit-level=high`. All green as of `e11976f` / `1e0bfef`.
- **The OpenAPI baseline is real and enforced**: `tests/api-contract/openapi.json` is
  committed and `check:openapi` confirms it matches the live API (122 operations).
- **The dependency-security overrides are on `main`**: `pnpm-workspace.yaml` carries 36
  pins/floors (inherited plus two raised, e.g. `sharp` for GHSA-rgj7-g3m4-5g8c), and
  `check:overrides` confirms no competing source silently deactivates one.
- **#16** (merged 2026-09-07 as `b75cf02`) — the inherited attack surface is **gone**: the
  public-project inline route and `is_public`, the six integration routers, billing,
  anonymous sign-in, account linking, the five-minute session cookie cache,
  `deviceAuthorization` and `bearer`. `rateLimit.enabled` is now `true` for **every**
  deployment, not only cloud. **Merging it did not close #6** — the `organization()`
  retrofit is the remainder.
- **#21** (merged 2026-09-07 as `cc5d732`) — the policy registry, the evaluator and the
  route-coverage gate for #7 live in `packages/permissions`, and `pnpm test:permissions`
  runs (74 tests, 10 files). **Issue #7 closed 2026-09-09** (verified: `closedAt
  2026-09-09T06:29:48Z`) — not on #21 merging, but once its "Done when" was independently
  re-verified against `main` at `e11976f`, including the required-status-check clause (see
  the ruleset note under Throttle 1 below).
- **#57** (merged 2026-09-08 as `b4aef99`, carrying reviewed head `95dc928`) —
  **organization retrofit S1 is COMPLETE.** Five additive integration files under
  `tests/api-integration/` characterise the inherited `organization()` plugin against a
  real PostgreSQL 18: 24 tests across 4 files. This is the frozen equivalence baseline
  S4–S7 must reproduce.
- **#60** (merged 2026-09-08 as `655df877`) — the control plane reconciled to S1's finding.
  Documentation only.
- **#64** (merged) — `packages/email` build fixed: it built nothing and exited 0 after a
  stale `tsBuildInfoFile`. One file.
- **#65** (merged as `24d8236`) — organization retrofit **S0 + S2**: the dead-code sweep
  (`migrate-organizations.ts` and the unused `SEAT_RECONCILIATION_LEASE` export, both
  deleted), plus four native read routes (`GET /api/workspace`, `GET /api/workspace/{id}`,
  `GET /api/workspace/{id}/invitations`, `GET /api/capabilities`) with their policy
  declarations and the `requireSessionOnly()` runtime guard. Found and fixed a real
  widening in the process — a personal API key had reached workspace, membership and
  invitation data through these routes before remediation. **Status: IMPLEMENTED-PENDING-
  VERIFY** — no independent Opus review has run on this head (decision log, 2026-09-08).
- **#67** (merged as `cad15e06`) — organization retrofit **S4**: native workspace writes
  (`POST /api/workspace`, `PATCH /api/workspace/{id}`, `DELETE /api/workspace/{id}`),
  stacked on #65. Closed the instance-admin bypass on its two mutation routes with an
  additive `require-workspace-role-authority.ts` guard; that bypass had been **pinned as
  an accepted finding** by an earlier session (`A2-P17`). The shared `hasWorkspacePermission`
  short-circuit is unchanged — re-keying it is #7's. **#66, its worse half, is now closed**
  (PR #80): a missing `workspace_role` row is a DENY for every role but `owner`.
  **Status: IMPLEMENTED-PENDING-VERIFY** — no independent Opus review has run on this head.
- **#19** (merged as `e11976f`) — the CI gates, `test:all`, the `check:*` scripts and the
  OpenAPI baseline described above, for issue #10. Nine remediation rounds surfaced real
  findings against the gate machinery itself (the review-scope list read from the working
  tree rather than HEAD, a note-binding check verifiable without expiring, a `waived`
  token satisfiable by negation) — all fixed and recorded in the decision log.
  **Uncorrected until now: #19 merged with its own `check:pr-template` gate FAILING**, on
  the identical two problems this document's own PR (#68) carries — an unticked
  independent-security-review checkbox and no committed note at
  `docs/07-planning/security-reviews/19-*.md`. Verified on the actual merged commit
  (`4c24b8a4`, checked 06:23:13Z; merged 06:22:54Z per `gh pr view 19`/`gh run view`). No
  decision-log entry records this as an authorised deviation the way
  [PR #13's is recorded](#process-deviation--recorded-corrected-not-waived) below.
  That is a gap in the record, not a claim that #19 is somehow unmerged — it is on `main`
  and its CI is green on every job that actually gates a push. Flagged here for the
  orchestrator; not something this lane may resolve by writing the note itself.
- A GitHub Project board (project 1, *TaskDesk v2 — P0*) with the six agreed columns.

### IN OPEN PR — read this from GitHub, not from here

**`gh pr list --state open`.** This section deliberately no longer enumerates open pull
requests, for the reason given in the header: the enumeration went stale within the hour it
was written, and correcting it consumed three independent review rounds while further
branches opened underneath it.

At the snapshot SHA above, what is durably true and worth recording:

- **Many pull requests merged on 2026-09-09 — the count is deliberately NOT stated here.** It
  moved three times while this very file was being corrected, and each move left a sentence
  false. `gh pr list --state merged` has it. What is durable, and the only reason to record
  anything, is that they fall into two groups with *different review bases*:
  - **The eleven up to `5270954`** — #64, #62, #65, #67, #19, #68, #63, #69, #71, #72, #73 —
    on top of #16, #21, #57, #60 and #61 earlier. **These are the waived set** (see below).
  - **Everything since `5270954`** — #78, #81, #79, #80, #84, #77, #83, #85, #92, #96 and #76
    as this was written, and more may have landed since — which did **not** use the waiver. Each carries committed review evidence at the tier its own
    changed files required, and the two tiers are recorded in **different places**:
    - **In security scope — #81, #79, #80, #77.** Independent **Opus** review, written up as
      a committed note in `docs/07-planning/security-reviews/`, named by pull-request number
      and declaring the exact reviewed head.
    - **Out of security scope — #78, #84, #83, #85.** Independent **Sonnet** reviews,
      recorded **in the pull-request bodies**, not as review notes. Do not read the absence
      of a file in `security-reviews/` as an absent review; read it as the classifier having
      put that change outside security scope.
  A count of merges "that day" is not the durable fact and an earlier version of this line
  claimed it was; the *review basis of each group* is.
- **Nothing in an open pull request is on `main`.** Do not describe it as available, and do
  not rebuild it. Check GitHub.
- **A branch existing releases nothing.** Only a merge releases a dependent retrofit stage,
  and the dependencies live in the
  [retrofit stage ledger](retrofits/organization-plugin-retrofit.md).

**The review state of what is on `main` is the part that does not go stale, so read it here.**
**The eleven up to `5270954`** merged under Thomas's explicit authorisation on the strength of
independent **Sonnet** review, with the mandatory **Opus** gate **waived**. Five touched
security-review-scope paths. No review note was written and no independent-review checkbox
was ticked. **That waiver was given once, for those pull requests, and does not carry
forward** — the eight merges since then each carry their own committed review evidence at the
tier their changed files required, and none invoked it. Since 2026-09-09 the template/security-review job is the **twelfth required status
check**, so a pull request can no longer merge without committed review evidence — see the
newest decision-log entry. Any findings from further security audits of `main`, and their
remediation status, are tracked as GitHub issues and pull requests — read them there
(`gh issue list --state open`, `gh pr list --state open`), not here.

### BLOCKED

- **#8** — **superseded 2026-09-16: its stated blocking reason no longer holds.** This
  bullet used to say the router retrofit waits for `organization()`'s removal surface to
  settle, because classifying a route about to be replaced is wasted review. **The full
  retrofit (S0–S10) is now landed** (see `## Throttle 1` above and the retrofit ledger) and
  `organization()` is unmounted — there is no longer a route surface still "about to be
  replaced." #8 itself is still **OPEN** on GitHub and was not otherwise assessed this
  pass (its full scope was not re-read), but the specific reason this bullet gave for
  keeping it blocked is gone. Whoever picks this up next should re-read #8 fresh rather
  than trust the stale framing below.
- **#17** — sessions already minted by the removed MCP OAuth and device flows. Deleting an
  endpoint is not revoking a credential; a consent click created a full 30-day session row.
- ~~Retrofit S7 (native role writes) — BLOCKED BY #82 AND #118~~ **UNBLOCKED, 2026-09-15.**
  **#66 is CLOSED** — PR #80 removed the privilege-restoration fail-open where
  `hasWorkspacePermission` fell back to the compiled built-in role definitions when a
  `workspace_role` row was absent, so a role an administrator had *narrowed*, or deleted,
  silently regained its built-in privileges. **#82 is CLOSED** — PR #110 reconciled the two
  authorization surfaces' disagreement on malformed multi-role values (PR #84 characterized
  the divergence; PR #110 remediated it, independently reviewed 2 Sonnet + 1 Opus, CLEAR).
  **#118 is CLOSED** — PR #122 added `UNIQUE (workspace_id, role)` to the database (migration
  `0051`) and PR #119 made both evaluators (`customRoleStatements`,
  `ownRoleStatements`) refuse rather than guess when a pair still resolves ambiguously;
  both independently reviewed 2 Sonnet + 1 Opus, both CLEAR, committed notes at
  `docs/07-planning/security-reviews/122-workspace-role-unique.md` and
  `docs/07-planning/security-reviews/119-workspace-role-evaluator.md`. `roles-and-permissions-ui.md`'s
  review section was already closed (PR #128). ~~S7 has no remaining precondition. It has
  not been implemented yet — this is the next critical-path item.~~ ~~S7 LANDED,
  2026-09-16 — PR #155. S10 (PR #107) is now the sole remaining step...~~ **SUPERSEDED
  2026-09-16: S10 also landed, as PR #161 (not #107, which stayed separate and held) — the
  retrofit is complete. See `## Throttle 1` above.**
- **#31 (P2 workflows) — blocked by AGENTS.md do-not 15.** `docs/03-features/workflows.md`
  is the subject of a *not-ready* review verdict — the verdict and its 4 High, 4 Medium and
  2 Low findings live in the review document, not in the spec itself, which has no review
  section — recorded in
  `docs/07-planning/reviews/2026-09-05/features-core-servicedesk.md` § 10, and a feature is
  not started while its review section is non-empty. `check:reviews` enforces it. The
  domain code exists on a draft pull request — check GitHub for it — and already satisfies three of the
  review's own recommended fixes, but **the first High is a data-model contradiction —
  workflows are workspace-scoped while states are project-scoped — that no agent may
  choose.** It needs Thomas.

### DECIDED / NOT YET IMPLEMENTED

- **SUPERSEDED 2026-09-16 — several bullets below described the retrofit as in-progress
  with `organization()` still mounted. That is no longer true.** S10 landed as PR #161
  (merge `6de483f`); `organization()` is unmounted; issue #6 is closed; Throttle 1 is open.
  See `## Throttle 1` above for the current, verified state. The bullets below are kept for
  their historical measurement detail (the call-site count table, the frozen N=9
  create-effect baseline) but their present-tense framing about what is "still mounted" or
  "not yet implemented" is stale — read them as history, not current fact.
- ~~better-auth `organization()` is removed in P0 — final. It is still mounted on
  `main`...~~ It is now actually removed — S10, PR #161.
- ~~Retrofit S0–S9 are COMPLETE... Only S10 remains... its tripwire gate is PR #107, which
  is blocked on a decision only Thomas can make~~ **All of S0–S10 are COMPLETE.** S10
  landed via its own PR (#161), independent of PR #107, which remains separately held.
  **What the client calls now — and this is stated as a command rather than a list, because an
  earlier version of this bullet enumerated it and got three of seven claims wrong:** run
  `grep -rn 'authClient\.organization\.' apps/web/src` for the live surface, excluding the
  `// Native replacement for authClient.organization.X()` comments, which is exactly the trap
  that produced the wrong list. The client **is** off the plugin for workspace CRUD writes
  (S4b), the reads S3 repointed (**enumerated in PR #76's own commit message** — not counted
  here, because a count written down here is the fourth thing in this one bullet to be measured
  wrong), and the role-change and ownership-transfer mutations (S5, repointed by S3). It is **not** fully off it for reads or membership writes.
  **This file states no standing count of remaining call sites**, and the reason is worth
  keeping: three successive attempts to write that number down — "fifteen", and two
  enumerations before it — were each measured wrong, because a naive grep counts the
  `// Native replacement for authClient.organization.X()` comments as live calls. What it names
  instead is the **method families**, which are checkable, and the tool that derives the sites:
  `pnpm check:organization-callers` (PR #107), a comment-aware scanner that fails closed on any
  shape it cannot analyse.

  **Four families remain**: `createRole`, `updateRole`, `deleteRole` and `listRoles`. All four
  are **S7's** to retire, released by #82 — but note that S7's original ledger scope was role
  *writes only* (`POST/PATCH/DELETE`), which would have left the `listRoles` **read** behind and
  the S10 zero-caller precondition unmet. S7's scope now explicitly includes the native role
  **list** route, and its rows say so; a review of this file caught the gap. Every other family is
  gone. Measurements at named commits, which cannot go stale because each row names its own
  tree (this is a record of measurements, not the standing count the bullet above refuses to
  keep):

  | Tree | Live call sites | Files | Families | What landed |
  | --- | --- | --- | --- | --- |
  | `3e78450` | 31 | 26 | 14 | the S3 baseline #100 was raised from |
  | `6bfc0f4` | 19 | 19 | 8 | #112 — S6a invitation writes |
  | `86c23b2` | 10 | 10 | 7 | #109 — S8a set-active |
  | `2aa6960` | **4** | 4 | 4 | #105 — #100's residual surface |

  Each figure was produced by two independent implementations agreeing: a comment-stripping
  counter, validated by reproducing the documented 31/26/14 on `3e78450` before being trusted
  on anything later, and #107's scanner.

  **#100 is NOT closed, and an earlier version of this bullet said it was.** #105 closed five
  of the six families #100 raised — `inviteMember`, `listMembers`, `removeMember`,
  `organization.list` and the two invitation reads — and its own "Not done" section states that
  it left **`listRoles` live**. #100 stays OPEN until that last family goes, and it goes in S7
  (see the S7 row, which now names the read route as well as the three writes). The claim was
  checkable and false, which is the worst kind to put in this file.

  ~~The remaining reason `organization()` is still mounted is S7... but S7 itself has not
  started~~ **SUPERSEDED 2026-09-16: S7 landed (PR #155), S10 landed after it (PR #161),
  and `organization()` is unmounted.** See `## Throttle 1` above.
- **The frozen organization-create baseline is N = 9 observable effects: eight first-order
  create effects plus one eventual, one-hop durable notification consequence.** The eight
  are the `workspace` row, the owner `workspace_member` row, the three seeded
  `workspace_role` rows, the `workspace.created` event, the default `team` row, its
  `team_member` row, and — on the **creating session's own row** — `active_organization_id`
  and `active_team_id`. The ninth is the `workspace_created` `notification` row, produced
  one hop from the event and asserted as **eventual**: its current pre-response timing is
  incidental and is explicitly **not** part of the contract. Derived by two independent
  methods (a full create-path source read, and a row-count diff across all 29 public
  tables) after the count had been wrong at four, six, seven and eight. Full statement in
  the [retrofit plan](retrofits/organization-plugin-retrofit.md) and the
  [decision log](decision-log.md); **S4 reproduced all nine on `main`.**
- **The OpenAPI baseline is `tests/api-contract/openapi.json`, committed and enforced.**
  `check:openapi` confirms it matches the live API (122 operations) on every push.
- **SUPERSEDED 2026-09-16 — Throttle 1 is OPEN.** The bullet below, describing condition 2
  as unmet and Throttle 1 as still shut, was accurate when written and is not accurate now:
  S7 and S10 both landed (PR #155, PR #161), `organization()` is unmounted, and issue #6 is
  closed. **See `## Throttle 1` above for the current, live-verified five-condition table —
  that section, not this historical bullet, is the one to trust.** Kept below for the
  history of how #3's required-status-check clause was resolved.
  - ~~#2 unmet — issue #6 needs the organization() retrofit through S10, and it has not run
    that far... organization() is still mounted end to end~~ **#2 is now met — S10 landed,
    #6 is closed.**
  - **#3 — corrected 2026-09-09.** This section previously said #3 was unmet because
    required-status-check reconciliation needed a ruleset change only Thomas could make.
    **Thomas made it**: `protect-main` (ruleset `22365005`, `updated_at
    2026-09-09T06:28:04Z`) now lists `route policy coverage + permission matrix` among the
    `required_status_checks`, `current_user_can_bypass: never` — verified by
    re-reading the live ruleset via the API, not by trusting the closing comment on #7.
    Issue #7 closed the same window (`closedAt 2026-09-09T06:29:48Z`). #3 is **met**, and
    was re-confirmed still met on 2026-09-16.
- **The four application-side gaps that stop v2 UAT coming up** — `TASKDESK_PORT` actually
  being read, live/ready health endpoints, Node static serving, a `storage.filesystem`
  driver — are **#11 prerequisites**. Ownership is assigned when they are scheduled.

**Screens:** 0 of **136** complete — [inventory](../02-design/screen-inventory.md)
(recounted 2026-09-05 with a kind column: P0 6 · P1 33 · P2 18 · P3 21 · P4 28 · P5 28 · P6 2)
**Features:** 0 of **31** shipped — [index](../03-features/README.md) (teams.md was missing from the index until 2026-09-05)
**ADRs:** 0001–0013 accepted · **Docs:** ~136 files, link check clean · **Security review:** see the breakdown below — the corpus is reviewed, the product is not
**Security status** — "complete" was a documentation claim being read as a product claim,
so it is broken out. Three of the seven have moved now that CI exists; four remain
out of reach until later gates:

| | |
| --- | --- |
| Architecture review | ✅ done |
| Threat model | ✅ done |
| Implementation review | 🟡 in progress — #16, #21, #57, #19 each carried independent review rounds; #16's, #21's and #13's are recorded in [security-reviews/](security-reviews/) as committed notes. **#19 merged with its own review checkbox unticked and no committed note** (see Blocked → Process deviation) — not yet recorded as an authorised deviation. #65 and #67 (native workspace routes) are **IMPLEMENTED-PENDING-VERIFY**, no independent review run on either head. Not a whole-product review |
| SAST / dependency scanning | ✅ **on `main` since #19.** `.github/workflows/ci-fast.yml` runs `pnpm audit --audit-level=high` and a dependency-audit job on every push and pull request; GitHub CodeQL and GitGuardian also run. Currently 2 moderate advisories, 0 high/critical |
| Authorization tests (route coverage, role × route matrix, tenant isolation) | ✅ `pnpm test:permissions` (74 tests) runs in CI via `check:route-policy` and is now a **required status check** on `main` (`protect-main` ruleset, updated 2026-09-09) — Throttle 1 condition 3 is met. Tenant isolation itself is still P0/#8 scope, not yet exercised |
| Internal red-team pass | ⬜ before the internal go-live gate |
| External penetration test | ⬜ before the first external paying customer (R19) |

**Readiness:** **Conditional GO → condition met.** The [external readiness review](reviews/2026-09-05/readiness-review-external.md)
asked for one documentation-closure PR before P0 code. **That PR was #3** ("apply the
confirmed pre-P0 decisions, and add CLAUDE.md"), merged 2026-09-06 as `1048844`, ahead of
the first P0 code in #13 (`18ae014`).
**Target calendar:** **Foundation Technical Preview** by 2026-09-12, go-live by 2026-10-03, full scope by end of
December 2026 — see [accelerated-delivery-plan.md](accelerated-delivery-plan.md). **This
is a target, not a deadline held under pressure** — the date is explicitly allowed to move;
the engine-pattern architecture and the security gates are what may not.

---

## Done

**Prior session — architecture and product decisions:**

- Analysed kaneo, Plane, OpenProject and TaskDesk v1
- Confirmed licences: kaneo MIT, Plane AGPL-3.0, OpenProject GPL-3.0. v2 is AGPL-3.0
- Locked the core decisions: kaneo as foundation (not forked), one backend, better-auth
  primary, two portals/two origins, everything pluggable, every route declares a policy,
  SLA computed on read
- Wrote ADRs 0001–0010 and the full documentation corpus — roughly 65 documents

**This session — continued after the OpenAI agent and GitHub Copilot both hit usage
limits, then GitHub Copilot too, then handed to Claude Code:**

- **Reviewed the six additionally cloned ITSM systems** (chatwoot, freescout, glpi,
  nocobase, osTicket, zammad) against their actual licences and architecture, added to
  [competitive-inspiration.md](../00-overview/competitive-inspiration.md) and
  [licensing-and-attribution.md](../00-overview/licensing-and-attribution.md). Zammad's
  configurable ticket-state model was the most directly validating find.
- **Wrote ADR 0011** — one generic lifecycle engine for every work item type, states and
  transitions fully data-driven, only a five-value `group` fixed in code.
- **Wrote ADR 0012** — a terminology overlay so domain nouns ("Ticket", "Project", "Cycle")
  are renameable per instance, separate from state naming.
- **Wrote ADR 0013** — marketplace listing and usage metering as an optional `license`
  plugin, never a default, keeping the self-hosted/no-phone-home promise intact.
- **Generalised the plugin pattern into "the engine pattern"** in
  [plugin-architecture.md](../01-architecture/plugin-architecture.md) — every feature, not
  only the (then six, now seven) plugin kinds, is expected to follow the same shape: contract,
  registry or settings screen, generated configuration, a feature flag, a validate/test
  affordance.
- **Reconfirmed and extended customer self-service**: customers already could raise,
  comment, escalate, approve-what's-addressed-to-them, reopen and rate their own requests;
  added the one genuine gap — **withdrawing** a submission before triage (`CP-15`,
  `IQ-16a`).
- **Added a three-tier reporting model** to
  [reports-and-dashboards.md](../03-features/reports-and-dashboards.md): fixed reports
  (unchanged), selectable row-and-column reports (a named, saved Table view), and a small
  customisable report builder — all three persisted through the existing `saved_view`
  mechanism, no new engine.
- **Corrected the tech stack against actual current status, not memory**: PostgreSQL
  16 → 18, Valkey 8 → 9, OpenAPI 3.1 → 3.2 target, and — the significant one — **dropped
  MinIO as the shipped default** after confirming its open-source edition was effectively
  wound down through 2025–2026, replacing it with SeaweedFS (default) and Garage
  (AGPL-aligned alternative). Confirmed Node 24, Traefik v3 and Keycloak 26 remain correct
  as-is. Noted kaneo's emerging Base UI dependency for action at fork time, not before.
  *(Later the same day: Base UI decided as the primary primitive standard — decision N;
  Keycloak moved out of core scope, Microsoft Entra only.)*
- **Specified the one-line installer** (`curl \| bash`) in
  [one-line-install.md](../05-operations/one-line-install.md) — a thin, checksum-verified
  bootstrapper around the existing `scripts/deploy.sh`, with a documented offline path.
- **Specified the AWS Marketplace listing** in
  [aws-marketplace.md](../05-operations/aws-marketplace.md) — container-product listing
  type (not SaaS, not AMI), mandatory automatic security scanning, metering via AWS
  Marketplace Metering Service, Helm chart submission requirements, and the AGPL
  buyer-obligation note, researched against AWS's current seller documentation. *(Later
  the same day: the listing was deferred beyond the current scope and a BYOL/contract
  model preferred over metering — see the decision log.)*
- **Added RBAC/API, OpenAPI-contract and MCP test layers** to
  [testing-strategy.md](../04-engineering/testing-strategy.md), plus a named
  cross-feature "task and work-item lifecycle" test suite.
- **Recorded a model-tier policy** for Claude Code's own subagent orchestration in
  [agent-workflow.md](../04-engineering/agent-workflow.md): Sonnet 5 implements against an
  approved spec; Opus or Fable plans and reviews; **security review is Opus, always, not
  negotiable against schedule.** Wired into [SDLC](../04-engineering/sdlc.md) step 5 and
  the stage gate.
- **Wrote the accelerated delivery plan**
  ([accelerated-delivery-plan.md](accelerated-delivery-plan.md))** at Thomas's explicit
  request — a dated Sept–Dec 2026 calendar mapping the full P0–P7 scope in parallel
  workstreams, with every quality-gate compression named in an explicit deferral register,
  sitting alongside — not replacing — the no-dates [phases.md](phases.md). Revised the
  same day once Thomas clarified the calendar is a target, not a deadline under pressure.
- **Added `CHANGELOG.md`** and a release-notes convention in
  [ci-cd.md](../04-engineering/ci-cd.md) tying the changelog, the screen inventory and the
  feature index together at every stage close.

---

## Next

**#19 merged, and the required-check/ruleset reconciliation is also now done** — Thomas
updated `protect-main` while this document was being corrected, and #7 closed the same
window. Throttle 1's conditions 1, 3, 4 and 5 are now all met. **The critical path is
issue #6 alone**. **S3 and S5 have both since shipped** — this sentence previously named them
as the critical path, which was true when written and is not now; the remaining steps are
**S7 and S10** (S9 landed 2026-09-15, PR #104). #6 closing is what opens Throttle 1.

**S5 has since shipped** (PR #77), as has **S4b** (PR #85) — an earlier version of this
section listed S5 as "not next, deliberately", which is no longer true. The principle behind
that note still holds: landing one stage does not start the next, each needs its own
scheduling decision. Issue **#6 stays OPEN / In Progress** with S7 and S10
outstanding (S9 landed 2026-09-15). **#7 is now
CLOSED** (2026-09-09) — the registry, evaluator, route-coverage gate and the required-
status-check reconciliation are all done; #6 is the only issue left keeping Throttle 1
closed.

**P0 · Foundation.** Order matters — the gates go in before the features. Two things
changed on 2026-09-06: a **step 0** (spec closure — done, see [phases.md](phases.md#p0--foundation))
now precedes step 1, and the **kaneo router retrofit** is named as P0's largest security
task with its own Opus review:

0. Spec closure — items 1–3 (data model authoritative, five policy kinds, week-one
   documents, threat model) **done 2026-09-05**; item 4 — each spec's remaining findings in
   [reviews/2026-09-05/](reviews/2026-09-05/) — is a **standing gate at that feature's SDLC
   step 2**, not a completed step ([AGENTS.md](../../AGENTS.md) do-not 15)
1. Initialise the repository — **only after the licence pull request merges and the P0
   issues exist**: `git fetch`, run
   kaneo's own suite on that SHA as the baseline, copy per the exhaustive table, de-brand
   **including the environment migration table**, apply the **fork-time removal and disable
   list** (anonymous sign-in, account linking, cookie cache, `deviceAuthorization`/`bearer`,
   `public-project` by file, the six integration plugins and their tables, billing, Sentry,
   planka-import, kaneo's agent files); fill the inherited-features register
1b. **Retrofit every inherited kaneo router into the five policy kinds** — human-reviewed,
   router by router; Opus security review before P0 closes
2. `LICENSE`, `THIRD-PARTY-NOTICES.md`, `NOTICE`, `AGENTS.md`
3. Extract `packages/ui`; Tailwind preset; Storybook running
4. Split `apps/web` into agent and portal entries
5. Scaffold `packages/domain`, `packages/permissions`, `packages/plugins-contracts`
6. Route registry with the round-trip test
7. **Policy registry, route coverage test, permission matrix test** — the anti-v1 controls
8. CI pipeline with every gate, including the new contract and MCP test layers
9. UX gate scripts: tokens, ui, deps, bundle purity
10. Playwright projects; Testcontainers harness; seed scripts
11. Dockerfile, compose, Traefik, `scripts/deploy.sh`, **and the `install.sh` bootstrapper**
12. Observability: Pino, Prometheus, health endpoints
13. `apps/site` skeleton
14. Sign-in, MFA, not-found, error boundary

If the [accelerated delivery plan](accelerated-delivery-plan.md) is being followed, this
is also **week 1** of that calendar, targeting the **Foundation Technical Preview** by
2026-09-12 — a technical preview of the foundation, not a user-acceptance milestone; the
UAT *environment* keeps its name.

**Exit criteria:** builds, deploys locally on three hostnames, every CI gate green **with
kaneo's inherited routes present and each carrying a policy**, P0 security review signed off.

---

## Blocked

### Open decision — #192, work-item tenant attribution (blocks the P1 write path)

**Awaiting Thomas.** Presented as issue #192's decision request on 2026-09-18: four options
(denormalise `work_item.workspace_id` with a composite `(workspace_id, type_id)` foreign key
and `ON UPDATE NO ACTION`; application-level enforcement only; a trigger; and adding
`workspace.organisation_id` as a separate prerequisite), with the tenancy implications,
migration effects, concurrency risks and a proposed direction. **No agent may pick this — it
creates a trust boundary.** The recommendation on the issue is the denormalised column plus
the `workspace.organisation_id` link, as one bounded pre-write-path schema change, because it
releases three blocked things at once: #192's cross-tenant gap, the RLS prototype, and #198's
project purge. It also needs a **new** `UNIQUE (workspace_id, id)` on `work_item_type`, which
does not exist today.

### Opus security reviews — capacity, not permission

**#214 and #215 are in security-review scope and their Opus passes have not happened.**
Claude was unavailable throughout this session, and `CLAUDE.md` is explicit that capacity
exhaustion means the candidate **waits** — it is not downgraded to an available model and it
is not cleared by a non-independent context. Both are marked
`SECURITY REVIEW PENDING — OPUS CAPACITY`, neither security-review box is ticked, and neither
may be merged by anyone, including the orchestrating session: the delegation to merge a
green candidate explicitly does not cover a candidate whose security review has not been
performed. Ordinary review capacity itself was also intermittent — the subagent provider
returned budget-exhausted (403) and connection-reset errors across several attempts, so
reviews of the other open candidates are queued rather than done.

### Process deviation — recorded, corrected, not waived

**PR #13 merged on 2026-09-06 before its mandatory security review had been performed.**
This was a **process deviation, not an approved waiver.** A post-merge Opus security review
was run immediately over the merged diff — five independent reviewers, one lens each,
reading the source rather than the pull-request description. Findings are recorded in
[`security-reviews/13-kaneo-import.md`](security-reviews/13-kaneo-import.md) with the five
lens files beside it, and on PR #13 itself.

It found **three CRITICAL** defects, **all three now fixed** on
`feat/p0-remove-inherited-surfaces` before Throttle 1: a missing `TASKDESK_AUTH_SECRET`
silently falling through to a constant published in better-auth's source; credentialed CORS
reflecting any origin whenever `NODE_ENV` was not exactly `"production"`; and `bearer()`
publishing the raw session token in a CORS-exposed header. One HIGH was fixed in the same
pass. **From now on a security-path pull request does not merge until its review is
recorded on it** — and once #10 lands, the fast CI job becomes a required status check so
this stops depending on anyone remembering.

**Corrected 2026-09-09: #10 has landed (as #19) and the prediction above is only half
true.** `check:pr-template` on PR #19's own final commit (`4c24b8a4`) reported exactly the
two problems this rule exists to catch — an unticked independent-security-review checkbox
and no committed note — and **failed**, one second before Thomas merged it (`e11976f`,
06:22:54Z). No decision-log entry records this as an authorised deviation the way #13's is
recorded above.

**The fast CI job is now a required status check — but not the part that would have
caught this.** `protect-main` (ruleset `22365005`) gained a `required_status_checks` rule
during this same reconciliation pass (`updated_at 2026-09-09T06:28:04Z`), closing Throttle
1's condition 3. Its list, re-read directly from the API, is `static`, `unit + component`,
`build`, `registers - env, vocabulary, reviews, skips, overrides`, `route policy coverage +
permission matrix`, `gate checkers + red probes`, `contract - OpenAPI drift`, `CI matches
ci-cd.md`, `supply chain - dependency audit`, `supply chain - secret scan`, `helm lint +
template` — and, **since later on 2026-09-09, `pull request template + security review` IS
the twelfth required context**, on Thomas's explicit instruction. So the exact gap #19 fell
through — a security-path pull request merging with its review checkbox unticked and no
committed note — **is now mechanically blocked** by GitHub. "Stops depending on anyone
remembering" describes all twelve gates. **This paragraph said the opposite until it was
corrected**, which is why it is worth reading the newest decision-log entry rather than this
file's older prose.

### Open

- ~~**`gh` is not authenticated.**~~ **RESOLVED 2026-09-06.** `gh` is authenticated and
  carries the Project scope. Pull requests are opened from the CLI, the PR #13 review is
  posted, and the Project board exists — project 1, *TaskDesk v2 — P0*, with the six
  agreed columns. Kept as a line rather than deleted because it was the top blocker for a
  day and its absence changed how several things were done.
- ~~**#6 must relocate the SSRF guard before it deletes anything.**~~ **RESOLVED by #16
  (2026-09-07).** `assertPublicWebhookDestination` now lives at
  `apps/api/src/utils/assert-public-destination.ts`, and both retained importers —
  `notification-preferences/delivery.ts` and `service.ts` — point at it there. The
  validation was moved, not dropped, which was the failure mode this entry existed to
  prevent. Kept as a line because the ordering rule still applies to every future removal.
- **Deleting the MCP OAuth route does not revoke the sessions it already minted.** A consent
  click created a full 30-day better-auth session row. #6 removes the route; something else
  has to invalidate outstanding tokens. **Tracked by #17.** *Blast radius: one lane.*
- ~~**`scripts/openapi/` has no destination.**~~ **DECIDED 2026-09-06** (decision log):
  the committed baseline the drift check compares against is
  `tests/api-contract/openapi.json`; a published `apps/site/public/openapi.json` is
  generated output, not the baseline. **RESOLVED, on `main` since #19 (2026-09-09).**
  `scripts/ci/check-openapi.mjs` and the baseline file are on `main`, and the `contract -
  OpenAPI drift` job passes on every push (122 operations, verified with `check:openapi`).
  *Blast radius: one lane.*
- **v2 UAT is not deployable yet, and the remaining reasons are application-side.**
  **All four numbered gaps below are now CLOSED** (`TASKDESK_PORT` and the health routes by
  PR #132, static serving by PR #144, `storage.filesystem` by PR #164 — all 2026-09-16 or
  earlier) **and independently verified end-to-end** — see the "UAT/deployability lane" table
  in `## Scheduler`, above, and this session's newest log entry for the from-scratch
  boot/health verification. Kept below as the historical record of what #11 actually needed,
  not as current state.
  The deployment skeleton is **ON MAIN** — PR #20 merged 2026-09-06 as `38ff9ac`. A
  `Dockerfile` that builds, base + local + production + UAT compose files, Traefik
  middlewares, a hardened `charts/taskdesk` that fails closed on every bootstrap secret,
  and `scripts/deploy.sh`. `Dockerfile.kaneo` is deleted.

  **#20 merging did not complete #11**, which stays **In Progress**. What is still missing
  is in the application, not the deployment:
  1. **The API listens on a hard-coded `1337`** (`apps/api/src/index.ts`, `startServer(…,
     port = 1337)`). `TASKDESK_PORT` is documented but never read, so the image, the
     compose files, the Helm Service and the healthcheck all point at 5173 and nothing
     answers.
  2. **`/api/public/health/live` and `/api/public/health/ready` do not exist.** The only
     health route is kaneo's `/api/health`. Until they do, the container's HEALTHCHECK can
     never pass and `up -d --wait` blocks on it — which is exactly the failure
     [container-image.md](../05-operations/container-image.md) warns about.
  3. **The Node process serves no static files.** kaneo used nginx; the TaskDesk image has
     none, by design. The web bundles ship at `/app/public` and nothing reads them.
  4. **There is no `storage.filesystem` driver.** `apps/api/src/storage/` contains only
     `s3.ts`. The compose and Helm shape for it exists (a named volume at `/app/data`,
     attachments under `/app/data/attachments`, owned by uid 10001); the driver, and the
     God Mode setting that points at that path, do not.
  **These four are #11 prerequisites, or dedicated prerequisite work — they are NOT
  automatically #6 or #9 scope.** An earlier revision of this file assigned them to Lane A
  and #9; that was inference from where they were noticed, not a decision. Implementation
  ownership is assigned when they are scheduled (decision log, 2026-09-06). **v2 takes
  `ticket-v2-uat.bimats.com` / `portal-v2-uat.bimats.com` beside v1**, with its own compose
  project, network, volumes and database. **v1 UAT stays running and untouched**, and the
  pre-#6 import must not be exposed publicly — `deploy/compose.uat.yml` carries a
  do-not-apply banner saying so. *Blast radius: the deployment lane, then UAT.*
- **`X-Forwarded-Proto` reaching the application on the bimats.com host is wrong or
  attacker-controlled, and the fix is at CloudFront.** TLS terminates at CloudFront, so
  Traefik's `web` entrypoint is plain HTTP: it forwards a viewer-supplied
  `X-Forwarded-Proto` verbatim, and sets `http` when none arrives. Either way the
  application cannot learn that the viewer used HTTPS. Set an origin custom header
  `X-Forwarded-Proto: https` on the distribution. Evidence and method:
  [proxy-topology-evidence.md](../05-operations/proxy-topology-evidence.md).
  *Blast radius: anything that issues a secure cookie or builds an absolute URL, on that
  host only.* Unblocked by: Thomas (AWS console).
- **A standalone production host has no ACME configuration**, because Let's Encrypt needs a
  contact email and there is no environment variable for one —
  [configuration-reference.md](../05-operations/configuration-reference.md)'s "variables the
  application does not read" table lists four, and none is an email. It was raised rather
  than invented. It does not block this host, which terminates TLS at CloudFront.
  *Blast radius: a future customer install on a bare host.* Unblocked by: Thomas.
- ~~**The GitHub Project board does not exist.**~~ **RESOLVED 2026-09-06**, with the `gh`
  authentication that caused it. The board exists — project 1, *TaskDesk v2 — P0*, with
  the six agreed columns, and is listed under ON MAIN above.

---

## Throttle 1 — OPEN (2026-09-16, all five conditions verified live)

**Opened 2026-09-16**, the same day S10 (PR #161) merged and issue #6 was closed. Every
condition below was re-verified directly against GitHub and live source at that moment —
not rounded up from an earlier partial state, and not inferred from S10 merging alone.
Issue #6's own real checklist (the full fork-time removal list, not just the
organization-plugin retrofit — see its closing comment) was checked item by item against
source before closing it.

| | Condition | State |
| --- | --- | --- |
| 1 | **#5** complete | ✅ merged as PR #13, closed |
| 2 | **#6 — the ISSUE** complete | ✅ **closed 2026-09-16.** S10 (PR #161) unmounted `organization()` — the last of S0–S10. Every other item in #6's actual checklist (inherited auth defaults, `public-project` incl. its two-phase column drop, six integration plugins, billing tables, Sentry, `packages/planka-import`, kaneo's `mcp`/`oauth` routers) verified against live source, not assumed from the checklist's own stale boxes. One literal "Done when" clause (octokit absent from the lockfile) resolved as a false positive — the 54 remaining `@octokit/*` lockfile entries are entirely a transitive dependency of `@semantic-release/github`, unrelated to the deleted integration plugin (`pnpm why @octokit/core`) |
| 3 | **#7** complete | ✅ **met — issue closed 2026-09-09** (`closedAt 2026-09-09T06:29:48Z`). #21 put the registry, evaluator and route-coverage gate on `main`; #19 put `pnpm test:permissions` (74 tests) in CI via `check:route-policy` on every push and pull request. The last open clause — both tests **required status checks** — closed when Thomas updated `protect-main` (ruleset `22365005`): `route policy coverage + permission matrix` now sits among 11 entries in `required_status_checks`, `strict_required_status_checks_policy: true`, `current_user_can_bypass: never` (`updated_at 2026-09-09T06:28:04Z`, re-read directly from `gh api repos/.../rulesets/22365005`, not taken from the closing comment's word) |
| 4 | route coverage **actually executes** in CI | ✅ **met.** `.github/workflows/ci-fast.yml`'s `route-policy` job runs `pnpm check:route-policy` on every push and pull request. Re-confirmed 2026-09-16 that `route policy coverage + permission matrix` is still present in `protect-main`'s `required_status_checks` |
| 5 | adding a route without a policy **fails the build** | ✅ **met, demonstrated rather than asserted.** `scripts/ci/probes/*.test.mjs` (run by `pnpm test:ci-scripts`) inject an unclassified route into the actual running router and CI machinery and assert the gate turns **red**. Re-confirmed 2026-09-16 that these probe files still exist and are untouched by the S10 change |

**Four plugin-specific defect issues verified and closed alongside #6**, per the explicit
instruction to check each was genuinely unreachable rather than assume so because the
plugin import disappeared: **#88** (duplicate membership rows — native `accept-invitation`
has its own explicit lock-and-check fix, not just the plugin's removal), **#108**
(prototype-key role name 500 — native already denied cleanly, now with a regression test),
**#124** (plugin update-member-role minting a second owner — native path's owner-count and
comma-aware-role fixes predate S10 and were verified independently), **#136** (plugin
has-permission UNIONing duplicate role rows — native `workspaceRolePermission` already
fails closed on any ambiguity, pinned by its own non-vacuity test). Each issue's closing
comment carries its own evidence.

**PR #107** (the caller-count-scanner CI safety net S10 was told not to depend on) remains
open and held — a separate matter, per Thomas's own 2026-09-16 decision, not a condition of
this throttle.

**Now that Throttle 1 is open**, P1–P7 lanes may run in parallel per `CLAUDE.md`'s
"Parallelizing P1–P7 once Throttle 1 opens" section — subject to the UAT-deployability gaps
in `## Blocked`, above, which are a separate, still-live concern.

---

## Open decisions

| Decision | Deadline | Owner |
| --- | --- | --- |
| **PR #107** (a CI safety-net scanner, held per Thomas's 2026-09-16 decision, no longer a Throttle 1 dependency now that S10 has landed via its own PR with independent caller verification): how to proceed with `scripts/ci/lib/organization-callers.mjs` after seven false-zero bypasses found across three Opus rounds — accept the current residual-risk profile with the gaps documented, redesign the scanner's approach, or authorize another remediation round despite the recurring pattern | Whenever convenient — not urgent | Thomas |
| CLA, for a possible dual licence | Before the first external contribution | Thomas |
| Final product name | Before P7 | Thomas |
| ~~Whether to sell externally~~ | Decided: yes — but the **AWS Marketplace listing itself is deferred beyond the current 3–4-month scope** (2026-09-05); BYOL/contract preferred when it comes — see [decision log](decision-log.md) | — |
| Docs-site stack — fresh Fumadocs app (recommended) / kaneo's marketing site + `/docs` / Mintlify | Before P0's `apps/site` skeleton | Thomas |
| Visual-regression tool for gate G8 — Playwright `toHaveScreenshot` with in-repo baselines, or Chromatic | Before P0's UX gate scripts | Thomas |
| Gate consolidation in release-plan.md — confirm as a waiver or revert | Before `2.0.0` | Thomas |
| WAL archiving for point-in-time recovery | Before real customer data | Thomas |
| Whether the 4-week go-live scope needs to narrow | Escalate the moment workstream A (service-desk domain logic) looks behind, per [accelerated-delivery-plan.md](accelerated-delivery-plan.md#what-happens-if-week-4-looks-tight) | Thomas |

---

## Watch list

Risks currently most likely to bite. Full list in [risks.md](risks.md), now with seven
additions — **R15–R17** for the accelerated calendar, **R18** marketplace integrity, **R19**
pentest lead time, **R20** the kaneo router retrofit, **R21** inherited authentication
defaults surviving the fork.

| | Risk | Why now |
| --- | --- | --- |
| **R15** | Workstream A (SLA/workflow/approvals port) can't realistically finish in the compressed window | It is the schedule's critical path, named on day one |
| **R2** | Stage discipline collapses | The accelerated plan deliberately runs stages in parallel — the discipline that must survive is the deferral register, not stage sequencing |
| **R1** | UX failure repeats | P0 is where the guards are installed or are not, on any calendar |
| **R17** | Parallel workstreams reproduce three-inconsistent-codebases faster than usual | Cross-agent review and CI-enforced vocabulary matter more, not less, under this pace |

---

## Session log

Newest first. One entry per working session.

### 2026-09-24 · P0 continuation — reviewer substitution recorded; shadow-scope findings fixed

Thomas authorized current GPT-6 Luna contexts for Sonnet-tier implementation and ordinary
review on active P0 work; the final independent Opus 5.5 security review remains mandatory.
The decision is recorded in the P0 CI lane's decision log; no security review is claimed.

On #324 / PR #354, three independent ordinary reviews of `c611f190` identified two missing
acceptance-evidence items and a project-scope provenance defect. Fixed the evaluator to track
the addressed project ID's provenance separately from the workspace ID, retained the
explicitly unevaluated `reach_unavailable` result where project reach facts do not exist,
and added a permissive shadow-policy denied-param integration probe. Focused checks on the
updated working tree: API typecheck, 31 shadow evaluator unit tests, 15 shadow-mode
Testcontainers integration tests, Biome, Docker image build, isolated Compose migration and
boot, liveness/readiness probes, and `git diff --check` pass. Three fresh independent
ordinary reviews passed the source/test remediation; a lightweight review of the final
comment-only clarification also passed. The #324 per-router before/after deployed-traffic
coverage report is still unavailable; no synthetic result is represented as deployed
evidence, so that acceptance item remains open. The workflow checks have not refreshed on
the current stacked-PR head; the previous head's CI was green apart from its pending Opus
gate. The current GitGuardian check flags the non-secret Helm key name `migration-password`
in the stacked DB-role change, and the GitHub Advanced Security action failed because its
requested model is unsupported; neither has been suppressed or represented as passing.

On #10 / PR #355, the documented root `pnpm test:e2e` command was missing from `package.json`.
Added the root alias and aligned CI and the `test-all` manifest to call it. The protected
route smoke passes locally through the documented root command. Commit `0f10f04` is pushed;
three independent ordinary delta reviews pass. Exact-head CI is being refreshed; the
mandatory Opus 5.5 review remains pending.

`claude auth status` reports logged out, so Opus capacity is unavailable here. Continue
other runnable P0 work; keep every security-scope candidate blocked from merge until its
exact-head Opus review is recorded.

### 2026-09-23 (third pass) · 11 more PRs merged; spec gates honoured, not routed around; an outage recovered cleanly

This pass shows the gates working as designed. `check:reviews` blocked #274 and #275
because specs they depended on still had stale open review findings. Each time, the answer
was to close those findings properly: #282 for comments-and-activity, #283 for approvals and
assignment, #278 for design-system, where Thomas made the three dependency picks. The Spec
field was not edited to get past the gate. The one case where editing it *was* right went to
Thomas (#274), and he chose "both".

Review caught real defects before merge:
- a TRUNCATE bypass of the audit trigger;
- false-tamper verification;
- undeletable workspaces;
- fail-open customer visibility;
- misattributed API-key actors;
- hollow focus tests;
- an invented spec rule.

An org spend-limit outage mid-session was recovered with nothing lost. A mutated file was
caught before commit.

### 2026-09-23 · #271 and #274 merged; Opus 5.5 default; activity-table decision; three blockers caught before merge

Three separate reviews each caught something that would have shipped:
- the alignment check found priority gated by the wrong capability (#271);
- Opus 5.5 found edits allowed on soft-deleted projects (#271) and undeletable workspaces
  from `ON DELETE RESTRICT` (#275);
- a real-browser check found `packages/ui` styles silently missing (#274).

Unit and integration suites were green in every case. The `resolveVisibility` mapping in
#275 hit the same fail-open class three rounds running, so per AGENTS.md "stop patching and
change altitude" it is being rebuilt as a data allowlist of exact `(verb, field)` pairs,
with an independently computed exhaustive test, rather than patched a fourth time. Thomas
decided the activity-table shape and #274's spec-citation path. Everything else was decided
under the new standing delegation and recorded in the decision log.

### 2026-09-22 · #18 merged after three Opus security-review rounds; all four eleventh-pass P0 defects now closed

Continuing the same day as the entry below. PR #227 (#18's setup-token flow) was
implemented and independently tested (see the entry below), then went through the full
three-round review tier the entry below already explains why it needed. What actually
happened in that tier is worth recording in full, because it is the clearest demonstration
this session produced of why the tier exists.

**Round 1 (mandatory Opus, first pass): CHANGES NEEDED — one blocking finding.** The fix
replaced an unconditional "first signup becomes admin" bypass with a token-gated one, and
its own stated goal was that `GET /api/instance/status` no longer lets anyone scan for an
unclaimed instance. The reviewer found that goal was not actually met: the new zero-user
refusal's error message differed from an ordinary registration refusal, so one
unauthenticated request could still tell an unclaimed instance from a claimed one — and the
message *named* `TASKDESK_BOOTSTRAP_ADMIN_EMAIL` as the next thing to try. Fixed by reusing
the ordinary refusal message unconditionally.

**Round 2 (delta-confirmation, second Opus pass, fresh context): CHANGES NEEDED again —
found the round-1 fix was itself incomplete, in two different ways.** First: the fix
hard-coded one message, but the ordinary refusal path (`checkRegistrationAllowed`) actually
has *two* different messages depending on whether an invitation was attempted — and a
claimed instance can return either, while the zero-user path used to always return the one
fixed message. Adding an `invitationId` field to the same request reopened the identical
oracle round 1 had just closed. Second, and unrelated: a separate, non-blocking finding
from round 1 (a Unicode case-folding trick using U+212A KELVIN SIGN, which reads as a plain
"k" to a human but is a different character) had also been "fixed" with `.normalize("NFKC")`
before lowercasing — except NFKC normalizes that exact character to "K" *first*, so the same
false match still happened one step later. The regression test for that finding was ALSO
wrong, comparing two different-length strings, so it would have passed regardless of
whether the bug was present. Both re-fixed: the refusal message now always comes from the
same `checkRegistrationAllowed` call regardless of claimed/unclaimed state, and Unicode
normalization was replaced with a plain ASCII-only case fold that cannot touch U+212A at all.

**Round 3 (second delta-confirmation, third fresh Opus context): CLEAR WITH FINDINGS.**
Verified both fixes adversarially — real HTTP requests against a real database across five
different request shapes for the first, and against five different Unicode confusables
(not just the one originally found) for the second — and found nothing further blocking.
Two new non-blocking observations, neither introduced by the fix: a narrower residual
oracle via a different registration-control env var, and a note that the regression tests
for this whole class of finding exercise a different code path than a real deployment's
request-handling middleware (the invariant holds either way; verified directly).

**Why this is being written up in this much detail**: this project exists because TaskDesk
v1 shipped eleven authorization holes past a green test suite. This session's own directive
was speed — one review round where possible, Sonnet for implementation, Opus only for the
mandatory pass. That directive was followed everywhere it was safe to follow, but "one
round" meant one round that actually closes the finding, not one round regardless of what
it finds: **#17**'s single mandatory Opus round found its own real, blocking bug (the
revocation migration's timezone-comparison defect, described in its own entry above), fixed
and delta-confirmed clear in a second pass — a genuine finding, not bookkeeping. **#146**'s
single Opus round was clean on the substance (CLEAR WITH FINDINGS, all non-blocking); the
extra confirmations recorded on that PR were plain main-sync bookkeeping (verifying an
unrelated merge didn't touch the reviewed files), not additional findings. **#18** needed
three real rounds, and the reason was never "process for its own sake" — every one of them
found something a fourth would not have caught by assumption alone. Two smaller follow-ups
from round 3 are tracked as issue #232; the round-1/round-2 findings are fully closed, not
deferred.

Four follow-up issues filed against this PR, all pre-existing or narrower-than-before gaps
rather than regressions: **#229** (no MFA enrollment on the setup page — no MFA plugin
exists anywhere in this repo), **#230** (no `grant-instance-admin` recovery CLI — no CLI
entrypoint exists anywhere in this repo), **#231** (a liveness gap: two armed bootstrap
mechanisms racing concurrently can leave an instance with zero admins, never two — a
smaller, better-scoped fix than a fifth review round on this PR), **#232** (the narrower
residual oracle plus the test-coverage note from round 3).

---

### 2026-09-22 · Three of the four dispatched P0 fixes merged, the fourth in a full review tier

Continuing the same day as the entry below. Thomas's direction for this stretch: parallelize
P1–P7, one ordinary review round rather than several, Sonnet for implementation, Opus for
the mandatory security pass, and retake the P1/P2 lanes previously held by other coding
agents (Copilot/DeepSeek, Cline/GLM) — reviewing their work rather than trusting it
unverified, since Thomas does not have independent confidence in its quality.

**Backlog review, PRs #213–#219**: reviewed and merged (a missing OpenAPI 404 declaration
found and fixed in #216; a mismatched doc-comment/test-name pair in #218; a test that only
ever exercised UTC despite claiming to verify non-UTC behavior in #219; a real
`consumedPct >= 100` boundary bug in #209 contradicting `sla.md`'s stated inclusive/exclusive
split for `at_risk`/`breached`, found, fixed, and regression-tested). PR #210 (a stale P2
lane-coordination ledger whose body no longer matched its own diff) closed as superseded
rather than resurrected — nothing referenced it and its coordination model no longer applies
now that this session drives P1/P2 directly.

**The four eleventh-pass P0 defects**: three merged this session.
- **#146** (PR #223) — Thomas made the fix-direction call the issue itself required
  (continue hardening `pr-body.mjs`'s existing pattern vs. a `remark`/`micromark` rewrite;
  recorded in the decision log above the P187 entry) — chose to ship the hardening fix.
  Mandatory Opus review: CLEAR WITH FINDINGS (non-blocking); three minor follow-ups (F1, F2, F4) tracked
  as issue #226.
- **#17** (PR #225) — the mandatory Opus review's first pass found a real, blocking bug: the
  revocation migration compared a `timestamp without time zone` column against a
  `TIMESTAMPTZ` literal, which is server-`TimeZone`-dependent and would under-invalidate on
  a non-UTC server (proved live under `America/New_York`). Fixed to a naive `TIMESTAMP`
  literal; delta-confirmed CLEAR across 5 timezones and 5 `DateStyle` settings by a second
  independent Opus pass, plus an independent ordinary Sonnet review (the orchestrating
  session could not self-certify this one, having performed the fix).
- **#97** (PR #224) — the logged-out redirect guard threw on `location.search`'s
  null-prototype object (from `@tanstack/router-core`'s `qss` decode); fixed to use
  `location.href`, plus a new root `errorComponent` as a last-resort catch-all.

**#18** (PR #227) — implemented and independently tested by the orchestrating session (64
files/577 tests integration, 48/323 unit, 10/79 permissions unchanged, 57/236 web; all
clean), but **not yet merged**. This one is going through the full three-round tier
(ordinary Sonnet review + a project-alignment check + the mandatory Opus security pass, all
in parallel) rather than the reduced one-round tier Thomas asked for elsewhere this session
— it redesigns an authority invariant (who can become the first instance admin), crosses a
migration, the API and the frontend in one change, and involves real concurrency reasoning
(a race between the pre-insert token check and the post-insert admin-promotion lock). This
is `AGENTS.md`'s own review-tier table applied by risk, not a shortcut.

**Two migration-numbering collisions, both from parallel same-day work**: #17's fix
generated migration `0059` in an isolated worktree, which collided with PR #215's `0059`
merging to `main` first; renumbered to `0060` via a fresh `drizzle-kit generate` (not a
hand-rename) so the journal/snapshot chain stayed derived rather than authored. The same
then happened to #18 once #17's fix claimed `0060` — renumbered again, to `0061`, the same
way. Neither renumbering changed the actual migration content; both were verified
byte-identical before and after.

**A governance point surfaced and corrected**: an Opus reviewer flagged that the
orchestrating session had recorded itself as the sole independent ordinary reviewer on PR
#225 after having performed that PR's own remediation (the migration renumbering) —
`CLAUDE.md`'s rule is that a context which materially authored or remediated a change cannot
also clear it. Fixed by dispatching a genuinely independent Sonnet reviewer and replacing
the self-recorded review in the PR body with that one.

---

### 2026-09-22 · P0 status correction, and fixes dispatched for four real P0 defects

Claude Sonnet 5 resumed the orchestrating session (Claude capacity restored). Thomas
flagged directly that P0 looked unfinished despite this file's prior "exit criteria met"
wording; rather than take either claim on faith, ran a live audit against current source
for every open P0-titled issue plus the ones a prior external review had specifically named.

**The audit confirmed Thomas's concern.** "Exit criteria met" conflated Throttle 1's own
five conditions (genuinely closed, unchanged by this correction) with P0 as a whole (not
close to done). Found four concrete, reproducible, currently-live defects with no code
change needed to confirm them — they were simply still there:
- **#18** — `apps/api/src/auth.ts`'s zero-user registration bypass has no setup-token check
  anywhere in the codebase; the first anonymous visitor to reach an unclaimed instance
  becomes its admin. Blocks any public exposure of a fresh instance.
- **#146** (CRITICAL) — `scripts/ci/lib/pr-body.mjs`'s `sections()` matches `##` headings
  against raw markdown lines before any comment-stripping, so a `##` heading hidden inside
  an HTML comment is still recognized and silently overwrites an earlier same-named section
  — a fake "cleared" security-review section could defeat the mechanical gate.
- **#17** — sessions minted via the MCP OAuth and device-authorization flows (removed under
  #6) were never revoked; the migrations that dropped those flows' own state tables say so
  in their own comments.
- **#97** — `apps/web`'s `_authenticated.tsx` still string-concatenates `location.search`
  directly in its logged-out redirect guard; a logged-out user hitting a protected route
  gets a blank page instead of a sign-in redirect.

Also confirmed two large umbrella P0 issues are still substantially open, not stale
paperwork: **#8** (the route-policy retrofit — ~80 inherited routes still unclassified, and
the policy registry has zero runtime wiring into `apps/api/src/index.ts`, so no request is
actually evaluated against a policy today) and **#9** (`packages/ui` extraction — only 18 of
roughly 63 primitives moved out of `apps/web`).

**Fixes for the four concrete defects dispatched to Sonnet implementation lanes, in
parallel, per Thomas's explicit "P0–P7 in parallel, one review round, finish this week"
instruction.** Each is a bounded, well-scoped fix in its own isolated worktree; none merged
yet as of this entry. #8 and #9 are large enough that they need their own dedicated slices
rather than a same-day fix — tracked as ongoing P0 work, not reopened as new issues (they
were never closed).

**Also in flight the same session**: a backlog of P1/P2 review gates left pending during
the capacity outage (PRs #213–#219) reviewed and merged (or in the merge queue) — real
defects found in several (a missing 404 declaration, a mismatched doc-comment/test-name
pair, a test that only ever exercised UTC despite claiming to verify non-UTC behavior, and
PR #209's `consumedPct >= 100` boundary contradicting `sla.md`'s stated inclusive/exclusive
split for `at_risk`/`breached`, fixed and regression-tested the same session).

**Correction to this entry's own header edit**: an independent reviewer of this PR caught
that the header-block relabeling above mislabeled the 2026-09-18 GitHub Copilot pass as
`**Earlier the same day:**` — four calendar days is not "the same day" as this entry. Fixed
to `**Previous pass — Updated by:**`, and the block below it (PR #200, 2026-09-16) is now
`**Two passes back — Updated by:**` so the two distinct-day labels don't collide. Recorded
here per this file's own rule that a correction to a prior entry is a new entry, not a silent
rewrite.

### 2026-09-18 · Two P1 candidates to review-complete, and #192 put to Thomas as a real question

Continuing autonomously under the P1 mandate. Three things moved.

**Three independent ordinary reviews across the two candidates, run and recorded — and Claude was not available for any of them.** All three ran in GitHub Copilot contexts (**DeepSeek V4.1 Flash**), named on the pull requests because the standing session instruction requires the real model and context to be recorded. None is a Claude review and none is a security review.

- **PR #215** (work-item integrity constraints) received **two** reviews, at the tier its
  classification calls for (it touches a migration and `apps/api/src/database/**`): a
  correctness pass at `caa1c7e` — **CLEAR WITH FINDINGS**, having proved the 21 tests
  non-vacuous by dropping all eight constrained objects and watching 10 of 21 go red — and a
  deliberately different **project-alignment** lens at `40a51eb` — **ALIGNED WITH
  CONCERNS**. All findings remediated. The alignment pass caught the sharpest one: my own
  commit message asserted a design disclosure had been added to the PR body when it had not.
- **PR #214** (UTC timestamps for the time-gated jobs) was reviewed at `a44b9b9` and came
  back **BLOCKING** — not for the production fix, which survived every falsification the
  reviewer constructed, but because the repository's own integration suite goes red whenever
  the database session timezone is not UTC: the lease *fixtures* still wrote session-local
  `now()`. Reproduced in both directions (`Asia/Kolkata` and `America/Denver` failing
  opposite tests), remediated, and re-verified — the **full suite under `Asia/Kolkata`
  (60 files / 533 tests, green)** and the **targeted lease/session set under
  `America/Denver` with `TZ=America/New_York` (12 tests, green)**. Both were failing on the
  reviewed head; neither is now.

**#192 written up as a decision for Thomas**, not decided by an agent — see **Blocked**. The
new evidence in that write-up is that the missing link is not one unscoped foreign key: the
same absent `workspace_id`/`organisation_id` also makes the RLS backstop `multi-tenancy.md`
already commits to *unwritable*, and blocks #198's project-purging half.

**Both candidates are `SECURITY REVIEW PENDING — OPUS CAPACITY`** and must not be merged.
The required `pull request template + security review` check is **correctly red** on both; the
security-review notes say so explicitly so that neither a later session nor an automated pass
reads that red as a defect to repair.

Method note worth keeping: every claim that a post-review delta was comment-only was proved
rather than asserted — `git diff <sha>..<sha> -- <file> | grep -E "^[+-]" | grep -vE
"^(\+\+\+|---)" | grep -vE "^[+-][[:space:]]*//"` returning no lines. A commit message
that claimed a fix it had not made is exactly the failure this guards against, and one
happened in this session.
### 2026-09-17 (later the same day, a fourth time) · #187 closed — a pre-existing gap in the live `project` table, made consequential by #23's new FK, not one of #23's own findings

Same session, continuing autonomously. With #23's schema-integrity findings all closed
(prior entries, below), took up #187 next: research first, since the issue's own wording
("matching organisation's/workspace's existing pattern") turned out not to hold — that
pattern is spec-only. `organisationTable` has had `deleted_at`/`purge_after` columns since
PR #179, but nothing anywhere sets or reads them; `workspaceTable` doesn't even have the
columns; no purge job or `legal_hold` table exists in the codebase at all. Scoped #187 down
accordingly: fix the actual defect (`project` delete is destructive) now, defer the general
purge/legal-hold infrastructure to a new issue, **#198**, rather than build it as a rider on
a bounded fix. Decision recorded in the decision log (PR #201).

**The fix**: `project` gets its own nullable `deleted_at`/`purge_after` columns, and
`delete-project.ts` becomes a single atomic `UPDATE ... WHERE id = ? AND workspaceId = ?
AND deletedAt IS NULL RETURNING *` — no `DELETE` is ever issued, so `work_item.project_id`'s
`ON DELETE CASCADE` (#185) never fires.

**Full mandatory review tier (2 Sonnet + Opus), two rounds.** Round 1: all three reviewers
independently found real, overlapping gaps in filtering elsewhere in the codebase — task/
column creation, task listing/export, global search, and project reorder all still let a
soft-deleted project's content through, live-reproduced by the mandatory Opus reviewer as
actual content leaks (a "deleted" project's tasks still readable, exportable, and
searchable). The core CASCADE-safety mechanism itself — the atomic `UPDATE`, proven
race-safe under concurrent double-delete via an 8-concurrent-request live probe (one row
stamped once, the rest 404, zero 5xx) — was sound throughout; every finding was in
read/write-path filtering, not the mechanism. Fixed once, centrally, in the shared helper
both task and column creation already called, plus each affected read path directly. Round
2: all three reviewers re-confirmed their own findings closed against the actual source at
the new head, not against the fix's description of itself.

**A genuine process wrinkle, worth recording plainly rather than smoothing over**: syncing
the branch with `main` after review completed (three unrelated docs-only PRs had landed in
the meantime) produced a merge commit that the mechanical PR-template checker correctly
flagged as needing its own confirmation — a merge commit's diff against its first parent
shows every file the other side touched, even when the actual code tree hasn't moved, so
the checker cannot simply infer a sync merge is safe. The same Opus reviewer independently
re-verified the code tree was untouched (root-tree hash comparison, both directions — that
nothing from `main` was silently dropped, and nothing on the branch silently changed) and
extended their own clearance to the merge commit, rather than the record being updated on
the orchestrating session's own say-so. This is the same discipline PR #191 established
after a real process error there; applied correctly here from the start.

**Also worth recording plainly**: issue #187 was accidentally auto-closed by GitHub's
closing-keyword parser **twice** before its real fix landed — once by an unrelated
commit's message (during the status.md reconciliation two entries below) containing a
phrase that matched the pattern, and a second time when a later commit's message,
explaining that first accident, quoted the trigger phrase verbatim and got swept into a
squash-merge commit body that matched the same pattern again. Both were caught (once by an
independent reviewer auditing an unrelated PR, once by noticing the timestamp coincidence)
and reopened with the actual defect still unfixed at the time. The issue was closed a
third time, deliberately and with evidence, only once PR #200 actually merged.

**Two follow-up issues opened, both non-blocking**: **#198** tracks the general purge-job/
`legal_hold` infrastructure this fix deliberately did not build (it doesn't exist anywhere
in the codebase yet, not for `organisation` or `workspace` either). **#202** (widened during
the review round) tracks a residual set of routes in the same "doesn't check `deletedAt`"
class that Opus found live-reachable but judged non-blocking — `update-project`/
`archive-project`/`unarchive-project`, column listing, and a few per-task-id mutation
routes — plus two smaller cosmetic nits (a stale UI-copy string, a misleading reorder error
message). None of these carries a cross-tenant or data-loss risk; all sit behind the same
permission/workspace gates as before.

**Merged as PR #200** (`ca90bbe`). Issue #187 is now closed.

**Not done:** the rest of #23 (routes, screens, the actual cutover from the old task/column
system); #25; the two SLA questions, the state-transition question, and the
`workflowRuleTable` question, all still waiting on Thomas; issue #8's remaining scope; the
live UAT redeploy; issues #189, #192, #196, #198, #202 remain open, none blocking anything.

---

### 2026-09-17 (later the same day, a third time) · #188 closed — the last of #23's schema's known integrity gaps, with the same review rigor PR #191 established

Same session, continuing autonomously. With #186 closed (prior entry, below), took up #188
— `work_item.parent_id` (a self-referencing column) had no guard against a work item
becoming its own ancestor, directly or through a longer chain — the last of the four
findings this schema's own review flagged as worth closing promptly, not the smaller
backlog items (#187, #189, #192).

**Two guards added**: a database constraint rejecting direct self-parenting outright, and a
trigger walking the ancestor chain to catch a longer cycle (something a plain constraint
cannot express). Given the previous PR's lesson on this exact table — a hand-written
trigger that looked reasonable and had a real, live-provable race — the trigger here was
built with that specific hazard in mind: it locks each ancestor row it visits as it walks,
so two concurrent attempts to form a cycle become a genuine, correctly-resolved database
deadlock instead of a silent race. **Verified, not just reasoned about**: real two-way and
three-way concurrent reproductions, run independently by two different reviewers using
their own separate test code, both confirming a cycle can never survive.

**The mandatory review, applying the same no-benefit-of-the-doubt standard this table has
now earned, found two more things worth fixing before merge**: the lock taken was stronger
than necessary (fixed, a one-word change), and — the more interesting one — the trigger
fired any time a row's parent field was *mentioned* in an update, even when the value
wasn't actually changing, which would have made an ordinary, unrelated edit to a work item
unnecessarily lock its entire ancestor chain. This is the same class of mistake already
caught once in the previous PR, on a different trigger — now closed here too. Both fixes
re-verified live by all three reviewers, one of whom went further and independently
constructed a brand-new concurrent scenario the implementer hadn't thought to test, closing
it out clean.

**Five smaller, non-blocking findings** — a narrow deadlock interaction between this
trigger and the previous PR's, a caveat about one uncommon administrative mode where the
database-level guarantee doesn't apply (application code doing its own chain calculations
still needs its own safety check), and three minor documentation/consistency notes — are
tracked as issue **#196**, not fixed here.

**Merged as PR #195** (`02c7059`). Issue #188 is now closed.

**Not done:** the rest of #23 (routes, screens, the actual cutover from the old task/column
system); #25; the two SLA questions, the state-transition question, and the
`workflowRuleTable` question, all still waiting on Thomas; issue #8's remaining scope; the
live UAT redeploy. Issues #189, #192, #196 remain open, low-priority, not blocking anything.

**Correction, found by this reconciliation's own reviewer:** issue #187 had been accidentally
auto-closed by an unrelated commit message (`d60b672`, a docs-only status.md wording fix
whose message happened to contain the substring "fix #187's description") — GitHub's
closing-keyword parser matched on that text alone; nothing in that commit touched the actual
defect. Reopened. The real problem — the live `project` table has no soft-delete window, so
`work_item.project_id`'s `ON DELETE CASCADE` (PR #185) is still live and destructive — was
never fixed, and is being worked now, same session, continuing autonomously; its own entry
will land here once it merges.

---

### 2026-09-17 (later the same day again) · #186 closed after a real concurrency bug, a self-corrected process error, and the session's deepest review cycle yet

Same session, continuing autonomously. With #23's schema slice landed (prior entry, below),
took up its own review's four write-path-blocking findings (#186) as the natural next
bounded step, rather than starting a new feature while a known integrity gap sat on `main`.

**S1 and half of S2 fixed cleanly**: `customer_visibility` now `NOT NULL DEFAULT 'private'`;
composite foreign keys now pin a work item's `state`/`parent` to its own project (the
`type_id`/workspace half stays open — genuinely more involved, tracked separately as
**#192**, since it needs either a denormalised column or another mechanism and deserves its
own decision, not an inline guess).

**S5 (a key/alias collision guard) is where this round earned its keep.** The first attempt
used a trigger checking one table against another — an ordinary review and, independently,
the mandatory Opus review each **found and proved, with live two-transaction reproductions,
that this had a genuine unlocked race**: two concurrent writers could each pass the check
and both commit, producing exactly the collision the trigger existed to prevent. Opus went
further and showed the race survives even Postgres's strictest isolation setting. **Rather
than patch the trigger, it was replaced with a real database uniqueness constraint** — a
small registry table where a key string can only ever be claimed once, checked by Postgres's
own index rather than application logic, which closes the race by construction and was
verified live under concurrent load. Opus's own review found this the correct engineering
answer, not merely an acceptable one, and separately recommended it be recorded as a real
design decision, not folded silently into a bug-fix commit — done, in the decision log.

**A second Opus pass on that redesign found four more issues**, none reachable yet (no
route writes these tables), two worth fixing now rather than waiting: a write that gets
silently skipped (a common, ordinary database pattern) could permanently squat a key string
forever; and an unrelated field update on an existing work item would have spuriously failed
just because it happened to re-state the item's own unchanged key. Both fixed with one small
correction to the same registry logic, verified live again. The other two findings were
documentation-accuracy corrections in code comments, also fixed.

**A real, if minor, process error happened here, and it is recorded honestly rather than
quietly fixed.** Partway through, this session advanced the committed review record's
declared "reviewed" commit past a routine sync with `main`, based on its own check that no
code had actually changed since the last real review — a reasonable-sounding but incorrect
shortcut: whether a security clearance survives a later commit is the *reviewer's* call to
make on their own finding, not the orchestrating session's to extend by editing a document,
even when the underlying technical claim turns out to be correct (it was). The mandatory
reviewer caught this on the very next confirmation request, verified the actual gap
independently, and extended the clearance itself. The review record states plainly what
happened and why it was wrong, rather than presenting a cleaned-up version of events.

**CI also caught one genuine flaky test** — a JavaScript timing quirk in the new
concurrency test itself (not the underlying database mechanism, which was already proven
correct): a promise wasn't given a rejection handler soon enough, so an automated tool could
occasionally flag it as an unhandled error even though the test's own check would have
caught the real outcome correctly every time. Fixed and verified with eight repeated runs
plus the full suite, clean every time.

**Merged as PR #191** (`90b38a3`). Issue #186 is now closed. Six smaller, non-blocking
findings from the original schema review remain open and tracked: **#187** (the live
`project` table has no soft-delete window, so `work_item.project_id`'s CASCADE now makes an
ordinary project-delete route destructive — not #23's own gap, but #23's new FK is what
makes it consequential), **#188** (a
work item could in principle be made its own ancestor — no guard exists yet), **#189** (a
small backlog of minor hardening items), **#192** (the deferred `type_id`/workspace
question above), and one item folded into the already-open **#181**.

**Not done:** the rest of #23 (routes, screens, the actual cutover from the old task/column
system); #25; the two SLA questions and the state-transition question, both still waiting
on Thomas; issue #8's remaining scope; the live UAT redeploy.

---

### 2026-09-17 (later the same day) · #23's first work-item schema slice lands; mandatory Opus review rules out a repeat of the identity schema's bugs, finds nine new ones

Same session, continuing autonomously. With P1's identity schema landed (prior entry,
below), scoped issue #23 (work items) before starting it — the live code is still entirely
kaneo's `task`/`column` schema and routes, and #23 is a genuine migration, not a green-field
feature. Scoping surfaced a large blast radius (54 files reference the current task/column
surface, including `packages/mcp/src/tools/register.ts`'s hardcoded `/api/task/*` paths) and
several genuinely open questions, recorded rather than guessed at:

- **Decided:** #23's first PR covers only the six tables every sibling P1 issue actually
  reads or writes (`work_item`, `work_item_type`, `state_template`, `state`,
  `work_item_key_alias`, `watcher`) — not `work_item_template`/checklist/label (a real,
  unresolved label-deduplication question deferred to a closely-following PR) and explicitly
  not `work_item_relation`/`comment`/`activity`, which belong to #26/#27 per the project's
  own dependency graph, not #23.
- **Decided, implementation-level:** rather than an atomic rename touching kaneo's live
  `task`/`column` tables and all 54 dependent files at once, the new tables are built as
  genuinely additive — kaneo's task/column surface stays completely untouched and
  functional, and a later PR handles the actual cutover once enough of the new backend
  exists to replace it meaningfully. This reads the existing one-shot-vs-two-phase
  migration decision narrowly (about preserving existing *data*, moot pre-launch) rather
  than as a mandate to do everything in one giant PR.
- **PROPOSED, not decided** — an independent review of this session's own scoping decisions
  (before implementation even started) pushed back on an initial plan to reuse the
  assignment (#30) precedent for state-transition legality-checking, correctly pointing out
  #30 carries an explicit issue-level P1/P2 carve-out that #23 never had, and that an
  unchecked transition risks more (SLA timestamps, roll-up completeness, reopen logic) than
  a wrong assignment does. Reworded as an open proposal in the decision log rather than
  quietly promoted to settled — Thomas's actual answer is still needed. **This does not
  block the schema work below**, only the eventual transition endpoint's behaviour.
- **Flagged for Thomas, unresolved:** kaneo's inherited per-column automation
  (`workflowRuleTable`) has no stated target anywhere in the new architecture's design docs
  — dropped as superseded functionality, or is there a plan for it this session hasn't
  found? Left untouched either way, not blocking anything.

**What landed:** `work_item`, `work_item_type`, `state_template`, `state`,
`work_item_key_alias`, `watcher` — **PR #185, merged `f8f410e`.** Same full review tier as
the identity schema (2 ordinary Sonnet + mandatory Opus). The Opus reviewer explicitly
checked for and ruled out a repeat of the identity schema's own two findings (an identity-
uniqueness bug, a cascade/restrict deadlock) — neither reproduces here — but found **nine
new, non-blocking findings** of its own, since this is a different schema with different
edges. Four are flagged as needing to close before any write-path PR, not before this one:
a fail-open default on `customer_visibility` (the one column gating what a customer can
see); no FK tying a work item's `state`/`type`/`parent` to its own project or workspace; an
alias/live-key namespace collision; and — structurally the most interesting one — the live
`project` table has no soft-delete window (`deleted_at`/`purge_after`) unlike its target
design, so the new `work_item.project_id` CASCADE now makes an ordinary project-delete route
destructive in a way that an identical-looking FK on the identity schema was NOT (that one
only fires on a hard purge, well past every recovery window — the same-shaped FK, different
consequences, because the two tables it points at are in different states of migration).
Tracked as issues **#186**, **#187**, **#188**, **#189**, plus one finding folded into the
existing **#181**. Issue #23 stays open — commented with exactly what landed and what
remains, rather than closed.

**Not done:** the rest of #23 (routes, policy, Zod, repository, the actual `task`/`column`
cutover); #25; the two SLA (#32) questions, still unanswered; issue #8's remaining ~85-route
scope; the live UAT redeploy.

---

### 2026-09-17 · P1's foundational identity schema lands; mandatory Opus review catches a real cross-organisation identity gap

Same session, continuing autonomously per the standing delegation. With the audit-trail
domain slice done (prior entry, below) and SLA (#32) still waiting on Thomas's two open
questions, the next priority was the P1 foundational identity schema itself — decided
2026-09-16, not yet implemented.

**What landed:** `organisation`, `organisation_quota`, `person`, `membership`, `role` —
exactly `data-model.md` §2's tables — as one purely additive migration
(`apps/api/drizzle/0052_hesitant_black_bolt.sql`, later `0053_fix_person_user_unique_scope.sql`),
plus an idempotent boot-time seed (one internal `organisation`, one `person` per existing
`user` row). No route, no controller, no policy wiring, no `resolveIdentity` implementation
— all explicitly separate, later work. **PR #179, merged `e7280ff`.** Zero existing tables
touched (confirmed: 0 deletions in the diff).

**Full review tier, as this schema's foundational role warrants:** two independent ordinary
Sonnet reviews (schema/migration fidelity against the spec; seed idempotency/scope
discipline) plus a mandatory Opus pass. Both ordinary reviews went beyond reading the diff —
the schema reviewer ran `drizzle-kit check` and the full suite directly; the seed reviewer
wrote and ran their own concurrent-boot race reproduction (25-way concurrent calls against a
real Postgres) rather than trusting the PR's own sequential verification.

**The mandatory Opus review found a real, blocking gap.** `person`'s uniqueness on `user_id`
was scoped `(organisation_id, user_id)` — permitting the same `user_id` to hold a `person`
row in two different organisations, on two different sides. Proven with a live insert: one
`user` simultaneously `side: "staff"` in the internal organisation and `side: "customer"`
elsewhere. `multi-tenancy.md` names this exact state as the specific ambiguity this schema's
design exists to prevent, and `resolveIdentity`'s single `personId`/`side` (keyed and cached
by `user_id`) would have resolved one of the two arbitrarily — a customer could have
resolved as internal staff. The PR's own seed already assumed the correct, global invariant,
so code and the DB constraint disagreed about what the rule even was. **Fixed while the
tables were still empty** — the cheapest possible moment — by making the uniqueness global
(`UNIQUE(user_id) WHERE user_id IS NOT NULL`), with two new regression tests reproducing
both the rejected and the legitimate case. All three reviewers delta-confirmed the fix at
the new head; Opus's final verdict: **CLEAR WITH FINDINGS (non-blocking)**.

**Six smaller findings from the same Opus pass, all non-blocking, all tracked rather than
silently left implicit:**
- **#180** — `role.workspace_id` CASCADE + `membership.role_id` RESTRICT makes a workspace
  hard-delete impossible once any role has a membership. Latent today (nothing writes
  `role`/`membership` yet); two live routes would 500 the moment that changes.
- **#181** — three related DB-level integrity gaps folded into one issue: nothing ties
  `membership.scope` to `role.scope` (a plausible escalation path once `resolveIdentity`
  exists — flagged by the Opus reviewer as the one to close **before** any membership-grant
  route is written); a placeholder person can hold a membership, contradicting the spec; no
  backstop ties `membership.scope_id` to the person's own organisation.
- **#182** — the seed's fail-open default (an unrecognised user becomes internal staff, every
  boot) is correct today but needs gating before P3 customer identities exist.
- **#177** (filed slightly earlier, same review family) — a separate, older, pre-existing
  CodeQL alert on `verify-api-key.ts` needs its own triage, materially different from the
  audit-trail one Thomas already resolved (there the hashed value genuinely is a credential).

**Not done:** #23/#25 themselves — this PR only clears their shared prerequisite; issue
#173's reconciliation of the legacy `workspace_member`/`workspace_role` tables with this new
shape; `resolveIdentity`'s actual implementation; SLA (#32), still waiting on Thomas; issue
#8's remaining ~85-route classification scope; the live UAT redeploy.

---

### 2026-09-16 (later the same day, a fifth time) · P2's audit-trail domain slice lands; mandatory Opus review catches four real hash-collision bugs; a CodeQL alert escalated to and resolved by Thomas

Same session, continuing autonomously. With #168 fixed and P1's foundational-schema
sequencing decided (prior entry, below), the next SAFE_PARALLEL item taken up was P2's
`packages/domain` lane: SLA (#32) has two genuine open product-behaviour questions (below,
still parked for Thomas) so **audit trail (#37)** was started instead — isolated, no
dependency edges, and its one open question (a same-instant tie-break rule) was a routine
implementation convention rather than a product-behaviour call.

**What landed:** `canonicalRowHash` (`AU-15`'s hash-chain recipe) and `reconstructAt`
(`AU-8`'s point-in-time reconstruction), pure functions in `packages/domain/src/audit/`, no
I/O — **PR #175**, merged `7db940e`. A prerequisite surfaced mid-task and was fixed first:
`audit-trail.md`'s 2026-09-05 review section was still open (do-not 15 blocks building a
feature while that's true) — closed as **PR #176**, merged `68b4e95`, following the #83/#75
precedent exactly.

**The mandatory Opus review did exactly what it exists to do.** This module was judged
security-relevant by content (it's a tamper-evidence mechanism), not by `ci-cd.md`'s literal
path list, and got the full tier: ordinary Sonnet PASS, then Opus. Opus's first pass came
back **CHANGES REQUIRED** with four concrete, demonstrated collision classes — none of them
caught by the module's own 263 passing tests: out-of-range `jsonb` numbers (`1e400`, an
actual value Postgres stores and returns) all canonicalizing to the same string as a real
`null`; the `\x1e`-joined field scheme not being injective, so two different rows with
different `userAgent`/`traceId` values could hash identically; non-plain objects (a `Date`,
a `Map`) silently collapsing to `{}`; and a same-instant tie-break rule whose own doc comment
claimed Postgres auto-increment ids as its ordering signal, when this schema's ids are CUID2
and — verified against the library's own source — carry **no ordering guarantee at all**.
All four were fixed (guards that throw rather than silently produce an ambiguous hash; the
tie-break's false premise replaced with a new, honest decision-log entry naming it a genuinely
open schema question rather than inventing a substitute), re-verified independently by the
same Opus reviewer re-running their own adversarial probes against the fix, and confirmed
non-regressive (both pinned golden-hash test values unchanged). Final verdict: **CLEAR WITH
FINDINGS (non-blocking)**.

**One CodeQL alert genuinely needed Thomas, and got it.** The hash call also tripped a CodeQL
rule (`js/insufficient-password-hash`) on a name-based heuristic — `apiKeyId`, a foreign-key
id, not a secret, is one of fifteen concatenated fields. Both the ordinary and the Opus
reviewer independently concluded, without prompting each other, that this is a genuine false
positive (a salted KDF would actively break `audit-verify`'s need for deterministic
re-hashing) — and neither dismissed it themselves, correctly treating that action as
gate-adjacent (`AGENTS.md` do-not 6). Escalated to Thomas, who authorized the dismissal;
recorded in the decision log and the alert dismissed via the code-scanning API before merge.
**Filed #177** to separately triage a second, older, pre-existing CodeQL alert of the same
rule on `apps/api/src/utils/verify-api-key.ts` — a materially different situation (there the
hashed value genuinely is a credential) that this session did not resolve, only flagged.

**Issue #37 stays open.** This PR is one bounded slice — the impure edge (the actual
`audit_log` insert, the advisory lock, `audit-verify`'s live chain walk, any route or
permission wiring, any screen) is explicitly not started. Commented on the issue with exactly
what landed and what remains, rather than closing it.

**Not done:** the audit-trail impure edge and everything downstream of it; SLA (#32),
still waiting on Thomas's two questions (unchanged from the prior entry); the foundational
identity-schema migration itself (decided, not yet implemented); issue #8's remaining
~85-route classification and runtime-integration scope; the actual UAT redeploy to real
infrastructure.

---

### 2026-09-16 (later the same day, a fourth time) · #168 (docker build failure) root-caused and fixed; UAT-0 independently verified end-to-end; P1 sequencing decisions recorded

Same session, continuing autonomously per the delegation recorded below and in the decision
log (both the 2026-09-16 "Autonomous continuation" entry and, for this pass specifically, the
2026-09-16 entries on P1's foundational identity schema and #23's migration strategy).

**#168 fixed.** The docker-build failure the prior pass in this same session flagged (a
significant new blocker, found while merging PR #164) was root-caused precisely: the
`Dockerfile`'s `deps` stage copies each workspace package's `package.json` individually
before `pnpm install --frozen-lockfile`, and that hand-enumerated list was missing
`packages/domain` and `packages/ui` — confirmed directly by building just the `deps` stage
and inspecting it (`packages/ui` didn't even exist as a directory in that stage, so
`pnpm install` never created its `node_modules`, so the React Compiler's injected
`react/compiler-runtime` import in `packages/ui/src/components/*.tsx` had nothing to resolve
against once the `build` stage copied real source on top). Fixed as **PR #171**, merged
`d2884f1` — two added `COPY` lines, nothing else. Independently reproduced both the failure
(bare `main`, fresh clone, `--no-cache`) and the fix (PR head) by a fresh reviewer before
merge, ordinary tier (confirmed: `Dockerfile` is not in `ci-cd.md`'s security-review-scope
list, per issue #140's own prior finding). Filed **#170** for the underlying fragility (the
`COPY` list has no CI check keeping it in sync with the workspace — it had already silently
drifted for two packages before this fix) — not blocking, not fixed here.

**UAT-0 independently verified, not just "the code should work now."** With all four
UAT-lane deployability gaps now closed (`storage.filesystem` landed as PR #164 earlier this
session; the other three had already closed in the prior wave) and #168 fixed, the
orchestrating session built the resulting image and booted it against freshly-created,
disposable Postgres/Valkey containers on an isolated Docker network — no shared state, no
host ports beyond `127.0.0.1`, torn down immediately after. From a genuinely empty database:
migrations ran clean, both `/api/public/health/live` and `/api/public/health/ready` answered
`200` (the latter with a real `{"status":"ok"}` from a live `SELECT 1`), the built web bundle
served at `/`, an unknown path correctly still 404'd, and WebSocket/Redis broadcast came up.
The host's pre-existing `taskdesk-uat-*` (v1) stack was confirmed running, unaffected, both
before and after. **What remains for a real UAT stand-up is only the actual redeploy to real
infrastructure** (DNS, the live hosts, real secrets) — an infrastructure action reserved for
Thomas's own authorization, not a code gap.

**Issue #8's H2 sub-item closed with evidence** (was already fixed by PR #163 in the prior
wave, but the issue's own checklist was never ticked) — now ticked, with a comment citing the
PR and explaining exactly which of the two documented resolution routes was taken. The rest
of #8 (the ~85-route classification pass, runtime authorization integration) remains open and
untouched — H2 was one bounded finding within it, not the whole issue.

**P1 core work started on its foundational identity schema**, not #23 directly. Scoping #23
(work items) against `data-model.md`/`packages/permissions/src/identity.ts` found that neither
#23 nor #25 can be built the way the architecture intends without `organisation`, `person`,
`membership` and `role` existing first — none of P1's eight chartered issues (#23–#30) owns
building them, a real gap the lane-prep plan's own shared-contract table didn't name. Recorded
as its own decision-log entry (2026-09-16) rather than started silently, alongside a second
entry settling #23's `task`→`work_item` migration strategy (one-shot, not the two-phase
live-cutover dance — conditional on no live deployment existing yet when that migration is
actually generated, a condition an independent PR review sharpened after the first draft only
said "no production data," which misses that even zero data doesn't rule out a live rolling
deployment breaking mid-rollout). Filed **#173** to track reconciling the existing
`team`/`invitation`/`workspace_role` tables with the new shape once something needs it
changed. The actual foundational-schema PR itself has not started yet — this pass only
cleared the sequencing question and recorded it durably.

**Two genuine SLA (#32) product-behaviour questions surfaced, not decided here — need
Thomas:** (1) when a work item moves to a project with a different SLA policy, does the new
policy apply immediately against the item's original start time, or does the move reset
which policy version applies at all — `sla.md`'s own text states both, contradictorily; (2)
does a service calendar with zero open hours but a policy still attached show "no policy" or
"on track forever" — `service-calendars.md` and `sla.md` each imply a different one. Both
have a recommended default already written up (pin the policy from creation, and "on track
forever," respectively) if Thomas has no strong preference. Neither blocks other P2 work —
**#37 (audit trail)** started in parallel instead, since its own one open question (a
same-instant tie-break rule for `reconstructAt`) was a routine implementation convention, not
a product-behaviour call, and was decided as part of that work.

**Not done:** the foundational-identity-schema migration itself (sequencing only, decided,
not yet implemented); #23 and the rest of P1 core; SLA (#32), pending Thomas's two questions
above; the actual UAT redeploy to real infrastructure (verified locally, not deployed live).

---

### 2026-09-16 (later the same day, a third time) · Autonomous post-Throttle-1 wave — four PRs merged, backlog reconciled, one significant new finding

Same session, continued after Throttle 1 opened (entry directly below). Thomas explicitly
authorized autonomous continuation — prioritizing within the roadmap, merging cleared PRs,
closing evidence-backed issues — without stopping to ask him to pick each ticket, reserving
only new/conflicting policy, undecided architecture, gate waivers, and reviewer-eligibility
changes for his own call.

**Backlog reconciled first.** Of the six open PRs at the start of this wave: **#127**
closed (its whole premise — a non-Claude model-routing policy question — was already
settled by the 2026-09-15 decision log entry); **#117** closed (a stale record of a
six-day-old transient review-capacity block, fully overtaken); **#123** closed (conflicting,
its status.md/ledger payload obsolete, one still-novel paragraph on router-alias semantics
judged not worth carrying forward — it describes multi-provider routing infrastructure the
2026-09-15 simplification already superseded); **#75** and **#91** reconciled and merged
(below); **#107** left untouched, held, per Thomas's own standing decision.

**PR #75** (P2 workflow-transitions domain module, `packages/domain/src/workflow/`) —
rebased cleanly, one independent Sonnet review found one non-functional doc-comment/test-
citation staleness (WF-22 already decided but the code still called it unconfirmed), fixed.
Merged as `ae15c6d`.

**PR #163** (issue #8's H2 finding — the route-coverage gate discarded Hono's registration
order, so a route above the auth guard was indistinguishable from one below it) — a bounded
security fix, not #8's much larger remaining scope. Full review chain: ordinary Sonnet PASS,
Opus CLEAR WITH FINDINGS (F1 MEDIUM — the fix also needed to model path *scope*, not just
order, since the guard is `/api/*` not `/*`; F2-F4 LOW), fixed; a second independent Opus
delta pass found N1 (LOW, a `/api`-without-trailing-slash false positive) and mechanical
PR-template defects, fixed; a final delta confirmed CLEAR. Merged as `ba0ae53`. Filed
**#165** (pre-existing, not-live-in-CI-today `test:permissions` flakiness when
`apps/web/dist` is present, found along the way — relevant to Docker-image-shaped
pipelines).

**PR #91** (issue #86 — register the event vocabulary, add `check:events`) — already deep
into its own review history from earlier work; this wave's job was rebase, reconciliation,
and closing it out. A rebase-introduced conflict in `decision-log.md` resolved by commit
timestamp (matching the file's existing intra-day ordering convention). **Found and fixed a
real control-plane discipline gap along the way**: the branch had, across two of its own
prior commits, first asserted a Thomas decision on #86 with no supporting source at all,
then "fixed" that by citing a second, equally unverifiable "orchestrator directive" — both
false. Re-attributed honestly to the orchestrating session's own delegated authority. Two
more Opus rounds (6 and a lightweight round-7 confirmation) found and closed one MEDIUM
(round 6 — a function declaration whose own name collided with a tracked call name
whitelisted its own parameter as a legitimate call argument, restoring an already-fixed
class of gap) and disclosed rather than chased two narrower LOWs of the same class
(round 7). **Also found the PR had never had its required ordinary review at all** — seven
Opus rounds are not a substitute for it — commissioned one, which caught two more trivial
doc self-contradictions, fixed. **Also found no committed security-review note had ever
existed for this PR** despite seven real Opus rounds — the mechanical PR-template gate had
nothing to bind to. Wrote the consolidated note. Merged as `07921c0`.

**PR #164** (issue #11 — `storage.filesystem` driver, so a fresh install has a working
task-image-upload backend with no S3 configuration) — new work this wave, not a backlog
item. Implemented a driver-agnostic extraction from the existing `s3.ts`, path-traversal and
symlink defenses, and — since a local filesystem has no native presigned-URL concept — a
new same-origin route gated by a short-lived HMAC-SHA256 upload token in place of a session.
Two ordinary Sonnet reviews (one deep on the token mechanism, one on path-safety/wiring) both
PASSED with only trivial/low findings. Mandatory Opus review returned CHANGES REQUIRED — one
blocking Medium: the new route, the only unauthenticated mutating filesystem-writing
endpoint in the product, had zero test coverage at the HTTP layer (every existing test
called the driver's functions directly). Fixed with a real HTTP-integration suite; a delta
Opus pass confirmed it by mutation-testing the new tests themselves, and found one further
Low (a genericized error was being discarded rather than logged server-side), fixed. Two
findings correctly deferred to tracked issues rather than fixed in this PR: **#166**
(orphaned bytes when finalize never runs, no GC) and **#167** (a `TASKDESK_STORAGE_DRIVER`
flip silently orphans bytes on delete). Merged as `90f8d78`.

**Significant new finding, not specific to any one PR: `docker build .` fails on `main`
itself**, reproduced on a fresh clone with `--no-cache`, no PR #164 changes present —
`apps/web`'s build step cannot resolve `react/compiler-runtime` from
`packages/ui/src/components/button.tsx` inside the Docker build environment specifically (a
plain host-side `pnpm --filter @taskdesk/web build` succeeds cleanly). Filed as **#168**.
This blocks producing any working Docker image today, which bears directly on issue #11's
own "Done when" criteria and the near-term UAT deployment work — flagged prominently to
Thomas rather than left for someone to discover mid-deployment.

**Every merge in this wave went through the full checklist**: exact-head verification after
every rebase (each confirmed by an empty diff on every file the applicable review covered,
not assumed), all required status checks green at that exact head, no waived gate, the
mechanical PR-template/security-review gate passing at the merged SHA. Two mechanical gate
failures were found and fixed along the way (not pre-existing — both introduced by this
wave's own edits): a missing `**Reviewed head:**` field format on PR #91's note, and a Gates-
table/checklist formatting defect on PR #163's body.

**Not done this wave:** #8's much larger remaining scope (classifying ~80 still-uncovered
routes, wiring `policyRegistry` into runtime request handling) — H2 was one bounded finding
within it, not the whole issue. P1 core's one genuinely startable slice (work-items) was
scoped but not started — its first real migration touches `person`/`organisation`, which the
scoping pass found is a P1-owned prerequisite, not something to build piecemeal alongside
`work_item`; flagged for Thomas rather than started. `storage.filesystem` UAT lane and PR
#107 remain untouched, per standing instruction.

### 2026-09-16 (later the same day again) · S10 landed (PR #161), issue #6 closed, Throttle 1 OPEN

Same session, continued after the S7 entry directly below. Relayed instructions (via
Thomas, sourced from a "GPT" analysis he asked to be evaluated on its own merits, not
followed blindly) made S10 the primary task, explicitly holding PR #107 separate.

**S10 (unmount the better-auth `organization()` plugin) implemented, reviewed, and merged
as PR #161**, a fresh purpose-built PR — not PR #107, which stayed untouched and held per
Thomas's own decision. Independent source-level verification of every executable
`authClient.organization.*` caller (not PR #107's known-incomplete scanner) confirmed zero
remained before removing the plugin. Two prep PRs landed first: **#159** (swapped 10 test
files from plugin-route to native-route setup) and **#158** (added the native
100-pending-invitations-per-workspace ceiling before removing the plugin's own protection;
its review found issue #160, a genuine S10 prerequisite — the native pending-invitations
list was hiding expired-but-pending rows — filed and fixed before S10 merged, not folded
into S10 silently).

**S10 itself** removed `organization()`, its `teams` config, six plugin-only Drizzle schema
entries, the plugin's rate-limit and cloud-abuse-gate rules, `auth-openapi.ts` (1221 lines,
all `/auth/organization/*`), `organization-plugin-role-guard.ts`, and nine whole
characterization/equivalence test files whose only subject was the plugin (with the few
still-relevant pure-function assertions moved to surviving files, not silently dropped).
Reviewed by the full panel this risk level warrants — 3 fresh Sonnet contexts plus a
mandatory Opus pass — **CLEAR WITH FINDINGS**:

- **F1 (MEDIUM):** removing the plugin silently dropped `activeOrganizationId` from
  better-auth's own session-field serialization (a framework mechanism, not something
  either reviewer expected to have to check) — first fix attempt closed that but opened a
  **new** hole (any caller could overwrite their own session's `activeOrganizationId` to a
  workspace they don't belong to via `POST /api/auth/update-session`), found independently
  by both reviewers through different methods (an adversarial live probe, and reading
  better-auth's plugin source directly). Correctly characterized as a session-state-
  integrity regression, not privilege escalation or session hijack — no data was ever
  reachable through it, since every real route independently re-checks membership. Fixed;
  two regression tests added.
- **F2 (LOW):** a stale `rbac.md` paragraph.
- **Missed in the original verification plan, caught by CI, not by either review round:**
  `pnpm openapi:write` needed re-running (35 dead `/auth/organization/*` operations were
  still in the committed contract). Fixed and delta-reviewed CLEAR before the actual merge.

Merged as `6de483f`. **Refreshed `main`, then verified issue #6's actual GitHub checklist
against live source before closing anything** — its real scope is the entire fork-time
removal list (auth defaults, `public-project`, six integration plugins, billing, Sentry,
`packages/planka-import`, kaneo's `mcp`/`oauth` routers), not just this retrofit, and every
checkbox on GitHub was still unticked despite most being done long ago. Checked each item
against source rather than trusting the checklist or assuming "S10 done" meant "#6 done."
One literal "Done when" clause (octokit absent from the lockfile) turned out to be a false
positive against overly literal original wording — resolved via `pnpm why @octokit/core`,
not left unexplained. **Closed #6**, with the full evidence in its closing comment.

**Also verified and closed four plugin-specific defect issues** (#88, #108, #124, #136) per
the explicit instruction to check each was genuinely unreachable, not merely assume so
because the plugin import disappeared — each had its own positive native-side fix or
regression test found directly in source, not just the absence of the vulnerable plugin
code. Each issue's closing comment carries its specific evidence.

**Throttle 1 opened.** All five conditions re-verified live: #5/#6/#7 closed, route-policy
coverage is a required CI check, and the unclassified-route-fails-CI probe still passes
untouched. Updated `status.md` (this file) and the retrofit ledger accordingly.

**Not done this session:** PR #107 was not touched, rebased, or remediated — it remains
open and held, per Thomas's own decision, no longer coupled to Throttle 1. PRs #127, #123,
#117, #91, #75 were left untouched per explicit instruction. `storage.filesystem` (the
fourth UAT gap) remains a separate, unstarted lane.

### 2026-09-16 (later the same day) · S7 landed (PR #155), browser-verified before merge; PR #107 found blocked on its own pre-existing finding

Same session, continued after PR #148 (spec-`n/a` detection fix) and PR #151 (risk-graduated
review-tier governance) both merged earlier the same day.

**S7 — native role list + create/update/delete — implemented, reviewed, and merged as
PR #155.** Dispatched as one implementation (backend + frontend are tightly coupled per the
blueprint's own build-order reasoning) to a fresh Sonnet subagent. Reviewed by 3 fresh
Sonnet contexts (auth/permissions/migration-redesign is the heaviest ordinary-review row in
PR #151's new table) — one found a real MEDIUM (a whitespace-only role name passed Zod
validation, then silently normalized to empty before insert; fixed by moving `.trim()` into
the schema itself) — then a full Opus pass, CLEAR, with a committed note at
`docs/07-planning/security-reviews/155-s7-native-role-cutover.md`. That review's own
adversarial probing found **F2 holds** (cannot grant a capability you don't already hold)
and one non-blocking MEDIUM: the role lock (`4_003`) and membership lock (`4_002`) don't
serialize against each other, filed as issue #156.

**Before merging, the orchestrating session itself verified the UI, rather than accept the
implementing/reviewing agents' honest "no browser available" gap.** Stood up an isolated
dev environment (fresh git worktree at the PR's head, fresh Postgres database, both API and
web dev servers running locally) and installed Playwright + a local Chromium binary
directly in the sandbox — `claude-in-chrome` was tried first and confirmed unusable for
this (it drives a browser on a different machine and cannot reach this sandbox's
`localhost`: `http://localhost:5173` failed to load while `https://example.com` succeeded
in the same tool). Bootstrapped a fresh instance admin, created a workspace, opened
`/dashboard/settings/workspace/roles`, and exercised all four native routes end to end:
list (page loads with the three default roles), create (`POST → 200`, toast, row appears
with the toggled permissions), update (`PATCH → 200`, toast, new permission count
persists), delete (`DELETE → 200`, toast, row disappears). Screenshots taken at each step
and sent to Thomas directly. The PR body's "Screens opened" section and the frontend
checklist's screens-opened box were then rewritten from the honest prior `BLOCKED` state to
the concrete route/viewport/click/screenshot account this template requires, re-checked
locally with zero problems (`node scripts/ci/check-pr-template.mjs`), and pushed via
`gh pr edit` — which does not change the head SHA, re-confirmed directly
(`fa8f98a34b62b171563b49c29d17686f42e6d5be`, matching the Opus-reviewed head exactly) before
merging with `gh pr merge 155 --merge --delete-branch=false`.

**Immediately after merging, found PR #107 (S10) is not actually unblocked by S7 landing.**
Its own PR body already documents a separate, pre-existing problem: the caller-count
scanner it implements (`scripts/ci/lib/organization-callers.mjs`) has had seven distinct
false-zero bypasses found across three Opus review rounds — rounds 5–6 fixed four of them,
round 7 found three more and *deliberately declined* to attempt an eighth remediation
round, judging the recurring pattern itself (a new gap every time an independent reviewer
looks) to be the more important finding. The independent-security-review checklist box is
intentionally left unticked, and the PR body itself says **DECISION REQUIRED FOR THOMAS**
before another round is attempted. Not something this session should route around or
resolve unilaterally — recorded here and in the Scheduler/Throttle 1 sections above rather
than acted on. `status.md` was reconciled to reflect S7 as landed and this as the new,
narrower shape of what's left before Throttle 1 opens.

Cleaned up after: killed the background API/web dev servers, dropped the throwaway
`s7_dev_verify` database, removed the verification git worktree and the now-fully-merged
`feat/6-s7-native-role-cutover` local branch. Local `main` fast-forwarded to `a879033`.

**Also found and corrected while reconciling this file:** PR #116 was already MERGED
(`bc57228`, 2026-09-15T18:41:14Z) — the Scheduler's own "third review in progress" row for
it was itself stale, describing a state that had already resolved before this file's prior
"last updated" snapshot was even taken. Removed from the scheduler.

**Not done this session (this entry):** PR #107 was not touched or remediated — that
decision belongs to Thomas. The
`storage.filesystem` UAT gap and a live `docker build`/`docker run` redeploy were not
started.

### 2026-09-15 (continued further) · Control-plane docs reconciled (PR #137); S9 landed (PR #104), needing two rebases; PR #116 mid-review

Continuation of the same session, picking up right after the previous entry. Two more pull
requests merged: **#137** (docs-only — reconciled `status.md` and the retrofit ledger
against #110/#122/#119's closure of #82/#118, corrected the "S7 unblocked" language,
refreshed the UAT-gap table; two independent Sonnet reviews found two stale
"blocked on #82 AND #118" leftovers the first pass missed — both fixed and re-confirmed
CLEAR at the corrected head) and **#104** (S9 resolved as documentation-only, Path B —
already fully reviewed weeks earlier, but stale against a fast-moving `main`).

**PR #104 needed two full rebases, not one, because `main` kept moving under it while it
was being prepared.** The first rebase (merging `main` at the #110/#122/#119 point)
resolved real conflicts in `decision-log.md` and the retrofit ledger's stage table, and was
delta-reviewed CLEAR by two Sonnet reviewers. Before that clearance could be acted on, PR
#137 merged and touched the exact same retrofit-ledger rows — a fresh, real conflict a
reviewer's own `git merge-tree` dry run predicted before it was acted on. A second rebase
resolved it. **Both delta reviews were done by resuming the same two reviewer contexts**
(not spawning fresh ones) with the exact new head each time — the established pattern this
session uses to avoid re-deriving a full review after a small, well-understood delta.

**A real process incident, worth recording so it does not recur:** mid-way through the
first rebase's conflict resolution, the shared lane worktree (`lane-e-a1`) was reset out
from under the orchestrator — most likely by a review subagent's own end-of-task cleanup
mistaking the shared worktree for one it owned, rather than creating its own isolated copy
as instructed. No work was permanently lost (the reset landed on a valid, if incomplete,
intermediate commit), but the second rebase attempt was deliberately done in an isolated
**detached** worktree instead, pushed by SHA rather than by branch checkout, specifically to
avoid a repeat. Review-agent prompts for the following PR (#116) were updated to state this
explicitly. Also found and removed roughly 35 stale, fully-detached leftover review
worktrees under `.taskdesk-reviews/` and `/tmp/`, spanning already-merged and still-open
PRs alike — the same worktree-accumulation anti-pattern the governance reset's decision-log
entry already named as a contributor to the earlier stall.

**PR #116** (widening the security-review-scope glob list, closing #115) is mid-review:
it is CI/security-control machinery, which `AGENTS.md`'s review-tier table requires **3**
ordinary reviews for, not 2 — a requirement its own prior review round had missed. Two
Sonnet reviews are posted and CLEAR (one found and fixed a real MEDIUM); a third is
in progress. Not yet ready for the Opus pass.

**Not done this session (this entry):** PR #116 has not merged — still needs its third
ordinary review, then Opus. S7 has not been implemented. The two remaining UAT gaps
(static file serving, `storage.filesystem` driver) have not been started.

### 2026-09-15 (continued) · #82 and #118 both closed; S7 unblocked; UAT-0's two prerequisite gaps closed

Continuation of the same session. Three pull requests merged: **#110** (#82 — one
membership/one role reconciliation), **#122** (#118 DB half — `UNIQUE (workspace_id, role)`,
migration `0051`), **#119** (#118 evaluator half — both authorization evaluators now refuse
rather than guess on an ambiguous role definition), and **#132** (two of the four UAT gaps:
`TASKDESK_PORT` now read via `resolvePort()`, `/api/public/health/{live,ready}` added — the
latter's review found and fixed a real bug, an idle pooled client's error surfacing
unhandled on the connection pool and crashing the process under `/ready` polling). Each
pull request independently reviewed at 2 fresh Sonnet + 1 Opus, all CLEAR, each with a
committed security-review note declaring the exact reviewed head.

**The one real mid-flight hazard, tracked to a verified fix rather than assumed benign:**
#122 merged to `main` while #119 was still under review. Once `main` (with #122's new
constraint) was merged into #119's branch, #119's own test setup broke — its shared
`plantDuplicateRoleRow` helper tried to insert a second `workspace_role` row for a pair the
new constraint now rejects. The Opus reviewer caught this mid-verification and explicitly
said "do not merge — the answer changed while I was verifying" rather than let a stale
verdict stand. Fixed by deleting the now-superseded test (its coverage already exists in
#122's own suite) and reworking the remaining one to drop the constraint, plant the
conflicting row, assert, delete the planted row and restore the constraint inside a single
`try`/`finally`. Verified, not just asserted: reproduced the original failure, confirmed the
fix passes standalone and combined with #122's suite (6/6, proving genuine restoration, not
superficial), confirmed non-vacuity by mutating the production predicate two different ways,
forced the test's own assertion to fail and measured that the cleanup still ran correctly,
and ran the entire integration suite (56 files / 525 tests) against a lane-private database
before treating the final SHA as settled.

**Issues #82 and #118 both CLOSED.** S7 (native role list + writes) has no remaining
precondition and is the new critical-path item — **not yet started**. See the Scheduler,
above, for what is runnable next: S7 itself, PR #104 (S9, needs a rebase), and PR #116
(widening the security-review scope — itself self-referentially in scope, needs the full
2 Sonnet + 1 Opus ladder, not a docs-tier pass).

**Not done this session:** S7 has not been implemented. The remaining two UAT gaps (static
file serving, `storage.filesystem` driver) have not been started. PR #104 has not been
rebased. Continuing immediately rather than stopping here.

### 2026-09-15 · Governance reset merged; S7 dependency corrected; live scheduler added

Two pull requests merged this session: **#111** (issue #108 characterization — a
prototype-key role name crashes the still-mounted plugin's evaluator while the native one
denies cleanly; real RED→GREEN against a live database, adversarially verified by mutating
the test's own assertions) and **#129**, a governance rewrite of `AGENTS.md`/`CLAUDE.md`
delegating merge execution to the orchestrating Claude session once required gates are
green, simplifying model routing to Sonnet (implementation/ordinary review/a new
alignment-check role) and Opus (explicit subagent, final security/critical review only —
dropping an earlier multi-provider-router experiment), and making a live UAT deployment
active priority.

**#129's own review process is the most durable thing about this entry.** Seven independent
review rounds across two Sonnet lenses and one Opus security lens found and closed three
real defects: two dangling/dropped-content issues in the rewrite itself, and — the one worth
remembering — the delegation silently removed the only real check the gate-waiver mechanism
ever had on waiver *authorship* (Thomas being the one physically at the merge button). Fixed
by excluding any waived-gate candidate from the delegation outright, not by re-asserting the
old sentence. Filed #130 to track the harder, unsolved version of the same problem
(reviewer identity generally is self-reported, not mechanically verified).

**Corrected, verified against source rather than an older snapshot:** S7's real release
condition is **#82 AND #118**, not #82 alone — the file said "#82 alone" for six days while
PR #123 (still open) already carried the correction and issue #118 (with its two remediation
PRs #119 and #122, both currently open with zero independent review) existed the whole time.
See the retrofit ledger and Blocked, below.

**Added the `## Scheduler` section** — a live, dependency-aware P0→P7 view (CRITICAL_NOW /
NEXT_DEPENDENCY / SAFE_PARALLEL / BLOCKED / DEFERRED), so "P0 isn't finished" stops being
read as "nothing else may start" when the actual dependency graph says otherwise. Also
verified, directly against the current tree rather than an earlier finding: all four known
UAT/deployability gaps (hardcoded port, missing health endpoints, no static serving, no
`storage.filesystem` driver) are still unfixed.

**Not done this session:** S7 itself has not been implemented. #82 and #118 have not
closed. No UAT gap has been fixed. The next runnable work — reviewing PRs #110/#119/#122 at
the tier each actually still needs, then starting the UAT gaps in parallel — continues
immediately rather than stopping here.

### 2026-09-09 · PR #68 rebased onto #19; status.md reconciled against a moving repository

Branch `docs/session-only-and-instance-admin-decisions` (PR #68) was cut before #19 merged
and had never run the gate matrix #19 introduced. Rebased once onto `origin/main`
(`955f8d4` → `e11976f`); one conflict, in `decision-log.md` (both branches had inserted
newest-first entries at the same point) — resolved by keeping both entry sets intact, PR
#19's four gate-machinery entries first, then this branch's two, verified afterwards with
`git diff origin/main..HEAD` showing **zero removed lines** in that file.

**Full gate matrix run and green**, real counts, not copied from the task brief: `lint:ci`
(1031 files, 53 warnings, 0 errors), `check:env`/`check:vocabulary`/`check:reviews`/
`check:skips`/`check:overrides`/`check:openapi` (122 operations match)/`check:i18n`, all
exit 0; `check:route-policy` and `test:permissions` both 10 files / 74 tests; `test:all
--list` 0/0/17-not-enabled; `audit --audit-level=high` 2 moderate, exit 0; `test:ci-scripts`
45 suites / 304 tests; `typecheck --force` and `build --force` both green; `test --force`
114 files / 728 tests across 6 packages. Only the known, intentional blocker remains:
`check:pr-template` red on the unticked independent-security-review box and the missing
committed note — not fixed, per instruction.

**status.md brought forward across five merged PRs (#64, #62, #65, #67, #19)** — the ON
MAIN / IN OPEN PR / BLOCKED / DECIDED sections, the security-status table and the Throttle
1 table all rewritten against the live repository rather than the prior snapshot. #19 is
the load-bearing fact: `main` runs CI and all nine `check:*` gates for the first time.

**Found in passing, verified rather than assumed:** PR #19 itself merged with its own
`check:pr-template` gate **failing** — the same two problems this PR's gate will show —
one second before Thomas merged it (`4c24b8a4` checked 06:23:13Z, merged 06:22:54Z). No
decision-log entry records it as an authorised deviation the way #13's is. Recorded in
ON MAIN and Blocked → Process deviation; not something this lane may resolve.

**The repository changed under this correction while it was being written**, and the
second change is the more important one to get right: Throttle 1's condition 3 was
drafted here as unmet — needing a required-status-check ruleset change "only Thomas can
make" — and then Thomas made exactly that change (`protect-main` ruleset `22365005`,
`updated_at 2026-09-09T06:28:04Z`) and closed issue #7 (`closedAt 06:29:48Z`) minutes
later, live, during this session. Re-verified against the API rather than left as first
drafted or trusted from the closing comment's own claim. Throttle 1 is now four of five
conditions met — only issue #6 (the retrofit through S10; only S0/S1/S2/S4 have landed)
keeps it closed. Stated precisely rather than rounded up: **Throttle 1 is still not
open.**

**Not done:** the security-review checkbox and note (by design — not this lane's to
satisfy); no decision-log entry added for #19's deviation (flagged for the orchestrator,
per control-plane ownership); no attempt to advance retrofit S3 or later (out of scope for
this PR).

### 2026-09-06 · #11 deployment skeleton built and measured on the real host

`feat/p0-deployment-skeleton`. A `Dockerfile` that builds, Compose base plus three
overlays, Traefik middlewares, `scripts/deploy.sh`, and a corrected Helm chart.
`Dockerfile.kaneo` is deleted rather than repaired — it could not build, and that break was
also why the repository's only `NODE_ENV=production` was unreachable (security review 13,
E-9).

**What was verified, not assumed.** `docker build` succeeds. The entrypoint refuses to
start and names all five missing variables. The container runs as uid 10001, carries
`NOTICE`, `LICENSE` and `THIRD-PARTY-NOTICES.md`, and its attachment directory is writable
by that user. `docker compose config` passes for every overlay combination, the production
render contains **no `ports:` at all**, and `helm template` fails closed on each missing
secret with its own message and succeeds when they are supplied.

**The trust-proxy value was measured rather than guessed**, which was the point of the
exercise and which found more than the number. TLS terminates at **CloudFront, not
Traefik** — a real request to `ticket-uat.bimats.com` arrived on Traefik's plain `web`
entrypoint. Both CloudFront and Traefik **append** to `X-Forwarded-For`, so the value is
`2`, set in the UAT overlay only. The same measurements showed that `X-Forwarded-Proto`
reaching the application is either attacker-supplied or wrong, which no amount of counting
boxes would have revealed. Full method and captured headers:
[proxy-topology-evidence.md](../05-operations/proxy-topology-evidence.md).

**Four application-side gaps stop the stack actually coming up** — a hard-coded port 1337,
the two missing public health endpoints, no static file serving in the Node process, and no
`storage.filesystem` driver. They are listed under Blocked. None of them is deployment
work, and none was worked around here: the skeleton is built to the documented contract and
the gaps are named.

**Not done:** `install.sh`. `scripts/deploy.sh` carries the production pre-flight the
one-liner needs, but the bootstrapper itself is not written. The Helm chart is corrected,
not rewritten to [kubernetes.md](../05-operations/kubernetes.md)'s two-Deployment,
three-Ingress-host contract — that is a larger piece of work and the chart is a P2 CI
artefact.

### 2026-09-06 · #5 completed on the branch — de-brand, lockfile delta, environment migration

Continues the import session under Thomas's cloud-agent working agreement, which closed the
decisions that had held the copy. The provenance order in `repository-bootstrap.md` §2 was
followed in its stated sequence — untouched baseline, imported graph proven, copy proven,
**then** rename, **then** an intentional lockfile regeneration, **then** a fresh audit and a
measured delta — so upstream and TaskDesk changes stay distinguishable.

**De-brand.** The five workspace packages and both apps moved to `@taskdesk/*`, and the
brand left 209 source files: CSS class names, tiptap and ProseMirror node names, React
component identifiers, i18n values across all 20 locales, email templates, the Helm chart,
the motion specs, and four paths that carried it in the filename. Four cases were checked
against the specification instead of swept: **`X-Kaneo-Signature` is a real HTTP header in
retained code** — notification delivery keeps it after #6 deletes the webhook router — and
it became `X-TaskDesk-Signature` because `webhooks-and-api-keys.md` **WH-1 already names
that header**, so the sweep implements the spec rather than changing behaviour;
`breadcrumbKaneo` was an i18n lookup **key**, renamed with its single usage; `KANEO_*`
variables were protected because they belong to the environment migration; and
`Dockerfile.kaneo` was deliberately left named as kaneo's, because it is still kaneo's
unrewritten three-image Dockerfile and **cannot build in this tree** — it copies three files
the copy table excludes. Verified that no kaneo copyright header was destroyed: kaneo
carries none in source, attribution is the root `LICENSE`, preserved verbatim.

**Lockfile regenerated deliberately, and the delta measured rather than assumed.** 1635
external packages upstream, 1566 now: **zero added, 69 removed**, all transitive
dependencies of workspace packages the copy table excludes. `pnpm audit` moves 12 → 11
advisories (0 critical, 8 high, 3 moderate); the one `low` disappeared because it reached
through `apps/site`, which is not copied. Trivy unchanged at 7 high, 0 critical.

**Environment migration.** All **98** variables classified — not the "~80" the planning
documents quote. The gap is entirely **indirect reads**: the seven S3 connection variables
go through a local `env()` helper, four `CREEM_PRODUCT_*` through a lookup table, and the
eight `SMTP_*` through a parameter default. A `check:env` gate that only greps
`process.env` would pass a tree that still reads unapproved configuration. Four of the five
required TaskDesk variables were renamed from their kaneo ancestors and the integration
suite was re-run under the new names to prove the rename is wired end to end.
`TASKDESK_PORTAL_URL` is genuinely new. `TRUSTED_PROXIES` was **not** renamed: kaneo takes a
CIDR list defaulting to all of RFC1918 while TaskDesk takes a hop count, which is a
behaviour change on a security boundary whose value must be **measured** in #11, not
inferred from the topology.

**Three defects found and fixed on the way.** `.gitignore`'s `.env.*` rule silently excluded
`apps/api/.env.test.example`, which the copy table says to copy — it was on disk and never
committed. `turbo.json` declared no `globalEnv` at all. And `biome.json` pinned schema
`2.5.4` while `package.json` declares biome `2.5.7` — **upstream kaneo's committed lockfile
was behind its own declared devDependency**, which only the deliberate regeneration
surfaced.

**Status, precisely.** #5 is **in progress**, not complete: the branch is pushed, every gate
that exists today is green, **no pull request is open, no security review has happened, and
nothing is merged.**

### 2026-09-06 · The P0 working agreement recorded; issue #5 provenance evidence produced

Two branches, both pushed, neither merged. Machine: Linux/EC2, **not** a Mac — `open -a
Docker` does not apply here, `docker info` does, and the Docker daemon was already running
88 containers.

**Task 0 — the working agreement** (`docs/p0-working-agreement`). Thomas's confirmed
sequencing was settled in conversation but written down nowhere. One new `CLAUDE.md`
section, "The P0 working agreement", in eight parts — the #4–#11 dependency graph, the two
throttles and the rule that Throttle 2 gates the *claim* and never the throttle, the P1–P4
parallel lanes, a blocking taxonomy graded by blast radius, shared-contract ownership, the
spec interaction rule, the reference restriction, and authority — plus the matching
decision-log entry. The `branch → commit → pull request → Thomas approves → merge` flow was
deliberately **not** restated as new; it is already settled in two places and the new
section points at them.

**Task 1 — issue #5, provenance steps 1–4** (`feat/issue-5-kaneo-import-provenance`). The
mandated order was followed exactly. A throwaway `git worktree` detached at
`42bb801114aa1ae499228a53180f0cdbc5607964`, so the reference clone never gained a
`node_modules` — verified afterwards that it still has none. `git fetch` first, and the
pinned SHA is still the tip of upstream `main`.

**The attribution baseline, every check green on the untouched snapshot:** typecheck,
build, `i18n:check`, `openapi:check`, and `lint` (which is `biome check --write .` and
changed nothing, so the snapshot is already biome-clean). Unit: **130 files, 692 tests, 0
failed, 0 skipped**. Integration: **33 files, 227 tests, 0 failed, 0 skipped — identical on
Postgres 16 and Postgres 18**, which is the new information the bootstrap document asked
for, since kaneo's own CI validates only on 16. Supply chain: `pnpm audit` 12 advisories (0
critical, 8 high) and Trivy 7 high / 0 critical over the same package set — two scanners
agreeing. Every high was traced to its dependency path rather than counted, and none is
reachable in a shipped TaskDesk: all sit in devDependencies (`@commitlint/cli`), build-time
tooling (`postcss`/`nanoid`) or optional peerDependencies kaneo never imports (`mysql2`,
`prisma`). The only advisory on a shipped path is `qs`, moderate, via the MCP SDK's
`express`. `trivy config` on `Dockerfile.kaneo` is clean.

**The copy was performed, and the imported tree is green.** 1,268 files from a `git
archive` of the SHA — tracked files only, so no `node_modules`, `dist` or `.turbo`
travelled. Every *Do not copy* row was verified absent afterwards; every *Copy* row
present. On the imported tree: typecheck, build, lint, `i18n:check`, **unit 124 files /
636 tests**, and **integration on Postgres 18 at 33 files / 227 tests — identical to the
kaneo baseline**. The unit count reconciles exactly against the 130 / 692 baseline:
`packages/planka-import` is not copied (5 files, 54 tests) and `apps/web/src/env.test.ts`
is deleted (1 file, 2 tests).

**Four things the copy table does not cover**, applied as stated in the commit message
rather than decided silently: the two kept `skills/*` are symlinks into `.agents/`, a
*Do not copy* row, so they were dereferenced; `apps/web/src/env.test.ts` asserts on the
excluded `apps/web/env.sh` and was deleted with the mechanism it covers; `scripts/openapi/`
has no verdict row and **running it proved it cannot simply be adopted** — `check.mjs`
writes `apps/docs/openapi.json` and `apps/docs` is *Do not copy* — so the table default was
applied and **the OpenAPI drift check is lost** until Thomas says where it should write; and
`.gitignore` was merged rather than overwritten.

**§2 de-brand cannot be completed inside #5, and that is a sequencing defect worth
recording.** Only the web entry document and the manifest were de-branded. Each remaining
part is coupled to work §1 or §3 defers: the `@kaneo/*` → `@taskdesk/*` rename changes a
`workspace:*` specifier, which breaks `--frozen-lockfile` and forces regenerating the
lockfile §1 says to keep until after the removals — measured at 799 changed lines, 69 of
them external `resolution`/`integrity` lines, which would invalidate the audit baseline
recorded in this same branch; `emailDomainName: "kaneo.app"` leaves with the anonymous
plugin, as §2 itself says; and the i18n sweep would rename `X-Kaneo-Signature`, an HTTP
header in the webhook contract, so it is not branding. The lockfile was verified
**byte-identical to kaneo's at `42bb8011`**.

**Still open: seven documentation decisions** — the Sentry and
`KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS` self-contradictions, `scripts/openapi/`'s real
home, and the seven missing **S3 connection variables**, which `apps/api/src/storage/s3.ts`
reads through a local `env()` helper at lines 79-81 and which a `process.env.X` grep
therefore cannot see. The environment migration is not applied.

**Two inherited security defaults were found that are on no removal list**, both verified
in source: `rateLimit: { enabled: isCloud() }` at `auth.ts:566` — rate limiting is off for
every self-hosted instance, and stripping `KANEO_CLOUD` would make that permanent rather
than fix it — and `apiKey({ enableSessionForAPIKeys: true })` at `auth.ts:536`, a third
authentication surface larger than the two already slated for removal. This is the same
pattern as the `anonymous()` and `accountLinking` finds: it was only visible by opening
`auth.ts`.

**UAT.** No cutover was attempted. v1 UAT runs as compose project `taskdesk-uat`, and its
declared config directory `/home/ubuntu/ticketing-uat/` no longer exists — the equivalent
files are in `ticketing.v1/`, and `docker compose config` was verified to resolve the same
nine services from there, which gives a working rollback command. Today's database dump was
verified readable with `pg_restore -l` (76 tables). **TLS does not terminate at Traefik**:
both UAT hostnames resolve to CloudFront with an ACM wildcard `*.bimats.com` valid to
2026-12-11, and Traefik serves only the plain `web` entrypoint behind it — so there is no
per-host certificate to reissue at cutover, which makes the swap simpler than assumed. **v1
UAT is not idle**: an interactive Entra-authenticated session on 2026-09-05 05:54 UTC. And
a v2 UAT deployment is not possible yet regardless, because `ticketing.v2` still has no
application code.

**Toolchain.** Node 24.20.0 and pnpm 10.32.1 installed **user-locally** via `fnm` and
`corepack`, not machine-wide. There is no `gh` and no GitHub token anywhere on the host;
SSH push works, so branches are pushed and pull requests cannot be opened.

**Not done, deliberately:** the kaneo copy, de-brand and environment migration (held on the
seven decisions); the issue dependency-link corrections and the Project board (no token);
a second-model review of either branch (none available — recorded as unreviewed rather than
downgraded, per the third absolute); and no committed security note, because
`docs/07-planning/security-reviews/` does not exist and its filename needs a pull-request
number that does not exist yet.

### 2026-09-06 · Confirmed decisions applied; licence and provenance files opened as a pull request

Thomas returned a confirmed decision document closing everything the pre-P0 check had left
open, and adding repository setup. Applied in two pull requests.

**Licence and provenance** (its own pull request, the provenance boundary before the kaneo
import): `LICENSE` (AGPL-3.0 verbatim), `NOTICE` (copied into the image, section 13 stated
plainly), `THIRD-PARTY-NOTICES.md` (kaneo's MIT licence verbatim with its holder, the
confirmed snapshot commit and why it is not the `v2.22.0` tag, the projects studied but not
copied, and the rule that third-party code arrives with its notice in the same pull request).

**Documentation**: the SHA and the inherited-migrations decision marked **confirmed**
everywhere they had said "pending"; **stage / workstream / step / state** separated into one
word each, which required renaming the SDLC's nine stages to **steps** and ADR 0011's loose
"stages" to **states** so the new word had one meaning; product principle 7 restated to
constrain what may be *claimed* finished rather than what may be *started*; the security
line broken into seven rows because "complete" described the documents and was being read as
the product; the Sep 12 milestone renamed **Foundation Technical Preview**; the **engine
boundary rule** (swappable ⇒ plugin, single implementation ⇒ domain module plus a flag);
**RLS promoted from deferred to a P0 prototype** on `work_item`, `comment` and `attachment`
with a merge-or-drop exit; the **person model** — one person, one organisation, email is not
an identity key, two rows for a human who needs both portals with the same address allowed,
impersonation as the supported route for staff, and the two-customer-organisations consultant
recorded as an accepted limitation; every command in README and AGENTS.md marked **planned,
not available until P0 completes**; the **week-2 scope confirmation** given an owner and a
moment; **do-not 16** rewritten as the working mode — branch → commit → pull request →
Thomas approves → merge, and never leave finished work uncommitted.

Nine decision-log entries. Link check clean.

Opened as two pull requests — **#2** (licence and provenance, closing issue #4) and **#3**
(the confirmed decisions and `CLAUDE.md`) — and eight P0 issues, **#4–#11**, as vertical
slices with dependency lines rather than one issue per screen. The GitHub Project board is
the one thing not done: the token lacks the `project` scope.

**Not done, deliberately:** no kaneo import and no P0 code — the hard stop is the licence
pull request merging.

### 2026-09-06 · Pre-P0 check applied — the plan corrected against kaneo's real source

Thomas asked whether the corpus had been checked "file by file" and whether anything would
bite later. Fable ran a whole-corpus check: deterministic scripts (links, flags, env vars,
identifier registries — all clean) plus eight background Opus lenses (bootstrap vs kaneo,
RBAC/security, identity, data model, design, planning, process, operations), each writing
findings incrementally; every Top-5 claim was re-verified against the files before use.
≈200 findings, ≈60 high. The registries held (111 tables, 84 capabilities, 38 events, 22
flags — zero orphans); the defects were **kaneo reality, contradictions, missing columns and
mechanisms, and prose-only process rules**.

Thomas then directed that nothing stay in a review file. Applied in one pass (fourteen
decision-log entries; eight file-partitioned edit agents; Opus review): the **kaneo snapshot
SHA** proposed as upstream main `42bb8011` (the `v2.22.0` tag predates authorization fixes)
— pending confirmation; the **fork-time removal and disable list** (kaneo enables
better-auth's `anonymous()` guest sign-in by default, ships `accountLinking.enabled: true`
with the generic OIDC provider trusted, and a five-minute session cookie cache — none of it
was in any document); the **environment migration table** (≈80 kaneo variables →
five-plus-six); `public-project` as a file checklist including the anonymous
attachment-read path; migrations inherited from kaneo's 45 (recorded from Thomas's message,
to confirm); `storage.filesystem` as the fresh-install default with SeaweedFS as an opt-in
profile; CSRF scoped to cookie auth; `orOwner` requiring the `*_own` capability; elevated
DELETEs refused to non-session credentials; `pending_action` gaining `payload`/`route_key`;
Entra claim rules Entra can actually satisfy; the reload mechanism watching
`identity_connection`; `scheduled_transition`, `first_response_at`, `is_reopen`, legal hold,
quotas, tombstones; Radix → Base UI in six documents (kaneo is already 43/63 Base UI);
design tokens split into inherited-verbatim and authored; compose ports out of the base
file; the PR template written and specified; do-not 16 (Thomas's wording); the third
absolute (wait, never downgrade the reviewer); the two-lane go-live rehearsal gate;
marketplace deferral everywhere; Pages marked spec-required; twenty reports. Thomas's two
agent-report messages were verified item by item: all valid except the claim that email was
missing from the decision log (it was at line 59; a dedicated entry now exists anyway).

Method note: the Workflow tool was not used (it stalled three times on this corpus the day
before); plain background agents with incremental files completed 8/8 for the review. In
the apply pass five of eight edit agents were killed by a 600 s stall watchdog mid-edit and
were resumed with their context; edits were verified by diff afterwards.

**Not done, by rule:** nothing committed or pushed (do-not 16). **Next:** Thomas confirms
the SHA and the migration approach and says "commit"; then P0 step 1.

### 2026-09-05 · Decision document applied — identity/SCIM core, universal deletion approval, deferred scope

Thomas supplied a confirmed decision document (sections A–N: flexible timeline as an
operating rule; kaneo as a one-time snapshot; public boards deleted; reach-affecting project
fields; service-key bounds; MCP on normal RBAC; MCP read-only default and prompt-injection
posture; universal deletion approval with confirmation levels; no automation delete;
trusted-proxy hop count; internal red-team gate; customer request visibility; Base UI as the
primitive standard) plus an identity update making **Microsoft Entra OIDC + SCIM core P3
delivery**, and an [external readiness review](reviews/2026-09-05/readiness-review-external.md)
("Conditional GO — one documentation-closure PR first").

Applied in one closure pass: new [pending-actions.md](../01-architecture/pending-actions.md)
(`PA-1`–`PA-14`, `pending_action` table, `/api/me/pending-actions/*`, `202` semantics,
session-only approval); new [identity-provisioning.md](../03-features/identity-provisioning.md)
(`IP-1`–`IP-25`, six identity tables, `/scim/v2/*` as `delegated: scim`, 17 acceptance tests
against a real Entra tenant); [auth-and-identity.md](../01-architecture/auth-and-identity.md)
made the identity owner; `rbac.md` (MCP = same RBAC, session-only routes, elevated list),
`security-model.md` (SCIM and deletion sections, evidence chain), `data-model.md`,
`api-design.md`, `events.md`, `background-jobs.md`, `plugin-architecture.md` (flags
`feature.scim`, `feature.dev_links`; notify/devlink future priorities), `mcp-server.md`
(`MC-19`–`MC-22`, `delete_work_item`, no purge tool), `god-mode.md` (Organisation →
Identity; nineteen screens), `customer-portal.md` (`CP-16` visibility, `CP-17` org SSO),
`automations.md` (`AM-13`), `work-items.md`, `attachments.md`, `comments-and-activity.md`,
`webhooks-and-api-keys.md` (`AK-10`, `AK-11`), `inherited-features.md` (integration routers
removed at fork; Base UI), `ui-extraction-plan.md`, `tech-stack.md`, `ci-cd.md`,
`testing-strategy.md` (four new test families), `screen-inventory.md` (136), `phases.md`
(operating rule; P0/P1/P3/P4), `release-plan.md`, `accelerated-delivery-plan.md`,
`roadmap.md` (deferred list with priorities), `aws-marketplace.md` + ADR 0013 addendum
(BYOL/contract preferred), `data-protection.md`, `definition-of-done.md` + `sdlc.md`
(review-section-empty gate), `AGENTS.md` (do-not 12–15), glossary, decision log, this file.

Then a **four-lens consistency check** (identity/SCIM · pending actions · scope/timeline ·
identifiers/counts) over the result, every finding re-verified against both files before
being applied: ~70 fixes, mostly stale wording that pre-dated the decisions (Radix/Keycloak/
Slack/marketplace mentions, "flagged off" for routers now deleted, "empty application" for
the P0 exit), plus three real structural ones — `membership.scope` gained `organisation` so
the customer role has a row to live in; `prev_hash`/`row_hash` added to `audit_log`; and the
rule-id prefixes `AU`/`SV`/`RL` were each defined twice, so automations became `AM-n`,
services `SVC-n`, releases `REL-n`, with a prefix registry in the features README.

Next session: **P0 step 1** — copy kaneo at a recorded SHA, delete `public-project` and the
integration routers, fill the inherited-features register, then the router retrofit.

### 2026-09-05 · Fable session — parallel audit, closure pass, security fold-in, first push

Model switched to Fable 5.1. Ran a six-reviewer parallel audit of the whole corpus (five
Opus reviewers — core/service-desk specs, governance/design specs, architecture/engineering/
ops, cross-document consistency, security — plus a Sonnet verifier for OpenProject/ITSM
feature gaps), after a Workflow-tool attempt stalled twice and was replaced by plain
background agents writing findings incrementally. Findings live in
[reviews/2026-09-05/](reviews/2026-09-05/) and are summarised in
[review-2026-09-05.md](review-2026-09-05.md).

Then the **closure pass**: `data-model.md` rewritten as the single authoritative schema
(workspace-scoped `state` + `project_state`, ~30 previously unmodelled tables added);
`rbac.md` rewritten with five closed policy kinds, a capability implication graph, the
built-in role × capability matrix and the one elevated-actions list; `api-design.md`,
`background-jobs.md` (lease SQL corrected), `screen-inventory.md` (recounted: 133),
`god-mode.md`, `settings-hierarchy.md`, `security-model.md` (threat model) rewritten; the
canonical event catalogue ([events.md](../01-architecture/events.md)), teams spec,
auth-runtime-reconfiguration, i18n, migrations, repository bootstrap, UI extraction plan,
container image, Kubernetes values contract and data-protection documents written; the
env file cut to five required variables with a first-run setup page replacing the
bootstrap email, at Thomas's direction.

**Security fold-in** (the review completed last): PKCE/`state`/`nonce` as the OIDC
protocol floor; reach-affecting project fields moved to `project:manage_members`; service
keys bounded by their creator; MCP destructive tools behind out-of-band human approval
with tool output marked untrusted; AI plugin rules (scoped retrieval, output as untrusted
input, audit, spend cap); `TASKDESK_TRUST_PROXY` as a hop count with the app port never
published; webhook delivery and audit reads reach-scoped; placeholder visibility (`AM-11`);
impersonation forbidden from creating durable authority; five new threat-model rows;
`public-project` deleted at fork; the kaneo router retrofit named as P0's largest security
task with its own Opus review; an internal red-team pass at the go-live gate; ten new
negative security tests; R20 added. All high-severity findings are closed in the corpus;
the medium/low items that are per-spec are listed in the review files and close at each
spec's SDLC step 2.

Also: `.gitignore`, `CHANGELOG.md`, [release-plan.md](release-plan.md) (channels, `stable.txt`,
`release/2.N` branches, migration matrix), first commit and push to `docs/v2-planning-corpus`,
PR #1.

Next session: **P0 step 1** — copy kaneo at a recorded SHA, delete `public-project`, fill
the inherited-features register, then the router retrofit.

### 2026-09-05 · Continuation — ITSM review, three new ADRs, accelerated calendar

Picked up after the OpenAI agent and then GitHub Copilot both exhausted their usage
limits mid-session. Surveyed the six additionally-cloned ITSM systems; corrected the tech
stack against actual current status (Postgres 18, Valkey 9, OpenAPI 3.2, and dropping
MinIO after confirming its open-source edition wound down through 2025–2026); wrote ADRs
0011–0013 (lifecycle engine, terminology overlay, marketplace metering); generalised the
plugin pattern into an explicit "engine pattern" required of every feature; specified the
one-line installer and the AWS Marketplace listing; added RBAC/API, OpenAPI-contract and
MCP test layers; recorded a model-tier policy for Claude Code's own subagent use, with a
mandatory Opus security checkpoint; added a three-tier reporting model; reconfirmed and
closed the one real gap in customer self-service (withdrawal); wrote a dated accelerated
delivery plan at explicit request, then revised it the same day once told the calendar is
a target and not a deadline under pressure; added `CHANGELOG.md` and a release-notes
convention.

Key conclusions:

- The MinIO finding is the sharpest example of why "check current status, don't assume
  from training" mattered this session — a plausible-sounding default would have been
  wrong within the same year it was written.
- The engine-pattern generalisation and the "dates flex, architecture doesn't" framing are
  two directions of the same instruction, and are recorded together in the decision log
  for that reason.
- Nothing in this session touched P0's actual task list. The next session should begin
  P0, step 1, exactly as previously planned.

Next session: begin P0, step 1.

### 2026-09-05 · Planning

Analysed all four reference codebases. Established licensing constraints. Made and
recorded the ten architectural decisions. Wrote the complete documentation corpus —
roughly 65 documents across nine sections.

Key conclusions:

- v1's authorization *design* is its most valuable asset and is being carried forward
  (reach vs authority, directory-resolved identity, 404-not-403). Its *frontend* is being
  discarded entirely.
- v1's real failure was process, not code: features were declared done when they
  functioned. The nine-step SDLC and the thirteen automated UX gates exist to close that.
- The eleven authorization holes v1 shipped past a green suite were all *omissions*. The
  route policy registry converts that class of bug into a build failure.

---

## How to update this

At the end of every session:

1. Update the stage progress bars.
2. Update screen and feature counts.
3. Move anything finished into **Done**.
4. Restate **Next** with concrete steps, not intentions.
5. Record anything **Blocked**, with who unblocks it.
6. Add a session log entry, including what did not work.

Do not describe intent. Describe state. "Working on the board view" is not a status;
"board view renders and drags; keyboard drag not yet implemented" is.
