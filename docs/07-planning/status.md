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
vocabulary. **That procedural gate is closed: the licence pull request merged (#4) and the
P0 issues exist.** The full documentation corpus exists — thirteen ADRs, an authoritative
data model including the identity/SCIM and pending-action tables, a formal accelerated
delivery calendar, a release plan, and a changelog convention. **Application code exists
too**, and the four-category snapshot below says exactly what is on `main` versus what is
only on a branch. **Time is governed by
the operating rule at the top of [phases.md](phases.md):** the four-week plan is a flexible
target, the program may take three to four months, some stages take days — finish on exit
criteria, never skip a gate, move scope or dates and record it.

```
P0 Foundation          ███░░░░░░░  25%   ← in progress (2 of 8 issues done: #4 #5)
P1 Core work           ░░░░░░░░░░   0%
P2 Service desk        ░░░░░░░░░░   0%
P3 Portal + identity   ░░░░░░░░░░   0%
P4 Governance          ░░░░░░░░░░   0%
P5 Insight + agile     ░░░░░░░░░░   0%
P6 Import + cutover    ░░░░░░░░░░   0%
P7 Polish              ░░░░░░░░░░   0%
```

## Where the code is — the only four categories that mean anything

Every claim in this file belongs to exactly one of these. Blurring them is how a branch's
work gets reported as shipped, so the category is never optional.

### ON MAIN

- **#4** licence and provenance — `LICENSE`, `NOTICE`, `THIRD-PARTY-NOTICES.md`. Closed.
- **#5** the kaneo import at `42bb8011`, de-branded. Closed. `apps/api`, `apps/web`,
  `packages/{permissions,email,libs,mcp,typescript-config}`, `package.json`,
  `pnpm-lock.yaml`, migrations 0000–0044.
- **#11's deployment slice** (PR #20, merged `38ff9ac`) — a root `Dockerfile` that builds
  and runs as uid 10001, `compose.yml` publishing no application port, the local /
  production / UAT / Traefik overlays, `scripts/deploy.sh`, a `charts/taskdesk` that
  fails closed on every bootstrap secret, and
  [proxy-topology-evidence.md](../05-operations/proxy-topology-evidence.md).
- Commands that run: `pnpm install | dev | build | lint | typecheck | test |
  test:integration`, the five `i18n:*` scripts, and `scripts/deploy.sh`.
- **No CI.** `.github/` on `main` holds only `pull_request_template.md` — there are **zero
  workflow files**, so nothing runs automatically on a push. Every gate described anywhere
  in this repository as "failing the build" is describing the intended rule, not current
  behaviour, until #19 merges. This is the single most load-bearing fact in this section.
- A GitHub Project board (project 1, *TaskDesk v2 — P0*) with the six agreed columns.

### IN OPEN PR — real code, not on `main`, do not report as available

| PR | Issue | State |
| --- | --- | --- |
| **#16** (draft) | #6 slice | removes the inherited attack surface. Body materially stale; independent security review not done. **Merging it will not close #6.** |
| **#21** | #7 | policy registry, evaluator, route coverage. Two independent Opus reviews complete: **1 CRITICAL, 6 HIGH, 7 MEDIUM, 7 LOW**. Remediation in progress. **Not merge-ready.** |
| **#19** | #10 | CI gates, `test:all`, the `check:*` scripts, `tests/api-contract/openapi.json`. Two CodeQL HIGHs fixed. **Not merge-ready** — route-policy coverage fails until #21 lands, and `pnpm audit` is honestly red. |

### BLOCKED

- **#8** — the router retrofit waits for #6's removal surface to settle. Classifying a route
  that is about to be deleted is wasted review and a false sense of coverage.
- **#17** — sessions already minted by the removed MCP OAuth and device flows. Deleting an
  endpoint is not revoking a credential; a consent click created a full 30-day session row.

### DECIDED / NOT YET IMPLEMENTED

- **better-auth `organization()` is removed in P0 — final.** It is still mounted, because
  it is load-bearing for workspace creation, invitations, members and roles. Load-bearing
  means it needs a retrofit (S1–S10, #6 work), not that it is kept. **S1 —
  characterisation tests — has not started and gates everything after it.**
- **The OpenAPI baseline is `tests/api-contract/openapi.json`.** The file exists in #19.
- **Throttle 1's five conditions** are settled in their exact form (below). Four are unmet.
- **The four application-side gaps that stop v2 UAT coming up** — `TASKDESK_PORT` actually
  being read, live/ready health endpoints, Node static serving, a `storage.filesystem`
  driver — are **#11 prerequisites**. Ownership is assigned when they are scheduled.

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

### Process deviation — recorded, corrected, not waived

**PR #13 merged on 2026-09-06 before its mandatory security review had been performed.**
This was a **process deviation, not an approved waiver.** A post-merge Opus security review
was run immediately over the merged diff — five independent reviewers, one lens each,
reading the source rather than the pull-request description. Findings are recorded in
[`security-reviews/13-kaneo-import.md`](security-reviews/13-kaneo-import.md) with the five
lens files beside it, and on PR #13 itself.

It found **three CRITICAL** defects, **all three now fixed** on
`feat/p0-remove-inherited-surfaces` before Throttle 1: a missing `TASKDESK_AUTH_SECRET`
silently falling through to a constant published in better-auth's source; credentialed CORS
reflecting any origin whenever `NODE_ENV` was not exactly `"production"`; and `bearer()`
publishing the raw session token in a CORS-exposed header. One HIGH was fixed in the same
pass. **From now on a security-path pull request does not merge until its review is
recorded on it** — and once #10 lands, the fast CI job becomes a required status check so
this stops depending on anyone remembering.

### Open

- ~~**`gh` is not authenticated.**~~ **RESOLVED 2026-09-06.** `gh` is authenticated and
  carries the Project scope. Pull requests are opened from the CLI, the PR #13 review is
  posted, and the Project board exists — project 1, *TaskDesk v2 — P0*, with the six
  agreed columns. Kept as a line rather than deleted because it was the top blocker for a
  day and its absence changed how several things were done.
- **#6 must relocate the SSRF guard before it deletes anything.**
  `assertPublicWebhookDestination` lives in `apps/api/src/plugins/generic-webhook/config.ts`
  — a directory #6 deletes — and is imported by two **retained** files,
  `notification-preferences/delivery.ts` and `service.ts`. Deleting the directory first
  breaks the build, and the quick fix is to drop the SSRF validation entirely. This is an
  ordering precondition, not a suggestion. *Blast radius: the #6 lane.*
- **Deleting the MCP OAuth route does not revoke the sessions it already minted.** A consent
  click created a full 30-day better-auth session row. #6 removes the route; something else
  has to invalidate outstanding tokens. **Needs its own issue.** *Blast radius: one lane.*
- ~~**`scripts/openapi/` has no destination.**~~ **DECIDED 2026-09-06** (decision log):
  the committed baseline the drift check compares against is
  `tests/api-contract/openapi.json`; a published `apps/site/public/openapi.json` is
  generated output, not the baseline. **IN OPEN PR #19** — `scripts/ci/check-openapi.mjs`
  and the baseline file exist there and the `contract - OpenAPI drift` job passes. **Not on
  `main`.** *Blast radius: one lane.*
- **v2 UAT is not deployable yet, and the remaining reasons are application-side.**
  The deployment skeleton is **ON MAIN** — PR #20 merged 2026-09-06 as `38ff9ac`. A
  `Dockerfile` that builds, base + local + production + UAT compose files, Traefik
  middlewares, a hardened `charts/taskdesk` that fails closed on every bootstrap secret,
  and `scripts/deploy.sh`. `Dockerfile.kaneo` is deleted.

  **#20 merging did not complete #11**, which stays **In Progress**. What is still missing
  is in the application, not the deployment:
  1. **The API listens on a hard-coded `1337`** (`apps/api/src/index.ts`, `startServer(…,
     port = 1337)`). `TASKDESK_PORT` is documented but never read, so the image, the
     compose files, the Helm Service and the healthcheck all point at 5173 and nothing
     answers.
  2. **`/api/public/health/live` and `/api/public/health/ready` do not exist.** The only
     health route is kaneo's `/api/health`. Until they do, the container's HEALTHCHECK can
     never pass and `up -d --wait` blocks on it — which is exactly the failure
     [container-image.md](../05-operations/container-image.md) warns about.
  3. **The Node process serves no static files.** kaneo used nginx; the TaskDesk image has
     none, by design. The web bundles ship at `/app/public` and nothing reads them.
  4. **There is no `storage.filesystem` driver.** `apps/api/src/storage/` contains only
     `s3.ts`. The compose and Helm shape for it exists (a named volume at `/app/data`,
     attachments under `/app/data/attachments`, owned by uid 10001); the driver, and the
     God Mode setting that points at that path, do not.
  **These four are #11 prerequisites, or dedicated prerequisite work — they are NOT
  automatically #6 or #9 scope.** An earlier revision of this file assigned them to Lane A
  and #9; that was inference from where they were noticed, not a decision. Implementation
  ownership is assigned when they are scheduled (decision log, 2026-09-06). **v2 takes
  `ticket-v2-uat.bimats.com` / `portal-v2-uat.bimats.com` beside v1**, with its own compose
  project, network, volumes and database. **v1 UAT stays running and untouched**, and the
  pre-#6 import must not be exposed publicly — `deploy/compose.uat.yml` carries a
  do-not-apply banner saying so. *Blast radius: the deployment lane, then UAT.*
- **`X-Forwarded-Proto` reaching the application on the bimats.com host is wrong or
  attacker-controlled, and the fix is at CloudFront.** TLS terminates at CloudFront, so
  Traefik's `web` entrypoint is plain HTTP: it forwards a viewer-supplied
  `X-Forwarded-Proto` verbatim, and sets `http` when none arrives. Either way the
  application cannot learn that the viewer used HTTPS. Set an origin custom header
  `X-Forwarded-Proto: https` on the distribution. Evidence and method:
  [proxy-topology-evidence.md](../05-operations/proxy-topology-evidence.md).
  *Blast radius: anything that issues a secure cookie or builds an absolute URL, on that
  host only.* Unblocked by: Thomas (AWS console).
- **A standalone production host has no ACME configuration**, because Let's Encrypt needs a
  contact email and there is no environment variable for one —
  [configuration-reference.md](../05-operations/configuration-reference.md)'s "variables the
  application does not read" table lists four, and none is an email. It was raised rather
  than invented. It does not block this host, which terminates TLS at CloudFront.
  *Blast radius: a future customer install on a bare host.* Unblocked by: Thomas.
- **The GitHub Project board does not exist.** Same `gh` root cause.

---

## Throttle 1 — not yet open

**Four of the five conditions are unmet.** Throttle 1 opens only when **all** are true.
Note the wording of 2 and 3: the **issue** completes. A slice merging is not the condition,
and reading it that way would open the throttle while `organization()` is still mounted
(decision log, 2026-09-06).

| | Condition | State |
| --- | --- | --- |
| 1 | **#5** complete | ✅ merged as PR #13 |
| 2 | **#6 — the ISSUE** complete | ⬜ in progress. PR #16 is a draft slice on `feat/p0-remove-inherited-surfaces`; the `organization()` retrofit S1–S10 has not started |
| 3 | **#7** complete | ⬜ in progress. **IN OPEN PR #21** — registry, evaluator and route coverage exist there, but two independent reviews found 1 CRITICAL and 6 HIGH, so it is not merge-ready |
| 4 | route coverage **actually executes** in CI | ⬜ **IN OPEN PR #19** — the `route-policy` job exists and currently fails closed, which is the gate working rather than the condition being met |
| 5 | adding a route without a policy **fails the build** | ⬜ #19, and not yet demonstrated. The review found that appending a line to `inherited-uncovered.json` currently makes the gate green again, so this condition needs the baseline-monotonicity fix in #21 before it can be claimed |

Conditions 4 and 5 are the ones most easily forgotten: it is **not enough** that #7 has a
passing test locally. The check must execute in CI, which means the part of #10 that
enforces route-policy coverage merges before Throttle 1 opens.

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

### 2026-09-06 · #11 deployment skeleton built and measured on the real host

`feat/p0-deployment-skeleton`. A `Dockerfile` that builds, Compose base plus three
overlays, Traefik middlewares, `scripts/deploy.sh`, and a corrected Helm chart.
`Dockerfile.kaneo` is deleted rather than repaired — it could not build, and that break was
also why the repository's only `NODE_ENV=production` was unreachable (security review 13,
E-9).

**What was verified, not assumed.** `docker build` succeeds. The entrypoint refuses to
start and names all five missing variables. The container runs as uid 10001, carries
`NOTICE`, `LICENSE` and `THIRD-PARTY-NOTICES.md`, and its attachment directory is writable
by that user. `docker compose config` passes for every overlay combination, the production
render contains **no `ports:` at all**, and `helm template` fails closed on each missing
secret with its own message and succeeds when they are supplied.

**The trust-proxy value was measured rather than guessed**, which was the point of the
exercise and which found more than the number. TLS terminates at **CloudFront, not
Traefik** — a real request to `ticket-uat.bimats.com` arrived on Traefik's plain `web`
entrypoint. Both CloudFront and Traefik **append** to `X-Forwarded-For`, so the value is
`2`, set in the UAT overlay only. The same measurements showed that `X-Forwarded-Proto`
reaching the application is either attacker-supplied or wrong, which no amount of counting
boxes would have revealed. Full method and captured headers:
[proxy-topology-evidence.md](../05-operations/proxy-topology-evidence.md).

**Four application-side gaps stop the stack actually coming up** — a hard-coded port 1337,
the two missing public health endpoints, no static file serving in the Node process, and no
`storage.filesystem` driver. They are listed under Blocked. None of them is deployment
work, and none was worked around here: the skeleton is built to the documented contract and
the gaps are named.

**Not done:** `install.sh`. `scripts/deploy.sh` carries the production pre-flight the
one-liner needs, but the bootstrapper itself is not written. The Helm chart is corrected,
not rewritten to [kubernetes.md](../05-operations/kubernetes.md)'s two-Deployment,
three-Ingress-host contract — that is a larger piece of work and the chart is a P2 CI
artefact.

### 2026-09-06 · #5 completed on the branch — de-brand, lockfile delta, environment migration

Continues the import session under Thomas's cloud-agent working agreement, which closed the
decisions that had held the copy. The provenance order in `repository-bootstrap.md` §2 was
followed in its stated sequence — untouched baseline, imported graph proven, copy proven,
**then** rename, **then** an intentional lockfile regeneration, **then** a fresh audit and a
measured delta — so upstream and TaskDesk changes stay distinguishable.

**De-brand.** The five workspace packages and both apps moved to `@taskdesk/*`, and the
brand left 209 source files: CSS class names, tiptap and ProseMirror node names, React
component identifiers, i18n values across all 20 locales, email templates, the Helm chart,
the motion specs, and four paths that carried it in the filename. Four cases were checked
against the specification instead of swept: **`X-Kaneo-Signature` is a real HTTP header in
retained code** — notification delivery keeps it after #6 deletes the webhook router — and
it became `X-TaskDesk-Signature` because `webhooks-and-api-keys.md` **WH-1 already names
that header**, so the sweep implements the spec rather than changing behaviour;
`breadcrumbKaneo` was an i18n lookup **key**, renamed with its single usage; `KANEO_*`
variables were protected because they belong to the environment migration; and
`Dockerfile.kaneo` was deliberately left named as kaneo's, because it is still kaneo's
unrewritten three-image Dockerfile and **cannot build in this tree** — it copies three files
the copy table excludes. Verified that no kaneo copyright header was destroyed: kaneo
carries none in source, attribution is the root `LICENSE`, preserved verbatim.

**Lockfile regenerated deliberately, and the delta measured rather than assumed.** 1635
external packages upstream, 1566 now: **zero added, 69 removed**, all transitive
dependencies of workspace packages the copy table excludes. `pnpm audit` moves 12 → 11
advisories (0 critical, 8 high, 3 moderate); the one `low` disappeared because it reached
through `apps/site`, which is not copied. Trivy unchanged at 7 high, 0 critical.

**Environment migration.** All **98** variables classified — not the "~80" the planning
documents quote. The gap is entirely **indirect reads**: the seven S3 connection variables
go through a local `env()` helper, four `CREEM_PRODUCT_*` through a lookup table, and the
eight `SMTP_*` through a parameter default. A `check:env` gate that only greps
`process.env` would pass a tree that still reads unapproved configuration. Four of the five
required TaskDesk variables were renamed from their kaneo ancestors and the integration
suite was re-run under the new names to prove the rename is wired end to end.
`TASKDESK_PORTAL_URL` is genuinely new. `TRUSTED_PROXIES` was **not** renamed: kaneo takes a
CIDR list defaulting to all of RFC1918 while TaskDesk takes a hop count, which is a
behaviour change on a security boundary whose value must be **measured** in #11, not
inferred from the topology.

**Three defects found and fixed on the way.** `.gitignore`'s `.env.*` rule silently excluded
`apps/api/.env.test.example`, which the copy table says to copy — it was on disk and never
committed. `turbo.json` declared no `globalEnv` at all. And `biome.json` pinned schema
`2.5.4` while `package.json` declares biome `2.5.7` — **upstream kaneo's committed lockfile
was behind its own declared devDependency**, which only the deliberate regeneration
surfaced.

**Status, precisely.** #5 is **in progress**, not complete: the branch is pushed, every gate
that exists today is green, **no pull request is open, no security review has happened, and
nothing is merged.**

### 2026-09-06 · The P0 working agreement recorded; issue #5 provenance evidence produced

Two branches, both pushed, neither merged. Machine: Linux/EC2, **not** a Mac — `open -a
Docker` does not apply here, `docker info` does, and the Docker daemon was already running
88 containers.

**Task 0 — the working agreement** (`docs/p0-working-agreement`). Thomas's confirmed
sequencing was settled in conversation but written down nowhere. One new `CLAUDE.md`
section, "The P0 working agreement", in eight parts — the #4–#11 dependency graph, the two
throttles and the rule that Throttle 2 gates the *claim* and never the throttle, the P1–P4
parallel lanes, a blocking taxonomy graded by blast radius, shared-contract ownership, the
spec interaction rule, the reference restriction, and authority — plus the matching
decision-log entry. The `branch → commit → pull request → Thomas approves → merge` flow was
deliberately **not** restated as new; it is already settled in two places and the new
section points at them.

**Task 1 — issue #5, provenance steps 1–4** (`feat/issue-5-kaneo-import-provenance`). The
mandated order was followed exactly. A throwaway `git worktree` detached at
`42bb801114aa1ae499228a53180f0cdbc5607964`, so the reference clone never gained a
`node_modules` — verified afterwards that it still has none. `git fetch` first, and the
pinned SHA is still the tip of upstream `main`.

**The attribution baseline, every check green on the untouched snapshot:** typecheck,
build, `i18n:check`, `openapi:check`, and `lint` (which is `biome check --write .` and
changed nothing, so the snapshot is already biome-clean). Unit: **130 files, 692 tests, 0
failed, 0 skipped**. Integration: **33 files, 227 tests, 0 failed, 0 skipped — identical on
Postgres 16 and Postgres 18**, which is the new information the bootstrap document asked
for, since kaneo's own CI validates only on 16. Supply chain: `pnpm audit` 12 advisories (0
critical, 8 high) and Trivy 7 high / 0 critical over the same package set — two scanners
agreeing. Every high was traced to its dependency path rather than counted, and none is
reachable in a shipped TaskDesk: all sit in devDependencies (`@commitlint/cli`), build-time
tooling (`postcss`/`nanoid`) or optional peerDependencies kaneo never imports (`mysql2`,
`prisma`). The only advisory on a shipped path is `qs`, moderate, via the MCP SDK's
`express`. `trivy config` on `Dockerfile.kaneo` is clean.

