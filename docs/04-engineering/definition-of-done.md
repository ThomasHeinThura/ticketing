# Definition of Done

The [pull request template](../../.github/pull_request_template.md) ships every checklist
below already. Tick the ones that apply; mark a whole checklist `n/a`, with one line saying
why, if it does not — never delete it. An unticked, unmarked box is a blocker, not a note.

---

## Any change

- [ ] Branch named `feat/…`, `fix/…`, `docs/…`, `chore/…`
- [ ] Conventional commit messages
- [ ] `pnpm lint` green
- [ ] `pnpm typecheck` green
- [ ] `pnpm test` green
- [ ] No disabled or skipped tests
- [ ] No new dependency without a [decision log](../07-planning/decision-log.md) entry
- [ ] No code from an unlicensed source
- [ ] Pull request describes **what changed and why**, and what was deliberately left out

---

## Backend change

- [ ] Every new or changed route has a **policy entry**
- [ ] `pnpm test:permissions` green — route coverage and permission matrix
- [ ] Permission matrix fixture updated if access changed, and the diff is intentional
- [ ] Zod request **and response** schemas — no ORM row reaches the wire
- [ ] Integration tests against a real Postgres
- [ ] Negative tests for every "must not" in the spec
- [ ] Mutations write an `activity` row and an `audit_log` row
- [ ] Mutations emit their domain event
- [ ] Migration is forward-only and reviewed
- [ ] Destructive migration is two-phase
- [ ] Domain logic lives in `packages/domain` and is pure
- [ ] No secret is logged or serialised
- [ ] Opus security review completed and recorded in the pull request's `## Security
      review` section

---

## Frontend change

- [ ] No primitive defined outside `packages/ui` (G1)
- [ ] Tokens only — no literal colours or arbitrary spacing (G2)
- [ ] Every new route in `lib/routes.ts`, round-trip test passing (G5)
- [ ] Empty, loading and error states implemented **and good** (G6)
- [ ] axe: zero critical or serious (G4)
- [ ] Keyboard-operable end to end (G10)
- [ ] Works with `prefers-reduced-motion` (G9)
- [ ] Works in light and dark
- [ ] Works at 375 px and at 200% zoom
- [ ] Honours the density preference
- [ ] Visual regression snapshots reviewed and approved (G8)
- [ ] Performance budgets met (G11)
- [ ] Screen added to the [screen inventory](../02-design/screen-inventory.md)
- [ ] Every screen in this change opened and used; listed in the pull request's
      `## Screens opened` section
- [ ] **Does it look like kaneo?** (H1) — answered honestly in the pull request

---

## New `packages/ui` primitive

- [ ] Built on a **Base UI** primitive where one exists; Radix only with a
      `KNOWN-RADIX.md` entry approved in the same pull request
- [ ] Variants via `cva`
- [ ] Ref forwarded, props spread, `className` accepted
- [ ] Storybook story: default, every variant, every size, disabled, loading, error,
      long content (G7)
- [ ] axe clean in every story
- [ ] Light and dark
- [ ] Reduced motion, if it animates
- [ ] Documented in [design system](../02-design/design-system.md)

---

## New feature

Everything above, plus:

- [ ] Feature spec exists in [03-features](../03-features/README.md) and **matches what
      was built**
- [ ] Behaviour rules numbered, and tests cite them
- [ ] Open questions section is empty
- [ ] **The feature's section in [reviews/2026-09-05/](../07-planning/reviews/2026-09-05/)
      is empty** — every medium/low finding closed in the spec before the build started.
      "Documentation exists" is not "spec is complete"; this box is what enforces the
      difference
- [ ] Feature flag added, and the feature is genuinely hidden when off — including its API
      routes returning 404
