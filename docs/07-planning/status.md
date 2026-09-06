# Status

**Last updated:** 2026-09-06
**Current stage:** P0 · Foundation — not yet started
**Updated by:** Claude Code (Fable), applying the pre-P0 check at Thomas's direction —
see the session log

> Update this at the end of every working session. It is the first thing anyone — human or
> agent — reads when picking the project up cold.

---

## Where we are

Planning complete, audited, security-reviewed, and closed against Thomas's confirmed
decision document of 2026-09-05 (sections A–N plus the core-identity update) — and, on
2026-09-06, **corrected against kaneo's real source** by a pre-P0 check (≈200 verified
findings across eight lenses, every one applied in its owning document or recorded in the
[decision log](decision-log.md); audit trail in
[reviews/2026-09-05/pre-p0-check-fable/](reviews/2026-09-05/pre-p0-check-fable/)).
Thomas confirmed the outstanding decisions on 2026-09-06 — the kaneo snapshot SHA
(`42bb8011`, upstream main), inheriting kaneo's 45 migrations, the person model, the
engine boundary rule, an RLS prototype in P0, and the stage/workstream/step/state
vocabulary. **What now gates P0 is procedural, not a decision: the licence pull request
must merge and the P0 issues must exist** — see Blocked. The full
documentation corpus exists — thirteen ADRs, an authoritative data model including the
identity/SCIM and pending-action tables, a formal accelerated delivery calendar, a release
plan, and a changelog convention. No application code written yet. **Time is governed by
the operating rule at the top of [phases.md](phases.md):** the four-week plan is a flexible
target, the program may take three to four months, some stages take days — finish on exit
criteria, never skip a gate, move scope or dates and record it.

```
P0 Foundation          ░░░░░░░░░░   0%   ← next
P1 Core work           ░░░░░░░░░░   0%
P2 Service desk        ░░░░░░░░░░   0%
P3 Portal + identity   ░░░░░░░░░░   0%
P4 Governance          ░░░░░░░░░░   0%
P5 Insight + agile     ░░░░░░░░░░   0%
P6 Import + cutover    ░░░░░░░░░░   0%
P7 Polish              ░░░░░░░░░░   0%
```

**Screens:** 0 of **136** complete — [inventory](../02-design/screen-inventory.md)
(recounted 2026-09-05 with a kind column: P0 6 · P1 33 · P2 18 · P3 21 · P4 28 · P5 28 · P6 2)
**Features:** 0 of **31** shipped — [index](../03-features/README.md) (teams.md was missing from the index until 2026-09-05)
**ADRs:** 0001–0013 accepted · **Docs:** ~136 files, link check clean · **Security review:** see the breakdown below — the corpus is reviewed, the product is not
**Security status** — "complete" was a documentation claim being read as a product claim,
so it is broken out. Five of the seven are impossible before code exists:

| | |
| --- | --- |
| Architecture review | ✅ done |
| Threat model | ✅ done |
| Implementation review | ⬜ no code yet |
| SAST / dependency scanning | ⬜ no code, no lockfile |
| Authorization tests (route coverage, role × route matrix, tenant isolation) | ⬜ P0 |
| Internal red-team pass | ⬜ before the internal go-live gate |
| External penetration test | ⬜ before the first external paying customer (R19) |

**Readiness:** **Conditional GO → condition met.** The [external readiness review](reviews/2026-09-05/readiness-review-external.md)
asked for one documentation-closure PR before P0 code; that PR is this branch's third commit
**Target calendar:** **Foundation Technical Preview** by 2026-09-12, go-live by 2026-10-03, full scope by end of
December 2026 — see [accelerated-delivery-plan.md](accelerated-delivery-plan.md). **This
is a target, not a deadline held under pressure** — the date is explicitly allowed to move;
the engine-pattern architecture and the security gates are what may not.

---

## Done

**Prior session — architecture and product decisions:**

