# Accelerated delivery plan — Sept–Dec 2026

- **Status:** Active alongside [phases.md](phases.md) and [roadmap.md](roadmap.md), not a
  replacement for either.
- **Owner:** Thomas. **Decided:** 2026-09-05, revised 2026-09-05. See [decision log](decision-log.md).

> **The dates below are a target, not a deadline held under pressure.** Thomas's own
> instruction, given the same day this plan was written: *"we can adjust the timeline...
> dates are just a number — something you can finish in one go, and something that needs
> more time to look at and solve. No pressure."* What must not move is the **engine
> shape** of every feature — see [what never moves](#what-never-moves-regardless-of-the-calendar)
> below. What can move, without it being a failure, is the calendar. Treat every date here
> as "aim for this, and say plainly the moment it looks wrong" rather than "hit this or
> something went wrong."

## What this document is, and is not

[phases.md](phases.md) defines what each phase's **Definition of Done actually means** —
that does not change, and nothing here lowers that bar permanently. This document maps the
**full P0–P7 scope already specified** onto a real, dated calendar at Thomas's explicit
request, running phases in parallel rather than strictly sequentially, and it says
**exactly where a quality gate is compressed, deferred, or run at reduced depth to hit the
date** — because the alternative is a plan that looks fine and quietly isn't, which is the
one failure mode this whole project exists to avoid.

**Read this if you are asking "what ships by which date."**
**Read [phases.md](phases.md) if you are asking "what does 'done' mean for feature X."**
Where they conflict on a date, this document governs. Where they conflict on what "done"
means, phases.md governs — a compressed timeline is a statement about *when*, never a
silent redefinition of *what*.

## Why this is attemptable at all, on this calendar

A from-scratch build of 109 screens and a full ITIL-depth service desk in four weeks would
be fantasy. Three things make an aggressive attempt realistic rather than fantastical:

1. **P1 is mostly already built.** [ADR 0001](../01-architecture/adr/0001-kaneo-as-foundation.md)
   takes kaneo — a working, tested, styled work-management application — as the starting
   point. Week 1 is de-branding and hardening a running product, not building one from a
   blank editor.
2. **The specs already exist.** All 30 feature specs, the data model, the API design, the
   RBAC model and ten ADRs are written. [SDLC](../04-engineering/sdlc.md) stage 2 (Specify)
   — normally the slowest stage because it requires human judgement — is already done for
   the whole product. What is left is stages 3–9, which parallelise.
3. **Heavy, model-tiered AI-agent parallelisation.** Independent workstreams (below) run
   concurrently, each on its own branch, per
   [agent-workflow.md](../04-engineering/agent-workflow.md)'s "parallelise across
   independent areas" rule and its
   [model-tier policy](../04-engineering/agent-workflow.md#model-tiers-within-claude-code) —
   Sonnet 5 implementing against an already-approved spec, Opus/Fable reviewing,
   **Opus gating security on every workstream, always, with no exception for schedule
   pressure.**

## What never moves, regardless of the calendar

Two things are non-negotiable here, independent of whether any date above slips —
security, per explicit instruction, and the **engine shape** of every feature, per the
equally explicit follow-up instruction that the calendar may flex but the architecture may
not:

1. **Security is not optional under any timeline.** Route policy coverage, the permission
   matrix, tenant isolation (404-not-403), secrets handling, and the Opus security review
   at every merge ([ADR 0010](../01-architecture/adr/0010-route-policy-registry.md),
   [Security model](../01-architecture/security-model.md)) run from day one, on every
   workstream, at full strength, on whatever calendar this actually takes.
2. **Every feature — the ones listed here and any added later — is built as a pluggable
   engine, never a one-off.** Contract, registry, God-Mode-generated configuration, a
   feature flag to switch it off. See
   [plugin-architecture.md § the engine pattern](../01-architecture/plugin-architecture.md#the-engine-pattern-making-any-feature-pluggable).
   A workstream that ships something hardcoded to hit a date has not actually hit the
   target — it has produced the thing this whole rebuild exists to avoid.

**What is allowed to compress is breadth, polish and the calendar itself.** What is never
allowed to compress is whether a security check exists, or whether a feature was built as
an engine. Anything that has to give under schedule pressure gives from the list in
the deferral register below, or by the calendar moving — never from either of the two
rules above.

## Calendar

Today is **2026-09-05** (Saturday).

| Week | Dates | Milestone |
| --- | --- | --- |
| **1** | Sep 5 – Sep 12 | **UAT ready.** v1-level core running: de-branded kaneo, sign-in, RBAC/policy registry, CI security gates live |
| **2–4** | Sep 12 – Oct 3 | Parallel build-out of service desk, portal, governance and reduced insight/agile scope. **Go-live** at the end of week 4 |
| **5** | Oct 3 – Oct 10 | **Production testing week** — soak test, load test, security pass, bug bash, no new features |
| **6–17** | Oct 10 – Dec 31 | The 3-month window: import/cutover, full polish and hardening, AWS Marketplace packaging, requested features, ongoing bug-fixing, and **paying down everything deferred below** |

### Week 1 — v1-level core, UAT ready (by Sep 12)

**"v1 level" means, precisely:** sign-in with MFA, organisations/workspaces/projects,
work items with type/state/priority, board and list views, comments, labels, basic
editable roles — the P0 + P1 scope from [phases.md](phases.md), which is substantially
kaneo de-branded and hardened, not built from zero. **It does not mean v1's full feature
set** (SLA, approvals, portal, 14 reports) — that would not be honest to promise for week
1, and isn't the claim.

- P0 in full: repo initialised from kaneo, de-branded, licensed, `packages/ui` extracted,
  route registry, **policy registry + route-coverage test + permission-matrix test live in
  CI from day one**, Dockerfile/Compose/Traefik, `scripts/deploy.sh` and the
  [one-line installer](../05-operations/one-line-install.md).
- P1's core slice: work items, board/list, comments, labels — kaneo's existing
  capability, rebranded and gated by the policy registry rather than rebuilt.
- UAT environment stood up on real infrastructure (Postgres 18, Valkey 9, SeaweedFS,
  Traefik), seeded with realistic data.
- **Exit:** UAT reachable, sign-in works, a work item can be created and moved on a board,
  every route in the CI-generated OpenAPI document has a passing policy check.

### Weeks 2–4 — parallel build-out to go-live (by Oct 3)

Six workstreams run concurrently from Monday of week 2, each on its own branch, per
[agent-workflow.md](../04-engineering/agent-workflow.md). This is the load-bearing part of
the whole calendar — it is where "four weeks" becomes possible only because the work is
split, not serial.

| Workstream | Scope this window | Ports from |
| --- | --- | --- |
| **A — Service desk domain** | SLA engine, workflow/lifecycle engine ([ADR 0011](../01-architecture/adr/0011-ticket-lifecycle-engine.md)), approvals, assignment rules, service calendars, request types, intake queue | v1's `.NET` domain logic, reimplemented — **the highest-risk stream**, see below |
| **B — Portal & identity** | Portal origin/bundle, core portal screens, better-auth provider presets (OIDC/Entra/Keycloak), MFA/session policy | v1's portal spec (design only — its code is discarded), JSM's permission model |
| **C — Governance / God Mode** | Roles editor, feature flags, plugin registry UI, organisations, branding, terminology overlay ([ADR 0012](../01-architecture/adr/0012-terminology-overlay.md)) | Plane's instance-admin model |
| **D — Reduced insight** | Cycles, tier 1 fixed reports (a working subset, not all fourteen), tier 2 selectable reports | Reduced [P5](phases.md) scope — see deferrals |
| **E — Realtime, notifications, webhooks** | WebSocket fan-out, notification channels, outbound webhooks with signing | P1/P4 scope, pulled forward because the other streams depend on it |
| **F — Security & QA (continuous, cross-cutting)** | Opus security review of every workstream's every merge; negative E2E suites; tenant-isolation fuzzing | Runs across all five other streams, never paused |

**Workstream A is the schedule risk.** Porting the SLA engine, the versioned workflow
engine and approvals from v1's C# to TypeScript, with the exhaustive test coverage
[risks.md](risks.md) (**R3**) already calls for, is genuinely the largest, least
compressible piece of work in the whole plan — it is domain logic with real edge cases
(DST, holidays, pauses, policy versioning), not screen-building. It starts on **day one of
week 2**, gets the most agent-hours of any stream, and is the first thing to escalate if
week 4 is at risk — see [What happens if week 4 looks tight](#what-happens-if-week-4-looks-tight).

**Exit at end of week 4 ("go-live"):** a real customer or internal team can raise a
request, have it triaged, worked through a workflow with SLA tracking, approved where
required, and see it in the portal — administered entirely through God Mode, with no
hardcoded configuration. This is P0–P5 at **reduced but real depth**, not P0–P5 at their
eventual full Definition of Done — see deferrals below for exactly what's thinner.

### Week 5 — production testing (Oct 3 – Oct 10)

No new features. This week is exclusively:

- Load test against the [testing strategy](../04-engineering/testing-strategy.md) targets.
- A full security pass: the negative E2E suite in full, tenant-isolation fuzzing, a
  dependency and container scan, and an Opus-reviewed pass over the whole surface built so
  far — the phase-gate security review from [SDLC](../04-engineering/sdlc.md), run once
  now rather than only at a phase close, because "go-live" is being treated as a real
  phase-gate event.
- A bug bash against the realistic and hostile seed datasets.
- Backup and restore drill — **R12** in [risks.md](risks.md) exists precisely because this
  step gets skipped under deadline pressure; it does not get skipped here.

**Exit:** production traffic is live, monitored, on a tested rollback path.

### Weeks 6–17 — the 3-month window (Oct 10 – Dec 31)

Everything deferred below, plus:

- **P6 — Import and cutover.** Starts here, not before, per
  [phases.md](phases.md)'s own reasoning: importing into a still-settling model wastes the
  work twice, and it did not settle until week 4.
- **P7 — Full polish and hardening**, including the external penetration test, the full
  accessibility audit, i18n beyond `en-US`, and load baselines at realistic multi-tenant
  scale.
- **AWS Marketplace packaging** — [aws-marketplace.md](../05-operations/aws-marketplace.md)
  — seller registration (which has its own lead time) starts as soon as week 6, running
  alongside the engineering work, not after it.
- Requested features, ongoing maintenance, and bug-fixing against real production usage.
- **Paying down every deferral below to its original Definition of Done.**

## What ships at go-live vs. what is deliberately deferred to the 3-month window

This is the explicit register the "keep both documents" decision requires. Nothing in the
left column is silently thinner without appearing here.

| Area | At go-live (end of week 4) | Deferred to weeks 6–17 |
| --- | --- | --- |
| **Reporting** | Tier 1 (a working subset of the fourteen, not all), tier 2 (selectable table reports) | The rest of the fourteen fixed reports; tier 3 customisable report builder; dashboards beyond a sensible default |
| **Agile** | Cycles | Modules, estimates, calendar/timeline views |
| **Time & cost** | Not present | Time entries, rates, budgets — the whole feature |
| **Service management** | Not present | Services, changes, change freezes, releases |
| **Knowledge base** | Not present | Articles, deflection during request creation |
| **Import** | Not present | The entire [P6](phases.md) — Azure DevOps, Plane, Jira, CSV |
| **Accessibility** | Automated gates (axe, zero critical/serious) run in CI as always — **not deferred** | The *manual* full audit and remediation pass across every screen |
| **i18n** | `en-US` only | The other 21 locales kaneo carries |
| **Load testing** | The baseline scenarios in [testing-strategy.md](../04-engineering/testing-strategy.md), run in week 5 | Load testing at realistic multi-tenant production scale over time |
| **Penetration test** | Not performed | External penetration test — **explicitly required before this is handed to a real external paying customer**, see [risks.md](risks.md) **R4** |
| **AWS Marketplace** | Not listed | Full packaging and seller registration |
| **Mobile / portal polish** | Functional, gated by the same UX quality gates as everything else | The dedicated refinement pass |
| **God Mode plugin surface** | Auth, storage, notify plugin kinds live | `ai` and `license` plugin kinds (AWS Marketplace metering, [ADR 0013](../01-architecture/adr/0013-marketplace-metering-plugin.md)) |
| **Collaborative editing, SAML, LDAP, AI features** | Not present | Already "candidates, not commitments" in [roadmap.md](roadmap.md) — unaffected by this plan either way |

**Nothing in the "at go-live" column skips a security gate, a route policy, or a
permission-matrix entry to get there.** Those are full-strength from week 1, per
[What never moves, regardless of the calendar](#what-never-moves-regardless-of-the-calendar).

## What happens if week 4 looks tight

State it now rather than discover it on Oct 2, and state it as a genuine choice rather
than a forced one — per Thomas's own instruction, **the date is the thing allowed to
move**. If workstream A (service desk domain logic) is not ready, there are two honest
options, not one: narrow the go-live scope to P0/P1/reduced-P4 (work management plus
governance, without SLA/workflow/approvals) and keep the date, **or** hold the fuller
scope and let the date move a week or two. Either is a legitimate outcome; what is not
legitimate is declaring the original date *and* the original scope both met when they
were not — that is the specific dishonesty
[product principle 7](../00-overview/product-principles.md) and this whole rebuild exist
to prevent. Escalate to Thomas the moment workstream A looks behind, not at the week-4
deadline, precisely so this choice can be made deliberately rather than discovered late.

## Risk register additions specific to this plan

Beyond the standing risks in [risks.md](risks.md) (**R1–R14**, all still active and now
under more pressure, not less):

| | Risk | Mitigation |
| --- | --- | --- |
| **R15** | Workstream A (domain-logic port) cannot realistically finish by week 4 | Named the schedule's critical path from day one; scope-narrows go-live per the section above rather than shipping untested SLA/workflow logic |
| **R16** | "Go-live" gets treated, informally, as the *final* bar rather than a phase-gate with known deferrals | This document's deferral register is read at week 5's phase gate and again before any external customer is onboarded |
| **R17** | Parallel workstreams on one fast calendar reproduce **R7** (three agents, three inconsistent codebases) faster than usual | Cross-agent review stays mandatory even under deadline pressure; the fixed vocabulary in [coding-standards.md](../04-engineering/coding-standards.md) is enforced by CI, not by review diligence alone |

## Related

- [Phases](phases.md) · [Roadmap](roadmap.md) · [Risks](risks.md) · [Status](status.md)
- [SDLC](../04-engineering/sdlc.md) · [Agent workflow](../04-engineering/agent-workflow.md)
- [Security model](../01-architecture/security-model.md)
