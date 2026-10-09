# Agent workflow

TaskDesk work is coordinated by **Thomas and AI agents**. This document describes how they
work without producing incompatible codebases.

> **Read canonical [AGENTS.md](../../AGENTS.md) first, then `CLAUDE.md` for routing, this workflow, then
> [SDLC](sdlc.md), then [coding standards](coding-standards.md), then the feature spec.**

---

## Roles

| | Thomas | Agents |
| --- | --- | --- |
| Decides scope and priority | ✅ | ❌ |
| Writes and approves specs | ✅ final integrated human review at P4 | ✅ drafts and implements against authorized documented contracts |
| Writes ADRs | ✅ approves | ✅ drafts |
| Implements | occasionally | ✅ mostly |
| Writes tests | | ✅ |
| Reviews | ✅ final say | ✅ first pass |
| Human design review (H1–H6) | ✅ at integrated P4 review | ❌ |
| Waives a quality gate | ✅ only | ❌ |
| Merges to `main` | ✅ | ✅ — the orchestrating session, once every required gate is genuinely green (Thomas, 2026-09-15). Lane/subagents: ❌, always |
| Deploys to production | ✅ | ❌ |

Two of these are absolute: **an agent may never approve its own design review, and an
agent may never waive a quality gate.** Those are the two controls that stop the v1
failure mode from returning through a different door.

---

## Why the constraints in this repository exist

Most of the mechanical rules in these documents exist *because* most code here is written
by agents:

| Rule | What it prevents |
| --- | --- |
| No primitives outside `packages/ui` | Three agents inventing three button components |
| Tokens only, no literal colours | Plausible-looking but inconsistent styling |
| Every route declares a policy, CI-enforced | An agent adding an endpoint and forgetting the check |
| Route registry with a round-trip test | A screen that exists but has no address |
| Storybook required per primitive | Undiscoverable components, re-invented next week |
| Visual regression snapshots | Silent drift across many small changes |
| Spec before build | Agents producing something plausible and wrong |

Given a fixed vocabulary and a build that rejects invention, agent output is remarkably
consistent. Given freedom, it is remarkably inconsistent. Constrain accordingly.

---

## Dividing work between three agents

**One agent per feature branch.** Never two agents on one branch — they will each rewrite
the other's work and neither will notice.

Suggested specialisation, though any agent can do any of it:

| Agent | Suits |
| --- | --- |
| GPT-6 Luna | Implementation and ordinary review, following the model policy below |
| Copilot (in VS Code) | Work needing workspace context, iterating with Thomas watching, UI |
| OpenAI agent | Research, spec drafting, migration mapping, documentation |

Parallelise across **independent** areas — for example: API for feature A, UI for feature
B, tests for feature C. Do not parallelise across a shared file.

---

## Model policy

Apply these model assignments to every implementation and bulk candidate, regardless of which
agent or tool orchestrates the work:

