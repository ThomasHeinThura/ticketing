# CLAUDE.md

Operating guide for Claude working in this repository.

[`AGENTS.md`](AGENTS.md) is canonical and applies to every agent, human or otherwise. Read
it. This file does not repeat it — it holds the things that are specific to Claude, and the
things previous Claude sessions learned the hard way and would otherwise learn again.

This file deliberately contains **no live PR list, live SHA, issue count, or current stage
count**. Refresh those from GitHub every session.

---

## Before anything else

Read, in this order, every session:

1. [`AGENTS.md`](AGENTS.md) — the five rules and the twenty do-nots.
2. [`docs/07-planning/status.md`](docs/07-planning/status.md) — **Blocked** first, then the
   newest session-log entry. It tells you what is actually true today.
3. [`docs/07-planning/decision-log.md`](docs/07-planning/decision-log.md) — the newest
   entries. **Check it before calling anything an open question.** Most things that look
   undecided were decided and written down.
4. Live GitHub — `gh pr list --state open`, `gh issue list --state open`, the exact head of
   whatever you are about to touch.

Then the feature spec for what you are doing, and any ADR it cites.

**Do not act on a remembered SHA or a remembered PR list from an earlier conversation.**
Re-check. Sessions have compacted or lost context before while a repository this active kept
moving underneath them.

---

## Mission, and what "done for now" means

Continuous verified progress through the currently authorized dependency graph, currently
targeting **P4 complete** — a fresh deployment configurable into a customer's service desk
without editing application source. P0 has taken longer than planned and the calendar is
under real pressure; that changes the urgency, not the gates. A gate that closes a real
defect does not get thinner because a customer is waiting.

Do not stop at: P0, a throttle boundary, one merged PR, one merge-ready PR, a review report,
a provider failure, or a context refresh. See "Keep moving, without skipping a gate" in
`AGENTS.md` for the operational rules this implies, and "Reporting to Thomas" below for how
to say what happened without that becoming the stopping point itself.

---

## Establishing current truth

**Do not maintain a live-state narrative in this file.** Earlier versions of `CLAUDE.md` and
`status.md` embedded pull-request tables, throttle-condition counts and "blocked by exactly
issue N" statements that were true when written and false within days, and were then read as
current by the next session. The fix is not a better table — it is not keeping one here.

To find out what is actually true right now:

1. `status.md`'s dated snapshot header — **stage**, throttle open/shut, and *why* a throttle
   is shut (the reason is durable even when the count is not).
