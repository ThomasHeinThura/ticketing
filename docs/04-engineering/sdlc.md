# SDLC

The nine steps every piece of work passes through. Expanded from Thomas's original
eight, with explicit entry and exit criteria so that "done" is not a matter of opinion.

This exists because v1's failure was not a coding failure. It was a **process** failure:
features were declared complete when they functioned, and quality was left for later,
and later never came.

```
1 Plan  →  2 Specify  →  3 Build  →  4 Unit test  →  5 Integration test
        →  6 UX check  →  7 Fix loop  →  8 Document  →  9 Deploy
                              ↑______________|
```

---

## 1 · Plan

**Purpose** — decide what to build and why, before anyone opens an editor.

**Entry** — a stage is active and its previous stage is closed.

**Do**

- Pick the next item from the [stage backlog](../07-planning/phases.md).
- Confirm it is in scope for the current stage. If it is not, it goes to the backlog, not
  into this stage.
- Identify what it depends on and whether those exist yet.
- Check [licensing](../00-overview/licensing-and-attribution.md) if any code is being
  taken from elsewhere.

**Exit** — the item is on the stage board with a clear scope statement.

---

## 2 · Specify — *update the markdown*

**Purpose** — write down what is being built, before building it.

**Entry** — step 1 complete.

**Do**

- Write or update the feature spec in [03-features](../03-features/README.md), following
  the template in its README.
- Add screens to the [screen inventory](../02-design/screen-inventory.md).
- Add routes to `lib/routes.ts`.
- Add tables and columns to the [data model](../01-architecture/data-model.md).
- Add capabilities and route policies.
- If a decision was contested or is expensive to reverse, write an
  [ADR](../01-architecture/adr/README.md).

**Exit**

- The spec exists, has numbered behaviour rules, and its **Open questions section is
  empty**.
- The feature's section in [reviews/2026-09-05/](../07-planning/reviews/2026-09-05/) is
  **empty** — the ~300 medium/low audit findings close here, feature by feature, and a
  feature may not enter step 3 while any remain. Reviewers check this box, not the
  author.
- Thomas has read it. For anything non-trivial this is a real gate, not a formality — it
  is far cheaper to correct a spec than an implementation.

> **This step is not optional and it is not "documentation".** It is the design. An
> agent implementing from a vague spec will produce something plausible and wrong, and
> the wrongness will only surface at step 6.

---

## 3 · Build

**Purpose** — write the code.

**Entry** — an approved spec.

**Do**

- Branch: `feat/<area>-<short-description>`.
- Implement to the spec. Where the spec is wrong, **fix the spec in the same branch**.
- Follow [coding standards](coding-standards.md).
- Domain logic goes in `packages/domain` as pure functions.
- UI is composed from `packages/ui` primitives only.
- Every route gets a policy entry.
- Every screen gets empty, loading and error states.

**Exit** — it compiles, it lints, it typechecks, and it does what the spec says.

---

## 4 · Unit test

**Purpose** — prove the logic, in isolation.

**Do**

- Domain functions: exhaustive, including boundaries and edge cases named in the spec.
- Components: renders, is keyboard-operable, is axe-clean.
- Cite spec rules in test names — `test('WI-16: rejects a hierarchy cycle')` — so a
  failing test points at the rule it protects.

**Exit** — `pnpm test` green. Coverage on `packages/domain` at least 90%.

---

## 5 · Integration and API test

**Purpose** — prove it works against a real database and a real HTTP surface.

**Do**

