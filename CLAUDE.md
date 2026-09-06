# CLAUDE.md

Operating guide for Claude working in this repository.

[`AGENTS.md`](AGENTS.md) is canonical and applies to every agent, human or otherwise. Read
it. This file does not repeat it — it holds the things that are specific to Claude, and the
things previous Claude sessions learned the hard way and would otherwise learn again.

---

## Before anything else

Read, in this order, every session:

1. [`AGENTS.md`](AGENTS.md) — the five rules and the eighteen do-nots.
2. [`docs/07-planning/status.md`](docs/07-planning/status.md) — **Blocked** first, then the
   newest session-log entry. It tells you what is actually true today.
3. [`docs/07-planning/decision-log.md`](docs/07-planning/decision-log.md) — the newest
   entries. **Check it before calling anything an open question.** Most things that look
   undecided were decided and written down.

Then the feature spec for what you are doing, and any ADR it cites.

## Where this project is right now

**There is no application code.** The repository is a documentation corpus — around 136
markdown files — plus licence and provenance files. Nothing builds, nothing runs, and every
command in `AGENTS.md` and `README.md` is marked *planned*. If `pnpm test` fails with "no
such script", the checkout is fine and you are early.

**The hard stop:** no kaneo import and no P0 code until the licence pull request has merged
and the P0 issues exist. This is not a formality — it is the provenance boundary, so that
upstream MIT code never sits in an AGPL repository without its notice.

## How work reaches `main`

**branch → commit → pull request → Thomas approves → merge.**

That flow is the standing approval, and it is what do-not 16 means in practice. Create a
branch, commit to it, push, open a pull request that says what you did and what you did not
do. **Only Thomas merges.** `main` is protected: pull request required, one approval, no
force pushes, squash merge only.

Two failure modes to avoid, one in each direction: pushing to `main`, and leaving finished
work uncommitted on the laptop. The second has happened — eighty-three files once sat
uncommitted because an earlier reading of do-not 16 was too strict.

Commit messages are conventional (`docs:`, `chore:`, `feat:`, `fix:`) — commitlint and
semantic-release are part of the inherited stack.

## Model tiers, and the three absolutes

The tier is not a free choice; it tracks who may sign off on what
([`agent-workflow.md`](docs/04-engineering/agent-workflow.md)).

| Work | Tier |
| --- | --- |
| Orchestrating, planning, reviewing | Opus or Fable |
| Implementation against an agreed spec | Sonnet |
| **Security review** | **Opus. Always. Every pull request, every stage gate.** |

Three things an agent may never do:

1. Approve its own design review.
2. Waive a quality gate — only Thomas.
3. **Downgrade an unavailable reviewer.** If a usage limit or an outage puts the required
   tier out of reach mid-review, stop and wait. Write what is unreviewed into the pull
   request, add a **Blocked** entry to `status.md`, and stop. A review recorded at the wrong
   tier is worse than no review, because it closes the field that would otherwise stay
   visibly open.

## Using subagents here — what works

This corpus is large, and parallel review is genuinely useful. What has been tried:

- **Use the plain `Agent` tool in the background, one lens per agent.** Eight lenses over
  this corpus completed twice with no losses.
- **Do not use the Workflow tool for multi-file document review.** Its stall detector killed
  Opus reviewers mid-read three times on this repository. Workflow is fine for many small
  single-file agents; it is not fine here.
- **Have every agent append findings to a scratchpad file as it confirms them**, never
  buffer them for a final message. Agents get killed by a stall watchdog at around ten
  minutes; incremental writing means a death costs nothing.
- **Partition by file, exclusively.** Two agents editing one document will silently
  overwrite each other. Give each agent a list of files it owns and a handoff file for
  anything it needs changed elsewhere.
- **Tell agents to read in ranges** (`sed -n '120,240p'`), never `cat` a long file and never
  walk a reference repository recursively. That is what triggers the stalls.
- **Re-verify an agent's claims before acting on them.** Several confident findings in the
  last review were wrong; every one that mattered was checked against the file first.

## Verify against the source, never against memory

The most valuable findings this project has produced all came from reading the actual thing:

- kaneo enables better-auth's `anonymous()` guest sign-in **by default**, ships
  `accountLinking.enabled: true` with the generic OIDC provider trusted, and keeps a
  five-minute session cookie cache. None of it was in any document until someone opened
  `auth.ts`.
- MinIO had been wound down as an open-source project; a plausible default would have been
  wrong within the year it was written.
- kaneo's primitives are already Base UI, not Radix — six documents said otherwise.

So: check the upstream repository, the lockfile, the actual CI run. Reference clones live
beside this one under `../` (`kaneo`, `plane`, `openproject`, `ITSM/*`, `Ticketing` for v1).
Explore them with `ls` and targeted reads; recursive searches over them stall.

## The vocabulary, which is enforced

Four words that used to be one, separated on 2026-09-06. Using the wrong one will confuse
the next agent:

| Word | Means |
| --- | --- |
| **Stage** (P0–P7) | A level of product capability, with exit criteria |
| **Workstream** | A lane of work executing against those criteria; several run at once |
| **Step** (1–9) | One pass of the build process for a single feature (the SDLC) |
| **State** | Where a single work item sits in its lifecycle |

And every identifier has exactly one authoritative home — do-not 11. Add it there first, in
the same change:

| Identifier | Lives in |
| --- | --- |
| Tables and columns | `docs/01-architecture/data-model.md` |
| Capabilities, policy kinds | `docs/01-architecture/rbac.md` |
| Feature flags, plugin kinds | `docs/01-architecture/plugin-architecture.md` |
| Event keys | `docs/01-architecture/events.md` |
| Background jobs | `docs/01-architecture/background-jobs.md` |
| Environment variables | `docs/05-operations/configuration-reference.md` |
| Rule-id prefixes | `docs/03-features/README.md` |

## Writing for Thomas

He reads long output between other work, on a phone as often as not. What he has asked for:

- **Plain language.** Short sentences. No jargon where a normal word exists.
- **Label every item** as a *question he must answer*, a *decision he must make*, a
  *decision you made for him* (with how to reverse it), or *just an explanation*. Ambiguity
  about whether you are asking for approval costs him time.
- **Never reopen a settled item.** The four-week plan is a flexible target and the whole
  programme may take three to four months. That is an operating rule, not a question. Do not
  raise it again as a caveat, a risk, or an "honest calendar" note.
- **Say what you did not do**, plainly, at the end. An honest omission is worth more than a
  confident summary.

## The failure this project exists to avoid

TaskDesk v1 shipped eleven authorization holes past a green test suite, and twenty-five
screens at sixty per cent. Its documentation was excellent; its process was not. Every rule
here that feels heavy — the policy registry, the route-coverage test, the security review at
a fixed tier, the empty-review-section gate — is one of those failures converted into
something a build can refuse.

The pattern to watch for in yourself: **every rule that closes a code defect has a test;
every rule that closes a process defect has a sentence.** Sentences are what agents route
around. If you find yourself explaining why a gate does not apply this once, that is the
failure happening again, and the answer is to stop and ask.
