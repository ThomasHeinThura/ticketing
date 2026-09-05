# Definition of Done

Copy the relevant checklist into the pull request description and tick it. An unticked box
is a blocker, not a note.

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
- [ ] **Does it look like kaneo?** (H1) — answered honestly in the pull request

---

## New `packages/ui` primitive

- [ ] Built on a Radix primitive where one exists
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
- [ ] Feature flag added, and the feature is genuinely hidden when off — including its API
      routes returning 404
- [ ] Capabilities added to `packages/permissions`
- [ ] Data model documentation updated
- [ ] E2E test covering the primary journey
- [ ] User-facing documentation added to `apps/site`
- [ ] Configuration reference updated if settings were added
- [ ] i18n strings extracted; `en-US` complete
- [ ] [status.md](../07-planning/status.md) updated

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

## Phase completion

- [ ] Every feature in the phase meets its Definition of Done
- [ ] Every screen ✅ in the screen inventory
- [ ] Full E2E suite green, agent and portal
- [ ] Full E2E suite green with reduced motion
- [ ] Manual screen reader pass — VoiceOver and NVDA
- [ ] Keyboard-only working session completed, findings logged
- [ ] Fresh-eyes test completed, hesitations logged
- [ ] Cross-browser: Chrome, Firefox, Safari, Edge
- [ ] Run against realistic data — 10,000 work items, 50 projects, 200 people
- [ ] Load test baseline recorded
- [ ] Security review of anything new
- [ ] Backup and restore verified
- [ ] Written phase review, **including what went wrong**
- [ ] Roadmap and status updated

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
- [Testing strategy](testing-strategy.md)
