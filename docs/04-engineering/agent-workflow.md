# Agent workflow

**The one canonical execution workflow** — how tasks run, change state, get reviewed, reach
`main`, get released, escalate and resume. Read [AGENTS.md](../../AGENTS.md) (authority, roles,
rules) and the [active mission](../07-planning/active-mission.md) (what is authorized now)
first. Acceptance definitions live in the [Definition of Done](definition-of-done.md); failure
handling in the [error fix loop](error-fix-loop.md). This file does not restate either.

---

## Operating modes

The active mission names the mode. Each mode's boundary:

| Mode | Do | Do not | Leaves the mode when |
| --- | --- | --- | --- |
| **Policy maintenance** | Audit and correct instruction files, templates and policy records through one owning PR | Implement product features; change the conductor's queue, scheduler or merge order | The policy PR is accepted or Thomas reassigns it |
| **Integration freeze** | Compose existing branch work onto accepted `main`; fix conflicts, security defects, regressions and acceptance failures against approved contracts | Build an unimplemented spec; treat a missing product decision as an acceptance fix; merge a cumulative head wholesale | Every frozen-scope task is `DONE`, `SUPERSEDED` or waiting on Thomas |
| **Feature development** | Implement explicitly authorized roadmap scope through the full [SDLC](sdlc.md) | Start scope the mission does not name | Thomas changes the mission |
| **Release and SIT verification** | Publish the accepted artifact to the destinations the active mission names, deploy the exact digest to the approved test environment, verify complete workflows and recovery, run the independent audit, report | Publish anywhere else; deploy to production (Thomas only); start roadmap work after acceptance | Acceptance and audit are reported → **Hold** |
| **Hold** | Record exact state; answer Thomas | Invent work to stay busy | Thomas issues a new mission |

---

## Roles and authority

