<!--
Fixed sections. Do not delete a section that does not apply — mark it n/a, with one
line saying why. Every checklist ships in every pull request; irrelevant checklists are
marked n/a, never removed. An unticked box is a blocker, not a note.
See docs/04-engineering/definition-of-done.md and docs/04-engineering/ci-cd.md.
-->

## Task

<!-- One sentence: what this pull request does. -->

**Spec:** <!-- path under docs/03-features/, or n/a -->
**Rules in scope:** <!-- rule ids from the spec, e.g. WI-3, WI-7 -->

## Implemented by

**Model:** <!-- e.g. Sonnet 5 -->
**Session:** <!-- session id -->

## Reviewed by

**Model:** <!-- must be a different model or session from Implemented by -->
**Session:** <!-- must differ from Implemented by's session -->

## Security review

**Model:** <!-- must be Opus -->
**Session:** <!-- session id -->
**Surfaces examined:** <!-- list them, or state explicitly "no security surface touched" -->
**Note:** <!-- link to the committed docs/07-planning/security-reviews/<pr>-<slug>.md -->

## Screens opened

<!--
One line per screen actually opened and used, not just implemented:
route — viewport — what was clicked — screenshot
n/a only if apps/web/** was not touched by this pull request.
-->

## Gates

| Gate | Result (pass / n/a / waived) | Decision-log link |
| --- | --- | --- |
| G1 — No bespoke primitives | | |
| G2 — Tokens only | | |
| G3 — Contrast | | |
| G4 — Accessibility | | |
| G5 — Every screen has a URL | | |
| G6 — Every screen has four states | | |
| G7 — Storybook coverage | | |
| G8 — Visual regression | | |
| G9 — Reduced motion | | |
| G10 — Keyboard reachability | | |
| G11 — Performance budgets | | |
| G12 — Portal bundle purity | | |
| G13 — No layout shift on data arrival | | |
| Route coverage (`test:permissions`) | | |
| Permission matrix | | |

A row marked **waived** needs Thomas's explicit approval and a decision-log entry — see
[UX quality gates § Waiving a gate](../docs/02-design/ux-quality-gates.md#waiving-a-gate).
A row is not "n/a" because it is inconvenient; it is n/a because the gate does not apply
to this change.

## Checklists

<!--
Paste the relevant checklist(s) from docs/04-engineering/definition-of-done.md below each
heading and tick them. A checklist that does not apply to this change is marked n/a with
one line saying why — it is never deleted from the pull request.
-->

### Any change

### Backend change

### Frontend change

### New `packages/ui` primitive

### New feature

### New plugin

### Bug fix

### Phase completion

## Design review H1–H6

<!-- Thomas only. Agents leave this section blank. -->

## Not done

<!-- What was deliberately left out of this pull request, and why. -->
