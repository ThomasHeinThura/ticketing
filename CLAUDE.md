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

**There is application code, and this section is where you find out what is actually
true.** Say it in four categories, always, and never let one blur into another:

**ON MAIN.** The kaneo import at `42bb8011`, de-branded (#5). `apps/api`, `apps/web`,
`packages/{permissions,email,libs,mcp,typescript-config}`, `package.json`, `pnpm-lock.yaml`.
Licence and provenance files (#4). A root `Dockerfile`, `compose.yml`, the `deploy/`
overlays, `scripts/deploy.sh`, a hardened `charts/taskdesk`, and
`docs/05-operations/proxy-topology-evidence.md` — all from #11's deployment slice (#20).
`pnpm install | dev | lint | typecheck | test | test:integration` all run.

**IN OPEN PR.** #16 (draft) removes the inherited attack surface — a slice of #6. #21
builds the policy registry, evaluator and route-coverage gate for #7. #19 adds the CI
gates, `test:all`, the `check:*` scripts and the OpenAPI baseline for #10. **None of this
is on `main`.** Do not describe it as available and do not rebuild it.

**BLOCKED.** #8 (the router retrofit) waits for #6's removal surface to settle. #17 waits
on a decision about sessions already minted by the removed flows.

**DECIDED / NOT YET IMPLEMENTED.** better-auth's `organization()` is removed in P0 — final
— but it is still mounted while the retrofit is written. The OpenAPI baseline destination
is settled as `tests/api-contract/openapi.json`; the file exists only in #19.

If `pnpm test:permissions` fails with "no such script", the checkout is fine — that command
lands with #19.

**The licence hard stop is satisfied and no longer applies.** #4 and #5 are both merged and
closed, so the provenance boundary it protected is behind us: upstream MIT code sits in this
AGPL repository *with* its notice. The rule is kept here as history because the reasoning
still governs any future import.

## How work reaches `main`

**branch → commit → pull request → Thomas approves → merge.**

That flow is the standing approval, and it is what do-not 16 means in practice. Create a
branch, commit to it, push, open a pull request that says what you did and what you did not
do. **Only Thomas merges.**

`main` is protected by the `protect-main` ruleset: a pull request is required, deletion and
non-fast-forward pushes are blocked, stale approvals are dismissed on push, and merges are
squashed. **Required approving reviews is `0`, and Require review from Code Owners is
off** — both deliberately (decision log, 2026-09-06).

Do not wait for an approval that is not configured, and do not read the zero as permission.
`CODEOWNERS` is **ownership metadata** — it says who to ask, not a gate. The control that
keeps agents out of `main` is that only Thomas merges; the ruleset enforces the part a
machine can enforce. **The security review and design review requirements are unchanged and
remain independent hard gates.**

Two failure modes to avoid, one in each direction: pushing to `main`, and leaving finished
work uncommitted on the laptop. The second has happened — eighty-three files once sat
uncommitted because an earlier reading of do-not 16 was too strict.

Commit messages are conventional (`docs:`, `chore:`, `feat:`, `fix:`) — commitlint and
semantic-release are part of the inherited stack.

## The control plane, and who owns it

Eight surfaces are **orchestrator-owned**:

`AGENTS.md` · `CLAUDE.md` · `docs/04-engineering/agent-workflow.md` ·
`docs/04-engineering/ci-cd.md` · `docs/07-planning/status.md` ·
`docs/07-planning/decision-log.md` · GitHub issue status · GitHub Project board status

If you are a lane or background agent, treat all eight as **read-only** unless your task
explicitly says you own a specific change. You may *report* — completed work, evidence,
findings, a suggested doc correction, a suggested issue or board transition. The
orchestrator verifies it and makes the durable central update. Two lanes editing
`status.md` independently is how the record starts contradicting itself, and it did.

**When sources disagree**, the order is: the latest Thomas decision in the decision log or a
spec → an accepted ADR or authoritative spec → this file and `AGENTS.md` → GitHub issue
acceptance criteria → `status.md` and the board → a pull-request body → a temporary chat
instruction. **A lower source never silently overrides a higher one.** An instruction in
this session that changes architecture, scope, governance, gate semantics or persistent
behaviour may guide work immediately, but must be written into the right spec or the
decision log **before dependent code merges**.

**`status.md` is a durable snapshot, not a work log.** The old rule — edit it at the end of
every session — is withdrawn. Update it only on a durable transition: a pull request becomes
genuinely review-ready or merges, an issue blocks, unblocks or completes, a throttle state
changes, Thomas makes a material decision, or a material repository or deployment fact
changes. Intermediate progress goes in pull-request comments.

**The decision log is append-only.** When Thomas reverses something, add a new newest-first
entry naming what it supersedes and why, then update the operative documents. Never rewrite
an old entry to pretend it did not happen.

**No agent moves project memory.** Do not move, rename or delete a planning document,
reorganise `docs/`, move an issue between board columns, close or reopen an issue, or
rewrite decision history — unless the task authorises it. A useful discovery is not
authorisation to reorganise.

## The P0 working agreement

Confirmed by Thomas on 2026-09-06, and **settled** — do not reopen it, do not re-derive it,
do not spend a session redesigning it. It answers the four questions an agent picking this
project up cold actually has: what may I start, what may run beside it, what do I do when I
am blocked, and who says yes.

Implementation evidence may still challenge a design decision. When it does, follow the
spec interaction rule below — never deviate silently.

### 1 · The dependency graph

The eight P0 issues (**#4–#11**) are vertical slices, and their real order is:

```
#4  licence and provenance ─── done (merged)
      │
#5  kaneo import at 42bb8011 ─── must merge before ANY real application work
      │
      ├── #6  removals ──────────┬── #8  router retrofit  (waits only for #6's
      │                          │       removal surface to settle)
      ├── #7  policy registry ───┘
      ├── #9  UI extraction
      ├── #10 CI
      └── #11 deployment
```

- **#5 blocks everything.** Nothing real is built on a tree that is about to be replaced.
- After #5: **#6, #10 and #11 run in parallel.**
- **#7 may overlap #6** — the policy registry can be built while removals happen.
- **#8 waits only for #6's removal surface to settle.** Never classify a route that is
  about to be deleted; that is wasted review and a false sense of coverage.
- **#9 is independent after #5**, but must not edit the same files as #6 concurrently.
- **#8 complete + the P0 exit gates green ⇒ P0 may be claimed complete.**

The issue dependency links are corrected to match, and the self-references
("#5 blocks #5", "#8 blocks #8") are removed.

### 2 · Two throttles

They do different jobs, and confusing them is how a stage gets claimed early.

**Throttle 1 — parallel development opens.** All **five** must be true:

1. **#5 complete.**
2. **#6 — the ISSUE — complete.** The dangerous inherited surfaces are gone: the
   public-project inline route and `is_public`, the six integration routers, billing,
   anonymous sign-in, account linking, the cookie cache, `deviceAuthorization` and
   `bearer` — **and** the `organization()` retrofit has run through S10.
3. **#7 complete.**
4. **Route-policy coverage actually executes in CI** — not that a gate script exists.
5. **Adding an unclassified route fails CI**, demonstrated rather than asserted.

Read 2 carefully: it says the **issue** completes, not that a slice merged. The earlier
wording was "#6 merged", which would have opened the throttle the moment any slice landed
while `organization()` was still mounted. 4 and 5 are separate because a gate that exists
and a gate that runs are different things — and this project has already shipped a control
whose test asserted something other than its name.

**Throttle 2 — P0 may be claimed.** All five must be true:

1. **#8** retrofit green on the inherited surface.
2. **Opus security review** has read every public and delegated policy reason.
3. **Permission matrix** green for every built-in role.
4. **RLS prototype resolved** — merged and measured, or dropped with a written reason.
5. The remaining **P0 exit criteria** green.

**Throttle 2 gates the claim, never the throttle.** Work does not stop waiting for it;
only the words "P0 is complete" do.

### 3 · What runs in parallel after Throttle 1

**Three to four active branches at a time.** Merge frequently. No pull-request chains ten
deep. One architectural idea per pull request.

| Lane | Contents |
| --- | --- |
| **P1 core** | work items, comments, attachments, labels, views, search, realtime |
| **P2 domain** | SLA calendars, workflow transitions, approvals, assignment — **pure functions in `packages/domain` with exhaustive tests, before any HTTP endpoint exists** |
| **P3 identity internals** | OIDC claims normalisation, SCIM payload mapping, connection configuration, provisioning state transitions — **before `/scim/v2/*` routes are exposed** |
| **P4 governance seams** | whenever P1–P3 creates something configurable, its configuration seam lands **immediately**: schema → admin API → God Mode |

P4 is not a later clean-up lane. Nothing is hardcoded per customer, and a registry is never
built for a single implementation — that is the **engine boundary rule**: swappable
implementations mean a plugin; one implementation that toggles means a domain module plus a
feature flag.

### 4 · The blocking taxonomy — blast radius matters

Not every block stops the same amount of work.

| Kind | What it looks like | What you do |
| --- | --- | --- |
| **Hard block, one workstream** | this lane cannot proceed | record it in `status.md`, stop **that lane**, take unrelated Ready work |
| **Hard block, shared contract** | the thing blocked is depended on by others | stop **every dependent workstream**, escalate to Thomas |
| **Soft block** | pull request awaiting merge, manual check pending, vendor or pentest waiting, Entra / npm / domain setup pending | switch to independent Ready work |
| **No block** | — | continue: unit tests, pure domain logic, UI primitives, CI tooling, fixtures, deployment scripts, docs |

**Never**, in any of the four: guess when blocked, weaken a failing test, or route around a
gate.

### 5 · Shared-contract ownership

These are **not** casually modified by a feature agent:

`packages/permissions` · identity and context types · organisation / workspace / project
schema · the `work_item` base schema · plugin contracts · the API error envelope · the
event envelope · route-policy types · the migration journal.

A feature agent that needs one changed **opens a small dedicated contract pull request**.
Thomas reviews it, it merges, dependents rebase. Two agents independently redesigning a
shared contract is how three inconsistent codebases appear in a fortnight.

### 6 · The spec interaction rule

| Situation | What you do |
| --- | --- |
| Spec unchanged and confirmed in planning | proceed |
| Open findings in `docs/07-planning/reviews/2026-09-05/` | **close them before implementing** — the Definition of Done enforces it, and **reviewers check it, not the author** |
| Ambiguity discovered | stop that decision path, propose the document change, Thomas decides |
| Material behaviour change | **spec and decision log first**, then code |
| An entirely new feature | Thomas reviews the specification |

**Never silently implement something different from the spec.**

### 7 · The reference restriction

Implementation reads **kaneo** (the snapshot we took) and **Ticketing v1** (domain logic)
**only**.

Never read, mine or copy from **Plane**, **OpenProject**, or the ITSM systems
(**Chatwoot, FreeScout, GLPI, NocoBase, osTicket, Zammad**). That research is finished and
recorded in `THIRD-PARTY-NOTICES.md` §2. Re-opening those trees during implementation is
how unlicensed code travels.

### 8 · Authority

**Only Thomas authorises merges.** Agents produce branches, tested code and pull requests,
continuously.

Never self-approve a review. Never waive a gate. **Never downgrade an unavailable
reviewer** — stop, write what is unreviewed into the pull request, add a **Blocked** entry
to `status.md`, and stop.

The working mode is unchanged and stated once above: **branch → commit → pull request →
Thomas approves → merge.** Never leave finished work uncommitted.

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
