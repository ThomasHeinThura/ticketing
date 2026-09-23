# P2 Service Desk — execution ledger

> **Owner:** the P2 lane. **Agents on this program (2026-09-23 lineup):** Luna (GPT-6),
> Copilot/DeepSeek 4.1 Flash (P1 + shared contract), Cline (mimo-v2.26 flash — all
> Sonnet-tier implementation and ordinary reviews; this ledger). Claude hit its capacity
> limit; its four active PRs (#308, #320, #322, #323) were taken over mid-flight.
> **Claude Sonnet and Opus model capacity remain unavailable** — ordinary reviews are
> executed by genuinely independent contexts with their **actual model identities recorded
> per review** (never relabeled as Sonnet/Opus). Mandatory Opus security reviews stay
> mandatory: affected PRs carry `SECURITY REVIEW PENDING — OPUS CAPACITY` and **never
> merge without the Opus pass.**
> **Chain of record:** roadmap → specification/rules → issue → PR → exact SHA → tests →
> reviews → UI walkthrough → merge → acceptance. Anything short of every cell is
> **IN PROGRESS**, never SHIPPED.
> **Supersedes** the 2026-09-18 ledger (its PR, #210, was closed unmerged; this file is
> the fresh landing).

## Coordination with the P1 (Copilot + DeepSeek) lane

- **Handover:** the #206 OpenAPI sweep findings were handed to P1 on PR #216 — **#216
  merged 2026-09-22** with a combined ordinary + mandatory security review returning
  `CLEAR` after a BLOCKING round was fixed and verified. The shared API-contract surface
  is P1's; no competing P2 PR exists.
- **Shared surfaces** (edit sequentially: whoever lands a migration first pushes, the
  other rebases): `apps/api/drizzle/*` (journal is ordered),
  `apps/api/src/database/schema.ts`, `packages/permissions` registry,
  `apps/api/src/index.ts`, `packages/ui`, authoritative architecture docs.
- **Live proof the sequential discipline matters:** PR #322 (P1) and PR #323 (#8 slice)
  both claim migration **0068** with the same timestamp — whichever merges second must
  renumber to 0069 **with a strictly later `when`** or already-migrated databases
  (UAT included) silently skip it (#323 Opus S9 spells out the exact procedure).
- **Tables P2 will claim when it migrates** (proposal posted on #216, de-facto practice
  holding): `sla_policy`/`sla_policy_version`/`sla_goal`/`sla_pause`/`work_item_sla_cache`,
  `service_calendar`, `approval`, `satisfaction_rating`,
  `request_type`/`request_type_version`/`organisation_request_type`,
  `submission`/`submission_message`/`deflection_event`, `request_participant`.

## Storage truth (main `dd067e2`, migrations 0000–0067)

`audit_log` exists (0067). **No migration yet creates** `request_type`, `submission`,
`approval`, `sla_policy*`, `service_calendar`, or the workflow tables — they are defined
in `data-model.md` only. Every P2 persistence slice below is therefore blocked on its
first migration, taken under the sequential rule above (next free number after the
0068 collision resolves).

## SLA (`sla.md`)

| Chain | State |
| --- | --- |
| roadmap → spec | P2 Service desk; `sla.md` §11 review findings **CLOSED** (spec corrections dated 2026-09-18; section emptied per the #176 precedent) |
| domain → PR → SHA | **MERGED** — computation (dueAt, covered-minus-pauses, six states, goal matching) + policy layer (SLA-1/2 resolution, SLA-3 pinning, SLA-11 pause validation, SLA-15 scan edges) → `0bb7764` (#218, stacking #209's content; #209 closed superseded) |
| tests | `packages/domain` suites green in CI on both heads (334+ tests incl. 6 preview tests) |
| reviews | recorded at merge (packets executed; identities recorded on the PRs) |
| UI walkthrough | not started — no UI in these slices |
| persistence / API / `sla-scan` / events / UI | **IN PROGRESS — BLOCKED on the first P2 migration** (sequential rule) then: policy CRUD + resolution routes, pause routes, cache writer + scan job (uses `scanEventForTransition`), at-risk/breach fan-out, SLA-13/18/19 display |

## Service calendars (`service-calendars.md`)

| Chain | State |
| --- | --- |
| spec | §12 review **EMPTY** (closed earlier) |
| domain → SHA | pure core ON MAIN (DST-correct arithmetic, holidays, validation); coverage preview (`weeklyCoverMinutes` nominal + `annualCoverMinutes` real) → `1e0c7c3` (#219) |
| persistence / API | **IN PROGRESS — BLOCKED on first P2 migration**: `service_calendar` table, CRUD, `GET …/preview?year=`, holiday import/preset routes, then the calendar-editor UI (week grid + live preview) |

## Workflows and transitions (`workflows.md`)

| Chain | State |
| --- | --- |
| spec | §10 review **EMPTY**; effects vocabulary `WF-19` settled in the spec (SLA-10's `pause_sla`/`resume_sla` cite it) |
| domain → SHA | pure core ON MAIN (#31) |
| persistence / execution / API / UI | **IN PROGRESS** — workflow tables not yet migrated; transition execution, guards, note policies, effects application, version publish flow, transition-matrix UI all pending. Depends on the same first-migration slot |

## Assignment (`assignment.md`)

Pure functions **MERGED** (`d0976d2`, #287 — AS-3/5/7-13/16-18; AS-15 deliberately out).
Review section no longer blocks. Persistence (rule storage), assignment API, and
work-item-assignment integration: **IN PROGRESS**, behind the first-migration slot.

## Approvals and CAB (`approvals.md`)

Pure rules **MERGED** (`dcbe7f6`, #289 — self-approval ban AP-8, expiry arithmetic,
any/all gate satisfaction). The §15 review findings no longer appear as open in
`features-core-servicedesk.md` (cleared with the domain landing). **Caveat:**
`service-management.md`'s review section (22 ln) still carries the CAB-membership
dangling-delegation finding — the `approval:decide_cab` route cannot ship until that
resolves. Storage (`approval`, migration), decide/withdraw routes, gate wiring on
`workflow_transition`, notifications, portal decision UI: **IN PROGRESS** — blocked on
the migration slot + §18.

## Audit trail (`audit-trail.md`)

§16 **EMPTY**. `audit_log` table + hash-chained append-only writer **MERGED** (`6adea03`,
#291); WI-6 activity logging on work-item write paths **MERGED** (`63b011d`, #292).
Remaining **IN PROGRESS**: reconstruction/verification functions, authorized-access
reads, visible-history UI, retention/purge wiring (with `legal_hold` from #208), and the
**#205 freeze-semantics answer** (proposal posted; owner decision pending — blocks the
one-hop-residual slice and the spec sentences).

## Request types, catalogue, submissions, intake, triage

`request-types-and-catalogue.md` §13 and `intake-queue.md` §14 review sections are
**EMPTY** — closed by #304 (`e34dc5e`). Storage defined in the data model, not migrated.
**IN PROGRESS, dependency-cleared for pure domain first:** submission state machine
(`new|clarifying|accepted|declined|duplicate|withdrawn`, instance-wide `SUB-n`),
form-schema validation incl. `showIf` evaluation, catalogue visibility rule (deny by
default when unmapped), triage/accept/decline/merge/queue semantics — then the migration,
APIs, intake screens, portal submission flow. Sequences ahead of SLA persistence (pure
work needs no slot).

## Portal, knowledge, views (review state today)

- `customer-portal.md` §17 — closed by #303 (`6aad350`).
- **Still OPEN (do-not 15 blocks implementation):** `views.md` (17 ln),
  `attachments.md` (17), `search-and-saved-views.md` (18), `agile.md` (17 — milestones/
  prerequisites/stakeholders/escalation), `knowledge-base.md` (19),
  `service-management.md` (22 — incl. CAB membership). Closure passes are the unblocking
  move, following the #176/#303/#304 precedent.

## The integrated P2 demonstration (acceptance target)

Submit → triage → assign → workflow transition → SLA tracking → approval → audit trail.
Prerequisites now split cleanly: **pure domain** (submission machine, request-type
validation — unblocked, not started), **one coordinated migration** (all persistence:
submission + SLA + calendar + approval + workflow tables), **API + UI** after those,
browser acceptance last. Seed data + negative tests (cross-tenant, unauthorized
transitions, duplicate operations, retries, timing boundaries, approval conflicts) land
with the API slices. Reuses the landed calendar, workflow, audit, approvals and
assignment pure cores — no parallel engines.

## Opus-review queue (durable — never bypassed, never merged without)

| PR | Head awaiting Opus | Note |
| --- | --- | --- |
| **#308** DB role split | `13ebb0f` | fresh full pass needed (prior pass at `140f0f0` = CHANGES NEEDED; D1/D2 fixed since). Also: GitGuardian incidents [37541345](https://dashboard.gitguardian.com/workspace/259168/incidents/37541345), [37545274](https://dashboard.gitguardian.com/workspace/259168/incidents/37545274) — tip defused (`13ebb0f`), the check scans history → **owner action: mark both false-positive** (neither was a real credential) |
| **#320** work-item list API | branch head (post `1e8ad6f` fix round + main merge) | delta pass on the S1–S3 fix round (null-bucket cursor sort, cursor validation, assigneeName scope) |
| **#322** reserve built-in role names | `fb92bff` | full pass; include judging the planted-role edge case (decision-log: report-only) |
| **#323** shadow mode | `5d26f79` | delta pass on the S1–S7 fix round (S1 BLOCKING fixed: scopeSource branching + artifact→unevaluated; S2 attribution first-non-ALL; S3 trace validation; S5 bounded concurrency + drop-count; S6 prune loop; S4/S7 runbook) |
| standing rule | — | any future P2 PR adding a migration or auth-adjacent route gets full Opus before merge |

Ordinary/alignment reviews: recorded per PR with actual model identities.

## Owner decisions queued for Thomas

1. **#205 freeze semantics** — clarification proposed (freeze writes / keep reads;
   whole-reachable-graph rule; assets same rule). Blocks the one-hop-residual slice and
   two spec sentences (audit-trail, attachments).
2. **#32** the two original SLA questions — still open; predates this ledger.
3. **GitGuardian dashboard** — incidents 37541345/37545274 need false-positive
   resolution (owner-only access). #308's merge likely requires it if GitGuardian is a
   required context.
4. **#107** — held per standing decision (zero live `organization()` callers verified;
   the tripwire PR is now a redundant safety net — harmless to keep).
5. **Migration 0068 collision** — action, not policy: whichever of #322/#323 merges
   second renumbers per #323 Opus S9 (file + `idx` + `tag` + strictly later `when` +
   snapshot `prevId` chain + verify on a database already migrated through the first).

## Next slices, dependency-cleared (no waiting required)

1. **Submission/intake pure domain** — submission state machine, `SUB-n` allocation,
   form validation with `showIf` evaluation, catalogue visibility. §13/§14 closed; no
   storage needed for the pure layer.
2. **Audit reconstruction/verification pure functions** over the landed `audit_log`
   (chain verify, window query, actor indexing) — §16 closed.
3. **Spec-closure passes** for `views.md`, `attachments.md`, `search-and-saved-views.md`
   to unlock their slices (findings whose storage the data model already resolved).
4. **Coordinated first P2 migration batch** — the moment the 0068 collision settles:
   calendar + SLA + submission + approval + workflow tables in one ordered PR
   (full review tiers + mandatory Opus).