**The copy was performed, and the imported tree is green.** 1,268 files from a `git
archive` of the SHA — tracked files only, so no `node_modules`, `dist` or `.turbo`
travelled. Every *Do not copy* row was verified absent afterwards; every *Copy* row
present. On the imported tree: typecheck, build, lint, `i18n:check`, **unit 124 files /
636 tests**, and **integration on Postgres 18 at 33 files / 227 tests — identical to the
kaneo baseline**. The unit count reconciles exactly against the 130 / 692 baseline:
`packages/planka-import` is not copied (5 files, 54 tests) and `apps/web/src/env.test.ts`
is deleted (1 file, 2 tests).

**Four things the copy table does not cover**, applied as stated in the commit message
rather than decided silently: the two kept `skills/*` are symlinks into `.agents/`, a
*Do not copy* row, so they were dereferenced; `apps/web/src/env.test.ts` asserts on the
excluded `apps/web/env.sh` and was deleted with the mechanism it covers; `scripts/openapi/`
has no verdict row and **running it proved it cannot simply be adopted** — `check.mjs`
writes `apps/docs/openapi.json` and `apps/docs` is *Do not copy* — so the table default was
applied and **the OpenAPI drift check is lost** until Thomas says where it should write; and
`.gitignore` was merged rather than overwritten.

