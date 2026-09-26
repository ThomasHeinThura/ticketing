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
| Merges to `main` | ✅ | ✅ — the orchestrating Claude session, once every required gate is genuinely green (Thomas, 2026-09-15). Lane/subagents: ❌, always |
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

**Updated 2026-09-26 — see the [decision log](../07-planning/decision-log.md), 2026-09-26,
"`pal-mcp` becomes the primary ordinary review/audit/report/alignment tool."** This
supersedes the 2026-09-15 "exactly two model families" wording for three roles only:
ordinary review, audit/reporting, and the alignment check. When Claude Code orchestrates its
own subagents — a Task, an Agent call — the tool/model tier is not a free choice. It tracks
who is allowed to sign off on what, not just who is cheaper.

- **`pal-mcp`** (an MCP tool suite — `analyze`, `codereview`, `secaudit`, `precommit`,
  `thinkdeep`, `tracer`, `chat`, `consensus`, `apilookup`, `challenge`) is now the primary
  path for bulk reading/context-prep, ordinary review, audit, reporting, and the alignment
  check, via the `pal-reviewer` subagent (`.claude/agents/pal-reviewer.md`). Its `coder`
  model is a fusion panel — GPT-6 Luna as judge, plus Gemini 3.8 Flash, DeepSeek v4.1 Flash
  and GLM 5.3 Flash, 272K context — on Thomas's own 9Router gateway.
- **Claude Sonnet** keeps implementation against an agreed spec, and is the ordinary-review
  fallback only when `pal-mcp`/9Router is genuinely unreachable — record the fallback and
  why.
- **Claude Opus** is unaffected: still the sole final security/critical review tier, never
  satisfied by `pal-mcp` or any lower tier, at any confidence level `pal-mcp`'s own tools
  report.

An earlier multi-provider-router and non-Claude-specialist-agent approach **for
implementation** was tried and dropped (decision log, 2026-09-15) — that attempt used the
same `router.technexus.info` endpoint `pal-mcp`'s 9Router now reaches. The 2026-09-26 decision
is a second, narrower attempt: review/audit/reporting only, never implementation, never the
Opus gate, re-confirmed by Thomas as his own vetted gateway. `pal-mcp`'s panel also fans out
to third-party-hosted model APIs (Gemini, DeepSeek, GLM) behind that gateway — Thomas vetted
the gateway itself; he has not separately confirmed those providers' own data-retention or
training terms. Until he does, never send live secrets, credentials, tokens, or real customer
PII through `pal-mcp`; treat this as an open item, not a resolved one.

| Role | Tool / Model | Why |
| --- | --- | --- |
| Main / orchestrating session | **Whatever model this session already is** | No longer restricted to Opus/Fable — a Sonnet session orchestrating its own subagents is normal. What matters is that the orchestrating session does not clear its own work |
| Implementation subagents — writing code or tests to an already-agreed spec | **Sonnet, spawned explicitly** | This repository's whole premise is that the spec is detailed enough for mechanical implementation ([AGENTS.md](../../AGENTS.md), [SDLC](sdlc.md)) |
| Ordinary review — ordinary bugs/tests/quality, architecture fit, QA pass | **`pal-mcp` (`pal-reviewer` subagent)**; Sonnet fresh context as fallback | A different tool/context catches what the authoring context is structurally blind to. Two independent reviewer invocations minimum for ordinary work — each a fresh `pal-reviewer` spawn, or a mix of `pal-reviewer` and Sonnet; **one internally-panelled `pal-mcp` call does not by itself satisfy a two-reviewer requirement** — three for broad/high-coupling work — see [AGENTS.md § Review tiers](../../AGENTS.md#review-tiers) |
| Audit / reporting | **`pal-mcp` (`pal-reviewer` subagent)**; Sonnet fresh context as fallback | Same reasoning as ordinary review — I/O- and pattern-matching-heavy relative to the final security gate |
| Project-alignment / misalignment check | **`pal-mcp` (`pal-reviewer` subagent)**; Sonnet fresh context as fallback | Does this change match the spec, the vocabulary, the shared contracts, the five rules |
| **Review — final independent security / critical review** | **Opus. Always. Not optional, not cost-negotiable. Never `pal-mcp`.** Spawned as an explicit, separate subagent, or a fresh top-level Opus context. Default build: **Opus 5.5** (decision log, 2026-09-23) — record that version in the review | The one checkpoint this repository will not discount for budget, convenience, or tool choice. See below |
| **Phase finalizer** (P0–P7, additive) | **Opus**, once per completed stage, across everything merged for it | Catches cross-PR interaction the per-PR gate can't see — never a substitute for the row above ([AGENTS.md § Review tiers](../../AGENTS.md#review-tiers)) |

**Security review is a checkpoint, not a step inside another review.** Every pull request
and every [stage gate](sdlc.md) that is in security scope gets an explicit, separate
security-focused pass on Opus, distinct from ordinary review even when both happen close
together. "The ordinary reviewer also looked at security" does not satisfy this rule.

### Opus may now be spawned explicitly for this one tier

**Superseded 2026-09-15.** The earlier rule — "every spawned agent is Sonnet, no Opus
subagents ever, because a workflow that inherits the session model will quietly pick
Opus" — guarded against *accidental* Opus fan-out (a subagent silently inheriting Opus from
an Opus-orchestrated session). That risk is real and the underlying caution stands: do not
let a subagent inherit its model implicitly. But the `Agent` tool now supports pinning a
subagent's model **explicitly** at spawn time, and a deliberate, named, single-purpose Opus
spawn for the security/critical-review tier does not carry the accidental-fan-out risk the
old rule existed to prevent. So:

