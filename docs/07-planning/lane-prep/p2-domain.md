> ## ⚠ Read this first — this is a PLAN written against an OLDER `main`
>
> **Baseline:** `955f8d4d`, the tip of `main` on 2026-09-06. **`main` has moved since**, and
> as of 2026-09-09 it is `d4510a2` with nine more pull requests merged. Statements below of
> the form "X does not exist on `main`" or "PR #N is open and unmerged" were **true when
> written and are not true now.**
>
> **What changed under this plan** (see [`../lane-prep/README.md`](README.md) for the full
> reconciliation):
>
> - `packages/domain` **now exists** (PR #69) — service calendars, 59 tests.
> - `packages/ui` **now exists** (PR #63) — the first primitive slice.
> - **CI exists on `main`** (PR #19): the `check:*` gates, `test:all`, the OpenAPI baseline,
>   and eleven required status checks on the `protect-main` ruleset.
> - Retrofit **S0, S2 and S4 have merged** (PRs #65, #67). S1 was already merged (#57).
> - Issue **#7 is complete and closed.**
>
> **What has NOT changed, and is the reason this plan is still the right starting point:**
> **Throttle 1 is still shut.** Its condition 2 requires issue #6 through retrofit **S10**;
> S3 and S5–S11 have not started. Every "do not write code yet" instruction below still
> stands, unchanged.
>
> This file is committed **as the research artifact it is** — deliberately not rewritten,
> because rewriting a dated plan to look current is how a snapshot starts lying. Trust its
> reasoning, its spec citations and its dependency analysis; re-verify every claim about
> what is or is not on `main` against `main`.

---

# P2 domain lane — prep plan

Prepared by Sonnet 5 PREPARATION agent, working tree at `955f8d4d` (= `origin/main` at prep time).
Scope: issues #31–#37 (workflows, SLA, service calendars, request types & catalogue, intake queue,
approvals & CAB, audit trail). **This is planning only — no code, no install, no build, no test run.**

Status: COMPLETE — all nine required sections plus ground-truth notes written. See
`NOT DONE` at the end for the documents not read in full and the residual gaps that follow
from that.

---

## 0. Ground truth read before planning (AGENTS.md / CLAUDE.md / status.md / decision-log.md)

- `packages/domain` does **not** exist on `main` (`955f8d4d`). Confirmed by directory listing:
  `packages/{email,libs,mcp,permissions,typescript-config}` only.
- **P2 definition (CLAUDE.md, "What runs in parallel after Throttle 1"):** "pure functions in
  `packages/domain` with exhaustive tests, before any HTTP endpoint exists."
- **Engine boundary rule (decision log, 2026-09-06, "The engine boundary — plugin, or domain
  module plus a flag"):**
  > Could two implementations of this be installed side by side and swapped by an administrator?
  > Yes → a plugin. No → a domain module plus a feature flag.
  > SLA, workflow, approvals, assignment, the terminology overlay: one implementation, varying
  > only in configuration and whether it is on.
  This is a **direct, named ruling covering four of our seven issues already** (SLA, workflow,
  approvals, assignment — assignment is P1/P2 split, see below). Nothing in P2 needs a plugin
  registry. This closes engine-boundary question 7 for SLA/workflow/approvals outright — see
  section 7 below for calendars and request types, which are not named in that ruling and need
  the same test applied rather than assumed.
- **Assignment split (decision log, "Small design choices..." table):** "Assignment: defaults
  and UI are P1; the rule *engine* ports with `packages/domain` in P2" — confirmed again in
  `docs/03-features/README.md`'s stage column: `Assignment | P1 (the rule *engine* ports with
  packages/domain in P2)`. So assignment is **not one of the seven P2 issues** but its pure
  selection logic lands in `packages/domain` too, alongside approvals (#36) which needs it.
- **Round-robin assignment is explicitly out of scope** (decision log, 2026-09-05): "A default
  assignee per project and per request type covers the real need." This bounds how elaborate the
  assignment-selection pure function needs to be — it is a lookup/fallback chain, not a
  load-balancing algorithm.
- **Teams / CAB (decision log, 2026-09-05 spec-closure entry):** "Teams has a spec (teams.md);
  the CAB is a flagged team." This is load-bearing for #36 — CAB is not a separate entity type,
  it is a `team` with a flag. Needs verification against `teams.md` and `approvals.md` directly
  (done below).
- **States are workspace-scoped** with `project_state` for per-project ordering/default/
  enablement (decision log, spec-closure entry) — relevant to workflow transition validity
  functions: the pure core must take the workspace's state set as data, not assume a fixed enum.
- **Transition `guards` and `effects` are closed vocabularies owned by `workflows.md`; SLA
  pausing is an effect, not a policy property** — direct dependency edge: workflow transitions
  can pause/resume SLA clocks, confirming SLA needs to expose a pause/resume primitive that
  workflow's effect-execution calls, not the reverse.
- **Reviews directory** `docs/07-planning/reviews/2026-09-05/` holds cross-cutting review files,
  not one per feature — see section 9 below; findings must be checked against each spec's own
  "Open questions" section (which the README rule says must be empty before implementation) plus
  these review docs before code starts.
- **Do-not 11 / vocabulary table**: every table/column → `data-model.md`; capability/policy kind →
  `rbac.md`; feature flag/plugin kind → `plugin-architecture.md`; event key → `events.md`;
  background job → `background-jobs.md`. All in the **same change** that introduces them.
- **Rule-id prefixes for the seven specs** (confirmed against `docs/03-features/README.md`):
  `WF` workflows · `SLA` sla · `CAL` service-calendars · `RT` request-types-and-catalogue ·
  `IQ` intake-queue · `AP` approvals · `AU` audit-trail. (`AS` assignment is P1/P2-split, listed
  separately.)

---

## 1. The `packages/domain` bootstrap

**Confirmed absent on `main`.** `pnpm-workspace.yaml` already globs `packages/**` and
`apps/**` — **no change needed there**. Verified by reading the file directly.

**Confirmed prior art on shape, from documents already on `main` (none of this needs
inventing — it is prescribed, just not yet built):**

- `monorepo-layout.md` § Package boundaries: `packages/domain ──► (nothing — pure)`. Rule:
  *"`packages/domain` may not import Drizzle, Hono, or anything with I/O. If a domain
  function needs data, the caller passes it in. This is what makes it testable."* A
  `dependency-cruiser` check plus a turbo task is supposed to enforce this — **does not
  exist yet**, and is itself a small piece of P2's bootstrap (see below).
- `repository-bootstrap.md` §4.1 (P0's own structure step, **not yet executed for
  `domain`**): *"Create `packages/domain`, `packages/permissions` (...) and
  `packages/plugins-contracts` as typed skeletons with one test each."* `permissions` is
  done (#21). `domain` and `plugins-contracts` are not. **This confirms scaffolding
  `packages/domain` was always someone's job before P2 could start** — the orchestrator's
  framing that "creating it is P2's first obligation" is consistent with this, since no P0
  slice has claimed it and P0 status shows item 5 ("Scaffold packages/domain,
  packages/permissions, packages/plugins-contracts") still open.
- ADR 0009 already prescribes the **exact signature** of the SLA pure core:
  ```ts
  computeSlaState({
    slaStartedAt, firstResponseAt, resolvedAt, priority, workItemTypeId,
    policy, calendar, pauses, now,
  }): { dueAt, consumedMinutes, remainingMinutes, state }
  ```
  "Lives in `packages/domain/src/sla/`. Pure, no I/O, exhaustively unit-tested."
- `background-jobs.md` § SLA scanning already names the call site: *"For each candidate,
  the pure `computeSlaState()` function from `packages/domain` runs."* — and gives the
  exact SQL that resolves which policy applies (`SLA-1`'s four-level coalesce), confirming
  policy **resolution** is a SQL/impure-edge concern, while **evaluation** (given a
  resolved policy) is the pure core.
- `events.md`: *"a CI test asserts the enum in `packages/domain/src/events/` equals this
  table"* — so `packages/domain` also owns the **event-key enum** (a pure data export, not
  logic), shared between the API, automations and webhooks.
- `sdlc.md` / `testing-strategy.md` / `ci-cd.md`: 90% coverage on `packages/domain`,
  measured **per package**, via `pnpm test:coverage` (`@vitest/coverage-v8`) — **the
  review at `architecture-engineering-ops.md:133` found this stated as an exit criterion
  in two documents and wired into no pipeline step.** `turbo.json` today has no
  `test:coverage` task at all (verified: `build`, `dev`, `lint`, `typecheck`, `test`,
  `test:permissions`, `test:integration` only). This is a **shared-contract gap**, not
  P2's alone to fix silently — see below.

### Exact files for the bootstrap PR

Modelled directly on `packages/permissions` (read in full) and `apps/api`'s pattern
(tsconfig extends the shared base; permissions' does not — an existing minor
inconsistency, not one to propagate):

```
packages/domain/
├── package.json          # "@taskdesk/domain", private, type: module,
│                          # main/types → dist, exports "." → dist,
│                          # scripts: build (tsc), lint (biome), test (vitest run),
│                          #          test:watch, test:coverage (vitest run --coverage)
│                          # devDependencies: @taskdesk/typescript-config (workspace:*),
│                          #   typescript, vite, vitest, @vitest/coverage-v8
│                          # dependencies: a real IANA timezone library for calendar
│                          #   arithmetic (see open question below — this is the one
│                          #   place packages/domain needs a runtime dependency, and
│                          #   AGENTS.md do-not 4 "Add a dependency without asking" applies)
├── tsconfig.json          # extends ../typescript-config/base.json (apps/api's pattern),
│                          #   outDir ./dist, rootDir ./src, noEmit false, declaration true
├── vitest.config.ts       # environment: node, include src/**/*.test.ts,
│                          #   + coverage config (v8, thresholds.autoUpdate false,
│                          #   perFile or global 90% — needs the CI-lane decision below)
└── src/
    ├── index.ts           # barrel re-export
    ├── calendar/          # #33 — no dependencies within packages/domain
    │   ├── types.ts       # ServiceCalendar, Window, Holiday (mirrors service_calendar
    │   │                  #   jsonb shape in data-model.md verbatim)
    │   ├── calendar.ts    # coveredMinutesBetween(calendar, from, to): number
    │   │                  # nextWindowOpening(calendar, instant): Instant
    │   └── __tests__/
    ├── sla/               # #32 — depends on calendar/
    │   ├── types.ts       # SlaPolicy, SlaGoal, Pause, SlaState (six-value enum,
    │   │                  #   snake_case, matching work_item_sla_cache.state exactly)
    │   ├── sla.ts          # computeSlaState(...) per ADR 0009's exact signature above
    │   └── __tests__/
    ├── workflow/          # #31 — depends on nothing inside packages/domain (guards/
    │   │                  #   effects are evaluated against caller-supplied state; SLA
    │   │                  #   pause/resume is an *effect the caller executes*, not a call
    │   │                  #   workflow/ makes into sla/ — see dependency-order note below)
    │   ├── types.ts       # State, Workflow, WorkflowVersion, Transition, Guard, Effect
    │   ├── legality.ts    # legalTransitions(state_set, workflow_version, actorRoles,
    │   │                  #   currentStateId): Transition[]  — WF-3/4/5's union-of-roles
    │   │                  #   rule; returns [] rather than throwing, so the 403-vs-409
    │   │                  #   split (WF-4) is decided by the caller, which knows whether
    │   │                  #   the actor held work_item:transition at all
    │   ├── guards.ts      # evaluateGuard(guard, context): { ok: true } | { ok: false,
    │   │                  #   reasonCode: `guard.${type}` }  — WF-15/16, five guard types
    │   ├── effects.ts     # resolveEffects(transition, context): EffectInstruction[]
    │   │                  #   pure translation from workflow_transition.effects jsonb to
    │   │                  #   a list of instructions (`{ kind: 'pause_sla', metric }`,
    │   │                  #   `{ kind: 'set_assignee', personId }`, ...) — the caller
    │   │                  #   (apps/api) executes each instruction against the database;
    │   │                  #   packages/domain never writes an sla_pause row itself
    │   └── __tests__/
    ├── approval/          # #36 — depends on nothing inside packages/domain for the gate
    │   │                  #   arithmetic; needs role/team-membership data passed in for
    │   │                  #   the CAB predicate (see section 2)
    │   ├── types.ts       # Approval, ApprovalPolicy ('any'|'all')
    │   ├── gate.ts        # isGateSatisfied(approvals_for_transition, policy): boolean
    │   ├── rules.ts       # canDecide(approval, actorPersonId): boolean  — AP-7/AP-8,
    │   │                  #   "not the requester", independent of capabilities
    │   ├── expiry.ts      # isExpired(approval, now), reminderDue(approval, now, pct)
    │   └── __tests__/
    ├── assignment/        # P1/P2 split — the *rule engine* only (resolution order and
    │   │                  #   roster-membership predicate); defaults storage and the UI
    │   │                  #   are P1's, per the confirmed decision-log entry
    │   ├── types.ts
    │   ├── resolve.ts     # resolveDefaultAssignee(workItemType, requestType, project):
    │   │                  #   personId | null  — AS-11/AS-12 fallback chain, NOT
    │   │                  #   round-robin (explicitly out of scope, decision log
    │   │                  #   2026-09-05)
    │   ├── rules.ts       # canAssign(actor, target, roster, capabilities): boolean —
    │   │                  #   AS-1/AS-2/AS-5's ownership-predicate-vs-role-check split
    │   └── __tests__/
    ├── intake/            # #35 — the parts that are genuinely pure (see section 2 for
    │   │                  #   what is NOT pure here: duplicate-similarity scoring is a
    │   │                  #   pg_trgm/SQL concern, not packages/domain)
    │   ├── mapping.ts     # mapFormDataToFields(formSchema, formData): { native, custom,
    │   │                  #   unmapped } — RT-3/RT-4's mapsTo translation, IQ-8
    │   ├── withdrawal.ts  # canWithdraw(submission): boolean — IQ-16a's state +
    │   │                  #   claimed_by predicate
    │   └── __tests__/
    ├── request-type/      # #34 — mostly schema validation, genuinely pure
    │   ├── form-schema.ts # validateFormSchema(schema): ValidationResult — publish-time
    │   │                  #   checks (RT-5 conditional field exists, RT-4 mapsTo target
    │   │                  #   exists), visibleFields(schema, formData) for showIf
    │   │                  #   evaluation (client and server share this)
    │   └── __tests__/
    ├── audit/             # #37 — the hash chain and reconstruction are pure given inputs
    │   ├── hash.ts        # canonicalRowHash(row, prevHash): string — AU-15's exact
    │   │                  #   RFC 8785 + field-order + separator recipe from
    │   │                  #   data-model.md § The audit hash chain, verbatim
    │   ├── reconstruct.ts # reconstructAt(activityRows, at: Instant): WorkItemSnapshot —
    │   │                  #   AU-8, replays activity from creation
    │   └── __tests__/
    └── events/
        └── keys.ts        # the EventKey enum mirroring events.md's catalogue exactly —
                            #   this is what the CI test in events.md checks against
```

**Also touched, same bootstrap PR (small, additive, none is a redesign):**

- `apps/api/package.json` — add `"@taskdesk/domain": "workspace:*"` to `dependencies`,
  same pattern as the existing `@taskdesk/email` / `@taskdesk/permissions` lines (verified
  those two lines directly). **No tsconfig path-alias change needed** — package resolution
  is via the pnpm workspace symlink and the package name, not a `paths` mapping; confirmed
  by reading `apps/api/tsconfig.json`, which carries no `paths` block for the two packages
  it already consumes.
- `turbo.json` — **no change required to run `packages/domain` through
  `build`/`lint`/`typecheck`/`test`**: those tasks already apply to every workspace package
  generically via `dependsOn: ["^build"]` and the package's own scripts. A change **is**
  needed if P2 wants `test:coverage` wired with its 90% threshold now rather than waiting
  for whichever PR closes the `architecture-engineering-ops.md:133` gap — **this is a
  shared-contract judgement call, flagged as an open question below**, because
  `turbo.json` is read by every package and a P2 agent adding a task to it in passing is
  exactly the kind of shared-file edit CLAUDE.md §5 asks to route through a small
  dedicated PR rather than bundle into a feature branch.
- `docs/01-architecture/monorepo-layout.md` — no *content* change needed (the rules
  already describe `packages/domain` precisely); this is confirmation, not a gap.

### Is this a "shared contract" needing its own PR first?

**Yes, and it should land as one.** Reasoning from CLAUDE.md §5's explicit list — plugin
contracts, the API error envelope and route-policy types are named there, and
`packages/domain`'s public types (`SlaState`, `Transition`, `Approval`, the `EventKey`
enum) are exactly the same shape of thing: consumed by multiple later PRs (#31–#37, plus
whatever P4 governance-seam work reads workflow/SLA config), so two agents each inventing
`SlaState` independently is the "three inconsistent codebases" failure CLAUDE.md names.
**Recommendation: one small `feat/packages-domain-bootstrap` PR** containing exactly the
skeleton above with `index.ts` re-exporting empty/typed stubs and one smoke test per
subfolder (mirroring `repository-bootstrap.md`'s own instruction — "typed skeletons with
one test each") — no behaviour yet — then the seven issues implement against it in
parallel branches that only *add* files under their own `src/<area>/`, never touching a
sibling's folder or the barrel file's existing exports (only appending new ones), which
keeps them from colliding the way two agents editing one file would.

**This bootstrap PR is not itself blocked by PR #19 or #21.** It touches no shared file
either of those two owns (`packages/permissions` is untouched; `pnpm-workspace.yaml` needs
no edit; `turbo.json`'s existing tasks need no edit for the skeleton to build and test).
It can start **the moment this prep is read**, in parallel with Throttle 1 conditions
still closing.

---

## 2. What is genuinely pure, per issue — the pure core vs. the impure edge

The test throughout: **does the function take everything it needs as an argument, or does
it reach for `Date.now()`, the database, or a config lookup?** Every core below is written
`(...data, now) => result`, never `(...data) => result` that calls `Date.now()` internally —
`now` is threaded explicitly so tests can pin any instant, including DST edges.

### #31 Workflows
- **Pure:** `legalTransitions(stateSet, workflowVersion, actorRoleIds, currentStateId)` —
  `WF-3/4/5`'s role-union rule, no I/O, no clock. `evaluateGuard(guard, context)` — the five
  guard types (`WF-15`); `context` (children states, blocker states, assignee presence,
  field values, change risk) is **entirely caller-supplied**, so the pure function never
  queries child work items itself. `resolveEffects(transition, context)` — translates
  `effects jsonb` into an ordered instruction list; **does not execute** `pause_sla`,
  `set_assignee` etc. itself (those are DB writes) — it only says *what* should happen.
  `stuckStates(workflowVersion, projectStateSet)` — the publish-time validation panel's
  core (`WF-9`), pure over two state sets.
- **Impure edge (apps/api):** loading the workflow version, the project's `project_state`
  rows, the work item's children/blockers, writing the `sla_pause` row an effect produces,
  emitting `work_item.transitioned`, persisting `scheduled_transition` rows for
  `schedule_transition` effects — that one genuinely needs `now()` to compute `due_at`, so
  the impure edge calls `resolveEffects(..., now)` and the caller adds `now` when writing
  the row, not the pure function computing an absolute timestamp itself unprompted.
- **`now` shape:** `resolveEffects` needs `now` only to pass through into a
  `schedule_transition` instruction's relative `after_minutes` math is left to the
  *caller* (`due_at = now + after_minutes` is a one-line addition done where the row is
  written) — so `resolveEffects` itself may not need `now` at all if it just emits
  `{ kind: 'schedule_transition', afterMinutes, toStateId }` and lets the caller add the
  clock. **Recommendation: keep `now` out of `resolveEffects`** — it is one of the rare
  sub-functions here with no clock dependency at all.

### #32 SLA
- **Pure:** `computeSlaState(...)` exactly as ADR 0009 specifies (quoted in section 1) —
  takes `now` explicitly. This is the canonical example of the shape the task description
  asks to distinguish: **not** `computeSlaState(workItemId)` reaching into a repository.
  Also `coveredMinutesBetween` is layered underneath via `calendar/` (see #33) rather than
  reimplemented in `sla/`.
- **Impure edge:** resolving *which* policy applies (`SLA-1`'s coalesce — already written
  as SQL in `background-jobs.md`, not domain code), loading `sla_pause` rows, writing
  `work_item_sla_cache`, emitting `sla.at_risk`/`sla.breached`/`sla.met`/`sla.missed`.
- **`now` shape:** every call site passes the scan's or the request's `now` in; `sla-scan`
  runs every 5 minutes and calls the pure function once per candidate row with one shared
  `now`, so a slow scan does not see different candidates evaluated against different
  instants — worth a named test (see section 5).

### #33 Service calendars
- **Pure:** `coveredMinutesBetween(calendar, from, to)`, `nextWindowOpening(calendar,
  instant)`, `isHoliday(calendar, date)`, `expandRecurringHoliday(rule, year)`. All take
  the calendar as plain data (`windows`/`holidays` mirroring the jsonb shape verbatim) and
  two instants — no calendar ever comes from the database inside this module.
- **Impure edge:** loading `service_calendar` rows, `.ics` import parsing (I/O — reading a
  file), country-preset holiday generation (a bundled dataset lookup — arguably pure if the
  dataset is bundled as a static import, **flagged as an open question in section 9**,
  since `CAL-11`'s "country presets... a starting point" implies a data source whose nature
  (bundled JSON vs. external service) decides whether the *generation* step counts as pure).
- **`now` shape:** `coveredMinutesBetween` takes two explicit instants (`from`, `to`), never
  a single "elapsed since" plus internal `Date.now()` — this is the one core with **no
  ambient "now" at all**, by design: it answers "how much cover between A and B", and the
  caller (SLA's core) decides that B is `now`.
- **DST correctness is a hard dependency on a real IANA tz library** — this is the one
  place `packages/domain` needs a **runtime dependency** (contradicting the "no I/O"
  aspiration only in the sense of needing a library, not in the sense of reaching outside
  its own arguments). ADR references "a real timezone library", never names one. **Flagged
  as an open question in section 9** — needs Thomas's yes under do-not 4 ("Add a dependency
  without asking") since it is a real new package dependency, and it is worth naming
  candidates (`Temporal` polyfill vs. `date-fns-tz` vs. `luxon`) before the bootstrap PR so
  the dependency is added once, not swapped mid-implementation.

### #34 Request types and catalogue
- **Pure:** `validateFormSchema(schema)` — publish-time checks (`RT-4` mapsTo target exists,
  `RT-5` conditional field exists — **exact `showIf` shape is undecided, see section 9**).
  `mapFormDataToFields(schema, formData)` — `RT-3/RT-4`'s translation, including the
  impact→priority style value map. `visibleFields(schema, formData)` — conditional
  visibility evaluation, shared by the portal renderer and the server validator (the spec's
  own words: "the client never filters this itself" pattern applied here too).
- **Impure edge:** the per-organisation catalogue lookup (`organisation_request_type` join
  — a database query, not domain logic — **this whole area is arguably *not* packages/domain
  at all**, since `RT-7/RT-8`'s visibility rule is a single SQL join with no interesting
  pure arithmetic; the interesting pure part is entirely the form schema, not the
  catalogue), publishing a new `request_type_version`, deflection-event recording.
- **`now` shape:** none of the pure functions here need a clock at all.

### #35 Intake queue
- **Pure:** `canWithdraw(submission)` — `IQ-16a`'s state (`new`/`clarifying`) plus
  `claimed_by is null` predicate; no clock, no I/O. Reuses `#34`'s `mapFormDataToFields`
  for `IQ-8` (acceptance mapping) rather than duplicating it.
- **Genuinely NOT pure, and should not be forced into `packages/domain`:**
  **duplicate-suggestion scoring** (`IQ-18`) — the review at
  `features-core-servicedesk.md:300` found this is unspecified even at the algorithm level,
  and whatever it becomes (`pg_trgm` similarity, per the review's own recommendation) is a
  **database-side computation**, not a pure TypeScript function over plain data — it cannot
  run without querying "recent work items in the same organisation" first. **This is a
  named example of the task's "where the impure edge sits" question**: the edge here is not
  a clock, it is the database itself, because the *ranking* only makes sense against live
  data too large to pass in as a plain argument. Recommend: keep this entirely in
  `apps/api`, never attempt a `packages/domain/src/intake/duplicates.ts`.
- **`now` shape:** none of the genuinely-pure functions need a clock. `IQ-15`'s
  auto-decline-after-14-days and the 14-day threshold are `reminder-scan`'s concern
  (impure edge, needs `now`), not a pure predicate worth extracting on its own — it is one
  comparison (`clarifying_since + days < now`), not worth a domain module.

### #36 Approvals and CAB
- **Pure:** `isGateSatisfied(approvalsForTransition, policy: 'any'|'all')` — `AP-5`'s core,
  a boolean fold over decided approvals, no clock. `canDecide(approval, actorPersonId)` —
  `AP-7`/`AP-8`, "not the requester", independent of capabilities — this is explicitly the
  kind of rule `rbac.md` and `security-model.md` say is "enforced in `packages/domain`,
  independent of capabilities" (verified by reading both). `isExpired(approval, now)` and
  `reminderDue(approval, now, pct)` — take `now` explicitly, unlike a job that calls
  `Date.now()` at read time.
- **CAB membership is data, not domain logic**: `approval:decide_cab` requires the actor
  to be a current `team_member` of the workspace's `is_cab = true` team (`TM-5`, `rbac.md`
  confirmed: `"approval:decide_cab | Decide a CAB approval — and be a member of the CAB
  team"`). The *lookup* ("is this person currently on the CAB team") is a database query
  (impure edge); **the pure part is `canDecide`, which takes an already-resolved
  `isCabMember: boolean` as one of its inputs**, never resolving membership itself.
- **Impure edge:** raising an approval (writing the row), the reminder scan
  (`reminder-scan`, 15 min cadence, needs `now`), deciding (writing `decided_at`, emitting
  `approval.decided`).
- **`now` shape:** `isExpired`/`reminderDue` take `now` as an argument — `reminder-scan`
  calls them once per pass with its own single `now`, same pattern as SLA's scan.

### #37 Audit trail
- **Pure:** `canonicalRowHash(row, prevHash)` — `AU-15`'s exact recipe (RFC 8785 canonical
  JSON for jsonb columns, `\x1e`-joined ordered fields, lowercase hex, `organisation_id`
  excluded) is **entirely pure given the row and the previous hash** — no clock read inside
  the hash function itself (`created_at` is a *field being hashed*, supplied by the
  caller, not read live). `reconstructAt(activityRows, at)` — `AU-8`'s point-in-time
  replay, pure fold over a list, `at` supplied explicitly (never "as of now" computed
  internally).
- **Impure edge:** the actual `pg_advisory_xact_lock` + insert (serialisation — cannot be
  pure by definition, it is the whole point of the mechanism), `audit-verify`'s chain walk
  (reads the database), writing the row itself.
- **`now` shape:** `reconstructAt` takes `at` as a parameter — this is the same "pure
  function taking an instant" shape as `computeSlaState`'s `now`, just renamed for
  readability at the call site (`reconstructAt(rows, someHistoricalInstant)` reads more
  naturally than `reconstructAt(rows, now)` when the caller usually passes a past instant,
  but the *shape* — explicit instant in, no `Date.now()` inside — is identical).

### Assignment (P1/P2 split, not one of the seven, but shares `packages/domain`)
- **Pure:** `resolveDefaultAssignee(workItemType, requestType, project)` — `AS-11/AS-12`'s
  fallback chain (request type overrides project), explicitly **not** round-robin.
  `canAssign(actorRoles, hasAssignCapability, targetPersonId, actorPersonId, roster)` —
  `AS-1/AS-2/AS-5`'s split between "assign anyone on the roster" (capability-gated) and
  "assign/unassign self only" (an ownership predicate). No clock in either.

---

## 3. Dependency order across the seven (plus assignment)

**Confirmed edges, from the specs and data model, not invented:**

- **`#33` service calendars → `#32` SLA.** `sla.md`: *"Depends on: service calendars,
  request types, work item types."* SLA's `computeSlaState` takes a `calendar` argument
  produced by `#33`'s pure core. **`#33` has no dependency on anything** (`Depends on:
  nothing`, confirmed in its own header) and its data table needs no other feature's
  schema. **`#33` is the one issue with zero inbound pure-domain dependencies and should be
  the first slice built and merged into `packages/domain`.**
- **`#31` workflows → `#32` SLA, at the *effect* level, not the *calculation* level.**
  `WF-17`/`WF-18`/`SLA-10` establish that pausing/resuming and "resolved" pause rows are
  workflow-transition **effects** — `#31`'s `resolveEffects` emits `pause_sla`/`resume_sla`
  instructions that the impure edge (apps/api) turns into `sla_pause` writes. **This is not
  a compile-time import from `workflow/` to `sla/` inside `packages/domain`** — the two
  modules never call each other; the coupling is entirely in `apps/api`'s orchestration,
  which calls `resolveEffects` then, for a `pause_sla` instruction, writes the row that
  `computeSlaState`'s `pauses` argument later reads. **Confirmed acyclic**: `sla/` needs no
  import from `workflow/`, and `workflow/`'s effect vocabulary needing to *name* `pause_sla`
  is just a string literal, not a type import.
- **`#34` request types → `#32` SLA (policy override) and `#31` workflows (via
  `work_item_type.workflow_id`)**, per `request-types-and-catalogue.md`'s own header:
  *"Depends on: work item types, workflows, SLA, custom fields."* But **within
  `packages/domain`, `request-type/`'s pure functions (form-schema validation, field
  mapping) need nothing from `sla/` or `workflow/`** — the dependency is at the *data
  model* level (a `request_type` row references an `sla_policy_id` and a
  `work_item_type_id`), not at the pure-function call level. **No packages/domain-internal
  edge.**
- **`#35` intake queue → `#34` request types.** `intake-queue.md`: *"Depends on: request
  types, work items, notifications."* Reuses `#34`'s `mapFormDataToFields` directly
  (`IQ-8`) — **this is a real intra-package import**, `intake/` → `request-type/`.
- **`#36` approvals → `#31` workflows (gate identity) and assignment's `team`/CAB data.**
  `approvals.md`: *"Depends on: workflows, notifications."* The gate-satisfaction check
  needs `workflow_transition.approval_policy`, which `#31` defines the type for
  (`ApprovalPolicy`) — **recommend `approval/` imports the `ApprovalPolicy` type from
  `workflow/types.ts`** rather than redeclaring `'any'|'all'` a second time, which is the
  kind of duplicate-vocabulary mistake the rule-id-prefix collisions already illustrate
  elsewhere in this corpus.
- **`#37` audit trail depends on nothing else in `packages/domain`.** `audit-trail.md`:
  *"Depends on: nothing."* Confirmed — the hash function and reconstruction are self-
  contained pure folds over rows any feature can produce. **Fully parallel with everything
  else, no serialisation point.**
- **Assignment's pure core depends on nothing else** (`resolveDefaultAssignee` needs only
  `work_item_type`/`request_type`/`project` default-assignee columns, already fields, not
  cross-references into another pure module) but **`#36` approvals' CAB-membership check
  and `#31`'s `role_id`-based transition legality both need "is this person on this
  team/role" predicates of the same shape as assignment's roster check** — worth sharing
  one `isMemberOf(roster, personId): boolean` utility across `assignment/`, `approval/` and
  `workflow/` rather than three near-identical one-liners; **flagged as a design nit for
  the bootstrap PR, not a blocking dependency.**

