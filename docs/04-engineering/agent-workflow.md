# Agent workflow

The team is **Thomas plus three AI agents**: an OpenAI agent, GitHub Copilot, and Claude
Code. This document is how that works without producing three incompatible codebases.

> **If you are an AI agent picking up work here, read this document first, then
> [SDLC](sdlc.md), then [coding standards](coding-standards.md), then the feature spec.**

---

## Roles

| | Thomas | Agents |
| --- | --- | --- |
| Decides scope and priority | ✅ | ❌ |
| Writes and approves specs | ✅ approves | ✅ drafts |
| Writes ADRs | ✅ approves | ✅ drafts |
| Implements | occasionally | ✅ mostly |
| Writes tests | | ✅ |
| Reviews | ✅ final say | ✅ first pass |
| Approves a design (H1–H6) | ✅ only | ❌ |
| Waives a quality gate | ✅ only | ❌ |
| Merges to `main` | ✅ | ❌ |
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
| Claude Code | Long multi-file features, domain logic, refactors, test suites |
| Copilot (in VS Code) | Work needing workspace context, iterating with Thomas watching, UI |
| OpenAI agent | Research, spec drafting, migration mapping, documentation |

Parallelise across **independent** areas — for example: API for feature A, UI for feature
B, tests for feature C. Do not parallelise across a shared file.

---

## Model tiers within Claude Code

When Claude Code orchestrates its own subagents — a Task, an Agent call, a Workflow — the
model tier is not a free choice. It tracks who is allowed to sign off on what, not just
who is cheaper.

| Role | Model | Why |
| --- | --- | --- |
| Main / orchestrating session | **Opus or Fable** | Holds the whole task in view — scope, spec conformance, cross-file consequences. This is the seat that plans, assigns work, and signs off |
| Implementation subagents — writing code or tests to an already-agreed spec | **Sonnet 5** | This repository's whole premise is that the spec is detailed enough for mechanical implementation ([AGENTS.md](../../AGENTS.md), [SDLC](sdlc.md)). Running every subagent on Opus/Fable multiplies token cost and setup time for no proportional gain on narrowly-scoped, spec-driven work |
| Review — solution architecture / design sign-off | **Opus or Fable, never Sonnet** | A different, *stronger* context catches what the authoring context is structurally blind to — the same reasoning behind "an agent may never approve its own design review," one tier further |
| Review — QA / quality officer, "senior" pass | **Opus or Fable** | Same reasoning |
| **Review — security** | **Opus. Always. Not optional, not cost-negotiable.** | The one checkpoint this repository will not discount for budget. See below |

**Security review is a checkpoint, not a step inside another review.** Every pull request
and every [stage gate](sdlc.md) gets an explicit, separate security-focused pass on Opus,
distinct from the architecture and QA passes even when the same higher-tier model performs
more than one of them. "The QA reviewer also looked at security" is not the same thing as
a security review, and does not satisfy this rule.

