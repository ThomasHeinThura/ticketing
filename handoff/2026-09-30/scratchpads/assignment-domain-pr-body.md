## Task

Build assignment rules as pure functions in a new `packages/domain/src/assignment/`
module — no I/O, no DB, no HTTP — with exhaustive tests.

**Spec:** docs/03-features/assignment.md
**Rules in scope:** AS-3, AS-5, AS-7, AS-8, AS-9, AS-10, AS-11, AS-12, AS-13, AS-16,
AS-17, AS-18, plus the edge-cases table's inactive-default, self-assign-concurrency,
assignee-deactivated/removed-from-project, and cross-project-move rows.

**Fix round (this revision), from the ordinary review and a separate alignment check —
all against `origin/main`, never the stale local checkout at `/home/ubuntu/ticketing.v2`
that caused the original mistakes:**

1. **BLOCKING, fixed.** `AssigneeDisplayFacts.accountDeleted` and the `"former_member"`
   display status were invented against a stale reading of `assignment.md`. On
   `origin/main` (post-#283), `AS-8` states plainly that people are never hard-deleted —
   only deactivated (`person.active = false`) — and `work_item.assignee_id` is `ON DELETE
   RESTRICT`, so there is no delete path to tombstone against. Removed `accountDeleted`
   and `"former_member"` entirely; `AssigneeDisplayStatus` is now exactly `"active" |
   "inactive" | "not_on_project"`, with precedence `not_on_project` > `inactive` >
   `active`. Tests rewritten as a table-driven 2×2 matrix over `active`/`onProject`.
2. **Fixed.** `planAssignment`'s confirmation gate was over-broad: it required
   confirmation for *any* reassignment between two different people. `AS-3`'s actual
   text is about a member **picking up** work — self-assigning something already held by
   someone else — so confirmation now requires `newAssigneeId === actorId` in addition to
   there being a different previous holder. A lead or third party reassigning between two
   *other* people no longer requires confirmation (the previous holder is still notified,
   per `AS-17`). Two test cases updated to match; a new mutation-guard test added.
3. **Every doc-comment quote re-checked against `origin/main`'s current
   `assignment.md`/`workflows.md`/`data-model.md` text, word for word.** `workflows.md`
   and `data-model.md` are byte-identical to what this PR was built against — no fix
   needed there. `assignment.md` itself had moved (§8/§15 review closure, #283) since the
   very first read this lane did against the stale main checkout. Fixed, beyond items 1–2
   above:
   - The concurrency edge case's quote ("optimistic concurrency; the second is told who
     won") no longer exists — replaced with the current text, both the edge-cases-table
     row and the API section's own conditional-`UPDATE`/`409` mechanism, in
     `ConcurrentAssignResult`'s and `decideConcurrentSelfAssign`'s doc comments.
   - A capitalisation slip ("left unassigned..." vs. the spec's "Left unassigned...") in
     `resolveDefaultAssignee`'s doc comment.
   - Three added `` `409` `` backtick-code-spans around a plain "409" the spec itself
     never puts in code font — reverted to match verbatim.
   - `AS-10`'s quote was accurate as far as it went, but incomplete: `AS-10` now reads
     "**P5.** ... Not a v2 P1 screen" — the *report/screen* is deferred to P5.
     `workItemsAssignedToInactive`'s doc comment now quotes this in full and explains why
     the pure filter is still being built now (P5 needs it; a domain function isn't the
     screen `AS-10` defers).
   - A comment-header phrase presented in quotes as if a spec quote (`"already assigned
     to you is a no-op."`) was actually my own paraphrase — de-quoted to avoid implying
     verbatim spec text.

**Two spec extensions, decided by the orchestrating session under Thomas's standing
delegation (do-not 17 — the answer goes into the spec, not just the code) — added to
`docs/03-features/assignment.md` in this same PR:**
- `AS-5`: "Only active people (`person.active = true`) are eligible for any assignment,
  direct or default. Assigning to a deactivated person is refused." — generalises the
  existing "default assignee inactive" edge case to every assignment.
- `AS-18`: "The actor is never notified of their own action, and this covers unassigning
  yourself as well as assigning yourself." Both are quoted word for word in the code's
  doc comments (`AssigneeStanding.active`, `AssignmentPlan`, `evaluateAssigneeEligibility`,
  `planAssignment`). `assignment.md`'s review section is closed (#283); ran
  `node scripts/ci/check-reviews.mjs --spec docs/03-features/assignment.md` after these
  edits — **exit 0**, confirming the section is still empty.

**Not implemented, and why:**
- **AS-1/AS-2/AS-4** — who may assign whom is a capability/RBAC predicate
  (`work_item:assign`, the `orSelfTarget` body predicate) that already lives in the
  registry per `assignment.md`'s own API section ("the body predicate is in the registry
  (rbac.md), not the handler"). Rebuilding it here would duplicate a shared contract
  (`packages/permissions`) this lane does not own.
- **AS-6** — "assignment stores a person id, comparisons are by id" is structural (every
  function in this module takes/returns a branded-free `PersonId = string` and never a
  display name); there is no separate function to write for it.
- **AS-14** — automations are "subject to the same roster constraint," i.e. they reuse
  `evaluateAssigneeEligibility`; no separate function needed.
- **AS-15 — explicitly out of scope.** The spec's own words: "Round-robin and
  load-balanced assignment are out of scope for v2. They reward gaming and produce worse
  outcomes than a person looking at a queue." The task brief that kicked off this lane
  gave round-robin/least-open-items as *example* strategies to build; the spec directly
  contradicts that example, and the spec wins (do-not 17 — invent nothing the spec
  doesn't say; a closed-vocabulary AS rule saying "out of scope" is not an open question
  to guess an answer for). No auto-assignment strategy exists in this PR. What is built
  instead is the person-picker's **read-only** "current open work count"
  (`countOpenAssignments`) that `assignment.md` § Screens describes — a fact a human
  reads, never an input to an algorithm that picks anyone.

## Implemented by

**Model:** Claude Sonnet 5
**Session:** background implementation lane, `feat/30-assignment-domain`

## Reviewed by

**Model:** _pending_
**Session:** _pending_

## Security review

**Model:** n/a — `packages/domain` is not in `ci-cd.md`'s security-review scope list
(auth/permissions code, migrations, CI/gate machinery, the dependency graph). This PR
touches none of those: three files under `packages/domain/src/assignment/**` plus a
`docs/03-features/assignment.md` spec edit, no route, no migration, no dependency change.
**Session:** n/a
**Surfaces examined:** n/a — no security surface touched
**Note:** n/a

- [ ] **Independent review completed and recorded** — pending

## Screens opened

n/a / not applicable — no `apps/web/**` file touched.

## Gates

| Gate | Result (pass / n/a / waived) | Decision-log link |
| --- | --- | --- |
| G1 — No bespoke primitives | n/a | no UI change |
| G2 — Tokens only | n/a | no UI change |
| G3 — Contrast | n/a | no UI change |
| G4 — Accessibility | n/a | no UI change |
| G5 — Every screen has a URL | n/a | no screen |
| G6 — Every screen has four states | n/a | no screen |
| G7 — Storybook coverage | n/a | no UI change |
| G8 — Visual regression | n/a | no screen |
| G9 — Reduced motion | n/a | no UI change |
| G10 — Keyboard reachability | n/a | no UI change |
| G11 — Performance budgets | n/a | no screen |
| G12 — Portal bundle purity | n/a | no UI change |
| G13 — No layout shift on data arrival | n/a | no screen |
| Route coverage (`test:permissions`) | n/a | no route added or changed |
| Permission matrix | n/a | no capability or policy touched |

No gate is waived.

## Checklists

### Any change

- [x] Branch named `feat/30-assignment-domain`
- [x] Conventional commit messages
- [x] `pnpm lint` green (`biome check` clean on every touched file)
- [x] `pnpm typecheck` green
- [x] `pnpm test` green — `@taskdesk/domain` 392/392 (337 pre-existing + 55 new in
      `assignment.test.ts`)
- [x] No disabled or skipped tests
- [x] No new dependency
- [x] No code from an unlicensed source
- [x] Pull request describes what changed and why, and what was deliberately left out

### Backend change

n/a, with one exception ticked — no `apps/api` route, migration, or wire schema is
touched by this PR:

- [ ] Every new or changed route has a policy entry — n/a: no route
- [ ] `pnpm test:permissions` green — n/a: no route
- [ ] Permission matrix fixture updated — n/a: no access changed
- [ ] Zod request and response schemas — n/a: no route
- [ ] Integration tests against a real Postgres — n/a: pure functions, no I/O to
      integration-test; unit tests are the exhaustive layer for this module
- [ ] Negative tests for every "must not" in the spec — n/a: see unit tests instead
      (ineligibility reasons, `default_inactive`, concurrency conflict, etc. are all
      covered as table-driven cases in `assignment.test.ts`)
- [ ] Mutations write an activity row and an audit_log row — n/a: this module never
      writes anything; it only decides
- [ ] Mutations emit their domain event — n/a: same reason
- [ ] Migration is forward-only and reviewed — n/a: no migration
- [ ] Destructive migration is two-phase — n/a: no migration
- [x] Domain logic lives in `packages/domain` and is pure — yes, this is the whole PR
- [ ] No secret is logged or serialised — n/a: no logging in this module
- [ ] Opus security review completed and recorded in the pull request's Security review
      section — n/a: `packages/domain` is outside `ci-cd.md`'s security-review scope
      (see `## Security review` above)

### Frontend change

n/a — no `apps/web/**` file touched.

### New `packages/ui` primitive

n/a — no `packages/ui` file touched.

### New feature

n/a — this PR does not complete a feature slice (no route, no UI, no feature flag); it
is the pure-function layer a later PR (schema/route/UI) builds on, per the task's own
"partition by file" instruction. `assignment.md`'s review section remains empty (verified
with `check-reviews.mjs`, see above) after this PR's two small spec additions (AS-5,
AS-18).

### New plugin

n/a — no plugin.

### Bug fix

n/a — not a bug fix.

### Phase completion

n/a — not a stage-completion PR.

## Design review H1–H6

n/a — Thomas only; no UI in this PR.

## Not done

- **AS-15's round-robin/load-balanced auto-assignment is deliberately not built** — see
  the "Not implemented, and why" note under `## Task`. If a future PR wants automated
  assignment, `assignment.md` needs its own spec change first (removing or narrowing
  AS-15), not a domain function that quietly does what AS-15 says v2 does not do.
- **AS-1/AS-2/AS-4's permission predicates are not duplicated here** — they live in
  `packages/permissions`, untouched by this PR.
- **No `apps/api` wiring.** `packages/domain/src/index.ts` is deliberately not touched
  (per this lane's own scope) so the barrel does not export a module nothing calls yet;
  the orchestrator wires the export and the `apps/api` executor in a follow-up.
- **Bulk-assign partial-results plumbing (the edge-cases table's "Bulk assign where some
  items are outside authority" row) is not a separate domain function** — per-item
  authority is a permissions-layer decision (AS-1/AS-2), and per-item eligibility is
  already `evaluateAssigneeEligibility` called in a loop; there was no additional pure
  rule to extract.
- Did not open any screens — none exist yet for this slice.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