| Work | Model | Requirements |
| --- | --- | --- |
| Implementation and tests against an approved or explicitly user-authorized documented recommendation | **GPT-6 Luna** | Keep work inside the written contract, surface unresolved behavior rather than guessing, and report what was run. |
| Ordinary independent review | **GPT-6 Luna** | Use fresh reviewer contexts and the review count required by [AGENTS.md § Review tiers](../../AGENTS.md#review-tiers): at least two for ordinary substantive work, three for broad or high-coupling work, and the stated security-scope exceptions. Review the exact candidate SHA. |
| Security review for a candidate touching the security-scope paths in [ci-cd.md](ci-cd.md#pull-request-pipeline) | **GPT-6 Sol** | Required independently after ordinary review clears. The reviewer must not have materially authored, directed, or remediated the candidate. Review the exact candidate SHA. |
| Phase finalizer for P0–P7 | **GPT-6 Sol** | Required as an additional fresh independent pass before a stage is claimed complete. Cover everything merged for that stage since the prior finalizer. |
| Sampled big review | **Opus 5.5** | Runs only when Thomas or the orchestrator selects a sample. GPT-6 Luna or GPT-6 Sol first prepares a structured packet; Opus samples that evidence and may inspect additional files, tests, or claims. This is additive and never replaces a required review. |

Implement related approved slices and known-finding fixes in substantial batches; do not start
standalone reviews for small/mechanical edits or speculative trials. Run meaningful tests as
implementation proceeds, then freeze the bulk candidate SHA and apply the independent review
panel and any required Sol review before merge. Fix findings together and review the resulting
delta at its required tier without automatic comfort rounds. Tiny urgent fixes may join the
next batch unless the user explicitly requests isolated delivery. The detailed canonical rule
is in [AGENTS.md § Bulk implementation and review cadence](../../AGENTS.md#bulk-implementation-and-review-cadence).
Keep the review ledger's historical wording intact: the implementation author maps and fixes
applicable known findings, while independent reviewers verify evidence and record disposition.
Do not self-close a ledger row. A behavior decision absent from the authorized contract remains
a blocker for that decision path.

Within the current freeze, complete related existing-functionality integration fixes before
their integrated review; earlier full-feature instructions grant no new scope. For P0–P3, do not
block implementation on Thomas's spec read or H1–H6 review. Documented recommendations
explicitly authorized by the user, including #573, are implementation contracts. Record human
spec/design/H1 review as deferred until the integrated P4 review; never imply it has happened.
This deferral changes human-review timing only. Automated gates, independent Luna/Sol review,
exact-head requirements, stage finalizers, CI, and protected merge remain in force.

The ordinary reviewer count is sized by semantic risk and coupling, not merely by a path's
location. Keep the exact-head rule: a changed candidate requires review of its current SHA.
The security review remains mandatory for every candidate in the scope listed in
[ci-cd.md](ci-cd.md#pull-request-pipeline), with the depth and number of ordinary reviews
specified by [AGENTS.md § Review tiers](../../AGENTS.md#review-tiers). If GPT-6 Sol is
unavailable, the candidate waits for that review; do not substitute Opus 5.5 or another
model. Opus 5.5 is a sampled reviewer only, after the GPT review packet exists.

The sampled-review packet records exact SHA(s), the diff and file list, relevant specs, risk
classification, applicable GPT-6 Luna and GPT-6 Sol verdicts, tests and counts, residuals,
and explicit claims or questions to spot-check. A credible blocker from a selected pre-merge
sample stops the candidate until it is resolved. A post-merge sample blocker gets an issue
and a fix under the normal process.

Do not use `pal-mcp`, `pal-reviewer`, 9Router, its `coder` route, Gemini, DeepSeek, or GLM
for implementation, review, audit, or approval. These routes and providers are retired for
TaskDesk work. Historical decision-log entries retain their original record of earlier
policy and evidence; they do not authorize current use.

No reviewer may approve its own work or waive a quality gate. An unavailable required
reviewer means wait for capacity, not downgrade the tier. Record the exact reviewer, model,
scope, candidate SHA, checks actually performed, verdict, and findings in the review record.

---

## The context problem

An agent starting a task has no memory of yesterday. Everything it needs must be
discoverable from the repository.

**Before starting any task, read, in order:**

1. `AGENTS.md` at the repository root
2. This document
3. [SDLC](sdlc.md) — the step you are at
4. [Coding standards](coding-standards.md)
5. The feature spec in [03-features](../03-features/README.md)
6. Any [ADR](../01-architecture/adr/README.md) the spec references
7. The existing code in the area you are changing

**Do not** infer conventions from a single file. Read three or four in the same area
first. One file may itself be wrong.

---

## Task handoff format

When Thomas assigns work, or an agent hands off, use this:

```markdown
## Task
One sentence.

## Stage
Which SDLC step this starts at.

## Spec
Path to the feature spec. Which numbered rules are in scope.

## Files likely involved
Paths. Not exhaustive — a starting point.

## Definition of done
Copied from definition-of-done.md, trimmed to what applies.

## Constraints
Anything unusual. "Do not touch the schema." "This must not break X."

## Out of scope
What NOT to do. This matters more than it sounds — agents expand scope helpfully.
```

---

## Rules for agents

### Do

1. **Read the spec before writing code.** An unresolved question blocks its dependent scope.
   Record the decision needed and continue unrelated authorized integration tasks.
2. **Follow the existing pattern.** Feature folders, fetchers, query hooks — the shape is
   already decided.
3. **Write tests as you go**, citing spec rule numbers in test names.
4. **Run the checks yourself** before declaring done: `pnpm lint && pnpm typecheck &&
   pnpm test`.
5. **Update the spec** if implementation proved it wrong.
6. **Say what you did not do.** An honest "I did not implement the bulk path" is far more
   useful than silence.
7. **Escalate the blocked scope when needed.** After repeated failure, pause iterations on
   that mechanism and establish root cause plus a complete real-invocation-path regression
   before another runner iteration — see [error fix loop](error-fix-loop.md).

### Do not

The authoritative list is [AGENTS.md § Do not](../../AGENTS.md#do-not) — including
do-not 16 (commit, push or merge only through the agreed flow: branch → commit →
push → pull request → required review(s) → merge, with the orchestrating session merging
once every gate is green). The items below are the ones most often broken in practice; if
the two ever disagree, AGENTS.md wins.

1. **Do not invent UI primitives.** `packages/ui` or nothing.
2. **Do not add a dependency** without asking. It needs a decision log entry.
3. **Do not disable a test** to make a build pass. Ever.
4. **Do not waive a quality gate.** Only Thomas.
5. **Do not approve your own design review.**
6. **Do not refactor beyond the task.** A pull request that fixes a bug and also
   reorganises four files is unreviewable.
7. **Do not paste code from an unlicensed source.** See
   [licensing](../00-overview/licensing-and-attribution.md).
8. **Do not guess at behaviour.** If the spec does not say, ask, and then write it down.
9. **Do not claim something works without running it.** v1's handover was blunt about
   this: *"verify before you believe."*

---

## Verification is not optional

The single most common agent failure is **declaring success without checking**. v1's
retrospective recorded that four of its worst defects were invisible to a green test
suite, and that the only reliable path was to run things.

Before any "done":

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration       # if the API changed
pnpm test:permissions       # if a route was added or changed
pnpm --filter @taskdesk/web exec playwright test --config playwright.config.ts <exact-spec-path> # UI scope
```

And then **actually open the screen** and use it. Automated checks are necessary and not
sufficient.

For scoped web checks, invoke the runner directly with `pnpm --filter @taskdesk/web exec`: use `vitest run <exact-test-paths>` for unit tests and the Playwright command above for browser tests. An extra `--` passed through a package-script wrapper can select the whole suite; verify the selected file count before attributing results. This changes invocation guidance, not required gate coverage.

For long local suites, retain the complete output in a private evidence file before
summarizing file/test counts. Tool-output truncation is not a reason to repeat an entire
suite. Recover its retained report or failed-result cache; rerun only the unresolved failed
files to diagnose them. After the complete remediation batch, run the verification required
by its actual risk and the protected CI gates. Never weaken assertions or omit a required
gate to reduce round trips.

---

## Skills

`skills/` carries two agent skills kept from kaneo's ten (the other eight are read-once
references, not copied — [inherited-features.md](../01-architecture/inherited-features.md))
and five we write in P0 — the
review found the first draft listed all seven as inherited, which hid the work:

| Skill | Origin | Use for |
| --- | --- | --- |
| `improve-animations` | kaneo | Apply the motion specs |
| `find-animation-opportunities` | kaneo | Identify where motion would explain something |
| `add-route` | **ours, P0** | Add an API route with its policy (one of the five kinds), schemas, repository call and tests — the mechanism by which the policy-registry rule reaches agent output |
| `add-primitive` | **ours, P0** | Add a `packages/ui` primitive with story, keyboard and axe tests |
| `review-ui` | **ours, P0** | Check a screen against the design system and the quality gates |
| `write-feature-spec` | **ours, P0** | Draft a spec in the house format, with every mandatory section |
| `port-domain-logic` | **ours, P2** | Reimplement v1 domain logic in TypeScript from its tests |

Prefer a skill over freehand work — it encodes decisions already made.

---

## Sessions and memory

- Agent memory does not persist. **The repository is the memory.**
- Anything worth remembering goes into a document, not into a chat.
- At the end of a session, update [status.md](../07-planning/status.md) with where things
  stand and what is blocked.
- Long-running context goes in the pull request description, not in the conversation.
- Commit and push completed authorized work to feature/integration branches under the standing
  [AGENTS.md PR flow](../../AGENTS.md#how-work-reaches-main-and-who-may-merge), without repeated
  owner approval. Only the top-level orchestrator may perform a protected merge after all gates.
- Preserve the [integration queue](../07-planning/integration-execution-queue.md) before ending:
  task state, exact branch/head, evidence, unresolved blockers, next actionable task and resume
  command or procedure. Update the dated status snapshot when durable facts change.
- Use an available thread continuation/heartbeat mechanism to resume this authorized mission
  from the queue if work remains. Inspect existing continuations before creating one, avoid
  duplicates, and save the continuation identity and scope in the handoff. Stay quiet while
  blocked state is unchanged; notify on meaningful progress, failure or required owner action.
  A continuation must obey the same gates and stop after final SIT acceptance and audit.
- If continuation is unavailable, state that limitation and leave the explicit resume task.
  Never imply that an ended session continues by itself. A report is a checkpoint, not a
  substitute for committing, pushing, preserving state or arranging continuation.
- Public review artifacts should identify public test vectors descriptively rather than
  embedding credential-shaped fixture URIs. If redaction is needed, label it transparently,
  preserve the unredacted original in private evidence, and retain the finding's substance.

---

## Review

Every pull request, including this explicitly requested focused control-plane PR, gets:

1. **Independent ordinary review** — a fresh GPT-6 Luna context, not the one that wrote it.
   Use the required reviewer count for the change's risk and coupling
   ([AGENTS.md § Review tiers](../../AGENTS.md#review-tiers)). A security-scope candidate
   also requires the separate, mandatory GPT-6 Sol review below.
2. **Automated gates** — everything in CI.
3. **The required security review**, GPT-6 Sol, when the change is in security scope.
4. **Merge**, through the normal protected pull-request flow, by the orchestrating session
   once every one of the above is genuinely green on the exact candidate SHA
   (Thomas, 2026-09-15 — delegated; supersedes "only Thomas merges"). Thomas retains sole
   authority over design approval (H1–H6) and gate waivers; P0–P3 timing is deferred to the
   integrated P4 review as stated above.

`main` enforces as much of this as a machine can. The `protect-main` ruleset requires a
pull request, blocks deletion and non-fast-forward pushes, dismisses stale approvals on
push, and requires its status checks with zero bypass actors. For the repository at large it
does **not** require an approving review: **required approving reviews is `0`, and Require
review from Code Owners is off** ([ci-cd.md](ci-cd.md#branching), decision log 2026-09-06) —
deliberately, because a required approval from a one-person team documents a gate rather than
providing one. `CODEOWNERS` lists only the control-plane files themselves — not `*` — so this
holds for ordinary code exactly as before. It also lists those paths (`CLAUDE.md`,
`AGENTS.md`, this file, `ci-cd.md`, `.claude/agents/**`, `.github/CODEOWNERS` itself) as a
documentation signal, not a gate: a 2026-09-26 attempt to enable "Require review from Code
Owners" for them was reversed the same day, because this repo's single collaborator and
shared agent credentials mean there is no real identity boundary for GitHub to enforce — see
the decision log. **Do not re-attempt it, and never add a bypass actor to route around the
deadlock it would create.** The control that actually stops a bad merge in ordinary code is
steps 1–3 above plus the required status checks, not an approval count and not a single
person holding the button.

An agent reviewing its own work is worth very little; the same context that produced the
mistake will not see it.

---

## Task-level and orchestrator-level stopping

Pause only the dependent task when a product contract is ambiguous, an unapproved schema or
scope decision is required, an ADR conflicts, a required gate/reviewer is unavailable, or a
blocking finding remains. Record the exact missing decision/evidence in the queue. After
three failures on one mechanism, pause speculative runner iterations and follow the structural
convergence protocol in [error-fix-loop.md](error-fix-loop.md#the-three-attempt-rule).

The orchestrator continues unrelated dependency-safe authorized integration work. It stops
only when all such work is exhausted and remaining tasks need owner-only decisions, waivers,
unavailable capacity/credentials, or after final integrated SIT acceptance and audit. Preserve
queue state and arrange continuation at a session boundary. Do not merge a blocked candidate,
guess product behaviour, weaken a gate or start new feature scope to keep busy.

## Related

- [SDLC](sdlc.md) · [Definition of Done](definition-of-done.md)
- [Coding standards](coding-standards.md) · [Error fix loop](error-fix-loop.md)
