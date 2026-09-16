# AGENTS.md

**Canonical guide for anyone — human or AI — working in this repository.**
Read this first. Then read what it points you at.

---

## What this is

**TaskDesk v2** — a self-hostable, multi-tenant service desk and work management platform.

Built on [kaneo](https://github.com/usekaneo/kaneo) (MIT), which was taken **once** as a
foundation and is now ours. There is no upstream relationship. Design inspiration from
Plane, OpenProject and Jira Service Management. Domain knowledge from TaskDesk v1.

Licensed **AGPL-3.0**.

## Read in this order

1. This file
2. [`docs/04-engineering/agent-workflow.md`](docs/04-engineering/agent-workflow.md) —
   **required** if you are an AI agent
3. [`CLAUDE.md`](CLAUDE.md) — **required if you are Claude**: model tiers, subagent
   patterns that work in this repository, how work reaches `main`
4. [`docs/07-planning/status.md`](docs/07-planning/status.md) — **Blocked** first, then the
   newest session-log entry
5. [`docs/07-planning/decision-log.md`](docs/07-planning/decision-log.md) — newest entries
   first. Check it before calling anything an open question
6. live GitHub — `gh pr list --state open`, `gh issue list --state open`, exact heads,
   reviews, checks
7. the feature spec for what you are building, in
   [`docs/03-features/`](docs/03-features/README.md), and any
   [ADR](docs/01-architecture/adr/README.md) it references

Full index: [`docs/README.md`](docs/README.md)

**No sentence in this file, or in `CLAUDE.md`, may assert live PR/branch/issue-count/finding
state.** That belongs in `status.md`'s dated snapshot or in GitHub. A file that has to be
edited every time a branch opens is not durable truth — it is a dashboard, and GitHub already
is one. This was learned expensively: earlier revisions of these files went stale within
days and were then read as current by whoever arrived next, which is a wrong instruction
issued to everyone, not a documentation nit.

---

## The five rules

Everything else follows from these.

### 1 · UI/UX uses the shared design system

No bespoke primitives outside `packages/ui`. If a primitive is missing, add it *there*, with
a Storybook story and a test. Never inline one.

### 2 · Nothing is hardcoded per customer

We ship **one image to every customer**. Identity providers, storage, notifications,
branding, features, roles — all runtime configuration in God Mode, stored in the database.

Environment variables are bootstrap-only, registered in
[`docs/05-operations/configuration-reference.md`](docs/05-operations/configuration-reference.md)
and nowhere else. `check:env` enforces it in CI. If you are about to add one, or write
`if (customer === …)`, stop and add a plugin or a feature flag instead.

### 3 · Every route declares its permission

A route without a policy entry **fails the build**. `packages/permissions` — the registry,
evaluator and route-coverage gate — is on `main` and `check:route-policy` is a required
status check. This is not ceremony: v1 shipped eleven authorization holes past a green test
suite, and every one was an omission.

### 4 · Every screen has a URL

Filters, tabs, selections, open panels — all URL state. Registered in `lib/routes.ts`,
verified by a round-trip test.

### 5 · Ship narrow and finished

A stage completes before the next starts. A slice is not done because an endpoint exists —
finish its schema, policy, tests, UI, browser evidence, audit/event behaviour and
integration seam before calling it complete. v1 died of twenty-five screens at sixty per
cent.

---

## Layout

```
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

Which of these exist **on `main` today** versus only on a branch is live state — check
`gh pr list --state open` and `git log --oneline -- <path>` rather than trusting a table
here. Do not import from a package that does not exist yet, and do not take its absence as
licence to put its contents somewhere else.

Detail: [`docs/01-architecture/monorepo-layout.md`](docs/01-architecture/monorepo-layout.md)

---

## Commands

The authoritative list of what CI runs is
[`docs/04-engineering/ci-cd.md`](docs/04-engineering/ci-cd.md). Whether a given script exists
on `main` today is, again, live state — `pnpm run` with no arguments lists what is actually
wired in the checkout you have.

```bash
pnpm install
pnpm dev                   # everything
pnpm dev --filter api
pnpm dev --filter web

pnpm lint                  # biome
pnpm typecheck
pnpm test                  # unit + component
pnpm test:integration      # needs a private *_test Postgres database — see CLAUDE.md
pnpm test:permissions      # route coverage + role × route matrix
pnpm test:e2e
pnpm test:all              # alias for every CI check — ci-cd.md is the single list

pnpm check:tokens          # no literal colours; contrast passes
pnpm check:ui              # no bespoke primitives
pnpm check:deps            # no cycles, no boundary violations
pnpm check:queries         # no db.select() outside repository.ts
pnpm check:inventory       # screen inventory ↔ generated routes
pnpm check:reviews         # a spec in build has an empty review section
pnpm check:env             # no process.env read outside configuration-reference.md
pnpm check:vocabulary      # tables/capabilities/events/jobs exist in their authority doc
pnpm check:skips           # no .skip / .only / describe.skip
pnpm check:route-policy    # route coverage + permission matrix, fail-closed
pnpm check:openapi         # committed baseline matches the live API
pnpm check:organization-callers  # shrink-only ratchet on the retrofit's remaining plugin callers

pnpm seed minimal | realistic | hostile
scripts/deploy.sh local
```

**When a command fails, the cause decides the response.** `turbo: not found` or a missing
`node_modules` means an uninstalled tree — run `pnpm install`. "No such script" for
something not yet built is expected; for something you believe is on `main`, say so rather
than working around it.

---

## Before you say "done"

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm test:integration      # if the API changed
pnpm test:permissions      # if a route changed
pnpm test:e2e -- <scope>   # if the UI changed
docker build .             # if anything that ships in the image changed
```

**And then open the screen and use it** — list every screen you opened in the pull request's
`## Screens opened` section (route, viewport, what you clicked, screenshot). If browser
verification is genuinely unavailable, write `BROWSER VERIFICATION: BLOCKED`, never `n/a`.

**Deployability is not a separate, later concern.** Any change that touches what ships in
the container — the API, its bootstrap, the web bundle, the compose/Helm shape — is not done
until `docker build` succeeds and the container actually boots and answers its health
endpoint. This is an active near-term priority, not aspirational: TaskDesk needs a running
UAT deployment soon, and a change that quietly breaks the image is a regression even if
every other gate is green.

Full checklist:
[`docs/04-engineering/definition-of-done.md`](docs/04-engineering/definition-of-done.md)

---

## How work reaches `main`, and who may merge

**branch → commit → push → pull request → required independent review → required security
review where applicable → required CI green → merge → refresh `main` → continue.**

Create a branch, commit to it, push, open a pull request that says what you did and what you
did not do.

**The orchestrating session may merge a candidate itself, through the normal protected pull
request flow, once — and only once — every required gate is genuinely green**: applicable
tests pass with the expected suite/file counts, the required independent review(s) are
recorded, the required security review is recorded where the change is in security scope,
and every required GitHub status check is green on the exact candidate SHA. This replaces
the earlier "only Thomas merges" rule (Thomas, 2026-09-15 — see the decision log).

This delegation does **not** authorize:

- direct pushes to `main`;
- force-pushing or history rewriting as routine work;
- bypassing branch protection, a required check, a review tier, or a security gate;
- self-review, or calling one's own remediation an independent review;
- a lane/subagent merging — only the top-level orchestrating session merges;
- merging a candidate with any required check red, any required review missing, or a stale
  SHA that hasn't been re-reviewed;
- **merging any candidate whose `## Gates` table cites a waived gate.** The waiver-citation
  mechanism (`scripts/ci/lib/gate-waiver.mjs`) proves a waiver was declared in the form the
  decision log requires; it does not and cannot prove Thomas himself authorized it — the
  only real check on that used to be Thomas physically at the merge button, which this
  delegation removes. So a waived-gate candidate always needs Thomas's own action to merge
  (an approval, a comment, or the merge itself), never the orchestrator alone. Found by
  independent Opus review of this very delegation, 2026-09-15 — see the decision log.

A red required check, a missing review, an unresolved blocking finding, a merge conflict, or
a branch-protection refusal means: do not merge that candidate. Keep working on something
else runnable, then come back to it.

`main` is protected by the `protect-main` ruleset — a pull request is required, deletion and
non-fast-forward pushes are blocked, stale approvals are dismissed on push, and required
status checks (including `pull request template + security review`) have zero bypass actors.
Required approving reviews is `0` and Code Owner review is off, deliberately —
`CODEOWNERS` is ownership metadata, not a gate. The gates that actually stop a bad merge are
the review tiers below and the required status checks, not an approval count.

Never:

- fabricate review evidence, or mark an independent review `n/a`;
- waive a required gate without Thomas's explicit authorization, recorded in the decision
  log;
- downgrade a required reviewer/model tier — if the required tier is unavailable, the
  candidate **waits**, marked in the pull request, not downgraded;
- leave finished work uncommitted or unpushed on a local machine.

---

## Review tiers

**Tier by what the change actually risks, not by which directory it sits in.** A path list
(migrations, CI/gate machinery, auth/permissions code) tells you a change is a *candidate*
for the heavy tier — it does not by itself mean the change gets it. Two changes to the same
file can need completely different amounts of review. The classification below is one an
orchestrating session makes itself per change; it is not a per-file rule.

### Ordinary substantive work

At least **two** fresh, independent reviewer contexts, minimum. Use **three** for broad or
high-coupling work: migrations, API + frontend crossing the same change, concurrency,
cross-package integration, or stage-completion integration — and for CI/security-control
machinery specifically, only when the change actually alters an authority or gate-semantics
invariant (see below). Each review records: the exact candidate SHA, the reviewer's
independence from the author, what was actually checked (not just read), the verdict, and
blocking findings.

### Security-sensitive work

After ordinary review clears, a further **independent security review** is required before
merge — see `CLAUDE.md` for Claude's specific model-tier mapping. Security scope is the path
list in `docs/04-engineering/ci-cd.md`: authentication and permissions code, migrations, the
CI/gate machinery itself, and the dependency graph (`package.json`, lockfiles,
`pnpm-workspace.yaml` overrides). The reviewer must be a context that did not materially
author, direct, or remediate the change under review.

**Within that scope, size the ordinary-review count to what the change does, not just where
it lives** (Thomas, 2026-09-16 — see the decision log):

| The change... | Ordinary review | Security review |
| --- | --- | --- |
| ...touches a security-scope path with a change small enough that one reviewer can confirm BY INSPECTION it alters no authority or gate-pass/fail semantics (a comment, a log line, a rename with no behavior change) | **one** | required, but a **single, lightweight** Opus confirmation — verifying the change is exactly what it claims and nothing more, not a full adversarial audit |
| ...is a bounded fix to CI/gate logic or a security-scope file that changes pass/fail semantics for a narrow, well-understood case (a parsing bug, a false-positive/false-negative correction) | **one strong** | required, a **single, full** Opus pass — do not stack a second or third Sonnet round ahead of it "just in case"; Opus's own adversarial pass exceeds what another Sonnet pass adds here |
| ...touches auth, permissions, migrations, or redesigns a security control's core semantics (not a bounded fix to one) | **two to three**, per the broad/high-coupling test above | required, full independent Opus pass |
| ...is a large or high-risk authority redesign (a new capability, a new trust boundary, a schema change to an access-control table) | **full panel** (three), plus any domain-specific review the spec calls for | required, full independent Opus pass, and check whether an ADR is needed first |

**No row exempts a security-scope path from Opus entirely — there is no "n/a" security-review
outcome in this table, on purpose.** The lightest row still gets a lightweight Opus pass; only
its depth changes, never whether it happens. A **test or probe file inside `scripts/ci/**`
does not automatically qualify for the lightest row** — found adversarially, reviewing this
very table: those files are frequently part of the gate's own enforcement surface (a ratchet
threshold, an anti-narrowing assertion, a synthetic fixture a checker's own tests depend on),
so weakening one of their assertions can itself be a real gate-semantics change even though
the file is "just a test." Classify a test/probe-file change by what its assertions actually
enforce, the same way you would the checker code itself — not by the fact that it lives in
a `*.test.mjs` file.

A change can start in one row and prove it belongs in another — that is a normal outcome,
not a process failure, and does not retroactively invalidate review already done at the
row it actually turned out to be.

### When repeated review keeps finding something: stop patching and change altitude

A file can legitimately need several review rounds when each one finds a *different class*
of real defect. It should **not** need many rounds finding *narrower and narrower instances
of the same already-identified class* — enumerating one more punctuation mark, one more
Unicode edge case, one more spacing variant that a real PR author is exceedingly unlikely to
type. That pattern (do-not 10's "repeat the same failing approach more than three times")
is a signal to change what kind of fix is being attempted, not to run another review round
on the same kind of patch:

- **After the third round on the same mechanism finds the same CLASS of gap** (not a new
  class — the same one, recurring at a narrower scope each time), stop and ask: does the
  underlying design need a structurally different approach (the kind of redesign, not
  another special case), or is the residual risk small enough to accept and document
  explicitly, the way an accepted trade-off is recorded elsewhere in this file?
- **A finding that requires constructing an input no real author would plausibly type**
  (an astral-plane Unicode character exactly at a parser boundary, a dozen combining marks)
  is real if true, but it does not by itself justify another full review round at the same
  tier — record it, decide once whether it is worth a fix, and move on rather than treating
  every such finding as equally urgent as the ones a real PR body actually triggered.
- **Once a mechanism has had its structural redesign and further rounds are only finding
  size-of-input variations on the same theme, one Opus pass closes it** — do not requeue
  another Sonnet round first "to be safe." If Opus itself finds something new, that is real
  signal; chase it. If it doesn't, merge.
- This does not relax exact-head discipline, the requirement for a real regression test per
  finding, or the ban on waiving a gate — it relaxes how many *rounds*, not how rigorously
  each one is done.

---

## Keep moving, without skipping a gate

The project spent real time stuck — the same candidates cycling through repeated review
passes without the underlying SHA changing, control-plane documents going stale for days
while work continued elsewhere, and lanes re-litigating already-decided questions. None of
that was a gate doing its job; it was process friction. The fix is operational discipline,
not weaker gates:

- **Before opening another review pass on a candidate, check whether its SHA actually
  changed since the last review.** If it did not, the prior verdict still stands — do not
  re-review an unchanged head. If it did, only the delta since the last reviewed SHA needs
  fresh eyes for an ordinary revision; a security-sensitive candidate still gets the full
  tier applied to the new head.
- **Do not stop at one merged PR, one merge-ready PR, or one status report.** After every
  meaningful action — edit, test, commit, push, review, merge, CI result, blocker — refresh
  live state, remediate what needs it, and move to the next runnable piece of work. A
  narrated plan ("I will now...") is not a stopping point when the next action is
  executable now.
- **A blocked lane blocks that lane, not the program.** Take independent Ready work instead
  of waiting idle.
- **Whole-program stop is reserved for**: every dependency-safe authorized task exhausted,
  and every remaining path needs a genuinely new Thomas-only decision, a security waiver, a
  destructive/irreversible action, or an unavailable external credential with no
  alternative. One red PR, one blocked reviewer, or one provider hiccup is never enough on
  its own.
- **Keep `status.md` and `decision-log.md` current every session that changes something
  durable**, not only at the end of a stage. The staleness that caused confusion here came
  from treating "durable transition" as a reason to defer the update rather than a trigger
  to make it immediately.

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
10. Repeat the same failing approach more than three times — a fix attempt, a test rerun, a
    model/provider route — without changing something or asking. Classify the failure, try a
    different approach, or write down what you tried and stop to ask. This is a general
    anti-thrashing rule, not only about model routing.
11. Name a table, column, capability, feature flag, event key or job that is not in its
    single authoritative document — add it there first, in the same change.
12. Delete anything without a **pending action** — every user-initiated deletion returns
    `202` and waits for approval (`docs/01-architecture/pending-actions.md`). No
    `confirm: true`, no client-side dialog as the control.
13. Invent an MCP permission, a SCIM-only tenancy rule, or any path by which an identity
    provider, group or SCIM attribute grants `instance:admin` or `sees_all`.
14. Keep, flag or "leave for later" an inherited kaneo integration router — they are deleted
    at fork (`docs/01-architecture/inherited-features.md`); plugin contracts are the way
    back.
15. Start building a feature while its section in `docs/07-planning/reviews/2026-09-05/` is
    non-empty.
16. Commit, push or merge outside the flow above. A report is not approval; the flow is the
    standing approval. Never leave finished work uncommitted on a local machine.
17. Guess at behaviour — if the spec does not say, stop that decision path, propose the
    clarification, and write the answer into the spec once it exists.
18. Claim something works without running it — every screen touched is opened and listed.
19. Spawn a subagent without a concrete, bounded deliverable (exact files/question, exact
    expected output). Exploratory fan-out that produces no usable report is wasted spend,
    not progress.
20. Let two lanes edit the same file, or the same shared contract, concurrently.

---

## Licensing

| Source | Licence | What we take |
| --- | --- | --- |
| kaneo | MIT | **Code.** Keep the copyright headers |
| Plane | AGPL-3.0 | Ideas. Code is legal but we choose not to |
| OpenProject | GPL-3.0 | Ideas |
| TaskDesk v1 | Ours | Domain logic, reimplemented in TypeScript |

Never paste code from anywhere else without checking the licence and recording it in
`THIRD-PARTY-NOTICES.md`.

**Implementation reads kaneo (the snapshot taken) and TaskDesk v1 (domain logic) only.**
Never read, mine or copy from Plane, OpenProject, or the researched ITSM systems (Chatwoot,
FreeScout, GLPI, NocoBase, osTicket, Zammad). That research is finished and recorded in
`THIRD-PARTY-NOTICES.md` §2 and `docs/00-overview/competitive-inspiration.md`; re-opening
those trees during implementation is how unlicensed code travels into an AGPL-3.0 codebase.

Detail:
[`docs/00-overview/licensing-and-attribution.md`](docs/00-overview/licensing-and-attribution.md)

---

## Where we are

[`docs/07-planning/status.md`](docs/07-planning/status.md) — the durable, dated snapshot.
Read it before starting; keep it current when something durable changes, not only at a
session's end.

---

## Why the rules feel strict

Because most of the code here is written by AI agents with no memory between sessions, and
because v1 failed for reasons that discipline alone did not prevent.

Given a fixed vocabulary and a build that rejects invention, agent output is remarkably
consistent. Given freedom, it is remarkably inconsistent.

The constraints are not distrust. They are what makes a team of one human and several agents
able to produce one coherent product, and to actually ship it.
