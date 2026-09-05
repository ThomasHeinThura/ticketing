# UX quality gates

> v1 was feature-rich and unusable. These gates exist so that cannot happen again.
> They are mostly automated, because a person under deadline is not a reliable gate and
> v1 had reviewers too.

A pull request that fails any gate does not merge. There is no "we'll fix the UX later"
— that sentence is the exact mechanism by which v1 died.

---

## Automated — runs on every pull request

### G1 · No bespoke primitives

**Fails on:** a raw `<button>`, `<input>`, `<select>`, `<textarea>` or `<dialog>` outside
`packages/ui`.

**Why:** v1 hand-wrote every primitive and got inconsistency, missing icons and ad-hoc
accessibility. Enforced by lint. See [ADR 0008](../01-architecture/adr/0008-single-design-system.md).

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

**Fails on:** a route rendered by the router that is not declared in `lib/routes.ts`, or a
declared route that fails the build/parse round-trip test.

**Why:** v1 had screens reachable only by clicking through a sidebar, and nested report
tabs with no address, so a manager could not link a colleague to what they were both
discussing.

### G6 · Every screen has four states

**Fails on:** a route component with no empty, loading and error state exercised in tests.

The check is structural — the E2E suite mocks each condition and asserts something
meaningful renders. "Meaningful" excludes a bare "No results" or an unstyled error.

### G7 · Storybook coverage

**Fails on:** an exported `packages/ui` component with no story.

### G8 · Visual regression

**Fails on:** an unapproved pixel change to any Storybook story or to any key screen
snapshot.

Approving a diff is an explicit action in the pull request, which puts intentional visual
change in front of a reviewer and catches unintentional change immediately rather than
three weeks later.

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
| INP | < 200 ms |
| CLS | < 0.1 |
| Board render, 200 items | < 500 ms |
| List render, 500 rows | < 500 ms |
| Route transition | < 300 ms |
| Agent bundle, initial | < 350 KB gzip |
| Portal bundle, initial | < 200 KB gzip |
| Any board drag frame | 60 fps, no dropped frames |

A budget regression fails the build. Raising a budget requires a decision log entry.

### G12 · Portal bundle purity

**Fails on:** any module under `routes/agent/` or `components/god-mode/` appearing in the
portal bundle's module graph.

### G13 · No layout shift on data arrival

**Fails on:** CLS above 0.1 during the transition from skeleton to content.

Skeletons must match the shape of what replaces them. This is the difference between an
interface that feels solid and one that jumps.

---

## Human — at pull request review

### H1 · Does it look like kaneo?

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

### P1 · Screen review

Every new screen walked through against [design principles](design-principles.md), with
a written sign-off in the phase review note.

### P2 · Screen reader pass

VoiceOver on Safari and NVDA on Firefox, over the phase's core journeys.

### P3 · Keyboard-only day

One working session using the product without touching the mouse. Findings logged.

### P4 · Fresh-eyes test

Someone who has not seen the feature attempts its main task with no instruction. Every
hesitation is recorded. Hesitation is a design bug, not a user error.

### P5 · Cross-browser

Chrome, Firefox, Safari, Edge. Latest and latest-minus-one.

### P6 · Real data

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
