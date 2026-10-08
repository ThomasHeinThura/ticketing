# Live pull request disposition ledger

**Verified:** 2026-10-08 16:51 UTC. **Repository:** `ThomasHeinThura/ticketing`.
**Accepted `main`:** `3096cb044bdf6ae98488bfc385f532fa6386343a`.
GitHub showed **20 open PRs** at this verification.

This ledger records the live open-PR set and the disposition of each source lane. PR heads
and CI are volatile: refresh them from GitHub before acting. A historical review or a green
run on another SHA does not transfer to a changed candidate. This document records no merge
authorization; every candidate still needs its required reviews, exact-head checks and
protected merge.

## Current disposition

| PR | Current exact head | Scope | Disposition | Reason / next acceptance boundary |
|---:|---|---|---|---|
| 609 | `f06f886969f23ce70ead85ef3276cdcf0b094af6` | P1 navigation and URL state | Preserve as an existing owner slice; integrate after P0 | Keep its reviewed source and migration evidence; integrated CI/browser acceptance and central migration replay remain. |
| 608 | `76b833be5b46589229a630738c5b436365eba409` | P4 Users deactivation | Preserve as an existing owner slice; integrate after P0 | Approved instance-event envelope and canonical pending-action vocabulary are constrained by the decision log. Reconcile its provisional migrations centrally; no deployment or phase acceptance is implied. |
| 607 | `1c08ef44194dda01e38d86af9b048b125ba6c6b2` | P4 MCP specification docs | **HOLD** | MCP contract and `check:reviews`/review-register acceptance remain unresolved. Current CI also has failing registers, PR metadata/security-review and G11 checks. Do not describe this as ready to merge. |
| 606 | `e20c1124f7c1ddfb8f227ce87690e871aa9782ca` | P1 activity, history and mentions | Preserve as an existing owner slice; integrate after P0 | Exact-head integration and browser failures remain to be repaired and reviewed; retain original evidence. |
| 605 | `024788d8d9fe5e2aa9f63d17e1fb7c96f978fbe1` | P1 native realtime refresh | Preserve as an existing owner slice; integrate after P0 | Based on an unaccepted integration line; reconcile failures and dependency order during bounded composition. |
| 603 | `9ed99f243e15a058419753bf1cb188d76134a0b2` | P4 approval/role query ownership | Preserve as an existing owner slice; integrate after P0 | Repair its current integration checks and compose only with the prerequisite approved sources. No migration delta is recorded in the captured plan. |
| 602 | `2b7192eb5181d50085f8734d2c5da226e301453e` | P0 performance/closure source and review note | **BLOCKED** | The latest run on this head is G11 20/22: LCP 2,520/2,500 ms and 200-task board 614.1/500 ms. Earlier `23a01a6` 22/22 is historical source evidence and cannot clear this failure. The local notification remediation `b890c86a0feaba018d298273527d86058cb56921` is unpushed/undeployed; its current independent reviews are active. |
| 601 | `ad22ef8b1e9ac5ec8c7d2a2a93ea78fa7d1b2508` | P0 operational documentation | **BLOCKED** | Documentation batch is not accepted while current static, PR metadata/security-review, G11, dependency-audit and secret-scan checks fail. No review is recorded on the current head. |
| 599 | `7c5ae58c67c3572b2f4f52864788f78e726daa0d` | P1 attachment/public-origin | Preserve outside P0; integrate only at its accepted P1 boundary | Do not absorb into frozen P0. Keep existing owner source and reconcile current exact-head checks at P1 composition. |
| 598 | `3fecb75ccd4a1fcbfce5414de6d222c46bb5e94e` | P2 catalogue/intake | Preserve feature owner slices; **do not merge as the cumulative train** | Retain only implemented, reviewed feature scope; hold incomplete capabilities and allocate migrations in the central replay. |
| 596 | `103dc906052852c246f9f7f6660a6b7f8d7d931c` | P3 validated-login grant reconciliation | Preserve as an existing owner slice; integrate after P0 | Depends on identity/mapping schema and source. Require full ordinary and Sol review at the composed security-sensitive head. |
| 595 | `197b19fcee0f76b3faf69d5f9b0bfde3d8bb07d3` | P3 OIDC group mapping | Preserve as an existing owner slice; integrate after P0 | Identity schema and composition dependencies remain. Exact integration review and acceptance are still required. |
| 594 | `359d60bd31368cd04cc1aeab3ad5bcfade403f22` | P4 notification outbox eligibility | Preserve as an existing owner slice; integrate after P0 | Pair with #585 delivery schema owner and runtime authorization checks at the exact composed head. |
| 589 | `2350397b18f83ed417bf63d73970daacdbaae49c` | Mixed P1–P4 integration train | **DO NOT MERGE BLINDLY; rebuild after accepted P0** | 776 paths/305 commits mix owner work and duplicate migration lineage. Use only as a provisional byte/snapshot comparison source; select owners, compose from accepted `main`, replay each semantic migration unit once. |
| 586 | `b67a865a4c798069ab26c5dba4fb6632e82d6e1e` | P2 approvals | Preserve as an existing owner slice; integrate after P0 | Provisional migration 0116 is not a final allocation. Approval authority and pending-action semantics must be accepted with the implementation. |
| 585 | `5a371451d2d05777a8815639b18cd2ac8085578b` | P4 notification delivery | Preserve as the SQL feature owner; integrate after P0 | Its 0114/0115 SQL is duplicated in the train; replay once. Its 89-table snapshots are stale; use the reconciled composition snapshot lineage. |
| 569 | `af6f755c7b2803136101aece8bbcc03f48a2bb75` | P4 pending-action expiry index | Preserve source for owner review; **do not reuse provisional migration 0082** | Its migration conflicts with accepted history through 0087. Reallocate only after feature inclusion and order are frozen. |
| 513 | `a319442f1804c1733c08bfb63157d6191199e801` | P2 service calendars/SLA | Preserve as an existing owner slice; integrate after P0/P1 prerequisites | Assign schema by actual owner contract, not train membership. Calendar and SLA prerequisites must be included and reviewed together. |
| 512 | `0f24ba2c374255bf3edb36677bc6b3fb57419300` | P1 work-item journey | Preserve as an existing owner slice; rebuild bounded composition | Broad accumulated source overlaps newer P1 owners and frozen P0 lacks some journey paths. Map owned behavior and its regressions before replacing or closing. |
| 506 | `c55b32b313d0e46b568776ec107ae30975b31d06` | P0 notification task-reach authorization | **Preserve required source; do not close as absorbed** | Its task-reach authority behavior is absent from accepted main and frozen P0. The earlier local candidate `5ec7727` has blocked review evidence. Its complete local remediation `b890c86` follows `5ec7727`; current independent exact-head reviews are active and have not cleared it. |

