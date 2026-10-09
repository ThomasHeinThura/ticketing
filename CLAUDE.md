# CLAUDE.md

OpenAI-first operating guide for GPT agents working in this repository.

> **Compatibility filename.** This file keeps the historical name `CLAUDE.md` so existing
> links, CI comments, CODEOWNERS entries and repository references do not break during the
> model-provider migration. Its operative instructions are now for **OpenAI GPT agents**.
> A future rename to `OPENAI.md` is a separate control-plane change, not part of this model
> routing decision.

[`AGENTS.md`](AGENTS.md) is canonical and applies to every agent, human or otherwise. Read it.
This file does not repeat it — it holds the OpenAI-specific model routing, subagent patterns,
review handoffs, and the repository lessons that would otherwise be relearned each session.

This file deliberately contains **no live PR list, live SHA, issue count, or current stage
count**. Refresh those from GitHub every session.

---

## Before anything else

Read, in this order, every session:

1. [`AGENTS.md`](AGENTS.md) — the five rules and the standing do-nots.
2. [`docs/04-engineering/agent-workflow.md`](docs/04-engineering/agent-workflow.md) — the
   repository-wide agent workflow.
3. The [integration queue](docs/07-planning/integration-execution-queue.md), then
   [`docs/07-planning/status.md`](docs/07-planning/status.md) — **Blocked** first, then the
   newest dated snapshot.
4. [`docs/07-planning/decision-log.md`](docs/07-planning/decision-log.md) — newest entries
   first. **Check it before calling anything an open question.**
5. Live GitHub — `gh pr list --state open`, `gh issue list --state open`, the exact head of
   whatever you are about to touch, its review state, and its checks.
6. The feature spec for the work, plus every ADR or authoritative contract it cites.

**Do not act on a remembered SHA or a remembered PR list from an earlier conversation.**
Re-check. This repository moves too quickly for conversational memory to be authoritative.

---

## Mission, and what "done for now" means