- Analysed kaneo, Plane, OpenProject and TaskDesk v1
- Confirmed licences: kaneo MIT, Plane AGPL-3.0, OpenProject GPL-3.0. v2 is AGPL-3.0
- Locked the core decisions: kaneo as foundation (not forked), one backend, better-auth
  primary, two portals/two origins, everything pluggable, every route declares a policy,
  SLA computed on read
- Wrote ADRs 0001–0010 and the full documentation corpus — roughly 65 documents

**This session — continued after the OpenAI agent and GitHub Copilot both hit usage
limits, then GitHub Copilot too, then handed to Claude Code:**

- **Reviewed the six additionally cloned ITSM systems** (chatwoot, freescout, glpi,
  nocobase, osTicket, zammad) against their actual licences and architecture, added to
  [competitive-inspiration.md](../00-overview/competitive-inspiration.md) and
  [licensing-and-attribution.md](../00-overview/licensing-and-attribution.md). Zammad's
  configurable ticket-state model was the most directly validating find.
- **Wrote ADR 0011** — one generic lifecycle engine for every work item type, states and
  transitions fully data-driven, only a five-value `group` fixed in code.
- **Wrote ADR 0012** — a terminology overlay so domain nouns ("Ticket", "Project", "Cycle")
  are renameable per instance, separate from state naming.
- **Wrote ADR 0013** — marketplace listing and usage metering as an optional `license`
  plugin, never a default, keeping the self-hosted/no-phone-home promise intact.
- **Generalised the plugin pattern into "the engine pattern"** in
  [plugin-architecture.md](../01-architecture/plugin-architecture.md) — every feature, not
  only the (then six, now seven) plugin kinds, is expected to follow the same shape: contract,
  registry or settings screen, generated configuration, a feature flag, a validate/test
  affordance.
- **Reconfirmed and extended customer self-service**: customers already could raise,
  comment, escalate, approve-what's-addressed-to-them, reopen and rate their own requests;
  added the one genuine gap — **withdrawing** a submission before triage (`CP-15`,
  `IQ-16a`).
- **Added a three-tier reporting model** to
  [reports-and-dashboards.md](../03-features/reports-and-dashboards.md): fixed reports
  (unchanged), selectable row-and-column reports (a named, saved Table view), and a small
  customisable report builder — all three persisted through the existing `saved_view`
  mechanism, no new engine.
- **Corrected the tech stack against actual current status, not memory**: PostgreSQL
  16 → 18, Valkey 8 → 9, OpenAPI 3.1 → 3.2 target, and — the significant one — **dropped
  MinIO as the shipped default** after confirming its open-source edition was effectively
  wound down through 2025–2026, replacing it with SeaweedFS (default) and Garage
  (AGPL-aligned alternative). Confirmed Node 24, Traefik v3 and Keycloak 26 remain correct
  as-is. Noted kaneo's emerging Base UI dependency for action at fork time, not before.
  *(Later the same day: Base UI decided as the primary primitive standard — decision N;
  Keycloak moved out of core scope, Microsoft Entra only.)*
- **Specified the one-line installer** (`curl \| bash`) in
  [one-line-install.md](../05-operations/one-line-install.md) — a thin, checksum-verified
  bootstrapper around the existing `scripts/deploy.sh`, with a documented offline path.
- **Specified the AWS Marketplace listing** in
  [aws-marketplace.md](../05-operations/aws-marketplace.md) — container-product listing
  type (not SaaS, not AMI), mandatory automatic security scanning, metering via AWS
  Marketplace Metering Service, Helm chart submission requirements, and the AGPL
  buyer-obligation note, researched against AWS's current seller documentation. *(Later
  the same day: the listing was deferred beyond the current scope and a BYOL/contract
  model preferred over metering — see the decision log.)*
- **Added RBAC/API, OpenAPI-contract and MCP test layers** to
  [testing-strategy.md](../04-engineering/testing-strategy.md), plus a named
  cross-feature "task and work-item lifecycle" test suite.