The live open set above contains 20 PRs. PR #555 is closed, not open, and is recorded below
as absorbed. PR #550 is closed as superseded after accepted-main source conservation, recorded
below. PR #610 is closed after the registry direction changed to GHCR/GitHub release
publication; Docker Hub publication was canceled. PR #447 is closed as superseded; its branch
and ancestry remain preserved. These are disposition facts, not permission to delete source.

## Closed and absorbed: PR #555 Avatar

PR #555 exact head `0e82d1dd41fdfb9eed6d350ec0a9fd13174f3dd3` is **closed as absorbed by
accepted main**, based on `555-reconciliation.json` verified 2026-10-08 16:41:26 UTC and the
GitHub close record. The shared `@taskdesk/ui` Avatar implementation, story, tests, web
adapter/resolver behavior and tests are present in accepted main; replacement visual baselines
are accepted through PR #579. No source was deleted and the #555 branch/history remain
preserved. This is a source-conservation disposition only; the old PR's red checks are not
represented as passing and no test was freshly run for this reconciliation.

## Closed as superseded: PR #550 two-entry web split

PR #550 exact head `2ad7e03b4cbb9041b811c33e5799097d82a83214` was closed at 2026-10-08
16:51:01 UTC after the accepted-main semantic audit at
`3096cb044bdf6ae98488bfc385f532fa6386343a`. The root reconciliation verified ten core portal,
request-origin parser, test and CI-gate blobs byte-identical to accepted main; remaining
entry, API wiring and route/build behavior were checked against the accepted implementation.
The two-entry capability is conserved in accepted main. This was a PR closure, not a merge,
gate waiver or branch deletion. The #550 branch and Git history remain preserved. Evidence:
`550-reconciliation.json` and `550-source-conservation.md` in the private dated inventory.

## P0 evidence boundaries

- Frozen P0 source: `23a01a62ece3ca7d17105626f64ad78641435ec1`.
- Review-note descendant: `2b7192eb5181d50085f8734d2c5da226e301453e`.
- `23a01a6` hosted full run `37760096010` passed 22/22; that result belongs to `23a01a6`.
- Latest observed #602 head run `37803812115` passed 20/22 G11 cases, with LCP 2,520 ms and board 614.1 ms exceeding their unchanged budgets.
- Local notification candidate `5ec772771497e5883ff4c55f272cd34df737b585` received blocked independent review findings; preserve that history. The author completed a local-only remediation at `b890c86a0feaba018d298273527d86058cb56921` (parent `5ec7727`), reporting one file, seven tests, API typecheck and Biome as passing. Current independent exact-head reviews are active; no current verdict or future CI pass is claimed. The new candidate is unpushed and undeployed. Historical source23 reviews do not adjudicate it.
- The private V20 final manifest hash is `e51bf0cb343cddd922c426bf78784b22e400bc34c47780a753132c1a8eb554f2`. The scoped Sol CLEAR records historical witness scope only; it is not actual strict-runtime admission, activation, deployment, merge or phase closure.

## Evidence and refresh rule

The 2026-10-08 private inventory under
`~/.codex/taskdesk-evidence/2026-10-08/final-consolidation-inventory/` holds the raw PR
crosswalk, exact-head review evidence, source reconciliation and close records. Credentials
and private seed material stay outside GitHub and this repository. The companion
[central migration ledger](migration-replay-ledger.md) governs provisional migration
ownership and replay. Before changing any disposition, refresh the PR head, base, checks,
reviews, branch relationships and source conservation from GitHub and Git objects.
