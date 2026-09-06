# 0008 — One design system package, no bespoke primitives

- **Status:** Accepted
- **Date:** 2026-09-05
- **Deciders:** Thomas

## Context

This is the ADR that exists because of why v1 failed.

v1 had no component library. Every button, input, dialog, table and menu was hand-written
in `Frontend/src/ui/`. The consequences, documented in v1's own notes:

- Icons were referenced everywhere and defined nowhere, so several active buttons rendered
  with empty icon paths — visible, clickable, and blank.
- Spacing, sizing and interaction patterns differed between screens because each was built
  independently.
- Accessibility was ad-hoc: focus management, keyboard navigation and ARIA were
  implemented per component, or not at all.
- Two redesign attempts improved individual screens without fixing the cause, because the
  cause was structural.

The verdict in v1's own retrospective was unambiguous: *"No component library: UI
primitives hand-coded, leading to inconsistency; v2 should adopt a mature library."*

Meanwhile kaneo ships 63 primitives — 43 on Base UI, one on Radix (`Slot`) — with Tailwind
v4 tokens, a coherent visual language, dark mode, motion specs and accessibility handled by
Base UI. *(Wording corrected 2026-09-06 against kaneo's source; the ADR originally said
"60+ Radix-based". Decision N of 2026-09-05 makes Base UI the primary standard.)*

## Decision

**`packages/ui` is the single source of every UI primitive. Nothing outside it may define
one.**

- `packages/ui` is taken from kaneo's `apps/web/src/components/ui` and extracted into a
  package so that both the agent bundle and the portal bundle import the same primitives.
- Everything visual lives there: components, `tokens.css`, `theme.css`, `motion.css`,
  the Tailwind preset, and the Storybook catalogue.
- Application code — `apps/web/src/components/**` — composes primitives into features.
  It never defines one.
- **Enforced in CI:**
  - A raw `<button>`, `<input>`, `<select>`, `<textarea>` or `<dialog>` outside
    `packages/ui` is a lint error.
  - A hex colour, `rgb()`, or arbitrary Tailwind colour value outside `packages/ui` is a
    lint error. Only token classes are permitted.
  - `dangerouslySetInnerHTML` is banned outside the sanitised rich-text renderer.
  - Every exported primitive must have a Storybook story, or the build fails.
  - Every primitive must pass axe with zero critical or serious violations.
- If a primitive is missing, the answer is **add it to `packages/ui`** — with a story, a
  test and a token-based implementation. Never inline it "just this once".

## Consequences

### Positive

- **Consistency is structural, not aspirational.** Two screens built by two different
  people, or two different AI agents, look the same because they are made of the same
  parts.
- **Accessibility comes from Base UI**, once (decision N, 2026-09-05), rather than being re-litigated per component.
- **Dark mode, motion and theming are token-driven**, so a branding change is a variable
  change.
- **The portal cannot become second-class.** It is built from the same parts as the agent
  workspace. This is the specific failure mode ADR 0004 is guarding against.
- **AI agents produce consistent output.** Given a fixed vocabulary of primitives and a
  lint rule that rejects invention, an agent's UI work is far more predictable. For a team
  of one human and three agents, this is not a nice-to-have.
- Onboarding: Storybook is the catalogue, and it is always current because CI requires it.

### Negative

- **`packages/ui` becomes a bottleneck** when a feature needs something new. Mitigated by
  making it cheap to add a primitive — a template, a story and a test — and by accepting
  that a slightly-too-general primitive is better than a bespoke one.
- **Some designs will be constrained** by what the system can express. This is the trade
  being made deliberately: consistency is worth more to us than any individual screen's
  optimum.
- **Extraction from kaneo has a cost.** kaneo's primitives live inside its web app and
  assume its Tailwind configuration and path aliases. Moving them to a package means
  reworking imports, the Tailwind preset and the build. This is Stage 0 work and is
  budgeted.
- **The lint rules will occasionally be wrong** and will need escape hatches. Escapes are
  permitted with an inline comment naming the reason, and they are reviewed.

### Neutral

- We are consuming kaneo's design decisions wholesale, including ones we might not have
  made. That is the point — see [ADR 0001](0001-kaneo-as-foundation.md). Divergence is
  allowed later, but it happens inside `packages/ui`, once, for everyone.

## Alternatives considered

**Keep primitives in `apps/web` as kaneo does.** Rejected. Two bundles need to share them,
and a package boundary is what makes the lint rule expressible: "primitives may only be
defined here" requires a "here".

**Adopt a full component library — MUI, Mantine, Ant Design.** Rejected. Each brings a
strong opinion that would fight kaneo's visual language, and we would lose the thing we
came for.

**Design our own system from scratch.** Rejected. That is what v1 did.

**Allow bespoke primitives with review as the control.** Rejected. Review is a person, and
people are inconsistent under deadline. A lint rule is not. v1 had review too.

## Related

- [Design system](../../02-design/design-system.md)
- [UX quality gates](../../02-design/ux-quality-gates.md)
- [ADR 0001 — kaneo as foundation](0001-kaneo-as-foundation.md)