2. `docs/07-planning/retrofits/organization-plugin-retrofit.md` (or whichever stage ledger
   governs the work you're doing) for exact dependency state.
3. `gh pr list --state open` and `gh issue list --state open` for what is actually in
   flight. Nothing in an open pull request is on `main` — do not build on it, do not
   rebuild it.
4. `gh pr view <n> --json headRefName,mergeable,reviewDecision,statusCheckRollup` for one
   candidate's exact state before reviewing or merging it.

If `status.md` and GitHub disagree, GitHub is right — `status.md` is simply older. Update
`status.md` when you find it stale rather than working around the discrepancy silently.

---

## How work reaches `main`, and who may merge

`AGENTS.md`'s flow is unchanged: **branch → commit → push → pull request → required
independent review → required security review where applicable → required CI green → merge
→ refresh `main` → continue.**

**The orchestrating Claude session may merge a fully-green candidate itself**, through the
normal protected pull-request flow, once every required gate is genuinely satisfied on the
exact candidate SHA (Thomas, 2026-09-15 — see the decision log; this supersedes the earlier
"only Thomas merges" rule). Lane and background subagents never merge — only the top-level
session that is actually driving the work does, and only after verifying every gate itself
rather than trusting a subagent's report of green.

Before merging, verify directly:

- the candidate SHA is the one that was actually reviewed — a rebase, a conflict-resolution
  commit, or a `main`-merge since the last review invalidates it;
- applicable tests are green with the expected suite/file counts, not just exit code zero;
- the required independent review(s) are recorded on the PR at this SHA;
- the required security review is recorded where the change touches a security-review-scope
  path (`docs/04-engineering/ci-cd.md`'s list), at this SHA;
- every required GitHub status check is green;
- branch protection permits the merge without any bypass;
- **the `## Gates` table cites no waived gate.** If it does, this delegation does not cover
  it — the waiver-declaration mechanism proves a waiver was declared, not that Thomas
  authorized it, and his physical presence at the merge button was the only real check on
  that. A waived-gate candidate needs Thomas's own action to merge, always.

If any of that is not true, do not merge. Say what is missing on the PR, and move to other
runnable work — do not sit idle waiting on it, and do not route around it.

After every merge: refresh `main`, refresh PR/issue/check state, release dependents that
were waiting on it, rebase and re-test only the branches that actually need it, and continue.
A merge is not a stopping point.

---

## Model tiers

> **Since 2026-09-26 this section is superseded for reading/ordinary-review/audit/report/
> alignment by the decision log.** Read that first, then this.
> - **`pal-mcp`** (an MCP tool suite — `analyze`, `codereview`, `secaudit`, `debug`,
>   `refactor`, `testgen`, `precommit`, `consensus`, `thinkdeep`, `tracer`, `chat`,
>   `apilookup`, `challenge`) is now the **primary** path for bulk reading/context-prep,
>   ordinary review, audit, reporting, and the alignment check. Its `coder` model is a
>   **fusion panel** on Thomas's own 9Router gateway — GPT-6 Luna (judge), Gemini 3.8 Flash,
>   DeepSeek v4.1 Flash and GLM 5.3 Flash, 272K context — not a single small local model.
>   Thomas confirmed the endpoint is his own and vetted (2026-09-26).
> - This supersedes the 2026-09-23/2026-09-24 "#345 temporary current-model-context" ordinary-
>   review fallback for Claude's own subagent tier: GPT-6 Luna's review capacity is now
>   reachable directly as a tool call from inside this session, not only through a separately
>   Thomas-run agent.
> - **Sonnet's role narrows to coding/implementation against an agreed spec**, spawned
>   explicitly, and remains the fallback ordinary reviewer only when `pal-mcp`/9Router is
>   genuinely unreachable — record the fallback and why, same as any other tier substitution.
> - **The Opus 5.5 final security/critical review is unchanged: still mandatory, still a
>   fresh independent context, still never replaced by any lower tier — including `pal-mcp`.**
>   If Opus is unavailable, the PR waits.
>
> See the 2026-09-26 entry ("`pal-mcp` becomes the ordinary review/audit/report/alignment
> tool") and the 2026-09-23 entries it partly supersedes ("Three non-Claude implementation
> agents take the P0/P1/P2 lanes…" #336, "Until the lane agents' review capacity returns…"
> #345). The text below describes the tiers **within Claude's own subagents**, and the merge
> gates are unchanged.

Every subagent's model or tool is set **explicitly** at spawn time — never inherited from the
session. Three lanes are in play: **`pal-mcp`** (reading, ordinary review, audit, report,
alignment), **Claude Sonnet** (coding/implementation, and ordinary-review fallback), and
**Claude Opus** (the sole final security/critical review gate, never substituted). The earlier
multi-provider router, and the non-Claude coding agents routed through it, did not work out
**as an implementation router** — `pal-mcp` is narrower than that: a review/audit/reporting
tool, never an implementation path, and it never touches the Opus gate.

| Work | Tool / model |
| --- | --- |
| Bulk reading, context-prep, summarization | `pal-mcp` (`coder` fusion panel) |
| Ordinary review (bugs, tests, code quality), audit, reporting | `pal-mcp` (`coder` fusion panel); Sonnet fresh context as fallback if `pal-mcp`/9Router is unreachable |
| Project-alignment / misalignment check — does this change match the spec, the vocabulary, the shared contracts, the five rules | `pal-mcp` (`coder` fusion panel); Sonnet fresh context as fallback |
| Implementation against an agreed spec | Sonnet, spawned explicitly |
| **Final independent security / critical review** | **Opus**, spawned explicitly as its own subagent, on the exact candidate SHA — never `pal-mcp`, never a fallback tier |
| **Phase finalizer** (P0–P7, additive — see `AGENTS.md`'s "Review tiers") | **Opus**, a broader red-team pass across a completed stage's merges, in addition to (never instead of) the per-PR security-scope gate above |
| Orchestrating, planning, synthesizing reports | whatever model this top-level session is running as |

**Reading, ordinary review, audit, reporting and the alignment check default to `pal-mcp`.**
Match the tool to the job: `analyze`/`codereview`/`secaudit` for review and audit,
`thinkdeep`/`tracer` for understanding a change before judging it, `precommit` before a
candidate goes up, `chat`/`consensus` for a second opinion, `apilookup` for current API/SDK
facts instead of guessing from training data. Spin up as many independent `pal-mcp` calls or
Sonnet subagents as there is genuinely independent, boundable work for — implementation lanes
stay Sonnet; ordinary reviewers and the alignment checker default to `pal-mcp`, falling back
to fresh Sonnet contexts only when `pal-mcp` is genuinely unreachable. Decide the tier and the
reviewer count yourself, using `AGENTS.md`'s review-tier table — **by what the change actually
risks, not by which directory it touches** (Thomas, 2026-09-16, after PR #148 spent
eight-plus review rounds on a small CI-parsing fix: touching `scripts/ci/**` or another
security-scope path is not on its own a reason for three rounds — a bounded fix that changes no
authority or gate-semantics invariant is one strong ordinary review, then straight to the
single required Opus pass; the full three-round tier is for migrations, API+frontend crossing
the same change, concurrency, cross-package integration, or a change that actually redesigns an
authority/gate-semantics invariant, not for every touch to a sensitive path). Do not ask Thomas
to make that call per PR — but do apply the actual table, not a shortcut memory of "CI files
always get three."

**When a mechanism has already had several review rounds finding the same recurring class of
gap, do not keep queuing more ordinary-review rounds** — see AGENTS.md's "stop patching and
change altitude." Once the design has had its structural fix and further findings are narrower
instances of the same class (not a new class), one Opus pass is the closing gate, not
another ordinary round first. This is a rule about round *count*, not about rigor within a
round — exact-head discipline, a real regression test per finding, and the ban on waiving a
gate are unchanged.

**Only the final independent review for genuinely security-sensitive or otherwise critical
work is Opus, and it is always a fresh, separate context from whatever authored or
orchestrated the change — including `pal-mcp`.** A context that materially authored, directed,
or remediated the work under review cannot also clear it — spin up a distinct Opus subagent
(or, if this session is itself Opus, hand off to a fresh top-level Opus context) for that
review alone. Security-review scope is the path list in
[`ci-cd.md`](docs/04-engineering/ci-cd.md): auth, permissions, migrations, the CI/gate
machinery itself, and the dependency graph (`package.json`, lockfiles, `pnpm-workspace.yaml`
overrides).

Four things an agent may never do:

1. Approve its own review.
2. Waive a quality gate — only Thomas, recorded in the decision log.
3. **Downgrade an unavailable reviewer.** If Opus capacity is genuinely unreachable
   mid-review, the candidate waits, marked **SECURITY RE-REVIEW PENDING — OPUS CAPACITY** on
   the PR. Capacity exhaustion means wait, not substitute.
4. **Treat `pal-mcp`, or any model in its `coder` panel, as satisfying the Opus gate.**
   `pal-mcp` is an ordinary-review, audit and reporting tool. It is never the final
   security/critical review, at any confidence level its own tools report.

---

## Using subagents here — what works

This corpus is large, and parallel work is genuinely useful when it is bounded. What has
been learned on this repository:

- **Every subagent needs a concrete, bounded deliverable**: exact branch/head or exact
  files, exact question, exact expected output. Do not spin one up to "look into" something
  broadly — that burns tokens for a report nobody can act on (`AGENTS.md` do-not 19).
- **Partition by file, exclusively.** Two agents editing one document, or one shared
  contract (`packages/permissions`, identity/context types, the org/workspace/project
  schema, the work-item base schema, plugin contracts, the API error envelope, the event
  envelope, route-policy types, the migration journal), will silently overwrite each other
  or redesign it twice. Give each agent a file list it owns and a handoff note for anything
  it needs changed elsewhere.
- **Use the plain `Agent` tool, one lens per agent, in the background** when several
  independent implementation or review lanes are genuinely ready at once. Default useful
  concurrency is a handful of lanes — as many as there is real, non-overlapping,
  well-scoped work for, not a fixed number to hit.
- **Ordinary review, audit, reporting and the alignment check default to the `pal-reviewer`
  subagent** (`.claude/agents/pal-reviewer.md`), restricted to `pal-mcp` tools plus read-only
  file access. Give it the exact candidate SHA and file list; it does the actual review via
  `pal-mcp`'s `coder` fusion panel, batched into as few tool calls as the job allows, and
  reports the SHA it checked plus what it did not check. Fall back to a fresh Sonnet context
  only when `pal-mcp`/9Router is genuinely unreachable, and say so in the report.
- **Do not reach for heavier multi-agent orchestration (the `Workflow` tool) as a standing
  default.** It requires the user's own explicit opt-in in that session and is not something
  this file can pre-authorize; ask Thomas to say so explicitly ("use a workflow") when a
  stage genuinely has enough independent, well-defined slices queued to justify a larger,
  structured fan-out. Its stall detector has also killed long-document review agents on this
  repository before — for large single-document review, plain background `Agent` calls have
  been more reliable.
- **Have every agent write findings incrementally**, not buffered for a final message, when
  the task can take a while.
- **Tell agents to read in ranges**, never to `cat` a long file or walk a reference clone
  recursively — that is what triggers timeouts on this corpus.
- **Re-verify a subagent's claims against the actual source before acting on them.**
  Confident findings have been wrong before; the ones that mattered were checked against the
  file first.

---

## Deployment status is part of the routine, not a separate track

A live UAT deployment is near-term, active priority, not a someday item. Before it can stand
up, the application-side gaps block it — check `status.md`'s Blocked section and
`gh issue list` for their current state (a hardcoded port, missing public health endpoints,
no static file serving in the Node process, no `storage.filesystem` driver were the known
gaps as of the last check; re-verify, do not assume this list is still exhaustive).

Once those close: `docker build`, container boot, and the health endpoints answering are
part of "done" for any change touching what ships in the image (`AGENTS.md`, "Before you say
done"). After a merge that could affect deployability, redeploy the UAT stack and confirm it
comes up healthy — that is a runnable next step, not optional follow-up work someone else
picks up later.

---

## The control plane, and who owns it

Eight surfaces are **orchestrator-owned**:

`AGENTS.md` · `CLAUDE.md` · `docs/04-engineering/agent-workflow.md` ·
`docs/04-engineering/ci-cd.md` · `docs/07-planning/status.md` ·
`docs/07-planning/decision-log.md` · GitHub issue status · GitHub Project board status

Lane or background agents treat all eight as **read-only** unless their task explicitly says
they own a specific change. They may *report* — completed work, evidence, findings, a
suggested doc correction. The orchestrating session verifies it and makes the durable
central update itself. Two lanes independently editing `status.md` is how the record starts
contradicting itself, and it has.

**When sources disagree**, the order is: the latest Thomas decision in the decision log or a
spec → an accepted ADR or authoritative spec → this file and `AGENTS.md` → GitHub issue
acceptance criteria → `status.md` and the board → a pull-request body → a temporary chat
instruction. **A lower source never silently overrides a higher one.** An instruction in
this session that changes architecture, scope, governance, or gate semantics may guide work
immediately, but must be written into the right spec or the decision log **before dependent
code merges** — this file asserting something the decision log does not actually contain is
exactly the failure this hierarchy exists to prevent.

**`status.md` is a durable snapshot, kept current, not a work log and not something updated
only at a stage's end.** Update it whenever something durable changes: a pull request becomes
genuinely review-ready or merges, an issue blocks, unblocks or completes, a throttle state
changes, Thomas makes a material decision, or a material repository/deployment fact changes.
Intermediate progress goes in pull-request comments.

**The decision log is append-only.** When Thomas reverses or extends something, add a new
newest-first entry naming what it supersedes and why, then update the operative documents in
the same change. Never rewrite an old entry, and never let a decision that governs live
behavior exist only as an uncommitted draft — if it isn't in the decision log, it isn't in
force yet, no matter how confidently a later document assumes it.

**No agent moves project memory.** Do not move, rename or delete a planning document,
reorganise `docs/`, move an issue between board columns, close or reopen an issue, or
rewrite decision history — unless the task authorises it.

---

## Parallelizing P1–P7 once Throttle 1 opens

Once the throttle conditions in `status.md` are genuinely met (verify live, do not round up),
run independent lanes in parallel rather than finishing one stage before starting the next:

- **P1 core** — work items, comments, attachments, labels, views, search, realtime.
- **P2 domain** — SLA calendars, workflow transitions, approvals, assignment — pure
  functions in `packages/domain` with exhaustive tests before any HTTP endpoint exists.
- **P3 identity internals** — OIDC claims, SCIM mapping, connection config, provisioning
  state — before `/scim/v2/*` routes are exposed.
- **P4 governance seams** — land immediately alongside whatever P1–P3 work makes something
  configurable: schema → admin API → God Mode UI → audit trail. P4 is not a later cleanup
  lane; a feature that creates configuration without its seam is not finished (`AGENTS.md`
  rule 5).

A shared contract (see the list above) gets its own small dedicated pull request when a lane
needs it changed — never two lanes redesigning it independently. Blast radius decides how
much a block matters: a lane-local block stops that lane only; a shared-contract block stops
every dependent lane and needs Thomas; a soft block (review pending, external setup pending)
means switch to other Ready work; anything with no real dependency just continues.

---

## Verify against the source, never against memory

The most valuable findings on this project came from reading the actual thing, not from what
a document claimed:

- kaneo enables better-auth's `anonymous()` guest sign-in by default, ships
  `accountLinking.enabled: true`, and keeps a five-minute session cookie cache — none of it
  was in any document until someone opened `auth.ts`.
- MinIO had been wound down as an open-source project; a plausible written default would
  have been wrong within the year.
- kaneo's primitives are Base UI, not Radix — several documents said otherwise.
- Raw `grep` for a plugin client caller overcounts roughly 12x because comments carry
  historical strings — strip comment lines before trusting a count.

So: check the upstream repository, the lockfile, the actual CI run, the live database.
Reference clones live beside this one under `../`. Explore with `ls` and targeted reads;
recursive searches over them stall.

---

## Environment specifics on this host

- `node` is not on the default `PATH` — prefix shell commands with the fnm-managed Node
  path, or use the package-local binary (e.g. `apps/api/node_modules/.bin/vitest`).
- Integration tests need a **private `*_test` Postgres database per concurrent lane** — the
  harness truncates every table on reset, so two lanes sharing a database corrupt each
  other's runs and produce failures that look like real defects.
- The host runs unrelated production containers alongside this project. Keep test load
  bounded.

---

## The vocabulary, which is enforced

Four words that are easy to blur, separated deliberately:

| Word | Means |
| --- | --- |
| **Stage** (P0–P7) | A level of product capability, with exit criteria |
| **Workstream** | A lane of work executing against those criteria; several run at once |
| **Step** (1–9) | One pass of the build process for a single feature (the SDLC) |
| **State** | Where a single work item sits in its lifecycle |

Every identifier has exactly one authoritative home — `AGENTS.md` do-not 11:

| Identifier | Lives in |
| --- | --- |
| Tables and columns | `docs/01-architecture/data-model.md` |
| Capabilities, policy kinds | `docs/01-architecture/rbac.md` |
| Feature flags, plugin kinds | `docs/01-architecture/plugin-architecture.md` |
| Event keys | `docs/01-architecture/events.md` |
| Background jobs | `docs/01-architecture/background-jobs.md` |
| Environment variables | `docs/05-operations/configuration-reference.md` |
| Rule-id prefixes | `docs/03-features/README.md` |

---

## Reporting to Thomas

He reads long output between other work, on a phone as often as not.

- **Plain language.** Short sentences. No jargon where a normal word exists.
- **Label every item** as a *question he must answer*, a *decision he must make*, a
  *decision you made for him* (with how to reverse it), or *just an explanation*.
- **Never reopen a settled item.** Do not raise a decided question again as a caveat or a
  risk note.
- **Say what you did not do**, plainly, at the end. An honest omission is worth more than a
  confident summary.
- **A status report is a checkpoint, not a stopping point.** State what merged, what's
  current on `main`, what's merge-ready, what's tested, what's reviewed at which tier, new
  findings/issues, and what's blocked and why — then continue to the next runnable thing in
  the same turn where possible, rather than ending on the report.
- If genuinely confused about something only Thomas can decide — a real product/architecture
  call, a risk acceptance, something irreversible — ask once, as a tight set of concrete
  options, rather than stalling silently or guessing and redoing the work later.

---

## The failure this project exists to avoid

TaskDesk v1 shipped eleven authorization holes past a green test suite, and twenty-five
screens at sixty per cent. Its documentation was excellent; its process was not. Every rule
here that feels heavy — the policy registry, the route-coverage test, the security review at
a fixed tier, the empty-review-section gate — is one of those failures converted into
something a build can refuse.

**Every rule that closes a code defect has a test; every rule that closes a process defect
has a sentence.** Sentences are what agents route around. If you find yourself explaining why
a gate does not apply this once, that is the failure happening again, and the answer is to
stop and ask — not to keep going quietly.