[AGENTS.md § Roles](../../AGENTS.md#roles) defines who may do what. In practice:

- **One agent per branch.** Partition parallel work by file and shared contract; a shared
  contract gets its own bounded PR and one owner at a time.
- **The conductor alone** owns the queue, the dependency graph, shared test windows and
  runtimes, migration allocation, merge order, release coordination and the single
  continuation mechanism. Other agents read these; they do not create, retarget or edit them.
- **A lane** owns only its bounded deliverable. It commits and pushes its branch without
  asking, and finishes by returning a handoff. A lane never declares a stage, the mission or
  the project complete.
- **Two controls are absolute:** no agent approves its own design review or its own code
  review, and no agent waives a quality gate.

### Assigning a task

```markdown
## Task          One sentence.
## Mode          Which operating mode authorizes it.
## Spec          Path, and the numbered rules in scope.
## Depends on    Exact PR/SHA, artifact, decision or result — or "none".
## Files         Starting point, not exhaustive.
## Done means    The applicable level from definition-of-done.md § Levels of done.
## Out of scope  What not to do. Agents expand scope helpfully; say no in advance.
```

### Returning a handoff

```markdown
## Result        DONE / WAITING_* / BLOCKED / SUPERSEDED, and why.
## Source        Branch, exact head SHA, PR.
## Evidence      Commands run, counts, run IDs, artifact digests — each bound to its SHA.
## Not done      What was left out or could not be verified.
## Next action   The one concrete next step, and who owns it.
```

---

## Task states

The queue uses exactly these states:

```
READY → RUNNING → WAITING_CI ─────┐
           │    → WAITING_REVIEW ─┴→ READY (dependency resolved) → RUNNING …
           │
           ├→ WAITING_DECISION   (a real question only Thomas can answer)
           ├→ BLOCKED            (a named prerequisite prevents execution)
           └→ DONE | SUPERSEDED  (terminal)
```

| State | Means | Required fields |
| --- | --- | --- |
| `READY` | Dependencies satisfied; nobody running it yet | — |
| `RUNNING` | An owner has a concrete next action | Owner, next action |
| `WAITING_CI` / `WAITING_REVIEW` | A named gate is pending on an exact SHA | The check or review, the SHA |
| `WAITING_DECISION` | An actual unresolved owner or spec choice | The exact question, its options |
| `BLOCKED` | A named prerequisite is missing | The required source, artifact, decision or result |
| `DONE` | The task's level of done is met (a merged PR task may be labelled `MERGED`) | Evidence |
| `SUPERSEDED` | Another task absorbed it after its unique work was preserved | Successor and preservation proof |

Rules that hold everywhere:

- **A blocked or waiting task blocks only the tasks that depend on it.** Name the dependency;
  never write a blanket "wait for X".
- **A pending decision stops only the decision path it governs.** Unrelated authorized work
  continues.
- **CI or review completing is a transition, not a reason to end a session.** The conductor
  advances the queue.
- **When nothing is executable** because CI, reviews or other tasks are running, checkpoint
  and **yield with a named resumption trigger** (for example "CI run 123 completes" or "review
  of `<sha>` returns"). Do not declare completion, cancel active work, busy-wait, invent work,
  start new scope or loosen a gate. Resuming needs a working platform mechanism (see
  [continuation](#sessions-handoff-and-continuation)); a prompt is not a scheduler.
- Terminal states never authorize deleting a branch.

---

## The conductor loop

1. **Establish truth.** GitHub is newer than any file: refresh exact heads, reviews and check
   rollups. If the queue or `status.md` disagrees with GitHub, correct the record.
2. **Advance.** Move tasks whose dependencies resolved to `READY`; dispatch `READY` tasks to
   owners with the assignment format above.
3. **Merge what is eligible.** For each candidate meeting
   [merge readiness](definition-of-done.md#levels-of-done), merge through the protected flow,
   refresh `main` and re-evaluate dependants.
4. **Release** when the mission's sequence reaches it (see [Integration and
   release](#integration-and-release)).
5. **Checkpoint.** Record state, evidence and the next action in the queue, transcribing lane
   handoffs. Lanes do not edit the queue themselves.
6. Repeat. Stop only in **Hold**, or when every remaining task is waiting on Thomas, an
   external credential or capacity — and say so. Tasks waiting on CI or review are not a stop
   condition: they resolve into transitions.

**Records stay out of candidates.** Queue and `status.md` checkpoints go in the conductor's own
records PR (a branch carrying only those files), never onto a reviewed product candidate. A
status update is not an acceptance candidate and never forces a new product review.

Calendar pressure changes urgency, not gates.

**Duplicate work** (the same change in two branches): compare semantically, preserve every
unique commit or hunk on the surviving branch, record the preservation, then mark the other
`SUPERSEDED` with a pointer. Never close or rewrite another agent's branch without telling its
owner.

---

## Reviews

### Review roles

| Role | Competence | Independence |
| --- | --- | --- |
| **Ordinary reviewer** | Correctness, tests, code quality, spec alignment | Did not author, direct or remediate the change |
| **Security reviewer** | Authorization, tenancy, secrets, CI/gate machinery, supply chain | Fresh context; did not author, direct or remediate; reviews after ordinary review clears |
| **Phase finalizer** | Cross-PR red-team over a whole stage | Did not orchestrate or merge that stage's PRs |
| **Sampled auditor** | Challenges the review system itself | Works from a packet another context prepared |

The same model may fill several roles; **the context and role must be independent**. A context
that materially authored, directed or remediated a change is not its independent reviewer.

### Model policy

| Role | Assigned models (any one, in its own independent context) |
| --- | --- |
| Implementation, context preparation, ordinary review, bounded architecture/alignment review | **GPT-6 Luna**, explicitly selected; or **Claude Sonnet 5.5** under the current mission |
| Security review, critical cross-boundary review, phase finalizer and final audit, broad or high-risk architecture review, security- or architecture-heavy context preparation | **GPT-6 Sol**; or a fresh **Claude Opus 5.5** context under the current mission |
| Conductor | The session Thomas designates — under the current mission a Claude Opus 5.5 session (a GPT conductor prefers GPT-6 Sol for broad governance or security work) |
| Read-only extraction (optional) | **Claude Haiku 5.5** under the current mission — never an author, reviewer of record or approver |
| Sampled auditor | **Claude Opus 5.5**, only from a packet another context prepared; never replaces a required review |
| Policy maintenance | The session Thomas assigns. Its PRs still receive the independent reviews, and the security pass, their tier requires |

**Source:** decision log 2026-09-29 (GPT-6 Luna/Sol routing); 2026-10-09 "Opus
policy-repair conductor" (Claude Opus for every role, in separate independent contexts, for the
policy repair); and 2026-10-09 "Mixed-model routing for the delivery mission" (the
Opus/Sonnet/Haiku split above). These are disclosed changes of **who** reviews, not of review
depth, counts or independence. Models are
not interchangeable labels: one context never fills two roles on the same change, and the
author's context is never its reviewer.

Every review records the model and version **as the platform reports it** (for example
`Claude Sonnet 5.5 (claude-sonnet-5-5)`, `Claude Opus 5.5 (claude-opus-5-5)`), its role,
context, exact source, scope and verdict. **Never label a report with a model that did not
produce it** — a Claude report is never recorded as GPT-6 Luna or GPT-6 Sol, nor a Sonnet
report as Opus, and historical reviews keep their original identity. An existing review counts
for a role only where its scope and source coverage are established; it never approves later
changes. Reviews completed under an earlier assignment stay valid for what they covered.

The PR-template check reads the accepted security-review models from the block below **as it
stands on the merge base** (`main`), so a candidate cannot edit this block and approve itself
with the edit (`scripts/ci/lib/review-models.mjs`; where that reader is not yet on `main`, the
check still accepts only `GPT-6 Sol`). A change to the checker itself runs its own copy under
`pull_request`, like every CI control, and is held by the security-review path list. Each
line is matched exactly against the `**Model:**` field of `## Security review`. Once
installed, `check:policy` keeps the block well formed. The block follows the mission: the
change that replaces the active mission re-decides it in the same reviewed change.

<!-- policy:security-review-models -->
- `GPT-6 Sol`
- `Claude Opus 5.5 (claude-opus-5-5)`
<!-- /policy:security-review-models -->

If no assigned model is available, the candidate waits, marked **SECURITY RE-REVIEW PENDING —
CAPACITY**; never downgrade. `pal-mcp`, `pal-reviewer`, 9Router and their failover routes are
retired, and a historical `pal-mcp` verdict is never current evidence for a new head.

### How many reviews

| The change | Ordinary review | Security review |
| --- | --- | --- |
| Records only, in their own PR: `status.md`, the queue, dated evidence files. **Not** review notes, decision-log entries, the active mission or any document a check reads | **one** independent factual check against GitHub and the evidence | — |
| Ordinary substantive work | **two** independent | — |
| Broad or high-coupling: migrations, API + UI in one change, concurrency, cross-package, stage integration | **three** | if in scope |
| Touches a security-scope path but provably changes no authority or gate pass/fail | **one** | lightweight confirmation |
| Bounded CI/gate or security fix of a narrow pass/fail case | **one strong** | one full pass |
| Auth, permissions, migrations, or a security control's core semantics | **two to three** | full pass |
| New capability, trust boundary or access-control schema | **three** plus domain review | full pass; decide on an ADR first |
| Agent authority or workflow policy, including any edit to the active mission (which also needs a traceable decision by Thomas) | **two** | full pass when it changes merge authority, review requirements, evidence reuse, retry behaviour or gate semantics |

The security-review path list in [ci-cd.md](ci-cd.md#pull-request-pipeline) is authoritative
for **when** a security review is mandatory; no row exempts a path on that list. A test or
probe under `scripts/ci/**` is classified by what its assertions enforce.

Each review records: exact candidate SHA and comparison base, independence, what was checked,
tests or reproductions run, blocking and non-blocking findings, residual risk, verdict. A
committed security note also carries `**Reviewed head:** <40-character SHA>`.

### Exact head and evidence reuse

Evidence belongs to the source it was produced on and stays labelled with that SHA. It may be
reused for a later SHA only when every commit landed in between leaves its inputs unchanged:

| Evidence | Its inputs (a change to any of these invalidates it) |
| --- | --- |
| Review verdict | Everything the review covered — i.e. anything except review records |
| Test results | Product source, tests, build configuration, dependencies, and any document a check reads (registers, configuration reference, decision log for waivers) |
| Image / runtime / SIT result | Product source, build configuration, dependencies, deployment |
| CI-script test results | `.github/**`, `scripts/ci/**` and the other control paths in ci-cd.md (a review verdict still follows the first row) |
| Required GitHub status checks | **Never reused.** They must be green on the exact candidate |

**Review records** cover only the authentic publication of an existing report in this
candidate's designated review record: lines **added** to its own notes
(`docs/07-planning/security-reviews/<this-pr>-*.md`) carrying a report whose origin is
verified and whose verdict is unchanged, and the reviewer-identity and review-link fields of
the PR body. They never cover rewritten findings, fabricated approval, new waivers, changed
source attribution, or any change to another PR's note or to historical security authority.
Historical notes are cited by product code as the rationale for live security decisions;
they are append-only. A necessary redaction (for example of a secret) is a separately
reviewed, labelled correction, with the original kept in restricted storage where
appropriate. Never publish sensitive transcript content just to claim verbatim reproduction.

A delta made only of review records needs **no new review of any kind**, so publishing a
review never demands another one. The conductor checks **every intervening commit** with the
same Git semantics `scripts/ci/lib/security-review-note.mjs` uses — merges charged per parent,
renames and mode changes counted as touching a file, a revert never restoring a clearance. A
final net-tree diff alone is insufficient. With plain Git:

```bash
git merge-base --is-ancestor <reviewed> <candidate>
git log -m --format=%H --raw --no-abbrev --no-renames <reviewed>..<candidate>  # only A/M of this PR's notes, mode 100644
git log -m --format= --numstat <reviewed>..<candidate>                          # deletions column is 0
```

The conductor then states "review-record-only delta verified" in the merge record.

Reviewer reports are published **unedited** with their provenance (model as reported, role,
context or spawn identity, exact SHA); the only permitted change is a labelled, separately
reviewed redaction.

**Every dispatched review is recorded**, whatever its verdict — including blocked, abandoned
and failed runs — in the candidate's review notes or PR. A reviewer is re-dispatched for the
same SHA and scope only for a recorded reason unrelated to its verdict (a crash, the wrong
SHA). The author never asks a reviewer to change its findings or verdict. A blocking finding
from any dispatched review stays open until an independent reviewer records its disposition.
When the same session dispatched the reviews and will merge (a delegated policy maintainer),
the conductor confirms the review set is complete before the merge. **Before relying
on any review record, the conductor traces it to a review it dispatched or can otherwise
verify.** A record that cannot be traced does not count. A hash identifies bytes; it is not
proof of independence or approval. Old approval never silently covers new product changes: a
delta that touches anything else is reviewed at the tier the delta requires.

### Batching and altitude

- Implement related fixes as a coherent batch, run meaningful tests as you go, freeze the
  candidate SHA, then review once at the required tier. After the freeze, fix **blocking**
  findings as one bounded batch and review that delta; defer optional improvements. No
  standalone reviews for small or speculative edits; no comfort rounds. Completed review
  scopes are not restarted automatically.
- Known findings in the spec's pre-build review register are inputs to the batch: map each to
  evidence. The author never closes its own finding; reviewers record the disposition.
- **Change altitude:** when the third round on the same mechanism finds the same defect class,
  stop patching instances. Add a structural invariant and non-vacuous regression tests, then
  review at the tier the result requires. Later narrower instances of the same class do not
  queue more ordinary rounds; a clean required security pass closes the tier.

### Phase finalizer

Before any stage P0–P7 is claimed complete, one fresh security-tier red-team pass covers
everything merged for that stage since the previous finalizer. It is additive: it never
replaces or postpones a per-PR security review. A defect it finds that a per-PR gate should
have caught is also a finding about that gate.

### Sampled big review

Selected only by Thomas or the conductor; never a per-PR wait. Before it runs, another context (never the
auditor itself) prepares a packet: PR/stage and exact SHAs; what changed and why; changed and highest-risk
files; specs, ADRs and rules in scope; the risk tier and why; ordinary and security verdicts
with unresolved findings; tests actually run with counts and notable negative tests; residuals
and `## Not done`; invariants to challenge; explicit spot-check questions. The auditor samples
against the real code and evidence and may pick its own targets. A credible pre-merge blocker
stops the candidate; a post-merge one gets an issue and a fix. A clean sample never replaces a
required review.

---

## Verification

Run what the change's risk requires before calling it done — see
[Definition of Done](definition-of-done.md). Then **open the screen and use it**.

- Scoped web checks: invoke runners directly (`pnpm --filter @taskdesk/web exec vitest run
  <paths>` / `... playwright test --config playwright.config.ts <spec>`). A stray `--` through
  a package script can select the whole suite; confirm the selected file count.
- Keep complete output of long suites in a private evidence file before summarizing.
  Truncated tool output is not a reason to rerun a suite; rerun only unresolved failures to
  diagnose them.
- Integration tests need a **private `*_test` Postgres database per concurrent lane**.
  Shared lane databases create false failures. Keep host load bounded.
- Policy-shadow verification for development/P0 uses three issue-free UTC dates with
  source-bound coverage; a note-only change does not restart the window, elapsed time never
  clears a known failure, and other checks run without waiting for it
  ([runbook](../05-operations/runbook.md#policy-shadow-summary), decision log 2026-10-02).
- Public review artifacts describe public test vectors instead of embedding credential-shaped
  values; any redaction is labelled, with the original kept privately.

**Which checks run** on which change is defined in [ci-cd.md](ci-cd.md), including its
applicability rule; written policy never changes that by itself. A required check failing for a cause
outside the change (for example, an advisory against `main`'s lockfile) is assigned to that
cause's canonical owner; the PR is `WAITING_CI` on that named dependency and nothing unrelated
stops. Never disable a check, fabricate a status, or add a path exclusion to hide a shipped
dependency. Changing which checks apply is itself a CI/security-control change.

---

## Failures

Classify before you fix; change product code only for a demonstrated product cause; stop a
mechanism after three failures and diagnose its whole entry point. The procedure — including
the bounded verification policy for infrastructure failures and variable measurements — is the
[error fix loop](error-fix-loop.md).

---

## Integration and release

- **Integrate onto accepted `main`.** Compose selected owner units; never merge a cumulative
  integration head wholesale. Preserve every branch and its history. One migration ledger,
  allocated by the conductor.
- **Pre-merge evidence:** the required reviews, current required CI, and the runtime proofs a
  candidate can produce before merge (image build and boot, installer regression, applicable
  authorization proofs).
- **Post-merge evidence:** proofs that can only exist from accepted `main` — the signed
  release, installer, upgrade and rollback from the published artifact. They are verified after
  merge and before the task or stage that depends on them is closed. A main-only proof is never
  a prerequisite for merging an otherwise eligible candidate, and merging never closes a stage.
- **Publish** only to the destinations the [active mission](../07-planning/active-mission.md)
  names. Production deployment is Thomas's alone.
- **SIT:** deploy the exact published digest; verify complete authenticated workflows,
  migrations, health and recovery; bind every result to source SHA and image digest. Offline
  simulation and source review are diagnostic only.
- **After acceptance and audit:** report and enter Hold.

---

## Escalation and reporting

**Pause the affected task** (`BLOCKED` or `WAITING_DECISION`, with the reason) when a schema
change looks necessary that the task did not include, the task conflicts with an ADR, or the
codebase contradicts the task's assumptions in a way nobody foresaw. Other tasks continue.

Escalate to Thomas only what only Thomas can decide: product behaviour the contract does not
settle, a gate waiver, design approval, an irreversible or production action, unavailable
external access. Ask once, with concrete options. Technical diagnosis stays with the agents.

Reports use plain language and short sentences, and label each item: **question Thomas must
answer**, **decision Thomas must make**, **decision the conductor made** (with how to reverse
it), or **explanation**. State what merged, what is on `main`, what is merge-ready, what was
tested and reviewed (by which model/context), new findings, blockers and what was **not**
done. Never reopen a settled item. A report is a checkpoint, not a stopping point.

---

## Sessions, handoff and continuation

- Agent memory does not persist. **The repository is the memory.** Do not act on a remembered
  SHA or PR list; re-check. Before inferring a convention, read three or four files in the
  same area — one file may itself be wrong.
- Before a session ends: commit and push finished work. A lane writes its handoff (exact
  branch and head, state, evidence, blockers, the one next action, how to resume) in its PR;
  the conductor transcribes it into the queue.
- **Continuation is a mechanism, not a promise.** Only the conductor owns the one continuation
  (schedule, heartbeat). It exists only if its configuration can be read and it has a recorded
  run receipt; record its identity and scope in the queue. Before creating one, inspect what
  exists; never create a duplicate; lanes never create or retarget one. If none is verified,
  say so and leave an explicit resume task — never imply an ended session continues by itself.
  Stay quiet while blocked state is unchanged; notify on meaningful progress, failure or a
  required owner action.
- A continuation obeys every gate and stops at the mission's stop condition.

---

## Skills

`skills/` holds `improve-animations` and `find-animation-opportunities` (kept from kaneo).
Prefer a skill over freehand work where one fits.

## Related

[AGENTS.md](../../AGENTS.md) · [Active mission](../07-planning/active-mission.md) ·
[SDLC](sdlc.md) · [Definition of Done](definition-of-done.md) ·
[Error fix loop](error-fix-loop.md) · [CI/CD](ci-cd.md) · [Coding standards](coding-standards.md)