**§2 de-brand cannot be completed inside #5, and that is a sequencing defect worth
recording.** Only the web entry document and the manifest were de-branded. Each remaining
part is coupled to work §1 or §3 defers: the `@kaneo/*` → `@taskdesk/*` rename changes a
`workspace:*` specifier, which breaks `--frozen-lockfile` and forces regenerating the
lockfile §1 says to keep until after the removals — measured at 799 changed lines, 69 of
them external `resolution`/`integrity` lines, which would invalidate the audit baseline
recorded in this same branch; `emailDomainName: "kaneo.app"` leaves with the anonymous
plugin, as §2 itself says; and the i18n sweep would rename `X-Kaneo-Signature`, an HTTP
header in the webhook contract, so it is not branding. The lockfile was verified
**byte-identical to kaneo's at `42bb8011`**.

**Still open: seven documentation decisions** — the Sentry and
`KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS` self-contradictions, `scripts/openapi/`'s real
home, and the seven missing **S3 connection variables**, which `apps/api/src/storage/s3.ts`
reads through a local `env()` helper at lines 79-81 and which a `process.env.X` grep
therefore cannot see. The environment migration is not applied.

**Two inherited security defaults were found that are on no removal list**, both verified
in source: `rateLimit: { enabled: isCloud() }` at `auth.ts:566` — rate limiting is off for
every self-hosted instance, and stripping `KANEO_CLOUD` would make that permanent rather
than fix it — and `apiKey({ enableSessionForAPIKeys: true })` at `auth.ts:536`, a third
authentication surface larger than the two already slated for removal. This is the same
pattern as the `anonymous()` and `accountLinking` finds: it was only visible by opening
`auth.ts`.

