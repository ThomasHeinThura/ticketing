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

## Current mission and authority

[AGENTS.md](../../AGENTS.md#authority-and-integration-freeze-mode) governs execution authority;
`CLAUDE.md` governs routing and independence. These procedures cannot override either.
During **Integration Freeze and SIT Consolidation**, the
[integration queue](../07-planning/integration-execution-queue.md) selects existing-slice
integration and acceptance work. New feature scope and automatic P4 completion are frozen.
All applicable security, test, CI, performance, G1–G13 and protected-merge gates remain.

## 1 · Plan

**Purpose** — decide what to build and why, before anyone opens an editor.

**Entry** — an authorized task is actionable in the integration queue, with its dependencies
identified. Dependency-safe preparation may proceed in parallel; formal stage acceptance
remains sequenced and gated.

**Do**

- Pick the next actionable item from the integration queue, not an unimplemented roadmap item.
- Confirm it is existing functionality or an integration/acceptance fix within the freeze.
  New feature scope stays in the [stage backlog](../07-planning/phases.md) for owner direction.
- Identify what it depends on and whether those exist yet.
- Check [licensing](../00-overview/licensing-and-attribution.md) if any code is being
  taken from elsewhere.

**Exit** — the queue records scope, owner, dependencies, source and acceptance evidence needed.

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
  checked for known findings. Applicable findings are mapped to evidence and addressed in
  the authorized implementation batch; preserve the historical review text and do not
  self-close it. Independent reviewers verify the mapping and record disposition before
  merge or a phase claim. A remaining finding is not silently ignored or waived. Behavior
  questions that the written contract does not settle still block that decision path until
  an authorized contract resolves them.
- For P0–P3, human spec/design review is deferred until the integrated P4 human review; it is
  not an implementation prerequisite. A committed documented recommendation explicitly
  authorized by the user is sufficient to build against, including the current #573 contract.
  Record the human review as deferred, not approved. If the written contract leaves a
  behavior unresolved, stop that decision path rather than guessing.

> **This step is not optional and it is not "documentation".** It is the design. Implement
> only behavior established by the written spec or explicitly authorized recommendation;
> defer human review through P0–P3 and bring the completed feature set to the integrated P4
> human review. Do not treat the deferral as approval or fill gaps by assumption.

---

## 3 · Build

**Purpose** — write the code.

**Entry** — a written contract that is approved or explicitly authorized by the user for
implementation. Human spec/design review for P0–P3 is deferred to the integrated P4 review.

**Do**

- Branch: `codex/<area>-<short-description>` by default, or the explicitly authorized branch.
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
- **A security review, on GPT-6 Sol, not optional.** See
  [agent-workflow.md](agent-workflow.md#model-policy) — a separate,
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

**Exit** — every applicable automated gate is green. For P0–P3, mark human H1–H6 review as
deferred to the integrated P4 review; do not claim sign-off. At P4, perform the integrated
human review and record its actual outcome. The documented deferral does not block technical
P0–P3 stage closure when all other applicable criteria, including the stage-level GPT-6 Sol
finalizer, are met.

---

## 7 · Fix loop

**Purpose** — resolve what steps 4, 5 and 6 found.

**Do**

- Fix, then **re-run from the earliest step the fix could have affected**. A change to
  domain logic re-enters at step 4, not step 7.
- If a fix reveals the spec was wrong, update the spec and re-enter at step 3.
- Record anything learned in [error-fix-loop.md](error-fix-loop.md).

**Loop discipline**

- After **three** failures on the same mechanism, pause speculative iterations on that task.
  Count across versions, branches, sessions and reviewers. Assign an independent
  whole-entrypoint diagnosis, classify the failure from evidence, and agree on a bounded
  cause-appropriate remedy before another attempt. For a runner, preserve the five-item note
  and complete real-invocation-path regression required by
  [error-fix-loop.md](error-fix-loop.md#the-three-attempt-rule). Change product source only
  when the diagnosis warrants it. Escalate owner-only decisions; continue unrelated authorized
  tasks. Do not repeat unchanged acceptance runs.
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

- Only the top-level orchestrator merges through the protected PR flow after required
  exact-source reviews, tests and CI checks pass. CI publishes to GHCR/GitHub Releases.
- Deploy the immutable accepted artifact to SIT and run actual runtime acceptance.
- Verify migrations, health, affected authenticated journeys and applicable integration,
  security and performance requirements; record source/image digest and evidence.
- No Docker Hub publication or production deployment is authorized during this mission.

For P0, keep pre-merge and post-merge evidence distinct. Before protected merge, complete the
required reviews, current CI, installer regression, exact-image boot and other applicable
pre-merge runtime/authorization proofs. After an eligible merge, verify the real signed-main
release installer, upgrade and rollback; run the fresh accepted-main phase finalizer before
claiming P0 closed. Do not require a main-only signed release before an otherwise eligible
candidate can merge, and do not treat merge as phase completion.

**Exit** — the integrated slice meets applicable Definition of Done and actual SIT acceptance,
with its rollback verified and evidence bound to the tested source/artifact. Offline simulation
is diagnostic evidence only. This exit does not close a P0–P7 phase.

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
backup and restore) are run; **a stage-level security review, on GPT-6 Sol** — a holistic pass
over the whole stage's surface, not the sum of the per-feature reviews — is recorded; the
stage review is written in `07-planning/`, including what went wrong; and every gate that was
not run is a **recorded waiver** in the decision log, or the stage is not closed.

Preparation and formal closure are distinct. Dependency-safe integration preparation may run
in parallel within the authorized freeze; the queue cannot authorize a later-stage feature.
An accepted integration slice may cross already-existing stage surfaces without claiming any
stage complete. Formal P0–P7 closure still requires the canonical full stage checklist and
fresh independent GPT-6 Sol phase finalizer; neither a green slice nor SIT acceptance replaces
it. Earlier accelerated plans do not override the current owner mission.

After final integrated SIT acceptance and audit, record the final queue evidence and stop.
Await the next owner roadmap rather than automatically beginning another phase.

## Related

- [Definition of Done](definition-of-done.md) · [Agent workflow](agent-workflow.md)
- [Testing strategy](testing-strategy.md) · [Error fix loop](error-fix-loop.md)
- [UX quality gates](../02-design/ux-quality-gates.md)