### The graph, in one line each

```
#33 calendars ──► #32 SLA ──► #34 request-types ──► #35 intake-queue
                    ▲              │
                    │              ▼
#31 workflows ──────┴──────► #36 approvals
#37 audit-trail  (isolated, no edges)
assignment (P1/P2 split)  (isolated pure core; shares nothing but a utility idea)
```

### What can run in parallel, and the real serialisation points

- **True first slice, no blockers: `#33` service calendars.** Build and merge first.
- **Parallel immediately after `#33` merges: `#31` workflows and the calendar-consuming
  half of `#32` SLA can proceed together** — `#31` does not need `#32` to exist to write
  `legality.ts`/`guards.ts`/`effects.ts` (effects only *name* `pause_sla`, they do not call
  into `sla/`), so **`#31` genuinely has no hard dependency on `#32` and could equally be
  the first slice** if calendars are not ready. The one real serial point is: **`#32`'s
  `computeSlaState` cannot be exhaustively tested against pauses until `#31`'s effect
  vocabulary (`pause_sla`/`resume_sla` instruction shapes) is fixed**, because SLA's test
  fixtures need pause *intervals* shaped the way workflow effects will actually produce
  them. Recommend fixing the `Pause` type (`{ startedAt, endedAt, reason }`, matching
  `sla_pause`'s columns exactly) in the bootstrap PR itself, in `sla/types.ts`, and having
  `#31`'s effect instructions reference that type by import — this removes the ordering
  dependency entirely by settling the shared type up front rather than sequencing the work.
- **`#34` request types can start immediately** (its pure core needs no other module) but
  **should not be merged claiming completion until `#31`/`#32` type names it references
  exist**, since `request_type.sla_policy_id`/`workflow_id` are data-model facts, not
  domain-module imports — so this is a light dependency, not a blocking one.
- **`#35` intake queue has one real intra-package import dependency: `#34`** — sequence it
  after, or stub `mapFormDataToFields`'s signature early (in the bootstrap PR) so `#35` can
  build against a type-only stub while `#34`'s real implementation lands separately.
- **`#36` approvals has one real intra-package type dependency: `#31`'s `ApprovalPolicy`
  type** — same treatment: settle the type name in the bootstrap PR.
- **`#37` audit trail is fully independent and can run at any time, including first**, as
  can assignment's pure core.
- **Net recommendation for the four-branch parallel limit (CLAUDE.md §3, "three to four
  active branches"):** bootstrap PR first (small, fast, unblocks everything) → then up to
  four of {`#33`, `#37`, assignment, `#31`} in parallel (all zero-or-shared-type-only
  dependency) → `#32` and `#34` next (each has exactly one real predecessor) → `#35` and
  `#36` last (each has exactly one real predecessor, both already merged by then).

---

## 4. Acceptance criteria per issue

**All seven GitHub issues (#31–#37) use identical boilerplate** (confirmed by reading each
with `gh issue view --repo ThomasHeinThura/ticketing`): each names its spec as "source of
truth", is a **completion-gate issue** ("PRs are slices and the spec remains authoritative"),
carries label `stage:P2`, milestone "P2 — Service Desk", release `2.0.0-beta.1`, and records
**no** `blocked-by`/`blocking` links and **no sub-issues** on GitHub itself — the real
dependency graph in section 3 exists only in the specs and this document, not in GitHub's
own metadata. Each issue's own "done when" clause is generic: *"all [feature] rules,
permissions, screens, APIs, [feature-specific behaviours], named tests, domain-engine
obligations and applicable Definition-of-Done/security gates pass, and the feature index
can mark [feature] shipped."* So the **real** acceptance criteria are the specs' own
numbered rules. For P2's actual deliverable (pure functions, before any HTTP endpoint),
only the rules with no HTTP/screen component are in scope *now*; the rest belong to
whichever later PR attaches the endpoint. Per issue:

- **#31 workflows** — `WF-1`…`WF-21` (legality, versioning, notes, guards, effects); the
  pure-testable subset is `WF-3/4/5` (legality), `WF-9` (stuck-state detection), `WF-15/16`
  (guards), `WF-17/18/19` (effects vocabulary, not execution). Named tests already specified
  in the spec: `wf-4-403-vs-409.spec.ts`, `wf-13-approval-gate-matches-transition.spec.ts`,
  `wf-17-completed-writes-sla-pause.spec.ts`, `wf-19-effects-vocabulary.spec.ts`,
  `wf-21-customer-reopen-system-actor.spec.ts` (the last three of these are integration-
  level, not pure-unit, per the spec's own Testing section split).
- **#32 SLA** — `SLA-1`…`SLA-21` plus `SLA-15a`; the pure-testable subset is `SLA-4`
  through `SLA-13` (computation and pausing arithmetic). The spec states plainly: *"the
  most important test suite in the product"*, and lists its own required coverage
  verbatim (quoted in section 5).
- **#33 service calendars** — `CAL-1`…`CAL-13`; almost entirely pure-testable (this spec
  is P2's cleanest pure-function target — no HTTP-shaped rule blocks unit testing it).
- **#34 request types and catalogue** — `RT-1`…`RT-16`; the pure-testable subset is
  `RT-3/RT-4` (mapping/translation) and `RT-5` (conditional visibility) — **note the
  `showIf` shape is not yet concretely specified, see section 9**. Most of this spec
  (catalogue visibility, submission creation) is inherently a database/HTTP concern.
- **#35 intake queue** — `IQ-1`…`IQ-21` plus `IQ-16a`; the pure-testable subset is small
  (`IQ-8`'s field mapping, reusing #34; `IQ-16a`'s withdrawal predicate). Most of this
  spec is queue/HTTP/transactional behaviour, explicitly out of scope for P2's pure-
  function obligation.
- **#36 approvals and CAB** — `AP-1`…`AP-21`; the pure-testable subset is `AP-5` (gate
  satisfaction), `AP-7/AP-8` (self-approval/decision authority), `AP-12` (expiry
  arithmetic). Named tests already specified: `customer-cannot-request-cab.spec.ts`,
  `requester-cannot-self-approve.spec.ts`, `approver-email-not-leaked.spec.ts` (these three
  are integration/security tests, not pure-unit — the pure-unit equivalent is `canDecide`'s
  own unit suite).
- **#37 audit trail** — `AU-1`…`AU-15`; the pure-testable subset is `AU-15` (hash chain)
  and `AU-8/AU-9` (reconstruction). Most of the rest (write-path, retention, access) is
  infrastructure/HTTP.

---

## 5. The exhaustive-test plan — what "exhaustive" means per rule

`CLAUDE.md` and `sdlc.md` both use the word "exhaustive"; `testing-strategy.md` ties it to
a **90% per-package coverage threshold** (not yet wired into `turbo.json`/CI — see section
1). Below, named boundary cases per module, taken from each spec's own Testing section
where it names one, extended only where the spec's list is visibly incomplete (marked).

### `calendar/` (#33) — the strongest test list in the corpus, quoted almost verbatim
- Covered minutes between two instants, for each of the four presets (24×7, 8×5, 12×5,
  follow-the-sun).
- A span crossing a weekend; crossing a single holiday; crossing consecutive holidays; a
  holiday inside a pause (this last one is actually an `sla/` integration case, not a pure
  `calendar/` case — flag the spec's own phrasing as slightly imprecise).
- Split windows within a day (the Wednesday lunch-break example in the spec's own JSON).
- **DST forward and backward, in `Europe/London` and `America/New_York` by name** —
  the spec names these two zones specifically; `CAL-7`'s exact wording: *"During a DST
  spring-forward, an hour that does not exist is skipped. During autumn fall-back, the
  repeated hour is counted once."* — two explicit named cases, not "DST" as one case.
- A start instant outside cover — clock begins at next opening (`nextWindowOpening`).
- Year boundaries (a window spanning New Year's Eve into New Year's Day).
- Zero-cover calendars (`CAL-5`) — produces zero covered minutes for any span.
- **Added, not in the spec's list but implied by `CAL-2`/`CAL-3`:** overlapping windows on
  one day rejected at construction/validation (not computation) — this is a
  `validateCalendar` function the spec implies but does not name; recommend adding it as
  its own pure function and test, since `coveredMinutesBetween` should not need to defend
  against malformed input every call.
- **Added:** a window ending at `24:00`/`1440` — boundary-of-day arithmetic, since the
  review at `features-core-servicedesk.md:258` found the encoding underspecified (now
  resolved as minutes-from-midnight `0..1440` in the data model, but the *boundary value
  1440 itself* — is it inclusive of the instant or does the window end just before it? —
  deserves an explicit test either way).

### `sla/` (#32) — quoted directly from `sla.md`'s own Testing section
- Every state transition boundary **to the minute** (`none`→`ok`→`at_risk`→`breached`,
  and →`met`/→`missed` on completion) — the spec's own words, "to the minute", meaning
  tests at `target - 1min`, `target`, `target + 1min`, not just "before/after".
- 8×5, 12×5 and 24×7 calendars (reuses #33's fixtures).
- Creation before, during and after a covered window.
- Weekends, single holidays, consecutive holidays, a holiday inside a pause.
- DST forward and backward, in a timezone that observes them (same two zones as #33).
- Pauses: single, multiple, adjacent, overlapping (**rejected** — `SLA-11`'s 409 rule),
  unclosed (**the 30-day stale-pause case**, though that alert is `reminder-scan`'s job,
  not `computeSlaState`'s — the pure function's job is just to correctly subtract an
  unclosed pause's elapsed-so-far interval, which is itself a boundary case: an open pause
  with no `endedAt` subtracts up to `now`, not to infinity).
- Reopen after completion (`SLA-9`) — resumes, does not restart; a named test pinning the
  exact resumed value, not just "greater than zero".
- Policy version selection for an item created before a policy change (`SLA-3`).
- Priority change mid-flight (`SLA-4`'s note: the new goal applies from creation, so the
  *goal minutes* change but `slaStartedAt` does not — a test asserting `dueAt` moves while
  `slaStartedAt` is pinned).
- **Added, not explicit in the spec's list but load-bearing given the unresolved wording
  flagged in section 9:** a work item moved to a project with a different policy — this
  needs a **decided** rule before it can be tested at all (see the open finding below);
  write the test only after that ambiguity is resolved, not against a guess.
- **Added:** the `at_risk` threshold boundary itself is configurable per policy
  (`sla_policy.at_risk_threshold_pct`, default 75) — a test at 74%/75%/76% consumed for a
  policy with a **non-default** threshold (e.g. 60%), not only the default, since a domain
  function that only works at 75% has a hardcoded threshold in disguise.

### `workflow/` (#31)
- **State-transition matrix**: legality for every `(from, to, role)` combination in a
  seeded workflow — the spec's own phrase, "every combination", not a sample.
- Union of transitions for an actor holding two roles with different legal edges.
- Each of the five guard types, satisfied and unsatisfied, plus **the guard cycle case**
  (`WF`'s own edge-case table: "A requires B closed, B requires A closed" — both blocked,
  detected before publish) — this needs its own cycle-detection test in `stuckStates` or a
  sibling function, since `evaluateGuard` alone (one guard at a time) cannot detect a
  mutual cycle; **the pure function that detects it is not yet named in this plan's file
  list — add `detectGuardCycles(workflowVersion)` to `workflow/` during implementation.**
- Note-policy enforcement, all three values (`none`/`optional`/`required`).
- Reopen resumes rather than restarts (`WF-21`) — shares the SLA reopen test's fixture.
- Version selection and stuck-item detection (`WF-9`) — a published version with no
  outbound transition from some project-enabled state.
- **Added:** `from_state_id = null` ("from any state", used for Cancel) matched against
  every possible current state — the spec names this rule (`WF-5`) but its own test list
  omits a dedicated case for it.

### `approval/` (#36)
- Self-approval rejected (`AP-8`) — including the specific edge case the spec itself
  names: "Approver is also the requester → Rejected at 422 with a clear message" — this is
  the *pure* half (`canDecide` returns false); the 422 itself is the impure edge's job.
- Expiry arithmetic (`AP-4`/`AP-12`) — default 7 days, capped at 90; a test at exactly the
  cap boundary and one instant past it (rejected).
- Any-versus-all gate satisfaction (`AP-5`) — **the exact quorum matrix**: 1 approval
  pending/any→unsatisfied, 1 approved/any→satisfied, 2 pending 1 approved/all→unsatisfied,
  2 approved/all→satisfied, 1 approved 1 **rejected**/all→**stays unsatisfied, visibly**
  (`AP-18`'s edge case: "Two approvals, 'all' policy, one rejected → The gate stays
  blocked. The rejection is visible") — **this exact case must be a named test**, since a
  naive `every(a => a.state === 'approved')` fold already gets it right, but a fold that
  treats "any decided" as "satisfied" would wrongly pass.
- Reminder-due arithmetic at 50% and 90% of the window, both directions (before/at/after
  each threshold), and **only once each** — a repeat-send test against
  `reminder_50_sent_at`/`reminder_90_sent_at` already being set.

### `intake/` (#35, the small pure slice only)
- `canWithdraw`: `new`/`clarifying` with `claimed_by = null` → true; any other status →
  false; `claimed_by` set while status is still `new`/`clarifying` → false (`IQ-16a`'s
  precise "the moment a triager takes any action" rule) — **this needs the `claimed_by`
  column, which exists in the data model, but no claim-setting route is yet specified — see
  the open finding in section 9; write the predicate against the column now, the route can
  follow later.**
- Field mapping (`mapFormDataToFields`, shared with #34): every field type in the example
  schema (`text`, `select` with `mapsTo` value translation, `file`), plus an **unmapped**
  field landing in the "rendered into description" bucket.

### `request-type/` (#34, the small pure slice only)
- `validateFormSchema`: a `mapsTo` target that exists vs. one that was since deleted
  (`RT` edge case: "publish validation rejects it"); a conditional field whose controller
  exists vs. was removed (same edge case table).
- `visibleFields`: **the concrete `showIf` shape needs settling first** (section 9) —
  once settled, test the controlling field present/absent/wrong-type.

### `audit/` (#37)
- `canonicalRowHash`: a fixed input row producing a **known, pinned hash value** (a golden-
  file test, not just "produces *a* hash") — this is the only way a future accidental
  change to field order or separator is caught, since two different implementations that
  each pass their own round-trip test but disagree by one byte are exactly the failure
  `data-model.md`'s hash-chain section exists to prevent.
- `null` vs. empty-string indistinguishability in the hash — the data model states this is
  *deliberate*; test that a `null` column and an empty-string column produce the *same*
  hash, not different ones (an easy sign of a bug: someone "fixing" this later).
- `reconstructAt`: state at an instant before creation (undefined/error), at creation, at
  an instant with two competing field-changes in the same millisecond (ordering rule
  needed — **not currently specified anywhere I read; flag as a genuine gap**, see
  section 9), across a work item **type change** and a **project move** — the spec names
  both explicitly ("including across a type change and a project move").

### Assignment's pure core (shared package, not a P2 issue itself)
- `resolveDefaultAssignee`: request-type default present → wins over project default;
  request-type default absent, project default present → project wins; neither present →
  `null` (left unassigned, per `AS-11/AS-12` and the edge case "Default assignee is
  inactive → left unassigned, project flagged").
- `canAssign`: the full `AS-1`…`AS-5` matrix the spec's own Testing section names
  verbatim: "every role against every assignment target."

---

## 6. Identifier registrations owed

**The headline finding: almost nothing is owed.** Every table, capability, event key and
background job that P2's seven issues need is **already registered** in its authoritative
document, verified directly rather than assumed:

- **Tables** (`data-model.md`): `workflow`, `workflow_version`, `workflow_transition`,
  `scheduled_transition`, `state`, `project_state`, `request_type`, `request_type_version`,
  `organisation_request_type`, `submission`, `submission_message`, `deflection_event`,
  `service_calendar`, `sla_policy`, `sla_policy_version`, `sla_goal`, `sla_pause`,
  `work_item_sla_cache`, `approval`, `audit_log`, `audit_chain_anchor`, `team`,
  `team_member` — every one of these already exists in `data-model.md` §§2, 3, 6, 7, 11,
  read directly, not inferred.
- **Capabilities** (`rbac.md`): `sla_policy:read/manage`, `workflow:read/manage`,
  `request_type:read/manage`, `intake:triage`, `approval:request/request_cab/decide/
  decide_cab`, `instance:read_audit` — all present in the capabilities table, read in full.
- **Event keys** (`events.md`): every `work_item.*`, `sla.*`, `approval.*`, `submission.*`
  key P2's specs cite is in the catalogue, read in full.
- **Background jobs** (`background-jobs.md`): `sla-scan`, `reminder-scan`, `audit-purge`,
  and the on-demand `audit-verify` are all named with cadence and lease TTL.
- **Feature flags** (`plugin-architecture.md`): `feature.sla`, `feature.intake`,
  `feature.approvals` are all in the Feature toggles table; `workflows.md` and
  `audit-trail.md` both declare "always on" (no flag key needed).
- **Rule-id prefixes** (`docs/03-features/README.md`): `WF`, `SLA`, `CAL`, `RT`, `IQ`,
  `AP`, `AU` are each registered to exactly one spec, confirmed against the table.

**What is genuinely NOT yet done, and whose job it is:**

1. **`packages/permissions/src/features.ts` does not exist yet** — verified by listing
   `packages/permissions/src/*.ts` directly; the feature-flag enum is documented in
   `plugin-architecture.md` but has no code home. This blocks nothing in `packages/domain`
   (pure functions never read a feature flag themselves — the flag is checked at the
   impure edge, in `apps/api`, before a pure function is even called), but it **does** need
   to exist before P4's governance seam or any HTTP route can gate these features. Not
   P2's job to create in passing (it is `packages/permissions`, a named shared-contract
   surface); flag it for whichever PR wires the first P2 HTTP endpoint.
2. **`work_item_type.is_change`, `workspace.default_sla_policy_id`, `project.sla_policy_id`,
   `sla_policy.at_risk_threshold_pct`, `approval.transition_id`,
   `workflow_transition.approval_policy`, `submission.claimed_by`/`claimed_at`,
   `audit_log.workspace_id`/`impersonator_id`/`user_agent`/`trace_id`** — **all of these
   were flagged as missing by the 2026-09-05 review and are now confirmed PRESENT** in the
   current `data-model.md` (checked directly, quoted in section 0 and above). No action
   owed — the spec-closure pass already applied these fixes.
3. **No new identifier is introduced by the pure-function work itself.** Function names
   (`computeSlaState`, `legalTransitions`, etc.) are not governed by do-not 11 — only
   tables, capabilities, flags, event keys and jobs are. **If implementation surfaces a
   genuinely new column or event** (the two gaps named in section 9 — a reconstruction
   tie-break rule and the calendar-preset data source — might each need one), it must be
   added to its authoritative document in the same change, not deferred.

---

## 7. Where the engine-boundary rule bites, per issue

Applying the decided test — *"could two implementations of this be installed side by side
and swapped by an administrator?"* — to each of the seven, not assuming the answer:

- **#31 workflows — domain module + flag.** Explicitly named in the decision log's ruling.
  Always on (no flag key at all, confirmed in the spec header) — there is exactly one
  workflow *engine*; individual workflow *definitions* are configured rows (the `state`/
  `workflow` tables plus the workflow editor), which is the "registry or settings screen"
  half of the five-point pattern, not a plugin registry.
- **#32 SLA — domain module + flag (`feature.sla`).** Explicitly named. One SLA engine;
  policies are configured rows.
- **#33 service calendars — domain module + flag, and this is a genuine judgement call,
  not a named ruling.** The decision log's list ("SLA, workflow, approvals, assignment,
  the terminology overlay") does **not** name calendars explicitly. Applying the test
  directly: could two different *calendar engines* be installed side by side? No — there
  is one calendar arithmetic engine (windows + holidays + timezone), and what varies
  between deployments is *which calendars are configured*, exactly the same shape as SLA
  policies. **Conclusion: domain module + flag**, sharing `feature.sla` (confirmed: the
  spec's own header lists `feature.sla` as its flag, and the review at
  `features-core-servicedesk.md:261` flagged this shared-flag choice as worth a one-line
  justification, which this plan now provides: calendars are meaningless without SLA
  enabled, so a shared flag is deliberate, not an oversight).
- **#34 request types and catalogue — domain module + flag (`feature.intake`), also not
  explicitly named in the ruling but a clear application of the same test.** Could two
  *request-type engines* be swapped administratively? No — one form/catalogue engine;
  individual request types are configured rows, exactly the pattern the engine-pattern
  section's own worked example uses ("a table plus a small set of pure functions in
  `packages/domain` for something like the lifecycle engine").
- **#35 intake queue — domain module + flag (`feature.intake`, shared with #34).** Same
  reasoning; one triage engine, queues are saved-filter rows (already an existing "engine"
  — `saved_view` — not a new one).
- **#36 approvals and CAB — domain module + flag (`feature.approvals`).** Explicitly named
  ("approvals" in the ruling's list). The CAB is not a second plugin kind either — it is
  data (a flagged `team` row), per `teams.md`, not a swappable implementation.
- **#37 audit trail — domain module, always on, no flag at all** (confirmed: spec header
  says "always on"). Correctly excluded from the flag list entirely — an audit trail is not
  optional in a way a customer administrator should be able to switch off, which is a
  different question from the engine-boundary test but reaches the same "not a plugin"
  answer for an orthogonal reason (it is a control, not a feature).

**No issue in this lane needs a plugin registry.** This is worth stating plainly because
SLA policies, workflow definitions and request types are exactly the three the task
description names as places "someone will reach for a registry" — the decision log's
2026-09-06 ruling already forecloses this for two of the three by name, and this section
extends the same test, rather than a different one, to the third (calendars) and to
request types/intake, reaching the same answer by the same reasoning rather than by
analogy or convenience.

---

## 8. What P2 must NOT do

1. **No HTTP endpoint until the pure core exists with its tests.** CLAUDE.md's own words.
   Concretely: no route under `apps/api/src/` for any of workflows, SLA, calendars,
   request types, intake, approvals or audit trail lands in a P2 branch. The bootstrap PR
   and the seven feature PRs touch only `packages/domain` (plus the tiny, already-scoped
   `apps/api/package.json` dependency line from section 1).
2. **No policy-registry entries, no screens, no God Mode forms** for these features in a
   P2 branch — those are HTTP/UI-layer work that depends on the pure core existing first,
   and per section 4, most of each spec's acceptance criteria (screens, APIs) are
   explicitly deferred, not part of P2's own completion.
3. **P4's governance seam must not be treated as "later."** CLAUDE.md is explicit: *"P4 is
   not a later clean-up lane... whenever P1–P3 creates something configurable, its
   configuration seam lands immediately: schema → admin API → God Mode."* For P2
   concretely: **the moment any P2 issue's HTTP endpoint is built** (which is explicitly
   NOT this prep task, but the very next thing after it), the admin API and God Mode
   screen for that configuration (the workflow editor, the SLA policy/goal matrix editor,
   the calendar editor, the request-type form builder, the approval policy config) must
   land in the *same* body of work, not deferred to a cleanup pass. This plan does not
   itself build any of that — it names the obligation so whoever picks up the first P2
   HTTP-endpoint PR does not silently drop it.
4. **Do not build a plugin registry for SLA policies, workflows, request types or calendar
   definitions** — section 7's conclusion, restated as a prohibition: these are domain
   modules with configured rows and a feature flag, not registry members.
5. **Do not invent the round-robin/load-balancing assignment algorithm** the decision log
   explicitly rejected (2026-09-05) — `resolveDefaultAssignee` is a fallback lookup, not an
   allocation algorithm, and any implementation that starts distributing load across
   multiple candidates has silently reopened a closed decision.
6. **Do not force duplicate-suggestion scoring (`IQ-18`) into `packages/domain`** — section
   2's finding: this needs live database access to rank against, and is not a pure
   function no matter how it is written; keep it in `apps/api`.
7. **Do not touch `packages/permissions`, `pnpm-workspace.yaml`'s existing structure, or add
   a `turbo.json` task without routing it through the small-dedicated-PR path** CLAUDE.md
   §5 describes for shared contracts — section 1 already scoped exactly what the bootstrap
   PR touches; nothing beyond that list.
8. **Do not silently resolve the two live spec contradictions this prep found** (SLA
   policy-move ambiguity, calendar `none`-state collision — both named precisely in
   section 9) **by picking one reading and coding it** — per the spec interaction rule,
   these need the document fixed (and, for the first one, arguably a decision-log entry)
   before the behaviour is implemented, not a guess baked into a test that then becomes the
   de facto spec.

---

## 9. Open questions genuinely needing Thomas (checked against the decision log first)

Checked `decision-log.md` in full via targeted search for every topic below — none of
these five appears there already decided; each is a genuine gap, not a rediscovery of a
settled question.

1. **The SLA policy-move contradiction is still live in `sla.md`'s own text**, unchanged
   since the 2026-09-05 review flagged it: the edge-case table says *"Work item moved to a
   project with a different policy → New policy applies from the move, computed against
   original creation time"* — this is **two different computations described as one
   rule** (does the *goal* come from the new project's policy while the *clock* still
   starts at original creation — i.e., the moved item is immediately evaluated against a
   different `target_minutes` but the same `slaStartedAt` — or does the whole resolution,
   including which policy *version* applies, re-run as if newly created at the move?), and
   it sits **beside** `SLA-3`'s flat statement that *"the version effective at the work
   item's creation is used. Changing a policy never rewrites whether past work was met."*
   A project move is not "changing a policy" in the literal sense `SLA-3` describes, so the
   two rules may not actually conflict — but the spec never says so, and an implementer
   has to guess. **Recommended resolution** (the review's own suggestion, still valid): the
   policy resolved at creation is pinned for the item's life; a project move records an
   activity row and does **not** change the goal. **Needs Thomas's decision**, because it
   is a real behaviour choice (does moving a delivery item into a service-desk project
   immediately impose that project's SLA, or not?), not a documentation clarity fix alone.
2. **The `service-calendars.md` / `sla.md` "`none`" collision is still live**, unchanged
   since the same review: `CAL-5` says a zero-cover calendar "produces `none` for every SLA
   measured against it," while `sla.md`'s own state table defines `none` as *"No policy
   applies. A delivery project with no service commitment"* — a zero-cover calendar can
   perfectly well have a policy attached, in which case the correct state by `sla.md`'s own
   definition is `ok` forever (the clock never advances), not `none`. **This governs a test
   fixture** (section 5's `calendar/` "zero-cover" case) and a real SLA badge/report value,
   so it cannot be left ambiguous. **Recommended resolution**, from the review: reword
   `CAL-5` to say the clock never advances (state stays `ok` indefinitely), rather than
   introduce a seventh state value. **Needs Thomas's confirmation** because it changes what
   a customer or agent sees on a zero-cover work item's badge.
3. **The IANA timezone library dependency is unnamed.** ADR 0009 and `service-calendars.md`
   both require "a real timezone library" for DST correctness but neither names one.
   `packages/domain`'s own no-I/O rule does not forbid a pure computational dependency, but
   AGENTS.md do-not 4 ("Add a dependency without asking") applies to any new package.
   **Candidates worth naming for Thomas's yes:** the `Temporal` polyfill (`@js-temporal/
   polyfill` — forward-looking, matches where JS itself is heading, but not yet a browser
   built-in and adds bundle weight if `packages/domain` is ever bundled client-side, which
   `monorepo-layout.md`'s rules suggest it should not be, so that concern may not bind);
   `date-fns-tz`; `luxon`. **This should be settled before the bootstrap PR**, not
   discovered independently by whichever agent writes `calendar/calendar.ts` first, since a
   later swap means every existing test's fixture format changes too.
4. **The `showIf` conditional-visibility JSON shape (`RT-5`) is referenced by
   `data-model.md`** (*"form_schema jsonb (shape incl. `showIf` in
   request-types-and-catalogue.md)"*) **but not actually defined in
   `request-types-and-catalogue.md` itself** — the spec's own example JSON has no
   conditional field. This blocks writing `visibleFields`'s test fixtures precisely (though
   not the function's general shape). **Recommended shape** (matching the style of `RT-4`'s
   own `mapsTo` value-map): `{ "field": "impact", "equals": "Everyone" }`, single-level per
   the custom-field precedent (`custom_field.visibility_condition` in the data model uses
   exactly this shape: `{ field_key, op: eq|neq|in|is_set, value }`) — **recommend reusing
   that exact op vocabulary** rather than inventing a second one for request-type forms.
   This is closer to a documentation-completeness gap than a genuine behaviour question,
   but since it decides a JSON wire shape two renderers (portal, publish validator) must
   agree on byte-for-byte, it is listed here rather than silently assumed.
5. **`reconstructAt`'s tie-break rule for two `activity` rows in the same instant is
   unspecified anywhere I read** (not in `audit-trail.md`, not in `data-model.md`'s
   `activity` table definition, not in `comments-and-activity.md` — the last of which I did
   not read in full and flag as a possible source not yet checked, see NOT DONE). Postgres
   `timestamptz` has microsecond resolution, so a true tie is rare but not impossible under
   load (two automations firing on the same trigger, for instance). **Recommended
   resolution:** order by `activity.id` (an auto-increment or similarly ordered surrogate
   key) as the tie-break, since insertion order is the only reliable secondary signal a
   database provides for free. **Needs a one-line decision**, likely by Thomas or by
   whoever owns `data-model.md`'s `activity` table, before `reconstructAt`'s test suite can
   include a same-instant case.

**Also worth Thomas's attention, but as a scheduling question, not a design one:** section
1's `turbo.json` `test:coverage` task and the `packages/domain` 90% threshold — this is a
pre-existing gap (found by the 2026-09-05 review, not by this prep), sitting at the
boundary between P2 (which needs it to prove exhaustiveness) and whichever PR closes out
#19/#10's CI work. **Recommendation, not a demand:** P2's bootstrap PR adds the
`test:coverage` script to `packages/domain/package.json` alone (a local script, not a
`turbo.json` task) so `pnpm --filter @taskdesk/domain test:coverage` works standalone from
day one; wiring it into `turbo.json` as an enforced CI gate is left to the CI lane, since
`turbo.json` is read by every package and editing it in a P2 branch is exactly the kind of
shared-file touch CLAUDE.md asks to route separately.

---

## NOT DONE

- **Did not read `docs/03-features/customer-portal.md` in full** — needed to fully resolve
  whether `IQ-3`'s "durable page... surviving sign-out" is actually specified elsewhere
  (the review flagged it as an open gap on 2026-09-05; I could not confirm or deny it was
  since closed without reading this file, and ran out of budget before doing so). Read it
  before treating `IQ-16a`/`IQ-3`'s HTTP-layer auth mechanism as decided — this does not
  block the pure `canWithdraw` function itself, which needs no auth mechanism.
- **Did not read `docs/03-features/comments-and-activity.md` in full** — relevant to open
  question 5 (`reconstructAt`'s tie-break) and to `WF-12`'s comment/activity correlation
  (section 0/2's low-severity residual finding) — only grepped for it.
- **Did not read `docs/03-features/service-management.md` in full** — only grepped for
  "CAB"; read enough to confirm approvals.md's "CAB membership → service-management.md"
  cross-reference is stale (should point at `teams.md`) but did not read the rest of the
  spec for any other P2-relevant content (it is P5-staged, so low priority).
- **Did not read `docs/01-architecture/multi-tenancy.md`, `security-model.md`, or
  `api-design.md` in full** — only grepped/cross-referenced where a specific claim needed
  checking (e.g., the "enforced in packages/domain regardless of capabilities" pattern for
  approvals). A full read might surface additional pure-vs-impure boundary detail for the
  customer-visibility rules `sla.md` (`SLA-21`) and `approvals.md` (`AP-3`) reference.
- **Did not read the `pre-p0-check-fable/` subdirectory** of the 2026-09-05 reviews beyond
  the one `L6-planning.md` grep hit shown by search (assignment's P1/P2 split finding) and
  one `L2-rbac-security.md` grep hit (the `orOwner` time-window finding, not P2-scoped).
  There are more `L*-*.md` files in that directory I did not enumerate or read.
- **Did not check `consistency.md`, `feature-gaps-openproject-itsm.md`,
  `features-governance-design.md`, `readiness-review-external.md` or `security.md`**
  (the other five 2026-09-05 review files) for P2-specific findings beyond the one
  `features-governance-design.md:198` grep hit (automation depth-counter, not P2-scoped)
  and `features-governance-design.md:311` (reports, not P2-scoped). Given
  `features-core-servicedesk.md` is the review file organised explicitly by feature and
  covers all seven P2 specs directly (confirmed and read in full for sections 10-16), I
  judged this the highest-value single file and prioritised it completely; the other five
  are organised by cross-cutting theme (architecture, consistency, security, external
  readiness, ITSM gap-analysis) and may still contain P2-relevant findings under those
  themes that a full read would surface.
- **Did not verify `packages/typescript-config/base.json`'s exact compatibility** with the
  `noEmit`/`declaration` settings a new `packages/domain/tsconfig.json` would need beyond
  reading the file once — did not attempt a dry-run `tsc` (correctly, per the hard
  boundary against builds), so the exact tsconfig contents in section 1 are a
  recommendation modelled on `apps/api`'s pattern, not a verified-compiling artifact.
- **Did not check whether `docs/02-design/screen-inventory.md` lists screens for these
  seven features** that might reveal additional acceptance-criteria detail beyond the
  specs themselves — out of scope for a pure-function prep, but relevant to whoever picks
  up the HTTP/screen layer next.
- **No code was written, no `pnpm install`/build/test was run**, per the hard boundaries.
  Every file path and content sketch in section 1 is a recommendation for the bootstrap PR
  author to implement and verify, not a tested artifact.
