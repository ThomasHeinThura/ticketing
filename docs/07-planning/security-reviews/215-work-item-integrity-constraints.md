# Pre-merge security review — PR #215 (work-item integrity constraints)

**Reviewed head:** none — **no security review has been performed**, so this field cannot be filled honestly. `check:pr-template` requires a forty-character SHA here and rejects a note without one, which means the required `pull request template + security review` check on PR #215 is **correctly red** and must stay red until an Opus review runs and writes its verdict below. Do not "fix" that red by inventing a head, and do not weaken the gate to let a pending note pass — a note with no reviewed head attached is exactly the artefact that check exists to catch.

## Status: SECURITY REVIEW PENDING — OPUS CAPACITY

**This is not a security review.** It is the record the pull-request template requires, filed
in advance so the review has a home and so the gap is visible rather than implied. It asserts
nothing about the change's security properties.

**Why it is pending.** This change is in security-review scope: the classifier reaches it
through `apps/api/drizzle/*.sql` (migration `0059_work_item_integrity_checks.sql`) and
`apps/api/src/database/**`. `AGENTS.md` and `CLAUDE.md` require an independent **Opus** pass
for it. Claude is currently unavailable, and `CLAUDE.md` is explicit about what that means:
*"Capacity exhaustion means wait, not substitute."* The candidate therefore waits, marked,
rather than being downgraded to an available model or cleared by a non-independent context.

**What must not happen to this branch in the meantime:** it must not be merged, and the
security-review checkbox must not be ticked. The orchestrating session's delegation to merge
green candidates does **not** extend to a candidate whose security review has not happened.

## What the two ordinary reviews did and did not cover

Both ran in GitHub Copilot contexts (DeepSeek V4.1 Flash) — **not Claude**, and the real
models are named in the pull request because recording them is required. Neither is a
security review and neither substitutes for one.

- **Correctness (head `caa1c7e`)** — CLEAR WITH FINDINGS. Verified each constraint actually
  rejects, proved the 21 tests non-vacuous by dropping all eight objects and watching 10 of
  21 go red, checked every value set against `data-model.md` character-for-character, and
  confirmed a clean apply with no `drizzle-kit` drift.
- **Project alignment (head `40a51eb`)** — ALIGNED WITH CONCERNS. Confirmed the change is
  issue #189's own scope and that its vocabulary is not invented; found a design disclosure
  promised in the source but absent from the PR body (now added), a wrong decision-log
  citation, and a gate credited with a check it does not perform.

Both findings sets are remediated. `caa1c7e → 40a51eb` and `40a51eb → c49b3e1` are proven
comment-and-documentation only — no changed line in `schema.ts` other than a `//` comment, and
no `sql`` expression in either diff — so both verdicts stand for the executable content at
this head.

## What an Opus reviewer should examine first

Named so the pass starts from the risk rather than the diff:

1. **Do these eight constraints close the attack they claim to?** `position <> 'NaN'`,
   `number > 0`, and the seven value-set `CHECK`s are the only server-side enforcement of
   invariants that a future write path (#23) will depend on. Nothing enforces them in
   `packages/domain` today.
2. **Is the deliberately unscoped partial unique index a tenancy problem?**
   `state_project_default_unique` keys on `(project_id) where is_default` and is **not**
   scoped to `archived_at is null`. `project_id` is itself tenant-bound, so this looks
   in-boundary — but the project has a precedent for exactly this class being wrong
   (PR #191's O1 finding, where a composite FK on a mutable column with `ON UPDATE CASCADE`
   produced a cross-tenant write path). It deserves an explicit verdict, not an assumption.
3. **#192 is adjacent and unresolved.** A `wsA`-scoped work item can still reference a
   `wsB`-scoped `work_item_type`; this migration does not change that. The decision request
   is on issue #192 and awaits Thomas. A reviewer should confirm this PR neither closes nor
   widens that gap.
4. **`work_item_type` has no `UNIQUE (workspace_id, id)`.** #192's proposed composite FK
   needs it. Confirm the absence here is the sequencing noted in the PR body and not an
   oversight.
5. **No `audit_log` table exists**, so none of these constraints is audited. Confirm that is
   unchanged from `main` and not a regression introduced here.

## Reviewer instruction

Replace this file's status with a real verdict, name the exact reviewed SHA, state what was
checked (not merely read), and record any blocking finding. If the head has moved, the
review is void for the new head unless the delta is outside security scope or the review
says otherwise.
