# Design principles

> **The governing rule: it should feel like kaneo.** Not "inspired by". Not "in the
> spirit of". The same. If a screen would look out of place next to a kaneo screen, it
> is wrong.

This is a deliberate abdication of design authority, and it is the single most important
decision in the project. v1 failed because it tried to design as it built. v2 does not
design. It inherits a finished design and fits features into it.

---

## 1. kaneo is the specification

When you are unsure how something should look or behave, **open kaneo and look**. Not
Jira, not Linear, not a Dribbble shot. kaneo.

The reference is in the workspace at `../kaneo`. Read the actual component. Match its
spacing, its typography, its states, its motion.

If kaneo has no equivalent — SLA badges, approval panels, the request catalogue — build
it from kaneo's primitives and follow its conventions. A new component should be
indistinguishable in style from one that came with the system.

---

## 2. Calm by default

kaneo's interface is quiet. Muted neutral greys, restrained colour, generous whitespace, few
borders, subtle shadows. Colour means something — it is not decoration.

| Colour | Reserved for |
| --- | --- |
| Red | Destructive actions, breached SLA, errors |
| Amber | At-risk SLA, warnings, pending approval |
| Green | Success, met SLA, completed states |
| Blue / accent | Primary action, current selection |
| Neutral grey | Everything else |

Two consequences: a red badge is *noticed* because red is rare, and a screen with nothing
wrong looks calm.

---

## 3. Progressive disclosure

v1's ticket pane showed twenty-plus fields at once. Nobody could find anything.

Show what matters first. Put the rest one interaction away — a collapsible section, a
secondary tab, a popover. The right question is not "does this fit?" but "does someone
need this every time they open this screen?"

This applies especially to the work item detail view, which is the screen people spend
their day in and the one that most tempts everyone to add "just one more field".

---

## 4. Every screen has a URL

Anything visible must be linkable, bookmarkable, back-buttonable and middle-clickable.
Filters, tabs, lenses, selected records, open panels — all URL state.

This was one of v1's most-complained-about failures: reports were buried behind nested
tabs with no addresses, so a manager could not send a colleague a link to the thing they
were both discussing.

A route registry with a round-trip test enforces it.

---

## 5. Keyboard first, mouse always

kaneo ships a command palette (`⌘K`), numbered shortcuts and keyboard navigation. Keep
and extend it. Every frequent action should be reachable without the mouse — and every
action must still be reachable *with* it. Keyboard-only is not an excuse for a hidden
control.

---

## 6. Optimistic, then honest

Mutations apply immediately in the UI. If the server disagrees, roll back visibly and say
why. Never a spinner where an optimistic update would do; never a silent failure where a
rollback is needed.

---

## 7. Empty, loading and error states are designed, not defaults

A screen has four states and all four are part of the work:

- **Empty** — explain what this is and offer the action that fills it. Never a bare
  "No results".
- **Loading** — skeletons that match the shape of the content, not a centred spinner.
- **Error** — say what failed, what it means, and what to do. Offer a retry.
- **Partial** — some data arrived, some did not. Show what you have and flag what is
  missing.

A pull request that adds a screen without all four is incomplete.

---

## 8. Density is a user choice, not ours

kaneo offers comfortable and compact. Respect the preference everywhere. Do not
hard-code the spacing that happens to suit the screen you are building.

---

## 9. Motion communicates, never decorates

Follow kaneo's motion specs in `plans/001-motion-tokens-and-easing.md` and the related
documents. Animation exists to explain a relationship — where a thing came from, what it
became. If it does not explain something, remove it.

`prefers-reduced-motion` is honoured throughout, and it is tested.

---

## 10. Accessible because it is built that way

Radix gives focus management, keyboard interaction and ARIA for free. Do not work around
it. Do not reimplement a `Select` because the native one "looked wrong" — style the Radix
one.

WCAG 2.1 AA is the floor: contrast, focus visibility, keyboard reachability, screen reader
labels. Verified by axe in CI, and by manual keyboard-only passes at phase review.

---

## 11. The portal is not a lesser product

v1's customer portal was, in its own documentation, "a shell, not a working product". In
v2 the portal is built from the same `packages/ui` primitives as the agent workspace and
held to the same standard.

It is smaller and simpler because customers need less — not because it received less
attention.

---

## 12. Write like a person

Microcopy is design. Say what happened in plain words.

| Not this | This |
| --- | --- |
| "An error occurred" | "Couldn't save — the ticket was changed by someone else." |
| "No data" | "No tickets are waiting for approval." |
| "Are you sure?" | "Delete SUP-1234? This can't be undone." |
| "Invalid input" | "Due date must be after the start date." |
| "Success!" | *(nothing — the change is visible)* |

Sentence case for everything. No exclamation marks. No "Oops". No blame directed at the
user.

---

## What this does *not* mean

We are not forbidden from improving on kaneo. We are forbidden from improving on it
*accidentally, inconsistently, and one screen at a time* — which is what v1 did.

If a kaneo pattern is genuinely wrong for a service desk, change it **in
`packages/ui`, once, for everything**, and record why in the
[decision log](../07-planning/decision-log.md).

## The written vocabulary behind "does it look like kaneo?"

kaneo ships its design vocabulary as agent skills under `../kaneo/skills/` —
`pick-ui-library`, `animation-vocabulary`, `review-animations`, `apple-design`,
`emil-design-eng`. They are read-once references (not copied — [inherited-features.md](../01-architecture/inherited-features.md)),
and together with the kaneo reference screenshot set captured at P0 they are what gate
`H1` compares against ([ux-quality-gates.md](ux-quality-gates.md)).

## Related

- [Design system](design-system.md) · [Design tokens](design-tokens.md)
- [Motion](motion.md) · [Accessibility](accessibility.md)
- [UX quality gates](ux-quality-gates.md)
- [ADR 0008](../01-architecture/adr/0008-single-design-system.md)