- API integration tests against a Testcontainers Postgres.
- Route policy coverage test passes — every new route declares a policy.
- Permission matrix updated and passing.
- Negative tests: every "must not" in the spec has a test proving it.
- Manual API exercise where behaviour is subtle.
- **A security review, on Opus, not optional.** See
  [agent-workflow.md](agent-workflow.md#model-tiers-within-claude-code) — a separate,
  explicit pass, distinct from the general code review, on anything touching auth,
  reach/authority, secrets, uploads, webhooks or a new route. The **trigger is the path list in [ci-cd.md](ci-cd.md#pull-request-pipeline)** — that list is
  authoritative and this sentence only cites it; the review itself is recorded in the pull
  request's `## Security review` section and its committed note.

**Exit** — `pnpm test:integration` green. `pnpm test:permissions` green. Security review
recorded on the pull request.

---

## 6 · UX check

**Purpose** — the step v1 skipped.

**Do**

- Run the automated [UX quality gates](../02-design/ux-quality-gates.md) — G1 to G13.
- Open kaneo. Open this. Do they belong together?
- Walk the screen: keyboard only, at 200% zoom, at 375 px, in dark mode, with reduced
  motion.
- Read every string aloud.
- Check empty, loading and error states are *good*, not merely present.

**Exit** — every automated gate green; the human checks H1 to H6 signed off in the pull
request.

---

## 7 · Fix loop

**Purpose** — resolve what steps 4, 5 and 6 found.

**Do**

- Fix, then **re-run from the earliest step the fix could have affected**. A change to
  domain logic re-enters at step 4, not step 7.
- If a fix reveals the spec was wrong, update the spec and re-enter at step 3.
- Record anything learned in [error-fix-loop.md](error-fix-loop.md).

**Loop discipline**

- After **three** failed attempts at the same problem, stop. Write down what was tried and
  what happened — the five-item note from [error-fix-loop.md](error-fix-loop.md) — and ask Thomas. Do not keep trying variations — that is how a
  two-hour task becomes a two-day one.
- Do not disable a test to make a build pass. Ever.
- Do not waive a gate without following the waiver procedure.

**Exit** — everything green, no known defects, no disabled tests.

---

## 8 · Document

**Purpose** — leave it findable by whoever comes next, including yourself in three months.

**Do**

- Reconcile the spec with what was actually built.
- Update the screen inventory status.
- Update [status.md](../07-planning/status.md).
- Add user-facing documentation to `apps/site` if the feature is user-visible.
- Update the configuration reference if new settings were added.
- Add a decision log entry if a notable choice was made.

**Exit** — documentation matches reality. A stale spec is worse than no spec.

---

## 9 · Deploy

**Purpose** — get it in front of people.

**Do**

- Merge to `main` after review. CI builds and pushes the image.
- Deploy to UAT. Smoke test.
- Verify: migrations applied, no errors, dashboards healthy.
- Promote to production by digest, not by tag.

**Exit** — running in production, monitored, with a tested rollback.

---

## Applying this at different sizes

| Size | Stages |
| --- | --- |
| **Typo, copy change** | 3 → 9 |
| **Bug fix** | 3 → 4 → 5 → 7 → 9, plus 6 if UI |
| **Small feature** | All nine, step 2 as a spec section rather than a new document |
| **Feature** | All nine, in full |
| **Stage** | All nine, plus the [stage gate](definition-of-done.md#stage-completion) at the end |

The steps are never skipped for convenience. They are scoped to the work.

## The stage gate

**The canonical stage-gate list lives in one place:
[definition-of-done.md § Stage completion](definition-of-done.md#stage-completion).** This
section no longer restates it — four copies of the list had drifted apart by 2026-09-06. In
one sentence: every feature passes the Definition of Done; the manual passes (screen reader,
keyboard-only session, fresh-eyes test, cross-browser, realistic data volumes, load baseline,
backup and restore) are run; **a stage-level security review, on Opus** — a holistic pass
over the whole stage's surface, not the sum of the per-feature reviews — is recorded; the
stage review is written in `07-planning/`, including what went wrong; and every gate that was
not run is a **recorded waiver** in the decision log, or the stage is not closed.

**No stage starts before the previous one closes.** This is
[principle 7](../00-overview/product-principles.md), and it is the discipline that prevents
twenty-five screens at sixty per cent.

**The one exception, written down so nobody has to infer it:** during an accelerated window
in which several stages deliberately run as parallel workstreams (decision A in the
[decision log](../07-planning/decision-log.md); the calendar in
[accelerated-delivery-plan.md](../07-planning/accelerated-delivery-plan.md)), stage
*sequencing* is replaced by two things — the plan's **deferral register** (what each stage
deliberately ships thinner, in writing) and the **per-feature Definition of Done** (nothing
is called done because a calendar says so). Each stage's gate still runs, in full, before that
stage's features are declared done; what moves is *when* stages start, not *what* closes them.
An agent reading only this document should neither refuse to start P3 work while P2 is open
during such a window, nor treat the gate list as already broken.

## Related

- [Definition of Done](definition-of-done.md) · [Agent workflow](agent-workflow.md)
- [Testing strategy](testing-strategy.md) · [Error fix loop](error-fix-loop.md)
- [UX quality gates](../02-design/ux-quality-gates.md)
