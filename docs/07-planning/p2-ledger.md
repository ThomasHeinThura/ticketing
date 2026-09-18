# P2 Service Desk — execution ledger

> **Owner:** the P2 lane (this session) per Thomas's 2026-09-18 full-P2 execution mandate.
> **Chain of record:** roadmap → specification/rules → issue → PR → exact SHA → tests →
> reviews → UI walkthrough → merge → acceptance. A row without every cell filled is
> **IN PROGRESS**, never SHIPPED.
> **Review capacity note (2026-09-18):** Claude Sonnet and Opus are unavailable. Ordinary
> reviews are packaged as reviewer packets (see each PR's `REVIEWER PACKET` comment) for
> genuinely independent contexts to execute under Thomas's temporary operating
> authorization; actual model identities and SHAs are recorded per review as they happen.
> Mandatory Opus security reviews remain mandatory and pending — affected PRs carry
> `SECURITY REVIEW PENDING — OPUS CAPACITY`.

## Coordination with the P1 (Copilot + DeepSeek) lane

- **Shared surfaces needing ownership agreement before either lane edits:** `apps/api/drizzle/*` (journal is sequential), `apps/api/src/database/schema.ts`, `packages/permissions` registry, `apps/api/src/index.ts` (router mounting), `packages/ui`, `data-model.md` and other authoritative docs.
- **Handover:** the OpenAPI 404 sweep (issue #206) was completed by this lane and handed to P1 on PR #216 (handover comment, 2026-09-18) — P1 owns the shared API contract surface. **Receipt confirmation pending**; the `lane-206-openapi` worktree is preserved until it arrives. PR #216 is the vehicle — no competing PR.
- **Status 2026-09-18 (later):** no receipt confirmation yet; a consolidated coordination request (receipt + review execution + ownership) is posted on PR #216. #218 now clean (review gate only) after closing sla.md section-11 findings (do-not 15) — spec reconciliations and SLA-15 clarification included. #219 opened (calendar preview). Reviewer packets posted on #209/#210/#213/#216/#217/#218/#219.
- **Proposal (pending P1 confirmation):** P2 owns migrations/tables for `sla_*`, `service_calendar`, `approval`, `satisfaction_rating`, `request_type*`, `submission*`, `deflection_event`, `organisation_request_type`, `request_participant`; P1 continues to own `work_item`/`task`/`column` and membership writes. Shared-file edits (drizzle `_journal.json`, `schema.ts`) are taken sequentially — the lane landing a migration first pushes; the other rebases. Coordination thread: PR #216 + this ledger.

## SLA (`sla.md`)

| Chain | State |
| --- | --- |
| roadmap → P2 Service desk | done |
| spec → rules | `docs/03-features/sla.md` — §11 review findings reconciled 2026-09-18 (SLA-7 edge cases answered; SLA-15 edge semantics clarified; move-policy contradiction resolved to the §11 recommendation; stale-pause assigned to `reminder-scan`; SLA-17 no-stakeholder fallback). The §11 storage findings were already reconciled into `data-model.md` (`sla_policy_version`, `at_risk_threshold_pct`, metric-keyed cache, `request_type.sla_policy_id`). |
| issue | domain slices predate their issues — policy CRUD/scan issues to be filed at slice time |
| PR → SHA | **#209** (computation: dueAt, covered-minus-pauses, six states, goal matching) → `1885f7d`; **#218** (resolution SLA-1/2, pinning SLA-3, pause validation SLA-11, scan edges SLA-15; stacked on #209) → `31462a5`; sla.md spec reconciliation + section-11 review findings CLOSED (do-not 15) in #218 → `fcaf9d7` |
| tests | 328 pass in `packages/domain` (26 computation + 19 policy-layer); repo-wide suite runs in CI on both heads |
| reviews | packets posted 2026-09-18 on both PRs; **ordinary reviews pending — independent contexts to execute**; Opus: not yet classified security scope, pending reviewer confirmation |
| UI walkthrough | not started — no UI in these slices |
| merge | pending reviews |
| acceptance | **IN PROGRESS** — domain half done; policy CRUD, storage/migration, `sla-scan` job, API routes, UI, event fan-out all outstanding (persistence slices behind the P1 coordination agreement) |

## Service calendars (`service-calendars.md`)

| Chain | State |
| --- | --- |
| roadmap → spec → issue | spec §12 review treated the calendar module as a praised prerequisite; pure core landed earlier (#33) |
| PR → SHA | pure core ON MAIN (calendar arithmetic, DST-correct via `Intl`, holidays, validation); **#219** (coverage preview: weeklyCoverMinutes nominal + annualCoverMinutes real, 6 hand-computed tests) → `3dfc1ff` |
| tests | calendar suite + 6 preview tests passing in `packages/domain` |
| reviews | merged historically with full tier |
| acceptance | **IN PROGRESS** — persistence (`service_calendar` table + migration), CRUD API, preview endpoint, holiday presets: **BLOCKED on the P1 coordination agreement above** (shared drizzle/schema surfaces) |

## Workflows / transitions (`workflows.md`)

Pure core exists (#31). Persistence, transition execution, effects vocabulary (`WF-19` — **shared with P1's `workflow_transition` table**, requires the §10/AS-13 effects reconciliation first), guards, note policies: **not started**; the effects vocabulary is a genuine cross-lane decision (P2's `pause_sla`/`resume_sla` depend on it). Status: IN PROGRESS (domain), BLOCKED (effects) pending the shared-vocabulary agreement.

## Approvals and CAB (`approvals.md`)

**BLOCKED (do-not 15):** review §15 carries unresolved High findings — the any/all gate policy and "matching approval" linkage (`workflow_transition.approval_policy` storage) and CAB membership definition (§18's dangling delegation). Note: `data-model.md` §7 has since gained `approval.transition_id` + reminder columns, but the gate-policy storage and CAB-membership findings remain unresolved in the specs. The domain slice is deliberately not started. (Self-approval rejection AP-8 and expiry arithmetic are ready to build the moment the findings close.)

## Audit trail (`audit-trail.md`)

Persistence, append operations, reconstruction, authorized access: **not started** — the audit domain pure core exists (#37). Blocked on the coordination agreement (new table). Issue #205's freeze semantics question (does a soft-deleted project freeze audit *reads*?) touches this spec — clarification proposed on #205, answer pending.

## Request types, catalogue, submissions, intake, triage (`request-types-and-catalogue.md`, `intake-queue.md`)

**BLOCKED:** review §13 verdict *not-ready* — the per-organisation catalogue was specified with no storage. `data-model.md` now defines `request_type`/`request_type_version`/`organisation_request_type`/`submission` (the reconciliation happened), so domain slices are unblocked in principle; sequencing behind SLA and the P1 work-item write-path contract (intake accepts submissions → work items, P1-owned).

## Assignment, milestones/stakeholders/escalation (`assignment.md`, `agile.md`)

Not started. The assignment rule engine waits on the §10/AS-13 transition-effects decision (shared with workflows). Escalation paths feed from SLA-17 (now spec-complete, fallback stated).

## The integrated P2 demonstration (acceptance target)

Submit a request → triage → assign → transition through a configured workflow → track SLA → approve where required → inspect the audit trail. **BLOCKED on the P1 work-item write path** (submit/transition are #23's write path) plus the persistence slices above. Seed data and negative tests (cross-tenant, unauthorized transitions, duplicate operations, retries, timing boundaries, approval conflicts) are specified and will land with the API slices. Browser acceptance follows the agent UI slices.

## Opus-review queue (durable)

1. **#213** — batched Opus pass (issue #95's own scoping; probe/test files in security scope).
2. **#209 + #218** — confirm the not-security-scope classification (pure domain) or escalate.
3. **#216** — declarations only; not-security-scope; Opus not required.
4. **#217** — comment-only migration edit; lightest-tier Opus confirmation (no statement changed).
5. **#218** — confirm not-security-scope (pure domain + spec docs) or escalate; includes the sla.md section-11 closure.
6. **#219** — pure calendar additive; not-security-scope.
7. Any future P2 PR adding a migration or auth-adjacent route: full Opus before merge.

## Owner decisions queued for Thomas

1. **#205 freeze semantics** — clarification proposed (freeze writes / keep reads; whole-reachable-graph rule; assets same rule). Blocks the one-hop-residual slice and the `audit-trail.md`/`attachments.md` sentences.
2. **SLA-15 edge reading** — adopted per-transition-into-state (the only cache-implementable reading; written into `sla.md` in #218); if once-*ever* is wanted, the cache shape needs firing-flag columns (schema change).
3. **Effects vocabulary ownership** (workflows §10/AS-13, `WF-19`) — cross-lane; P2's `pause_sla`/`resume_sla` depend on it.

