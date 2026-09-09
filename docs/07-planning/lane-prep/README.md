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
