# Lane preparation plans — P1 to P4

Four preparation plans, one per post-Throttle-1 workstream, written by **Sonnet** preparation
agents on 2026-09-06 against `main` at `955f8d4d`. **No code was written for any of them**;
each is research and a build order, and each says so in its own header.

| Plan | Scope | Issues | Lines |
|---|---|---|---|
| [`p1-core.md`](p1-core.md) | work items, views, projects, relations, comments, attachments, search, assignment | #23–#30 | 818 |
| [`p2-domain.md`](p2-domain.md) | workflows, SLA, service calendars, request types, intake queue, approvals/CAB, audit trail | #31–#37 | 960 |
| [`p3-identity-portal.md`](p3-identity-portal.md) | customer portal, identity connections, SCIM provisioning | #38, #39 | 529 |
| [`p4-governance-seams.md`](p4-governance-seams.md) | the schema → admin API → God Mode seam for everything P1–P3 makes configurable | #40–#47 | 738 |

They were committed on 2026-09-09, three days after they were written, having until then
existed only in a session-scoped temporary directory. That is the reason this directory
exists at all: `CLAUDE.md` names *"leaving finished work uncommitted on the laptop"* as one
of two standing failure modes, and 3,045 lines of dependency analysis living in `/tmp` was
that failure mode in progress.

## Why they are not rewritten

Every one of them is **stale in the same specific way**, and none of them is rewritten to
hide it. Rewriting a dated plan to read as current is precisely the defect that
`status.md` has now been corrected for twice. What each plan gets instead is a header
naming its baseline and the changes since, so a reader knows which sentences to re-verify.

## Reconciliation: what moved between `955f8d4d` and `d4510a2`

Nine pull requests merged on 2026-09-09. What the plans would get wrong:

| A plan says | Actually, now |
|---|---|
| `packages/domain` does not exist | **Exists** — PR #69, service-calendar arithmetic, 59 exhaustive tests, no new dependency (Node's full-ICU `Intl` was verified sufficient) |
| `packages/ui` does not exist | **Exists** — PR #63, the first coherent primitive slice |
| no workflow files on `main`, no CI | **CI exists** — PR #19: `test:all`, the `check:*` gates, the OpenAPI baseline at `tests/api-contract/openapi.json`, and **eleven required status checks** on `protect-main` |
| `pnpm test:permissions` depends on unmerged #19 | **Runs in CI**, in the `route policy coverage + permission matrix` job |
| retrofit S2 (#65) and S4 (#67) are open, unmerged, do not build on them | **Both merged.** Build on them. S0 landed with #65 |
| issue #7 is open | **Complete and closed** |
| Throttle 1 conditions 4 and 5 unproven | **Both proven** — demonstrated by mutating the live router: an undeclared route fails CI |

## Further reconciliation: the `state_template` split (2026-09-09, after `d4510a2`)

Both plans still describe the lifecycle model as it stood before this correction, and are
**not rewritten**, per the rule above — this note exists so a reader knows which of their
sentences to re-verify instead.

| A plan says | Actually, now |
|---|---|
| `state` is workspace-scoped, with `project_state` for per-project order/default/enablement, and "open"/"closed" keys off a bare `state.group` column | **Superseded.** `state_template` (workspace-scoped) is the shared catalogue a workflow's transitions reference; `state` (project-scoped) is a project's own concrete row, mapped to exactly one template via `state_template_id`. `project_state` is **retired** — its job now lives on `state` directly. `state` carries no `group` column: "open"/"closed" resolve through the join to `state_template.group`. See [data-model.md §3](../../01-architecture/data-model.md) and [ADR 0011](../../01-architecture/adr/0011-ticket-lifecycle-engine.md), which is final. |

The sentences to re-verify, located rather than described — an earlier version of this note
sent a reader to `p2-domain.md`'s "Acceptance criteria per issue" section, which is clean, and
would therefore have missed the three that are not:

| Plan | Lines carrying pre-split vocabulary |
|---|---|
| [`p1-core.md`](p1-core.md) | **80**, **99** and **124** — #23's target schema, described as workspace-scoped `state` plus a project-scoped `project_state` table; and **136** and **444** — the roll-up discussion (`WI-19` / `RH-9` / `RH-16`) keying off `state.group in ('completed','cancelled')` |
| [`p2-domain.md`](p2-domain.md) | **72** (states workspace-scoped with `project_state` for ordering/default), **300** (the impure edge loading the project's `project_state`), **720** (`project_state` in the table list) |

Re-read those against the current `workflows.md`, `work-items.md`,
`relations-and-hierarchy.md` and `data-model.md` rather than trusting them as written. A
pointer that names the wrong section is worse than no pointer, which is why these are line
numbers and not a description — and a pointer that names *some* of the lines is the same failure
one step smaller, which is why both lists are exhaustive. Verified by grep at the time of
writing: `grep -n "state\.group\|project_state"` returns exactly these five lines for
`p1-core.md` and exactly these three for `p2-domain.md`, with nothing left over.

## What has NOT moved — the reason every plan is still a plan

**Throttle 1 is shut.** Condition 2 requires issue #6 complete *through retrofit S10*, and
[the retrofit stage ledger](../retrofits/organization-plugin-retrofit.md) records **four of
fourteen stages landed** — S0, S1, S2, S4. S3 and S5–S11 have not started. The other four
conditions are met.

So the instruction common to all four plans — *plan now, write code when the throttle
opens* — stands unchanged. Three retrofit stages (**S3, S5, S7**) have their preconditions
satisfied and can start today; they are the shortest path to opening the throttle, and they
are retrofit work rather than P1–P4 work.

**One exception, already taken:** P2's plan is explicit that `packages/domain` holds *pure
functions with exhaustive tests, before any HTTP endpoint exists*. Pure domain functions
touch no route and no policy, so they are **"no block"** work under `CLAUDE.md`'s blocking
taxonomy — which is why PR #69 shipped service calendars before the throttle opened. The
same reasoning extends to further pure `packages/domain` modules and to `packages/ui`
primitives. It does **not** extend to anything route-shaped, and no plan here should be read
as licence for that.