- [ ] Capabilities added to `packages/permissions`
- [ ] Data model documentation updated
- [ ] E2E test covering the primary journey
- [ ] User-facing documentation added to `apps/site`
- [ ] Configuration reference updated if settings were added
- [ ] i18n strings extracted; `en-US` complete
- [ ] [status.md](../07-planning/status.md) updated
- [ ] Opus security review completed and recorded in the pull request's `## Security
      review` section

---

## New plugin

- [ ] Implements the contract from `packages/plugins-contracts`
- [ ] Zod config schema — God Mode form generates from it
- [ ] `secretFields` declared; secrets encrypted and never serialised
- [ ] `validate()` implemented
- [ ] `test()` implemented where meaningful, returning a **real** error message
- [ ] Registered in its kind's index
- [ ] Appears in God Mode with no bespoke UI
- [ ] Integration test against a real instance of the thing (container where possible)
- [ ] Documented in [plugin architecture](../01-architecture/plugin-architecture.md)

---

## Bug fix

- [ ] A test that **fails before the fix and passes after**
- [ ] Root cause understood and stated in the pull request — not just the symptom
- [ ] Checked whether the same mistake exists elsewhere
- [ ] If it was a class of bug, a structural guard added so it cannot recur
- [ ] [error-fix-loop.md](error-fix-loop.md) updated if the lesson generalises

---

## Stage completion

**This is the canonical stage-gate list.** [SDLC](sdlc.md#the-stage-gate) and
[UX quality gates](../02-design/ux-quality-gates.md#stage-gate--before-a-stage-is-declared-complete) both point here instead of
restating it; ux-quality-gates.md's own automated checks are renumbered `PG1`–`PG6` so
they stop colliding with the delivery-stage numbering (`P0`–`P5+`) used everywhere else.

- [ ] Every feature in the stage meets its Definition of Done
- [ ] Screen review — every new screen walked through against
      [design principles](../02-design/design-principles.md), signed off in the stage
      review note (PG1)
- [ ] Every screen ✅ in the [screen inventory](../02-design/screen-inventory.md)
- [ ] Full E2E suite green, agent and portal
- [ ] Full E2E suite green with reduced motion
- [ ] Manual screen reader pass — VoiceOver and NVDA (PG2)
- [ ] Keyboard-only working session completed, findings logged (PG3)
- [ ] Fresh-eyes test completed, hesitations logged (PG4)
- [ ] Cross-browser: Chrome, Firefox, Safari, Edge, latest and latest-minus-one (PG5)
- [ ] Run against realistic data — 10,000 work items, 50 projects, 200 people (PG6)
- [ ] Load test baseline recorded
- [ ] Backup and restore verified
- [ ] **Stage-level Opus security review** — a holistic pass over the whole stage's
      surface, not only the per-feature reviews already passed
- [ ] Written stage review in `07-planning/`, **including what went wrong**
- [ ] [Screen inventory](../02-design/screen-inventory.md),
      [feature index](../03-features/README.md) status columns and `CHANGELOG.md`
      updated together, at the same stage close
- [ ] Roadmap and status updated
- [ ] Gates table complete for every pull request in the stage, with every **waived** row
      linked to its [decision log](../07-planning/decision-log.md) entry — see the
      [pull request template](../../.github/pull_request_template.md)'s `## Gates` section

Under the accelerated calendar, this gate carries the parallel-workstreams exception
recorded as decision A — see [SDLC § The stage gate](sdlc.md#the-stage-gate).

---

## Go-live rehearsal

Before the first real tenant — internal or external — the whole first week of a
customer's life is rehearsed **once, in order, in a single sitting, against the
`realistic` seed**, and timed. Not each step proven separately: the sequence, start to
finish. Cited from [phases.md](../07-planning/phases.md) and the accelerated plan's
week-5 gate ([decision log](../07-planning/decision-log.md)).

Two lanes, with different bars.

**Administrator lane — browser only, ten minutes.** From a running instance, with no
terminal and no file edited: create an organisation; configure Microsoft Entra for it;
invite a customer and have them sign in; raise a request from the portal; triage it; let
an SLA breach **on purpose** and confirm the breach is visible where the spec says it is;
resolve it. Wall-clock over ten minutes, or any step that cannot be completed in the
browser, **fails the gate**.

**Operator lane — a shell is expected; improvisation is not.** Install, restore from
backup, and run an upgrade are shell procedures **by design**
([deployment.md](../05-operations/deployment.md),
[backup-and-restore.md](../05-operations/backup-and-restore.md)), as is reading the
one-time setup token from the container log. The bar here is not "no shell": it is that
each is completed by **following the runbook exactly, in the documented commands, with no
step the runbook does not name**, and timed. A step that needs a command the
documentation does not contain is a documentation defect and fails the gate.

Record both lanes' timings and every hesitation in the stage review note. A hesitation is
a design bug ([UX quality gates](../02-design/ux-quality-gates.md) PG4), and a step that
took three times its expected duration is one too.

---

## The pull request template

Every pull request is opened from
[`.github/pull_request_template.md`](../../.github/pull_request_template.md). It carries,
as fixed sections: `Task`, `Implemented by`, `Reviewed by`, `Security review`, `Screens
opened`, `Gates` (G1–G13 plus route coverage and the permission matrix, each `pass` /
`n/a` / `waived` with a decision-log link for anything waived), `Checklists` (every
checklist on this page, `n/a` rather than deleted where one does not apply), `Design
review H1–H6` (Thomas only — agents leave it blank), and `Not done`.

CI checks the template mechanically: every section present; no section left both empty
and unmarked; `Reviewed by` names a different session or model from `Implemented by`;
`Security review`'s model matches `^Opus`, with a link to the committed note at
`docs/07-planning/security-reviews/<pr>-<slug>.md`; `Screens opened` non-empty whenever
`apps/web/**` changed; every checklist box ticked or marked `n/a`. See
[ci-cd.md](ci-cd.md) for the exact check.

---

## What "done" is not

- Not "it works on my machine"
- Not "the tests pass" — see the UX gates
- Not "I'll add tests in a follow-up"
- Not "the design can be tidied later"

**v1 died of "later".** There is no later; there is only the next feature, which will also
have a later.

## Related

- [SDLC](sdlc.md) · [UX quality gates](../02-design/ux-quality-gates.md)
- [Testing strategy](testing-strategy.md) · [CI/CD](ci-cd.md)
- [Pull request template](../../.github/pull_request_template.md)