- **Recorded a model-tier policy** for Claude Code's own subagent orchestration in
  [agent-workflow.md](../04-engineering/agent-workflow.md): Sonnet 5 implements against an
  approved spec; Opus or Fable plans and reviews; **security review is Opus, always, not
  negotiable against schedule.** Wired into [SDLC](../04-engineering/sdlc.md) step 5 and
  the stage gate.
- **Wrote the accelerated delivery plan**
  ([accelerated-delivery-plan.md](accelerated-delivery-plan.md))** at Thomas's explicit
  request — a dated Sept–Dec 2026 calendar mapping the full P0–P7 scope in parallel
  workstreams, with every quality-gate compression named in an explicit deferral register,
  sitting alongside — not replacing — the no-dates [phases.md](phases.md). Revised the
  same day once Thomas clarified the calendar is a target, not a deadline under pressure.
- **Added `CHANGELOG.md`** and a release-notes convention in
  [ci-cd.md](../04-engineering/ci-cd.md) tying the changelog, the screen inventory and the
  feature index together at every stage close.

---

## Next

**P0 · Foundation.** Order matters — the gates go in before the features. Two things
changed today: a **step 0** (spec closure — done, see [phases.md](phases.md#p0--foundation))
now precedes step 1, and the **kaneo router retrofit** is named as P0's largest security
task with its own Opus review:

0. Spec closure — items 1–3 (data model authoritative, five policy kinds, week-one
   documents, threat model) **done 2026-09-05**; item 4 — each spec's remaining findings in
   [reviews/2026-09-05/](reviews/2026-09-05/) — is a **standing gate at that feature's SDLC
   step 2**, not a completed step ([AGENTS.md](../../AGENTS.md) do-not 15)
1. Initialise the repository — **only after the licence pull request merges and the P0
   issues exist**: `git fetch`, run
   kaneo's own suite on that SHA as the baseline, copy per the exhaustive table, de-brand
   **including the environment migration table**, apply the **fork-time removal and disable
   list** (anonymous sign-in, account linking, cookie cache, `deviceAuthorization`/`bearer`,
   `public-project` by file, the six integration plugins and their tables, billing, Sentry,
   planka-import, kaneo's agent files); fill the inherited-features register
1b. **Retrofit every inherited kaneo router into the five policy kinds** — human-reviewed,
   router by router; Opus security review before P0 closes
2. `LICENSE`, `THIRD-PARTY-NOTICES.md`, `NOTICE`, `AGENTS.md`
3. Extract `packages/ui`; Tailwind preset; Storybook running
4. Split `apps/web` into agent and portal entries
5. Scaffold `packages/domain`, `packages/permissions`, `packages/plugins-contracts`
6. Route registry with the round-trip test
7. **Policy registry, route coverage test, permission matrix test** — the anti-v1 controls
8. CI pipeline with every gate, including the new contract and MCP test layers
9. UX gate scripts: tokens, ui, deps, bundle purity
10. Playwright projects; Testcontainers harness; seed scripts
11. Dockerfile, compose, Traefik, `scripts/deploy.sh`, **and the `install.sh` bootstrapper**
12. Observability: Pino, Prometheus, health endpoints
13. `apps/site` skeleton
14. Sign-in, MFA, not-found, error boundary

If the [accelerated delivery plan](accelerated-delivery-plan.md) is being followed, this
is also **week 1** of that calendar, targeting the **Foundation Technical Preview** by
2026-09-12 — a technical preview of the foundation, not a user-acceptance milestone; the
UAT *environment* keeps its name.

**Exit criteria:** builds, deploys locally on three hostnames, every CI gate green **with
kaneo's inherited routes present and each carrying a policy**, P0 security review signed off.

---

## Blocked

- **P0 step 1 (import kaneo)** — hard stop until **both**: the licence pull request
  (`LICENSE`, `NOTICE`, `THIRD-PARTY-NOTICES.md`) has **merged**, and the **P0 issues
  exist** on the Project board. The snapshot SHA and the migration approach are no longer
  blockers — both were confirmed on 2026-09-06. Unblocked by: Thomas merging the licence
  pull request.

---

## Open decisions

| Decision | Deadline | Owner |
| --- | --- | --- |
| CLA, for a possible dual licence | Before the first external contribution | Thomas |
| Final product name | Before P7 | Thomas |
| ~~Whether to sell externally~~ | Decided: yes — but the **AWS Marketplace listing itself is deferred beyond the current 3–4-month scope** (2026-09-05); BYOL/contract preferred when it comes — see [decision log](decision-log.md) | — |
| Docs-site stack — fresh Fumadocs app (recommended) / kaneo's marketing site + `/docs` / Mintlify | Before P0's `apps/site` skeleton | Thomas |
| Visual-regression tool for gate G8 — Playwright `toHaveScreenshot` with in-repo baselines, or Chromatic | Before P0's UX gate scripts | Thomas |
| Gate consolidation in release-plan.md — confirm as a waiver or revert | Before `2.0.0` | Thomas |
| WAL archiving for point-in-time recovery | Before real customer data | Thomas |
| Whether the 4-week go-live scope needs to narrow | Escalate the moment workstream A (service-desk domain logic) looks behind, per [accelerated-delivery-plan.md](accelerated-delivery-plan.md#what-happens-if-week-4-looks-tight) | Thomas |

---

## Watch list

Risks currently most likely to bite. Full list in [risks.md](risks.md), now with seven
additions — **R15–R17** for the accelerated calendar, **R18** marketplace integrity, **R19**
pentest lead time, **R20** the kaneo router retrofit, **R21** inherited authentication
defaults surviving the fork.

| | Risk | Why now |
| --- | --- | --- |
| **R15** | Workstream A (SLA/workflow/approvals port) can't realistically finish in the compressed window | It is the schedule's critical path, named on day one |
| **R2** | Stage discipline collapses | The accelerated plan deliberately runs stages in parallel — the discipline that must survive is the deferral register, not stage sequencing |
| **R1** | UX failure repeats | P0 is where the guards are installed or are not, on any calendar |
| **R17** | Parallel workstreams reproduce three-inconsistent-codebases faster than usual | Cross-agent review and CI-enforced vocabulary matter more, not less, under this pace |

---

## Session log

Newest first. One entry per working session.

### 2026-09-06 · Confirmed decisions applied; licence and provenance files opened as a pull request

Thomas returned a confirmed decision document closing everything the pre-P0 check had left
open, and adding repository setup. Applied in two pull requests.

**Licence and provenance** (its own pull request, the provenance boundary before the kaneo
import): `LICENSE` (AGPL-3.0 verbatim), `NOTICE` (copied into the image, section 13 stated
plainly), `THIRD-PARTY-NOTICES.md` (kaneo's MIT licence verbatim with its holder, the
confirmed snapshot commit and why it is not the `v2.22.0` tag, the projects studied but not
copied, and the rule that third-party code arrives with its notice in the same pull request).

**Documentation**: the SHA and the inherited-migrations decision marked **confirmed**
everywhere they had said "pending"; **stage / workstream / step / state** separated into one
word each, which required renaming the SDLC's nine stages to **steps** and ADR 0011's loose
"stages" to **states** so the new word had one meaning; product principle 7 restated to
constrain what may be *claimed* finished rather than what may be *started*; the security
line broken into seven rows because "complete" described the documents and was being read as
the product; the Sep 12 milestone renamed **Foundation Technical Preview**; the **engine
boundary rule** (swappable ⇒ plugin, single implementation ⇒ domain module plus a flag);
**RLS promoted from deferred to a P0 prototype** on `work_item`, `comment` and `attachment`
with a merge-or-drop exit; the **person model** — one person, one organisation, email is not
an identity key, two rows for a human who needs both portals with the same address allowed,
impersonation as the supported route for staff, and the two-customer-organisations consultant
recorded as an accepted limitation; every command in README and AGENTS.md marked **planned,
not available until P0 completes**; the **week-2 scope confirmation** given an owner and a
moment; **do-not 16** rewritten as the working mode — branch → commit → pull request →
Thomas approves → merge, and never leave finished work uncommitted.

Nine decision-log entries. Link check clean.

**Not done, deliberately:** no kaneo import and no P0 code — the hard stop is the licence
pull request merging and the P0 issues existing.

### 2026-09-06 · Pre-P0 check applied — the plan corrected against kaneo's real source

Thomas asked whether the corpus had been checked "file by file" and whether anything would
bite later. Fable ran a whole-corpus check: deterministic scripts (links, flags, env vars,
identifier registries — all clean) plus eight background Opus lenses (bootstrap vs kaneo,
RBAC/security, identity, data model, design, planning, process, operations), each writing
findings incrementally; every Top-5 claim was re-verified against the files before use.
≈200 findings, ≈60 high. The registries held (111 tables, 84 capabilities, 38 events, 22
flags — zero orphans); the defects were **kaneo reality, contradictions, missing columns and
mechanisms, and prose-only process rules**.

Thomas then directed that nothing stay in a review file. Applied in one pass (fourteen
decision-log entries; eight file-partitioned edit agents; Opus review): the **kaneo snapshot
SHA** proposed as upstream main `42bb8011` (the `v2.22.0` tag predates authorization fixes)
— pending confirmation; the **fork-time removal and disable list** (kaneo enables
better-auth's `anonymous()` guest sign-in by default, ships `accountLinking.enabled: true`
with the generic OIDC provider trusted, and a five-minute session cookie cache — none of it
was in any document); the **environment migration table** (≈80 kaneo variables →
five-plus-six); `public-project` as a file checklist including the anonymous
attachment-read path; migrations inherited from kaneo's 45 (recorded from Thomas's message,
to confirm); `storage.filesystem` as the fresh-install default with SeaweedFS as an opt-in
profile; CSRF scoped to cookie auth; `orOwner` requiring the `*_own` capability; elevated
DELETEs refused to non-session credentials; `pending_action` gaining `payload`/`route_key`;
Entra claim rules Entra can actually satisfy; the reload mechanism watching
`identity_connection`; `scheduled_transition`, `first_response_at`, `is_reopen`, legal hold,
quotas, tombstones; Radix → Base UI in six documents (kaneo is already 43/63 Base UI);
design tokens split into inherited-verbatim and authored; compose ports out of the base
file; the PR template written and specified; do-not 16 (Thomas's wording); the third
absolute (wait, never downgrade the reviewer); the two-lane go-live rehearsal gate;
marketplace deferral everywhere; Pages marked spec-required; twenty reports. Thomas's two
agent-report messages were verified item by item: all valid except the claim that email was
missing from the decision log (it was at line 59; a dedicated entry now exists anyway).

Method note: the Workflow tool was not used (it stalled three times on this corpus the day
before); plain background agents with incremental files completed 8/8 for the review. In
the apply pass five of eight edit agents were killed by a 600 s stall watchdog mid-edit and
were resumed with their context; edits were verified by diff afterwards.

**Not done, by rule:** nothing committed or pushed (do-not 16). **Next:** Thomas confirms
the SHA and the migration approach and says "commit"; then P0 step 1.

### 2026-09-05 · Decision document applied — identity/SCIM core, universal deletion approval, deferred scope

Thomas supplied a confirmed decision document (sections A–N: flexible timeline as an
operating rule; kaneo as a one-time snapshot; public boards deleted; reach-affecting project
fields; service-key bounds; MCP on normal RBAC; MCP read-only default and prompt-injection
posture; universal deletion approval with confirmation levels; no automation delete;
trusted-proxy hop count; internal red-team gate; customer request visibility; Base UI as the
primitive standard) plus an identity update making **Microsoft Entra OIDC + SCIM core P3
delivery**, and an [external readiness review](reviews/2026-09-05/readiness-review-external.md)
("Conditional GO — one documentation-closure PR first").

Applied in one closure pass: new [pending-actions.md](../01-architecture/pending-actions.md)
(`PA-1`–`PA-14`, `pending_action` table, `/api/me/pending-actions/*`, `202` semantics,
session-only approval); new [identity-provisioning.md](../03-features/identity-provisioning.md)
(`IP-1`–`IP-25`, six identity tables, `/scim/v2/*` as `delegated: scim`, 17 acceptance tests
against a real Entra tenant); [auth-and-identity.md](../01-architecture/auth-and-identity.md)
made the identity owner; `rbac.md` (MCP = same RBAC, session-only routes, elevated list),
`security-model.md` (SCIM and deletion sections, evidence chain), `data-model.md`,
`api-design.md`, `events.md`, `background-jobs.md`, `plugin-architecture.md` (flags
`feature.scim`, `feature.dev_links`; notify/devlink future priorities), `mcp-server.md`
(`MC-19`–`MC-22`, `delete_work_item`, no purge tool), `god-mode.md` (Organisation →
Identity; nineteen screens), `customer-portal.md` (`CP-16` visibility, `CP-17` org SSO),
`automations.md` (`AM-13`), `work-items.md`, `attachments.md`, `comments-and-activity.md`,
`webhooks-and-api-keys.md` (`AK-10`, `AK-11`), `inherited-features.md` (integration routers
removed at fork; Base UI), `ui-extraction-plan.md`, `tech-stack.md`, `ci-cd.md`,
`testing-strategy.md` (four new test families), `screen-inventory.md` (136), `phases.md`
(operating rule; P0/P1/P3/P4), `release-plan.md`, `accelerated-delivery-plan.md`,
`roadmap.md` (deferred list with priorities), `aws-marketplace.md` + ADR 0013 addendum
(BYOL/contract preferred), `data-protection.md`, `definition-of-done.md` + `sdlc.md`
(review-section-empty gate), `AGENTS.md` (do-not 12–15), glossary, decision log, this file.

Then a **four-lens consistency check** (identity/SCIM · pending actions · scope/timeline ·
identifiers/counts) over the result, every finding re-verified against both files before
being applied: ~70 fixes, mostly stale wording that pre-dated the decisions (Radix/Keycloak/
Slack/marketplace mentions, "flagged off" for routers now deleted, "empty application" for
the P0 exit), plus three real structural ones — `membership.scope` gained `organisation` so
the customer role has a row to live in; `prev_hash`/`row_hash` added to `audit_log`; and the
rule-id prefixes `AU`/`SV`/`RL` were each defined twice, so automations became `AM-n`,
services `SVC-n`, releases `REL-n`, with a prefix registry in the features README.

Next session: **P0 step 1** — copy kaneo at a recorded SHA, delete `public-project` and the
integration routers, fill the inherited-features register, then the router retrofit.

### 2026-09-05 · Fable session — parallel audit, closure pass, security fold-in, first push

Model switched to Fable 5.1. Ran a six-reviewer parallel audit of the whole corpus (five
Opus reviewers — core/service-desk specs, governance/design specs, architecture/engineering/
ops, cross-document consistency, security — plus a Sonnet verifier for OpenProject/ITSM
feature gaps), after a Workflow-tool attempt stalled twice and was replaced by plain
background agents writing findings incrementally. Findings live in
[reviews/2026-09-05/](reviews/2026-09-05/) and are summarised in
[review-2026-09-05.md](review-2026-09-05.md).

Then the **closure pass**: `data-model.md` rewritten as the single authoritative schema
(workspace-scoped `state` + `project_state`, ~30 previously unmodelled tables added);
`rbac.md` rewritten with five closed policy kinds, a capability implication graph, the
built-in role × capability matrix and the one elevated-actions list; `api-design.md`,
`background-jobs.md` (lease SQL corrected), `screen-inventory.md` (recounted: 133),
`god-mode.md`, `settings-hierarchy.md`, `security-model.md` (threat model) rewritten; the
canonical event catalogue ([events.md](../01-architecture/events.md)), teams spec,
auth-runtime-reconfiguration, i18n, migrations, repository bootstrap, UI extraction plan,
container image, Kubernetes values contract and data-protection documents written; the
env file cut to five required variables with a first-run setup page replacing the
bootstrap email, at Thomas's direction.

**Security fold-in** (the review completed last): PKCE/`state`/`nonce` as the OIDC
protocol floor; reach-affecting project fields moved to `project:manage_members`; service
keys bounded by their creator; MCP destructive tools behind out-of-band human approval
with tool output marked untrusted; AI plugin rules (scoped retrieval, output as untrusted
input, audit, spend cap); `TASKDESK_TRUST_PROXY` as a hop count with the app port never
published; webhook delivery and audit reads reach-scoped; placeholder visibility (`AM-11`);
impersonation forbidden from creating durable authority; five new threat-model rows;
`public-project` deleted at fork; the kaneo router retrofit named as P0's largest security
task with its own Opus review; an internal red-team pass at the go-live gate; ten new
negative security tests; R20 added. All high-severity findings are closed in the corpus;
the medium/low items that are per-spec are listed in the review files and close at each
spec's SDLC step 2.

Also: `.gitignore`, `CHANGELOG.md`, [release-plan.md](release-plan.md) (channels, `stable.txt`,
`release/2.N` branches, migration matrix), first commit and push to `docs/v2-planning-corpus`,
PR #1.

Next session: **P0 step 1** — copy kaneo at a recorded SHA, delete `public-project`, fill
the inherited-features register, then the router retrofit.

### 2026-09-05 · Continuation — ITSM review, three new ADRs, accelerated calendar

Picked up after the OpenAI agent and then GitHub Copilot both exhausted their usage
limits mid-session. Surveyed the six additionally-cloned ITSM systems; corrected the tech
stack against actual current status (Postgres 18, Valkey 9, OpenAPI 3.2, and dropping
MinIO after confirming its open-source edition wound down through 2025–2026); wrote ADRs
0011–0013 (lifecycle engine, terminology overlay, marketplace metering); generalised the
plugin pattern into an explicit "engine pattern" required of every feature; specified the
one-line installer and the AWS Marketplace listing; added RBAC/API, OpenAPI-contract and
MCP test layers; recorded a model-tier policy for Claude Code's own subagent use, with a
mandatory Opus security checkpoint; added a three-tier reporting model; reconfirmed and
closed the one real gap in customer self-service (withdrawal); wrote a dated accelerated
delivery plan at explicit request, then revised it the same day once told the calendar is
a target and not a deadline under pressure; added `CHANGELOG.md` and a release-notes
convention.

Key conclusions:

- The MinIO finding is the sharpest example of why "check current status, don't assume
  from training" mattered this session — a plausible-sounding default would have been
  wrong within the same year it was written.
- The engine-pattern generalisation and the "dates flex, architecture doesn't" framing are
  two directions of the same instruction, and are recorded together in the decision log
  for that reason.
- Nothing in this session touched P0's actual task list. The next session should begin
  P0, step 1, exactly as previously planned.

Next session: begin P0, step 1.

### 2026-09-05 · Planning

Analysed all four reference codebases. Established licensing constraints. Made and
recorded the ten architectural decisions. Wrote the complete documentation corpus —
roughly 65 documents across nine sections.

Key conclusions:

- v1's authorization *design* is its most valuable asset and is being carried forward
  (reach vs authority, directory-resolved identity, 404-not-403). Its *frontend* is being
  discarded entirely.
- v1's real failure was process, not code: features were declared done when they
  functioned. The nine-step SDLC and the thirteen automated UX gates exist to close that.
- The eleven authorization holes v1 shipped past a green suite were all *omissions*. The
  route policy registry converts that class of bug into a build failure.

---

## How to update this

At the end of every session:

1. Update the stage progress bars.
2. Update screen and feature counts.
3. Move anything finished into **Done**.
4. Restate **Next** with concrete steps, not intentions.
5. Record anything **Blocked**, with who unblocks it.
6. Add a session log entry, including what did not work.

Do not describe intent. Describe state. "Working on the board view" is not a status;
"board view renders and drags; keyboard drag not yet implemented" is.
