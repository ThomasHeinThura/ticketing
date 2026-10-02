# AGENTS.md

**Canonical guide for anyone — human or AI — working in this repository.** Read this first.
Then read what it points you at.

---

## What this is

**TaskDesk v2** — a self-hostable, multi-tenant service desk and work management platform.

Built on [kaneo](https://github.com/usekaneo/kaneo) (MIT), which was taken **once** as a
foundation and is now ours. There is no upstream relationship. Design inspiration from Plane,
OpenProject and Jira Service Management. Domain knowledge from TaskDesk v1.

Licensed **AGPL-3.0**.

## Read in this order

1. This file.
2. [`docs/04-engineering/agent-workflow.md`](docs/04-engineering/agent-workflow.md) — required
   for every AI agent.
3. [`CLAUDE.md`](CLAUDE.md) — **compatibility filename; now the OpenAI/GPT operating guide**:
   GPT-6 Luna / GPT-6 Sol routing, review independence, sampled Opus 5.5 audit, and how work
   reaches `main`.
4. [`docs/07-planning/status.md`](docs/07-planning/status.md) — **Blocked** first, then the
   newest dated snapshot.
5. [`docs/07-planning/decision-log.md`](docs/07-planning/decision-log.md) — newest entries
   first. Check it before calling anything an open question.
6. Live GitHub — `gh pr list --state open`, `gh issue list --state open`, exact heads,
   reviews, and checks.
7. The feature spec for what you are building, in [`docs/03-features/`](docs/03-features/README.md),
   and any [ADR](docs/01-architecture/adr/README.md) it references.

Full index: [`docs/README.md`](docs/README.md)

**No sentence in this file, or in `CLAUDE.md`, may assert live PR/branch/issue-count/finding
state.** That belongs in `status.md`'s dated snapshot or in GitHub. A durable instruction file
must not become a dashboard.

---

## The five rules

Everything else follows from these.

### 1 · UI/UX uses the shared design system

No bespoke primitives outside `packages/ui`. If a primitive is missing, add it *there*, with
a Storybook story and a test. Never inline one.

### 2 · Nothing is hardcoded per customer

We ship **one image to every customer**. Identity providers, storage, notifications, branding,
features, roles — all runtime configuration in God Mode, stored in the database.

Environment variables are bootstrap-only, registered in
[`docs/05-operations/configuration-reference.md`](docs/05-operations/configuration-reference.md)
and nowhere else. `check:env` enforces it in CI. If you are about to add one, or write
`if (customer === …)`, stop and add a plugin or feature flag instead.

### 3 · Every route declares its permission

A route without a policy entry **fails the build**. `packages/permissions` — the registry,
evaluator and route-coverage gate — is the authority, and `check:route-policy` is a required
status check. This is not ceremony: v1 shipped authorization holes past a green test suite,
and omissions were the recurring class.

### 4 · Every screen has a URL

Filters, tabs, selections, open panels — all URL state. Registered in `lib/routes.ts`, verified
by a round-trip test.

### 5 · Ship narrow and finished

A stage is **claimed** only when it is complete. Work on later stages may proceed in parallel
once the live throttle/dependency graph allows it. What is serial is acceptance, not all
execution.

A slice is not done because an endpoint exists — finish its schema, policy, tests, UI, browser
evidence, audit/event behaviour and integration seam before calling it complete.

A stage's completion also gets its **GPT-6 Sol phase-finalizer pass** before it is claimed done.
The sampled Opus 5.5 big review is additive when selected; it never replaces the Sol
finalizer.

---

## Layout

```text
apps/api      Hono + Drizzle + better-auth. The only backend.
apps/web      React 19 + TanStack. Two entries: agent, portal. One source.
apps/site     The documentation website.

packages/ui                 THE design system. Only source of primitives.
packages/domain             SLA, workflow, approvals, assignment. Pure, no I/O.
packages/permissions        Capabilities, roles, policy registry.
packages/plugins-contracts  Interfaces every plugin implements.
packages/libs               Typed Hono client.
packages/email              Transactional email.
packages/mcp                MCP client surface.

Dockerfile · compose.yml · deploy/ · charts/taskdesk/ · scripts/deploy.sh

tests/        api · api-integration · permissions · e2e · visual
docs/         Read it. It is the memory this project has.
```

Which of these exist **on `main` today** versus only on a branch is live state — check GitHub
and `git log` rather than trusting a static table.

Detail: [`docs/01-architecture/monorepo-layout.md`](docs/01-architecture/monorepo-layout.md)

---

## Commands

The authoritative list of what CI runs is
[`docs/04-engineering/ci-cd.md`](docs/04-engineering/ci-cd.md). Whether a script exists on
`main` today is live state — `pnpm run` lists what is wired in the checkout you have.

```bash
pnpm install
pnpm dev
pnpm dev --filter api
pnpm dev --filter web

pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:permissions
pnpm test:e2e
pnpm test:all

pnpm check:tokens
pnpm check:ui
pnpm check:deps
pnpm check:queries
pnpm check:inventory
pnpm check:reviews
pnpm check:env
pnpm check:vocabulary
pnpm check:skips
pnpm check:route-policy
pnpm check:openapi
pnpm check:organization-callers

pnpm seed minimal | realistic | hostile
scripts/deploy.sh local
```

**When a command fails, the cause decides the response.** An uninstalled tree gets installed.
A genuinely missing not-yet-built script is staged work. A script that should exist on `main`
is investigated rather than bypassed.

---

## Before you say "done"

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm test:integration      # if the API changed
pnpm test:permissions      # if a route changed
pnpm test:e2e -- <scope>   # if the UI changed
docker build .             # if anything that ships in the image changed
```

**And then open the screen and use it.** List every screen opened in the pull request's
`## Screens opened` section: route, viewport, what was clicked, screenshot/evidence. If browser
verification is genuinely unavailable, write `BROWSER VERIFICATION: BLOCKED`, never `n/a`.

**Deployability is not a separate, later concern.** Any change that touches what ships in the
container is not done until the image builds, the container boots and the health endpoint
answers.

Full checklist: [`docs/04-engineering/definition-of-done.md`](docs/04-engineering/definition-of-done.md)

---

## How work reaches `main`, and who may merge

**branch → commit → push → pull request → required independent review → required GPT-6 Sol
security review where applicable → required CI green → merge → refresh `main` → continue.**

Create a branch, commit to it, push, open a pull request that says what you did and what you
did not do.

**The orchestrating session may merge a candidate itself, through the normal protected pull
request flow, once — and only once — every required gate is genuinely green**: applicable tests
pass with expected suite/file counts, required independent review(s) are recorded, the required
GPT-6 Sol security review is recorded where the change is security-scope, and every required
GitHub status check is green on the exact candidate SHA.

This delegation does **not** authorize:

- direct pushes to `main`;
- force-pushing or history rewriting as routine work;
- bypassing branch protection, a required check, a review tier, or a security gate;
- self-review, or calling one's own remediation an independent review;
- a lane/subagent merging — only the top-level orchestrating session merges;
- merging a candidate with a red required check, missing review, unresolved blocker, or stale
  SHA that has not been reviewed at the required tier;
- merging any candidate whose `## Gates` table cites a waived gate without Thomas's own action.

A red required check, missing review, unresolved blocking finding, merge conflict, or
branch-protection refusal means: do not merge that candidate. Work on another runnable lane and
return when the blocker can be resolved.

`main` remains protected by the repository ruleset. Required approving reviews may remain `0`
for the repository at large; `CODEOWNERS` is ownership metadata, not the actual quality gate.
The real gates are the review tiers and required status checks.

`CODEOWNERS` may list control-plane files such as `CLAUDE.md`, `AGENTS.md`,
`docs/04-engineering/agent-workflow.md`, `docs/04-engineering/ci-cd.md`, agent-role files and
`.github/CODEOWNERS` itself as documentation. Do not turn "Require review from Code Owners" on
for the one-collaborator repository merely to create the appearance of protection.

Never:

- fabricate review evidence or mark an independent review `n/a`;
- waive a required gate without Thomas's explicit authorization recorded in the decision log;
- downgrade a required reviewer/model tier because it is unavailable;
- use retired `pal-mcp` / `pal-reviewer` / 9Router as a substitute path;
- leave finished work uncommitted or unpushed on a local machine.

---

## Review tiers

### Bulk implementation and review cadence

Implement multiple related, approved slices and collect/fix known findings in coherent,
substantial batches. Do not open standalone review passes for small or mechanical edits or
speculative trials. Run meaningful tests during implementation so the batch is ready to review
when its scope is complete. Then freeze the final bulk candidate SHA and run its applicable
independent review panel, plus the required GPT-6 Sol security review where applicable,
before the protected merge.

When a review finds issues, fix the findings as a coherent batch, freeze the new candidate,
and review that delta at the tier it requires. Do not add automatic extra rounds for comfort;
the existing risk-based review tiers and exact-head requirements still govern. Tiny urgent
fixes may join the next batch unless the user explicitly asks for isolated delivery. This
cadence never permits an unreviewed merge, self-review, a waived gate, a security-tier
downgrade, or bypassing main's protection.

**Tier by what the change actually risks, not by which directory it sits in.** A security path
makes a change a candidate for heavier review; the actual semantic risk determines the depth.

### Ordinary substantive work

At least **two fresh, independent reviewer contexts**, minimum. Use **three** for broad or
high-coupling work: migrations, API + frontend crossing the same change, concurrency,
cross-package integration, or stage-completion integration — and for CI/security-control
machinery only when the change actually alters authority or gate semantics.

Ordinary review defaults to **GPT-6 Luna**. Each review records:

- exact candidate SHA;
- independence from the author/fixer;
- what was actually checked;
- tests/reproductions actually run where applicable;
- verdict;
- blocking and non-blocking findings.

### Security-sensitive work

After ordinary review clears, a further **independent GPT-6 Sol security review** is required
before merge. Security scope is the path list in `docs/04-engineering/ci-cd.md`.

The reviewer must be a fresh context that did not materially author, direct, or remediate the
candidate.

**Within that scope, size the ordinary-review count to what the change does, not merely where
it lives:**

| The change... | Ordinary review | Security review |
| --- | --- | --- |
| touches a security-scope path but one reviewer can confirm by inspection that it changes no authority or gate pass/fail semantics | **one** fresh GPT-6 Luna | required **lightweight GPT-6 Sol confirmation** |
| is a bounded CI/gate or security-scope fix changing a narrow, well-understood pass/fail case | **one strong GPT-6 Luna** | required **single full GPT-6 Sol pass**; do not stack extra Luna rounds just for comfort |
| touches auth, permissions, migrations, or redesigns a security control's core semantics | **two to three GPT-6 Luna reviewers**, per coupling | required **full independent GPT-6 Sol pass** |
| is a large/high-risk authority redesign — new capability, trust boundary, access-control schema | **full ordinary panel (three)** plus domain-specific review | required **full GPT-6 Sol pass**, and decide whether an ADR is needed first |

**No row exempts a security-scope path from GPT-6 Sol entirely.** The lightest row changes
depth, never whether the review happens.

A test/probe file inside `scripts/ci/**` is not automatically low-risk. Classify it by what its
assertions enforce.

### Phase finalizer — additional GPT-6 Sol pass

At each stage's completion P0–P7, before it is claimed done, run one broader **fresh independent
GPT-6 Sol** red-team pass across everything merged for that stage since the previous finalizer.

The finalizer is additive. It never substitutes for or delays the required GPT-6 Sol review
of a bulk candidate before that candidate merges.
If GPT-6 Sol is unavailable for the finalizer, the stage is not claimed complete.

### Sampled big review — Opus 5.5

Opus 5.5 is retained as **one additional sampled big reviewer**, not as the routine per-PR
gate.

- It runs only when Thomas or the orchestrator selects a random/sample audit target.
- It does **not** replace GPT-6 Sol.
- It does **not** have to review the complete repository or every changed line.
- Before it runs, **GPT-6 Luna or GPT-6 Sol prepares a structured review packet** containing
  exact SHA(s), diff/file list, relevant specs, risk classification, GPT review verdicts,
  tests/counts, residuals, and explicit claims/questions to spot-check.
- Opus 5.5 independently samples that evidence and may choose additional files/tests/claims to
  challenge.
- If a selected pre-merge sample finds a credible blocker, the candidate stops until resolved.
- If a post-merge sample finds a blocker, create the issue/fix immediately under the normal
  process.

Do not wait for Opus 5.5 on every PR. That is not its new role.

### Retired review path

`pal-mcp`, `pal-reviewer`, `9Router`, `coder` failover, and `clink` are no longer part of the
active TaskDesk workflow.

Historical records remain in the append-only decision log and old review notes. Do not use
those historical records as authorization to reactivate the tooling.

### When repeated review keeps finding something: change altitude

A file may need several review rounds when each round finds a **different defect class**. It
should not need unlimited rounds finding narrower examples of the same known class.

After the third round on the same mechanism finds the same class again:

- stop adding another special case;
- decide whether the design needs a structural invariant/helper/redesign;
- add the structural fix and real regression tests;
- then run the review tier the new candidate actually requires.

Once the structural redesign exists and later findings are only narrower versions of the same
class, do not automatically queue another ordinary Luna round. A clean required GPT-6 Sol pass
can close that review tier.

This never relaxes exact-head discipline, real regression tests, or the ban on gate waivers.

---

## Keep moving, without skipping a gate

Process friction is not the same as safety.

- Before opening another review pass, check whether the candidate SHA actually changed.
- If the SHA did not change, the prior verdict still stands.
- If it did change, review the delta at the tier the candidate now requires; security-scope
  candidates still need GPT-6 Sol at the current exact head.
- Do not stop after one merge, one report, or one merge-ready PR.
- A blocked lane blocks that lane, not the program.
- Whole-program stop is reserved for the case where every dependency-safe authorized task is
  exhausted and everything remaining needs a Thomas-only decision, waiver, irreversible
  action, or unavailable external credential.
- Keep `status.md` and `decision-log.md` current whenever something durable changes.

---

## Do not

1. Invent a UI primitive outside `packages/ui`.
2. Write a literal colour or arbitrary spacing value.
3. Add a route without a policy.
4. Add a dependency without asking.
5. Disable, skip or focus a test to make CI pass — **ever**.
6. Waive a quality gate — only Thomas, recorded in the decision log.
7. Approve your own review, or call your own remediation independent.
8. Refactor beyond the task without a concrete dependency reason.
9. Paste code from an unlicensed source.
10. Repeat the same failing approach more than three times without changing the approach.
11. Name a table, column, capability, feature flag, event key or job that is not in its single authoritative document.
12. Delete anything without a **pending action** where the architecture requires it.
13. Invent an MCP permission, SCIM-only tenancy rule, or any path by which identity-provider data grants `instance:admin` or `sees_all`.
14. Keep, flag or "leave for later" an inherited kaneo integration router that the inherited-features register says is deleted at fork.
15. Start building a feature while its owning review section in `docs/07-planning/reviews/2026-09-05/` is non-empty.
16. Commit, push or merge outside the flow above. A report is not approval; the flow is the standing approval.
17. Guess at behaviour. If the spec does not say, stop that decision path and get the answer written into the spec.
18. Claim something works without running it; every screen touched is opened and listed.
19. Spawn a subagent without a concrete bounded deliverable.
20. Let two lanes edit the same file or shared contract concurrently.
21. Reactivate `pal-mcp`, `pal-reviewer`, 9Router, or a retired provider-routing path unless Thomas makes a new explicit decision that supersedes this one.

---

## Licensing

| Source | Licence | What we take |
| --- | --- | --- |
| kaneo | MIT | **Code.** Keep copyright headers |
| Plane | AGPL-3.0 | Ideas. Code is legal but we choose not to |
| OpenProject | GPL-3.0 | Ideas |
| TaskDesk v1 | Ours | Domain logic, reimplemented in TypeScript |

Never paste code from anywhere else without checking the licence and recording it in
`THIRD-PARTY-NOTICES.md`.

**Implementation reads kaneo (the snapshot taken) and TaskDesk v1 (domain logic) only.** Never
mine/copy implementation code from the researched comparison systems. Their lessons belong in
the written research, not copied source.

Detail: [`docs/00-overview/licensing-and-attribution.md`](docs/00-overview/licensing-and-attribution.md)

---

## Where we are

[`docs/07-planning/status.md`](docs/07-planning/status.md) — the durable dated snapshot. Read it
before starting; keep it current when a durable fact changes.

---

## Why the rules feel strict

Most code here is written by AI agents with no reliable memory between sessions, and v1 failed
for reasons discipline alone did not prevent.

Given a fixed vocabulary and a build that rejects invention, multiple agents can still produce
one coherent product. Given freedom to invent silently, they cannot.

The constraints are not distrust. They are what make one human plus several agents able to ship
one coherent system.
