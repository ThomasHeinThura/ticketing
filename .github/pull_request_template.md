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

**Model:** <!-- as the platform reports it, e.g. GPT-6 Luna or Claude Opus 5.5 (claude-opus-5-5) -->
**Session:** <!-- session id -->

## Reviewed by

**Model:** <!-- as the platform reports it; see agent-workflow.md § Model policy -->
**Session:** <!-- must differ from Implemented by's session -->

Ordinary review uses a model the [model policy](../docs/04-engineering/agent-workflow.md#model-policy)
assigns, in a context independent of the author. Never record a report under a model that did
not produce it.

## Security review

**Model:** <!-- exactly one label from the security-review model list in
agent-workflow.md § Model policy, as it stands on the merge base (main) -->
**Session:** <!-- session id -->
**Surfaces examined:** <!-- list them, or state explicitly "no security surface touched" -->
**Note:** <!--
link to the committed docs/07-planning/security-reviews/<pr>-<slug>.md. That note must
declare the head each review read, full 40-character SHA, one per line:
  **Reviewed head:** `<sha>`
Every commit that lands after the newest declared head must touch nothing outside
docs/07-planning/security-reviews/, or the note is stale and a fresh delta review is
required. Judged over landed commits, not the net tree — a revert does not restore it.
See ci-cd.md.
-->

## Sampled big review (optional)

<!--
Non-gating random/sample audit. When selected, another context prepares the packet before
the sampled auditor runs. Include the PR/issue/stage and exact SHA(s); what changed and why;
changed files and highest-risk files; relevant specs, ADRs and rules; risk classification
and why that tier applies; ordinary review verdicts and unresolved findings; the security verdict
when the change is security-scope; tests actually run with suite/file/test counts and
notable negative tests; residuals, waivers, exceptions and ## Not done items; recurring
defect classes or invariants to challenge; and explicit spot-check questions. See
agent-workflow.md § Sampled big review for the full packet contract. This sample is
optional evidence and never satisfies or delays a required security review.
-->

**Selected:** <!-- yes / no -->
**Model:** <!-- as the platform reports it, or n/a if not selected -->
**Packet author:** <!-- the context that prepared the packet (never the auditor); n/a if not selected -->
**Packet:** <!-- link to the structured packet; n/a if not selected -->
**Verdict:** <!-- clear / findings / n/a if not selected -->

## Screens opened

<!--
One line per screen actually opened and used, not just implemented:
route — viewport — what was clicked — screenshot

The FIRST meaningful line sets this section's state:
  n/a / not applicable   only if apps/web/** was not touched by this pull request
  BLOCKED — <why>         you could not open them; say what blocked you and name the
                          screens you did not open. Accepted as an honest gap, and NOT a
                          readiness signal — do-not 18 stays unsatisfied.
  anything else           the screens themselves

Mentioning "n/a" later, in explanation, carries no state. Do not water down a real gap
into an n/a, and do not avoid explaining one for fear the word will trip the check.
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

A row marked **waived** needs Thomas's explicit approval, and its link cell must cite one
decision-log entry **by `#anchor`** whose body carries the declaration

```
**Waives gate:** `G1` · **PR:** #19 · **Follow-up:** #123
```

— see [UX quality gates § Waiving a gate](../docs/02-design/ux-quality-gates.md#waiving-a-gate).
CI verifies the declaration binds to this gate, this pull request and a follow-up issue;
it cannot verify who approved it. **A candidate with any row marked `waived` is outside the
orchestrator's merge delegation and always needs Thomas's own action to merge** — see
[`AGENTS.md`](../AGENTS.md#how-work-reaches-main-and-who-may-merge), decision log
2026-09-15. A row is not "n/a" because it is inconvenient; it is n/a because the gate does
not apply to this change — marking a gate `n/a` when it actually applies is the same
misrepresentation as fabricating a waiver, and is reviewed the same way.

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

<!--
P0–P3: record “Deferred to integrated P4 human review; no approval claimed.” Do not
fabricate or imply H1–H6 approval. Thomas records the integrated human review at P4.
-->

## Not done

<!-- What was deliberately left out of this pull request, and why. -->