- **Every other subagent — implementation, ordinary review, alignment check — is Sonnet,
  set explicitly at spawn.** Still no accidental inheritance, still no Opus review swarms,
  still one implementation agent per active code slice as the default scale.
- **The final security/critical review may be an explicitly-spawned Opus subagent.** The
  constraint is on the *reviewing subagent's* independence, not on who is allowed to press
  spawn: any top-level session — Sonnet or Opus — may spawn it, **as long as the spawned
  subagent itself starts fresh and did not materially author, direct, or remediate the work
  under review.** What is never permitted, regardless of who spawns whom: a context (top-level
  or subagent) reviewing work it materially produced, under any label — that is still
  "approving your own review" (do-not 7 / do-not 5 above), just with an extra hop. The
  orchestrator spawning a genuinely independent Opus subagent to review the orchestrator's
  own prior work is the *intended* pattern (`CLAUDE.md`, "Model tiers"), not an exception to
  it — the subagent's freshness is what makes it independent, not distance from the
  spawner.
- If no Opus capacity is reachable at all — subagent or fresh top-level context — the pull
  request **waits**, marked **SECURITY RE-REVIEW PENDING — OPUS CAPACITY**. Capacity
  exhaustion means wait, not downgrade, unchanged from before.

Sonnet may do everything that *feeds* such a review — read the code, reproduce a
vulnerability, write the failing test, implement the fix, assemble the evidence. What it may
not do is *be* the required security/critical review itself.

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

The authoritative list is [AGENTS.md § Do not](../../AGENTS.md#do-not) — twenty items,
including do-not 16 (commit, push or merge only through the agreed flow: branch → commit →
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

1. **Independent review** — a fresh context, not the one that wrote it. Two Sonnet reviews
   minimum for ordinary work, three for broad/high-coupling work
   ([AGENTS.md § Review tiers](../../AGENTS.md#review-tiers)).
2. **Automated gates** — everything in CI.
3. **The required security/critical review**, Opus, when the change is in security scope.
4. **Merge**, through the normal protected pull-request flow, by the orchestrating Claude
   session once every one of the above is genuinely green on the exact candidate SHA
   (Thomas, 2026-09-15 — delegated; supersedes "only Thomas merges"). Thomas retains sole
   authority over design approval (H1–H6) and gate waivers — those are unchanged.

`main` enforces as much of this as a machine can. The `protect-main` ruleset requires a
pull request, blocks deletion and non-fast-forward pushes, dismisses stale approvals on
push, and requires its status checks with zero bypass actors. For the repository at large it
does **not** require an approving review: **required approving reviews is `0`, and Require
review from Code Owners is off** ([ci-cd.md](ci-cd.md#branching), decision log 2026-09-06) —
deliberately, because a required approval from a one-person team documents a gate rather than
providing one. `CODEOWNERS` lists only the control-plane files themselves — not `*` — so this
holds for ordinary code exactly as before. **Since 2026-09-26, Code Owner review is on for
exactly those control-plane paths** (`CLAUDE.md`, `AGENTS.md`, this file, `ci-cd.md`,
`.claude/agents/**`, `.github/CODEOWNERS` itself), so a lane or subagent cannot silently
rewrite the documents that define the gates — see the decision log. The control that
actually stops a bad merge in ordinary code is steps 1–3 above plus the required status
checks, not an approval count and not a single person holding the button.

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
