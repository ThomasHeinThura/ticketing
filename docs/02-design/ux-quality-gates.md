# UX quality gates

> v1 was feature-rich and unusable. These gates exist so that cannot happen again.
> They are mostly automated, because a person under deadline is not a reliable gate and
> v1 had reviewers too.

A pull request that fails any gate does not merge. There is no "we'll fix the UX later"
— that sentence is the exact mechanism by which v1 died.

---

## Automated — runs on every pull request

### G1 · No bespoke primitives

Three checks wearing one number — they need three implementations, so they are named apart:

- **G1a — raw elements.** Fails on a raw `<button>`, `<input>`, `<select>`, `<textarea>` or
  `<dialog>` outside `packages/ui`. kaneo lints with **Biome**, which has no equivalent of
  ESLint's `react/forbid-elements`, so this is a small AST script (`check:ui --raw-elements`)
  over JSX in `apps/web`, not a lint rule.
- **G1b — import boundary.** Fails on any import of `@radix-ui/*`, the `radix-ui` umbrella
  package or `@base-ui/react` outside `packages/ui`, and inside `packages/ui` on any Radix
  import not listed in `packages/ui/KNOWN-RADIX.md` ([ui-extraction-plan.md](ui-extraction-plan.md)).
  This is `check:ui` proper.
- **G1c — the old directory stays empty.** Fails if anything lands in
  `apps/web/src/components/ui` after extraction.

**Why:** v1 hand-wrote every primitive and got inconsistency, missing icons and ad-hoc
accessibility. See [ADR 0008](../01-architecture/adr/0008-single-design-system.md).

**Escape hatch:** an inline `// ui-exempt: <reason>` comment. Reviewed; rarely justified.


### G2 · Tokens only

**Fails on:** a hex colour, `rgb()`, `hsl()`, `oklch()`, or an arbitrary Tailwind value
for colour, spacing, radius or z-index, outside `packages/ui/src/styles/`.

Run by `scripts/check-tokens.mjs`, inherited from v1 — one of the few things it got right.

### G3 · Contrast

**Fails on:** any declared foreground/background pair below WCAG AA, in either theme.

### G4 · Accessibility

**Fails on:** any critical or serious axe violation, on any screen exercised by the E2E
suite, and on any Storybook story.

### G5 · Every screen has a URL

**Fails on:** a route present in the generated route trees (`routeTree.agent.gen.ts`,
`routeTree.portal.gen.ts`) but missing from `lib/routes.ts` — which is **generated from
those trees, never hand-maintained** — or a declared route that fails the build/parse
round-trip test. `check:inventory` compares the screen inventory's canonical routes (query
strings stripped) against the same generated list, so there is one source of truth.

**Why:** v1 had screens reachable only by clicking through a sidebar, and nested report
tabs with no address, so a manager could not link a colleague to what they were both
discussing.

### G6 · Every screen has four states

**Fails on:** a route component with no empty, loading and error state exercised in tests.

The automated check is structural and deliberately narrow: every route module registers
its `Empty`, `Loading` and `Error` state components (an AST check), and the E2E fixture
drives all three conditions for every route and asserts the registered component rendered.
Whether a state is *good* — not a bare "No results", not an unstyled error — is **H4**, a
human gate; this gate does not claim it.

### G7 · Storybook coverage

**Fails on:** an exported `packages/ui` component with no story.

### G8 · Visual regression

**Fails on:** an unapproved pixel change to any Storybook story or to any key screen
snapshot.

Approving a diff is an explicit action in the pull request, which puts intentional visual
change in front of a reviewer and catches unintentional change immediately rather than
three weeks later.

**Tool: pending Thomas's decision** ([status.md](../07-planning/status.md) → Open decisions)
between Playwright `toHaveScreenshot` with in-repo baselines and Chromatic. Until it is
chosen, G8 is a **human** gate — the reviewer compares the Storybook build by eye — and
"Chromatic-style" in older text meant only the approval workflow, never a dependency.

### G9 · Reduced motion

**Fails on:** the E2E suite failing when run with `reducedMotion: 'reduce'`.

### G10 · Keyboard reachability

**Fails on:** a core journey that cannot be completed keyboard-only.

Core journeys: sign in · create a work item · change its state · assign it · comment ·
raise a portal request · decide an approval · open the command palette and navigate.

### G11 · Performance budgets

Measured against a seeded dataset in CI.

| Metric | Budget |
| --- | --- |
| LCP | < 2.5 s |
| Interaction latency (a synthetic INP proxy, Playwright-measured on the named journeys) | < 200 ms |
| CLS | < 0.1 |
| Board render, 200 items | < 500 ms |
| List render, 500 rows | < 500 ms |
| Route transition | < 300 ms |
| Agent bundle, initial | < 350 KB gzip |
| Portal bundle, initial | < 200 KB gzip |
| Board drag, a scripted 2 s drag | p95 frame time < 20 ms, median of three runs |