**UAT.** No cutover was attempted. v1 UAT runs as compose project `taskdesk-uat`, and its
declared config directory `/home/ubuntu/ticketing-uat/` no longer exists — the equivalent
files are in `ticketing.v1/`, and `docker compose config` was verified to resolve the same
nine services from there, which gives a working rollback command. Today's database dump was
verified readable with `pg_restore -l` (76 tables). **TLS does not terminate at Traefik**:
both UAT hostnames resolve to CloudFront with an ACM wildcard `*.bimats.com` valid to
2026-12-11, and Traefik serves only the plain `web` entrypoint behind it — so there is no
per-host certificate to reissue at cutover, which makes the swap simpler than assumed. **v1
UAT is not idle**: an interactive Entra-authenticated session on 2026-09-05 05:54 UTC. And
a v2 UAT deployment is not possible yet regardless, because `ticketing.v2` still has no
application code.

**Toolchain.** Node 24.20.0 and pnpm 10.32.1 installed **user-locally** via `fnm` and
`corepack`, not machine-wide. There is no `gh` and no GitHub token anywhere on the host;
SSH push works, so branches are pushed and pull requests cannot be opened.

**Not done, deliberately:** the kaneo copy, de-brand and environment migration (held on the
seven decisions); the issue dependency-link corrections and the Project board (no token);
a second-model review of either branch (none available — recorded as unreviewed rather than
downgraded, per the third absolute); and no committed security note, because
`docs/07-planning/security-reviews/` does not exist and its filename needs a pull-request
number that does not exist yet.

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

Opened as two pull requests — **#2** (licence and provenance, closing issue #4) and **#3**
(the confirmed decisions and `CLAUDE.md`) — and eight P0 issues, **#4–#11**, as vertical
slices with dependency lines rather than one issue per screen. The GitHub Project board is
the one thing not done: the token lacks the `project` scope.

**Not done, deliberately:** no kaneo import and no P0 code — the hard stop is the licence
pull request merging.

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