The current authorized objective is **Integration Freeze and SIT Consolidation**, governed by
[AGENTS.md § Authority and Integration Freeze Mode](AGENTS.md#authority-and-integration-freeze-mode).
Continue the existing [integration queue](docs/07-planning/integration-execution-queue.md)
for owner-authorized work according to each task's actual dependencies, including while the
control-plane PR is pending. Only actions that require authority introduced by that PR wait
for its acceptance. Integrate existing functionality and acceptance fixes; freeze new
feature scope. Do not automatically complete P4 or claim P0–P7 closure. After final integrated
SIT acceptance and audit, stop and await the next owner roadmap.

Calendar pressure changes urgency, not gates. A gate that closes a real defect does not become
thinner because a date is near.

Do not stop at one merged PR, one merge-ready PR, one review report, one blocked lane, one
provider failure, or a context refresh. See `AGENTS.md` → **Keep moving, without skipping a
gate**.

---

## Establishing current truth

**Do not maintain a live-state narrative in this file.** GitHub and the newest dated
`status.md` snapshot are the live sources.

To establish truth now:

1. Read the newest `status.md` snapshot and its Blocked section.
2. Read the stage/retrofit ledger that governs the work.
3. Run `gh pr list --state open` and `gh issue list --state open`.
4. For a candidate, run `gh pr view <n> --json headRefName,headRefOid,mergeable,reviewDecision,statusCheckRollup`.
5. Compare the exact candidate head with every recorded review head before merging.

If `status.md` and GitHub disagree, GitHub is newer. Correct `status.md`; do not silently work
around the discrepancy.

---

## How work reaches `main`, and who may merge

`AGENTS.md`'s flow is unchanged:

**branch → commit → push → pull request → required independent review → required GPT-6 Sol
security review where applicable → required CI green → merge → refresh `main` → continue.**

The top-level orchestrating GPT session may merge a fully-green candidate through the normal
protected pull-request flow once every required gate is genuinely satisfied on the **exact
candidate SHA**. Lane/subagent contexts never merge.

Before merging, verify directly:

- the candidate SHA is the SHA actually reviewed;
- applicable tests are green with the expected suite/file counts;
- required independent review(s) are recorded at that SHA;
- required GPT-6 Sol security review is recorded at that SHA for security-scope changes;
- every required GitHub status check is green;
- branch protection permits the merge without bypass;
- the `## Gates` table cites no waived gate.

If any item is false, do not merge. Record what is missing, then continue other runnable work.

---

# Model routing

## The migration rule

From this decision forward:

- every role previously assigned to **Claude Sonnet** is assigned to **GPT-6 Luna**;
- every required role previously assigned to **Claude Opus / Opus 5.5** as a merge gate or
  stage-completion gate is assigned to **GPT-6 Sol**;
- **Opus 5.5 remains available only as one independent sampled "big reviewer"**, described
  below. It is not the per-PR security gate and not the phase finalizer;
- `pal-mcp`, `pal-reviewer`, `9Router`, and their provider failover chain are **retired from
  the active TaskDesk workflow**. Do not use them for reading, implementation, review,
  reporting, alignment, or security clearance.

Historical review records remain historical truth. Do not rewrite old PRs, old security-review
notes, or old decision-log entries merely because the current model policy changed.

## Active model tiers

| Work | Required model / context |
| --- | --- |
| Implementation against an approved or explicitly user-authorized documented recommendation | **GPT-6 Luna**, explicitly selected |
| Small mechanical implementation / tests | **GPT-6 Luna** |
| Bulk repository reading and context preparation | **GPT-6 Luna** by default; **GPT-6 Sol** when the reasoning is security/architecture-heavy |
| Ordinary review — bugs, tests, code quality | fresh independent **GPT-6 Luna** context(s) |
| Architecture / project-alignment review | fresh **GPT-6 Luna** for bounded work; **GPT-6 Sol** for broad/high-risk design changes |
| Security-scope final review | **GPT-6 Sol**, fresh independent exact-head context, mandatory |
| Critical cross-boundary review | **GPT-6 Sol** |
| Phase finalizer P0–P7 | **GPT-6 Sol**, fresh independent context, additive to per-PR reviews |
| Orchestration / planning / synthesis | top-level GPT session; prefer **GPT-6 Sol** for broad governance/security work |
| Random sampled "big reviewer" | **Opus 5.5**, only from a GPT-prepared review packet; optional sampling, never a replacement for GPT-6 Sol |

Every model/context used for a review is named explicitly in the PR or review note. Never rely
on an inherited/default model label.

## Bulk implementation and review cadence

Follow the canonical rule in [`AGENTS.md`](AGENTS.md#bulk-implementation-and-review-cadence):
complete the related existing-slice integration/acceptance repairs within the current freeze
against approved or explicitly user-authorized documented contracts, then review the bulk candidate at
its required independent Luna/Sol tiers before merge. Human spec/design/H1 review is deferred
until the integrated P4 review; record the deferral and never claim unperformed approval.
Map and fix applicable known findings in that implementation batch while preserving historical
review text; independent reviewers verify the evidence and record disposition before merge or
phase claim. Do not self-close findings, bypass unresolved behavior decisions, or treat them as
waived.
Do not open standalone review passes for small/mechanical edits or speculative trials. Fix
findings as a batch and review the changed candidate at the applicable tier, with no automatic
comfort rounds. Reviewer counts, exact-head discipline, security scope, stage finalizers,
required checks, and protected-merge rules remain in force.

---

## GPT-6 Luna — implementation and ordinary review

GPT-6 Luna inherits the work previously assigned to Sonnet:

- implement code/tests against an approved or explicitly user-authorized documented
  recommendation, without guessing behavior the contract leaves open;
- prepare bounded context;
- perform ordinary correctness/test/quality review in a fresh context;
- perform project-alignment review for ordinary changes;
- prepare evidence packets for GPT-6 Sol or Opus 5.5;
- remediate findings when assigned as the fixer.

Ordinary substantive work still requires the reviewer count in `AGENTS.md`:

- at least **two fresh independent reviewer contexts** for ordinary substantive work;
- **three** for broad/high-coupling work when the review-tier table calls for it;
- one strong ordinary reviewer for the bounded cases explicitly allowed by the table.

A GPT-6 Luna context that materially authored, directed, or remediated the change is not an
independent reviewer of that same change. The model name may be the same; the context and role
must be independent.

---

## GPT-6 Sol — mandatory security / critical gate

GPT-6 Sol inherits every mandatory gate role previously assigned to Opus.

For every security-scope PR, after the required ordinary review clears, run a fresh independent
GPT-6 Sol review on the **exact candidate SHA**.

The security-scope path list remains authoritative in
[`docs/04-engineering/ci-cd.md`](docs/04-engineering/ci-cd.md): authentication and permissions
code, migrations, CI/gate machinery, and the dependency graph, plus any other paths that file
currently declares.

The reviewer must not have materially authored, directed, or remediated the candidate.

The review records:

- exact candidate SHA;
- merge base or comparison base;
- files/surfaces examined;
- tests or reproductions actually run;
- findings with blocking/non-blocking classification;
- residual risk / what was not checked;
- verdict;
- `**Reviewed head:** <40-character-sha>` in the committed review note.

**No security-scope row is exempt from GPT-6 Sol.** The depth may be lightweight for a truly
mechanical non-semantic change, but the required independent Sol confirmation still happens.

If GPT-6 Sol is unavailable, the candidate waits and is marked:

**SECURITY RE-REVIEW PENDING — GPT-6 SOL CAPACITY**

Do not downgrade to Luna, Opus 5.5, or any other model to make the merge happen.

---

## Phase finalizer — GPT-6 Sol, additive

At each stage completion P0–P7, before the stage is claimed done, run one broader fresh
independent GPT-6 Sol red-team pass across everything merged for that stage since the previous
finalizer.

The phase finalizer:

- does not replace per-PR GPT-6 Sol security reviews;
- does not batch or postpone per-PR security work;
- exists to catch cross-PR interactions that an individual review could not see;
- must be independent from the contexts that orchestrated or merged the stage's PRs;
- blocks the stage claim if unavailable or if a blocking finding remains unresolved.

If the phase finalizer discovers a defect that a per-PR gate should have caught, treat that as
a finding about the per-PR process too. Do not respond by weakening the per-PR gate and relying
more heavily on the finalizer.

---

# Opus 5.5 — sampled big reviewer, not the merge gate

TaskDesk keeps **one Opus 5.5 big-review role** as an additional random/sample audit.

It is deliberately **not a full review of every PR** and **not a required per-PR merge gate**.
Its purpose is to challenge the GPT review system itself by sampling claims, code, evidence,
and recurring defect classes from a fresh outside context.

## When it runs

There is no fixed per-PR cadence. Thomas or the orchestrating session may select a candidate,
a recently merged batch, a defect class, or a stage slice for a sampled Opus 5.5 check.

Do not delay every PR waiting for Opus 5.5. That would recreate the old process under a new
name.

When a sample is selected, however, its findings are real:

- before merge: a credible blocking finding blocks the candidate until resolved and rechecked;
- after merge: file/assign the finding immediately and remediate under the normal workflow;
- a clean Opus sample never substitutes for a required GPT-6 Sol review.

## Opus 5.5 receives a GPT report, not an unstructured dump

Before invoking Opus 5.5, **GPT-6 Luna or GPT-6 Sol must prepare a review packet**. Opus 5.5
must not be asked to reconstruct the whole repository state from scratch as its normal mode.

The packet contains, at minimum:

1. PR / issue / stage and exact SHA(s).
2. What changed and why.
3. Exact changed-file list and the highest-risk files.
4. Relevant spec/ADR/rules in scope.
5. Risk classification and why that tier was chosen.
6. Ordinary GPT-6 Luna review verdicts and unresolved findings.
7. GPT-6 Sol security-review verdict if the work is security-scope.
8. Tests actually run, including suite/file/test counts and notable negative tests.
9. Known residuals, waivers, exceptions, and `## Not done` items.
10. Any recurring defect class or architectural invariant the reviewer should challenge.
11. Explicit sample questions: what claims should Opus spot-check?

Opus 5.5 then samples the packet against the real referenced code/evidence. It may choose its
own random files, tests, or claims from that packet. It is not constrained to agree with the
GPT conclusions.

The packet author and the Opus reviewer are separate roles. Opus 5.5 does not prepare the
packet it is judging.

---

## Retired tooling: `pal-mcp`, `pal-reviewer`, 9Router

The earlier `pal-mcp` ordinary-review/audit/reporting route is superseded.

Going forward:

- do not call `pal-mcp` for any TaskDesk work;
- do not use `.claude/agents/pal-reviewer.md` as an active agent role;
- do not use `9Router` or its Gemini/DeepSeek/GLM failover chain as TaskDesk reviewer or
  implementer routing;
- do not use `clink` through `pal-mcp`;
- do not count any historical `pal-mcp` confidence/verdict as current-model evidence for a new
  candidate head.

Historical decision-log entries and review records about `pal-mcp` stay intact because the
decision log is append-only. The new decision supersedes their operative effect; it does not
erase history.

---

## Review-round discipline

When repeated review keeps finding narrower instances of the same already-identified defect
class, stop patching individual examples and change altitude.

After the third round on the same mechanism finds the same class again:

- ask whether a structural invariant/helper/redesign is required;
- add the structural guard when appropriate;
- add non-vacuous regression tests;
- then use the review tier the resulting candidate actually requires.

Once the structural fix is in place and the remaining changes are only narrower instances of
the same class, do not stack more Luna rounds merely for comfort. The required GPT-6 Sol pass
closes the security tier if it is clean.

This changes review count, not rigor: exact-head discipline, real regression tests, and the
ban on waiving gates remain unchanged.

---

## Using parallel GPT agents here

Parallel work is useful only when it is bounded.

- Give every agent an exact branch/head or exact files, exact question, and expected output.
- Partition editing work by file/shared contract. Two lanes never edit the same shared
  contract concurrently.
- Implementation lanes default to GPT-6 Luna.
- Ordinary reviewer lanes use fresh GPT-6 Luna contexts.
- Security/critical review uses a fresh GPT-6 Sol context.
- A sampled Opus 5.5 audit only starts after a GPT review packet exists.
- Have long-running reviewers write findings incrementally.
- Read large files in ranges rather than dumping entire trees unnecessarily.
- Re-verify reviewer claims against actual source before acting on them.

A blocked lane blocks that lane, not the whole program.

---

## Deployment status is part of the routine, not a separate track

Do not store today's deployment state in this file. Check `status.md`, the deployment runbook,
GitHub, and the live environment each session.

For any change that affects what ships in the image:

- build the image;
- boot the container;
- verify health endpoints;
- run the applicable deployment/config validation;
- after merge, deliver the immutable GHCR/GitHub Releases artifact to SIT when the change
  affects deployability and verify the affected public paths; no Docker Hub or production
  deployment is authorized by this mission.

A passing unit suite does not excuse a broken image or deployment.

---

## The control plane, and who owns it

The orchestrator owns the central control-plane surfaces:

`AGENTS.md` · `CLAUDE.md` · `docs/04-engineering/agent-workflow.md` ·
`docs/04-engineering/ci-cd.md` · `docs/07-planning/status.md` ·
`docs/07-planning/decision-log.md` · `.github/CODEOWNERS` · active agent-role files ·
GitHub issue status · GitHub Project board status.

Lane/background agents treat these as read-only unless their task explicitly grants ownership
of a named control-plane change.

When sources disagree, use this order:

**explicit current project-owner decisions and recorded approvals → `AGENTS.md` →
`CLAUDE.md` (routing/independence) → `agent-workflow.md` and SDLC procedures → current
integration execution queue (task state only).**

Record new owner directives in the decision log without rewriting history. Approved specs
and ADRs govern product behaviour; a queue, issue, PR body or dated snapshot cannot override
policy, contracts or acceptance gates. A current explicit owner directive is not demoted
because it arrived in chat.

A lower source never silently overrides a higher one.

`status.md` is a dated durable snapshot, not a permanent live dashboard. Update it when a
durable fact changes.

The decision log is **append-only**. A new decision names what it supersedes and why; old
entries are not rewritten.

---

## Parallel preparation within Integration Freeze

Use dependency-safe lanes only for existing functionality, integration and acceptance fixes
listed in the durable queue. The throttle does not authorize new P1–P7 feature scope.
Inventory existing branch sources, establish dependencies, compose authorized slices and
prepare real runtime evidence. A shared contract gets its own bounded PR; never let two lanes
edit it concurrently. Product decisions and formal phase closure retain their own gates.

The owner-designated conductor alone owns the global queue, dependency graph, shared test
windows/resources, merge order, release coordination and existing continuation/scheduler.
Lanes own only their bounded deliverable and handoff; they do not create or retarget a global
continuation, update the integration branch, or allocate shared migrations/resources. Do not
repeat volatile PR/check statistics in this durable routing guide; keep task state in the
conductor's queue and dated status snapshot.

For failed checks, use the actual evidence to distinguish product defects, test/fixture defects,
environment/invocation defects, review/PR metadata defects and unexplained timing variation.
Choose a remedy at the layer the diagnosis supports. Do not alter correct product source merely
to trigger CI or repeat unchanged acceptance runs until they pass. The approved retry policy
still applies; when it blocks a justified action, request one precise owner decision. Repeated
failures on one mechanism follow the cross-session, version-independent whole-entrypoint
diagnosis in [error-fix-loop.md](docs/04-engineering/error-fix-loop.md#the-three-attempt-rule).

---

## Verify against source, never memory

The repository's most valuable findings come from opening the actual code, lockfile, CI run,
database, and deployment rather than trusting summaries.

Use targeted reads and live verification. Do not turn an old report into current truth merely
because it sounds precise.

---

## Environment specifics on this host

- If `node` is not on the default `PATH`, use the host's configured Node path or package-local
  binaries.
- Integration tests require a **private `*_test` Postgres database per concurrent lane**. The
  harness resets tables; shared lane databases create false failures and cross-test damage.
- The host may run unrelated containers. Keep test load bounded.

---

## Vocabulary authority

Four words remain deliberately distinct:

| Word | Means |
| --- | --- |
| **Stage** (P0–P7) | A level of product capability with exit criteria |
| **Workstream** | A lane executing against those criteria; several may run at once |
| **Step** | One pass of the feature SDLC |
| **State** | Where a single work item sits in its lifecycle |

Authoritative identifier homes remain:

| Identifier | Authority |
| --- | --- |
| Tables and columns | `docs/01-architecture/data-model.md` |
| Capabilities / policy kinds | `docs/01-architecture/rbac.md` |
| Feature flags / plugin kinds | `docs/01-architecture/plugin-architecture.md` |
| Event keys | `docs/01-architecture/events.md` |
| Background jobs | `docs/01-architecture/background-jobs.md` |
| Environment variables | `docs/05-operations/configuration-reference.md` |
| Rule-id prefixes | `docs/03-features/README.md` |

---

## Reporting to Thomas

- Use plain language and short sentences.
- Label each item as: **question Thomas must answer**, **decision Thomas must make**,
  **decision the orchestrator made** (with reversal path), or **explanation**.
- Never reopen a settled item as if it were undecided.
- Say what was not done.
- A status report is a checkpoint, not a stopping point.
- State what merged, what is current on `main`, what is merge-ready, what was tested, what was
  reviewed by Luna/Sol, any sampled Opus 5.5 result, new findings, and blockers.
- If only Thomas can decide a real architecture/risk/waiver question, ask once with concrete
  options. Do not guess and redo it later.

---

## The failure this project exists to avoid

TaskDesk v1 shipped authorization defects past a green suite and too many partly-finished
screens. The response is not more ceremony for its own sake; it is executable constraints:
policy coverage, exact-head review, tests for defect classes, explicit decisions, and stages
claimed only when complete.

**Every rule that closes a code defect gets a test. Every rule that closes a process defect
gets a durable instruction or machine gate.**