A budget regression fails the build. Raising a budget requires a decision log entry. Bundle
sizes are measured by `size-limit` on the two entry bundles; field INP is observed in
production ([observability.md](../01-architecture/observability.md)), not gated in CI — a
shared runner cannot measure it.

### G12 · Portal bundle purity

**Fails on:** any module under `routes/agent/` or `components/god-mode/` appearing in the
portal bundle's module graph (walked from the bundler's own metadata).

Achievable only with **two router trees**: two `tanstackRouter()` plugin instances
(`routes/agent`, `routes/portal`) generating two route trees, two Rollup inputs
(`entry.agent.tsx`, `entry.portal.tsx`) and two HTML files. kaneo's single generated
`routeTree.gen.ts` (49 static route imports) cannot satisfy this; the split is P0 work
([ui-extraction-plan.md](ui-extraction-plan.md)).

### G13 · No layout shift on data arrival

**Fails on:** layout shift above 0.1 measured **between the skeleton-mounted and
content-mounted performance marks** — a `PerformanceObserver` for `layout-shift` scoped to
that window — for every route the E2E fixture loads. This is the windowed complement of
G11's page-level CLS row, not a duplicate of it.

Skeletons must match the shape of what replaces them. This is the difference between an
interface that feels solid and one that jumps.

---

## Human — at pull request review

### H1 · Does it look like kaneo?

The comparison has an artefact: a **kaneo reference screenshot set** captured at P0 (the same
snapshot step that copies the code) and committed under `tests/visual/kaneo-reference/`, and
a written vocabulary — kaneo's `skills/` (`pick-ui-library`, `animation-vocabulary`,
`review-animations`, `apple-design`, `emil-design-eng`), linked from
[design-principles.md](design-principles.md). "Does it look like kaneo" is a comparison, not
a memory test.


Open kaneo. Open this. Would they sit next to each other without one looking wrong?

This is the primary question and it is asked every time.

### H2 · Progressive disclosure

Is everything on this screen needed *every time* someone opens it? If not, why is it not
behind a disclosure?

Particular scrutiny on the work item detail view, which is where fields accumulate.

### H3 · Microcopy

Read every string aloud. Does a person say that? Sentence case, no exclamation marks, no
"Oops", no blaming the user, no jargon leaking into the portal.

### H4 · Loading, empty, error

Not "do they exist" — G6 checks that — but "are they *good*?" Does the empty state
explain and offer an action? Does the error say what to do?

### H5 · Density preference

Does it honour comfortable versus compact, or did someone hard-code padding?

### H6 · Mobile

Does it work at 375 px? The agent workspace need not be beautiful on a phone, but it must
be usable. The portal must be genuinely good on a phone, because that is where customers
will use it.

---

## Phase gate — before a phase is declared complete

**The canonical phase-gate list is
[definition-of-done.md § Phase completion](../04-engineering/definition-of-done.md#phase-completion).**
The six checks below are its UX half, numbered `PG1`–`PG6` (renamed 2026-09-06) so they are
never confused with the delivery phases P0–P7.

### PG1 · Screen review

Every new screen walked through against [design principles](design-principles.md), with
a written sign-off in the phase review note.

### PG2 · Screen reader pass

VoiceOver on Safari and NVDA on Firefox, over the phase's core journeys.

### PG3 · Keyboard-only day

One working session using the product without touching the mouse. Findings logged.

### PG4 · Fresh-eyes test

Someone who has not seen the feature attempts its main task with no instruction. Every
hesitation is recorded. Hesitation is a design bug, not a user error.

### PG5 · Cross-browser

Chrome, Firefox, Safari, Edge. Latest and latest-minus-one.

### PG6 · Real data

Run against a seeded dataset with realistic volumes — 10,000 work items, 50 projects,
200 people, long titles, non-Latin names, empty fields. Most layouts break on real data,
not on demo data.

---

## What is deliberately *not* a gate

To be explicit, because v1 also over-constrained in the wrong places:

- **No cap on sidebar entries.** kaneo's shell handles a long navigation well; feature
  flags remove what a deployment does not use; the command palette makes depth
  survivable. An arbitrary number would force bad grouping.
- **No cap on fields in a form.** The gate is progressive disclosure, not a count.
- **No prescribed page layouts.** Match kaneo, use the primitives, pass the gates.

The gates constrain *quality*, not *shape*.

---

## Waiving a gate

Sometimes justified — a spike, a proof of concept, a genuine tooling false positive.

1. Say which gate, and why, in the pull request description.
2. Get explicit approval from Thomas. An AI agent may not self-approve a waiver.
3. Open a follow-up issue and link it.
4. Record it in the [decision log](../07-planning/decision-log.md).

A waiver without a follow-up issue is not a waiver, it is debt with no owner.

## Related

- [Design principles](design-principles.md) · [Accessibility](accessibility.md)
- [Definition of Done](../04-engineering/definition-of-done.md)
- [Testing strategy](../04-engineering/testing-strategy.md)