**In practice:** a Claude Code session doing implementation work runs its Task/Agent
subagents on Sonnet 5, and its own self-check before declaring "done" (see [verification is
not optional](#verification-is-not-optional)) is not a substitute for the required Opus
security pass — that is a separate, explicit step.

### The tier a review needs, and the tier a spawned agent may be

Since 2026-09-06 these are two different questions, and the table above answers only the
first. **Every spawned agent is Sonnet** — subagent, background agent, workflow agent,
adversarial prober — set explicitly at spawn, because a workflow that inherits the session
model will quietly pick Opus. No Opus subagents, no Fable subagents, no Opus review swarms.
Default scale is one Sonnet implementation agent per active code slice, plus optionally one
adversarial verifier.

So a review the table marks **Opus or Fable, never Sonnet** cannot be *delegated to a spawned
agent* at all. It has exactly two honest homes:

1. the **top-level session**, when that session is Opus or Fable and is not reviewing its own
   work; or
2. a **separate session** at the required tier, queued until capacity exists.

There is no third option, and in particular **the reviewer requirement is not relaxed** to fit
the budget. When a mandatory independent Opus security review is owed and no independent Opus
capacity is available, the pull request **waits**, marked **SECURITY RE-REVIEW PENDING — OPUS
CAPACITY**. Capacity exhaustion means wait, not downgrade.

Sonnet may do everything that *feeds* such a review — read the code, reproduce a
vulnerability, write the failing test, implement the fix, assemble the evidence. What it may
not do is *be* the review. Neither may the orchestrator, for work the orchestrator authored:
that is the "an agent may never approve its own design review" absolute, one seat up.

Why this is written down rather than left to judgement: two thirteen-agent Opus workflows plus
two Opus review agents exhausted the organisation's monthly allowance mid-task, and the seven
agents that died in flight were five of six adversarial passes — the step whose whole purpose
is to catch a design that looks right. One of the two that did run defeated the design it
attacked (decision log, 2026-09-06).

This does not relax either absolute already stated under [Roles](#roles): an agent of any
tier may never approve its own design review, and may never waive a quality gate. A
stronger model reviewing is a stronger check, not a different kind of permission.
**A third absolute: an unavailable reviewer is not a downgraded reviewer.** When a usage
limit, a quota, an outage or a timeout makes the required tier unreachable mid-review —
**stop and wait**. Do not continue on a lower tier. Do not let the authoring session review
its own work "just this once", and do not let a Sonnet implementation subagent review the
code it wrote, under any framing: not "a quick sanity pass", not "just the diff", not
"pending the real review". A review recorded at the wrong tier is worse than no review,
because it closes the PR field that would otherwise stay visibly open. While blocked: write
what is finished and what is unreviewed in the pull request description, add a **Blocked**
entry to [status.md](../07-planning/status.md) naming the tier you are waiting for and who
unblocks it, and stop. Waiting for capacity is a normal, recordable state — the same class
as "three attempts failed" ([error fix loop](error-fix-loop.md)). Only Thomas may decide the
work proceeds without the review, and that decision is a gate waiver: it follows the waiver
procedure in [UX quality gates](../02-design/ux-quality-gates.md), including the
decision-log entry.

**These tiers apply to every agent's pull request, not only Claude Code's.** A pull request
authored by the OpenAI agent or by Copilot gets its architecture/QA review and its Opus
security review through a Claude Code session before Thomas sees it; if that session cannot
reach Opus, the third absolute applies. The PR template records which model implemented,
which reviewed and which ran the security pass, and CI refuses a template whose
`Reviewed by` equals `Implemented by` or whose `Security review` does not name Opus
([ci-cd.md](ci-cd.md#pull-request-pipeline)).

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

1. **Read the spec before writing code.** If it has open questions, stop and ask.
2. **Follow the existing pattern.** Feature folders, fetchers, query hooks — the shape is
   already decided.
3. **Write tests as you go**, citing spec rule numbers in test names.
4. **Run the checks yourself** before declaring done: `pnpm lint && pnpm typecheck &&
   pnpm test`.
5. **Update the spec** if implementation proved it wrong.
6. **Say what you did not do.** An honest "I did not implement the bulk path" is far more
   useful than silence.
7. **Ask when genuinely blocked.** Three failed attempts is the ceiling — see
   [error fix loop](error-fix-loop.md).

### Do not

The authoritative list is [AGENTS.md § Do not](../../AGENTS.md#do-not) — eighteen items,
including do-not 16 (no commit, push or merge without Thomas's explicit approval in the same
session). The items below are the ones most often broken in practice; if the two ever
disagree, AGENTS.md wins.

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
pnpm test:e2e -- <relevant> # if the UI changed
```

And then **actually open the screen** and use it. Automated checks are necessary and not
sufficient.

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
- **The working tree stays uncommitted until Thomas says "commit"** ([AGENTS.md](../../AGENTS.md)
  do-not 16). Finish, write the report, stop. A report is not approval; neither is silence.

---

## Review

Every pull request gets:

1. **An agent review** — a different agent from the one that wrote it. Fresh context
   catches a surprising amount.
2. **Automated gates** — everything in CI.
3. **Thomas** — final approval, and the only source of approval for design and waivers.
`main` enforces as much of the third step as a machine can. The `protect-main` ruleset
requires a pull request, blocks deletion and non-fast-forward pushes, dismisses stale
approvals on push, and squashes merges. It does **not** require an approving review:
**required approving reviews is `0`, and Require review from Code Owners is off**
([ci-cd.md](ci-cd.md#branching), decision log 2026-09-06).

So "only Thomas merges" is enforced by Thomas holding the merge button, not by a review
requirement — and `CODEOWNERS` (`* @ThomasHeinThura`) is ownership metadata that says who to
ask. Do not wait for an approval that is not configured, and do not read the zero as
permission: steps 1 and 2 above are unchanged, and the security review at its fixed tier
remains a hard gate no agent may waive or downgrade.

An agent reviewing its own work is worth very little; the same context that produced the
mistake will not see it.

---

## When an agent should stop

Stop and ask when:

- The spec is ambiguous or has open questions.
- The task requires a decision about scope or priority.
- Three attempts at the same problem have failed.
- A schema change looks necessary and was not in the task.
- A quality gate is failing and the fix is not obvious.
- The task appears to conflict with an ADR.
- Something in the codebase looks wrong in a way the task did not anticipate.

Stopping is not failure. Producing 400 lines built on a wrong assumption is.

## Related

- [SDLC](sdlc.md) · [Definition of Done](definition-of-done.md)
- [Coding standards](coding-standards.md) · [Error fix loop](error-fix-loop.md)
