# Workflow and agent-policy audit — 2026-10-09

A dated record, not policy. It explains the restructure the
[decision log](decision-log.md) entry "Owner directive: workflow and agent-policy restructure"
describes, and hands off what this change deliberately did not do.

- **Author:** Opus 5.5 policy maintainer (owner-assigned), branch
  `claude/workflow-policy-restructure-20261009`.
- **Base:** the #612 policy branch as published at the start of this work (its history is kept
  unchanged underneath this change), itself based on accepted `main`.
- **Live state at audit time** (refresh before acting): 23 open PRs; #612 open with its
  required dependency-audit check red; #601 draft also editing `agent-workflow.md` and
  `sdlc.md`.

---

## 1 · Ownership decision

#612 (`codex/control-plane-integration-freeze-20261009`) was the existing policy PR, authored
and reviewed by a separate GPT lane. Its fixes were sound but **appended** further operative
paragraphs, so the same rule now existed in three to six places. Pushing to another agent's
branch was not appropriate, so this change is the **designated successor**: it is built
directly on #612's published head, keeps every #612 commit and review note unchanged, and
consolidates on top. No second competing definition of the workflow exists — when this
successor merges, #612's content merges with it.

Requested of the conductor: freeze #612 (no further commits), then either merge this
successor in its place or, if #612 merges first, rebase this branch onto `main` (it then
reduces to the consolidation commits alone).

---

## 2 · Contradiction register

Type: **C** contradiction · **A** ambiguity · **D** duplication · **S** legitimate safeguard ·
**T** tool/implementation defect · **F** observed failure mode.

| # | Type | Rule / location | Conflicts with / observed failure | Impact | Replacement | Validation |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | C | `main` CLAUDE.md: "currently working toward **P4 complete** … do not stop" | Freeze directive; P4 frozen | Agents resume feature work after every checkpoint | Mission removed from every permanent file; lives only in `active-mission.md` | Invariant "no P4-completion mission" |
| 2 | C | `main` agent-workflow: "working tree stays uncommitted until Thomas says commit" | AGENTS do-not 16 standing flow | Lanes stall waiting for a commit prompt | AGENTS roles: lanes commit/push without asking | Invariant "no commit-only-when-Thomas-says" |
| 3 | C | Decision log 2026-10-09 freeze entry: "resume the queue **after** the control-plane PR is accepted" | Conductor directive: no global wait | Whole queue waits on a docs PR | Task-state rule: a wait blocks only named dependants | Invariant "no global wait"; scenario 2–3 |
| 4 | C / F | DoD integration checklist: ordinary exact-candidate review still required after note-only commits | CI note-only rule exists so recording a review does not reopen it | #612 gathered 15 review notes and three rounds of note-only "re-verification" | Review-record-only delta (lines added to the PR's own notes) needs no new review; conductor verifies over landed commits and traces each record; historical notes append-only | Scenario 4 |
| 5 | C / T | "Use the **approved retry policy**" (AGENTS, CLAUDE, error-fix-loop, decision log) | No such policy exists anywhere; only G11's per-metric sampling | Ad-hoc reruns, or stalls with nobody able to cite the rule | Bounded verification policy in error-fix-loop (one pre-test infra re-run, inactive until Thomas approves; no re-runs meanwhile; G11 sampling unchanged) | Scenario 6; grep shows one definition |
| 6 | C | CLAUDE.md (auto-loaded by Claude Code) declares itself the **OpenAI** guide and limits Opus to sampling | Owner-assigned Opus policy work; Claude sessions read it as their instructions | Model files veto owner authority; provider file carries policy | CLAUDE.md is a provider adapter only; "Policy maintainer" role; model policy row | Invariant "model names only in model policy…" |
| 7 | A | "orchestrator", "orchestrating session", "top-level orchestrator", "root", "conductor", "control-plane auditor" | One role, six names | Unclear who may merge or own continuation | "Conductor", with the older names as declared aliases | Read-through |
| 8 | A | Stop conditions spread across AGENTS "Keep moving", workflow "stopping", SDLC, CLAUDE | No single definition of task vs PR vs stage vs mission done | Subagents declare completion; sessions end on CI completion | Task-state model + five **levels of done** | Scenarios 1, 9 |
| 9 | D | Review tiers, model routing, bulk cadence, Opus packet, phase finalizer | Stated in AGENTS, CLAUDE and agent-workflow (three near-copies) plus SDLC/DoD fragments | Copies drift; reviewers cite different text | One home: `agent-workflow.md § Reviews` | Invariant "review-count table defined once" |
| 10 | D | Mission text (freeze, GHCR, SIT, stop) | Six files | Every mission change needs six edits | `active-mission.md` | Invariant "mission name only in…" |
| 11 | D | Three-attempt rule | AGENTS do-not 10, workflow, SDLC step 7, error-fix-loop, decision log | Five versions of the count | Error-fix-loop only; others link | Read-through |
| 12 | D / F | Queue file and `status.md` | Identical checkpoint paragraphs; queue checkpoints sit **above** its own title; queue contains a policy paragraph ("Execution boundary and state definitions") | Status/queue edits read as policy; every checkpoint duplicated | Rule: records are evidence, never policy; state model in workflow. **Queue not edited** (conductor-owned) — see follow-up F4 | — |
| 13 | F | Runtime evidence runner iterated V24 → V44 as "fresh" versions | Three-attempt rule counted per version | Repeated live attempts without whole-path diagnosis | Count is per **mechanism**; version names never reset it; seven-step post-limit sequence; end-to-end chain from launcher to cleanup | Scenarios 5–6 |
| 14 | S | Every PR runs every required check, incl. dependency audit and G11 | Policy-only #612 red on `main`-wide advisory and timing | Docs PRs trapped by unrelated product state | **Kept** (enforced). Failure assigned to its owner; PR waits on that named dependency only. Path-aware scoping proposed separately (F1) | Scenario 3 |
| 15 | T | PR-template check hard-codes `GPT-6 Sol` for security-scope paths | Model-independent review roles | Owner cannot assign another qualified reviewer without a CI change | Roles defined model-independently; assignment table kept; checker change proposed (F2) | — |
| 16 | S | Note-only rule judged over landed commits, merges charged per parent | — | Merging `main` into a reviewed branch makes notes stale | **Kept** | — |
| 17 | D / stale | workflow "three agents: Copilot, OpenAI agent"; Skills table of five skills that do not exist; CLAUDE cites `.claude/agents/pal-reviewer.md` (absent) | Repository reality | Agents look for tools that are not there | Stale text removed; `CODEOWNERS` `.claude/agents/` entry left (F3) | `ls skills .claude` |
| 18 | C | #601 (draft, conductor-owned) rewrites `sdlc.md` stage sequencing to allow parallel stage implementation | Freeze: feature development inactive | Re-opens feature scope through an SDLC edit | Stage scope now set only by the active mission; #601's workflow hunks are superseded (F6) | Scenario 8 |
| 19 | A | Read order put the queue above the decision log; #612's PR body states rules ("No source change or suite rerun is justified…") | Evidence vs policy | PR bodies and checkpoints become de-facto rules | Hierarchy names everything else as evidence; do-not 22 | Read-through |
| 20 | F | "Use an available thread continuation/heartbeat" in lane-readable text; an extra observation schedule exists | Single conductor-owned continuation | Duplicate schedules; sessions promising to resume | Only the conductor owns one continuation, proven by configuration and a run receipt | Scenario 10 |
| 21 | C | `ci-cd.md § Branching`: "Squash merge" | `main` history uses merge commits (`Merge pull request #579 …`) | Practice ≠ the recorded selection | **Corrected 2026-10-09 (Instruction 1):** the documentation was right — squash is the explicitly selected method (decision log 2026-09-06) and the ruleset permits it; merge commits were a practice deviation. Recorded in the decision log; `ci-cd.md` wording clarified in the enforcement PR | `gh api repos/…/rulesets` allows merge, squash, rebase |
| 22 | A | DoD/SDLC branch rule "`codex/…` by default" | Provider-specific naming in permanent policy | Non-Codex agents look non-compliant | `<agent>/…` or `feat/fix/docs/chore` | No checker enforces prefixes |

---

## 3 · Policy map — where each rule now lives

| Rule | Single home |
| --- | --- |
| Authority hierarchy; evidence ≠ policy; enforced gates outrank prose | `AGENTS.md § Authority` |
| Roles and who may commit, merge, waive, approve | `AGENTS.md § Roles` |
| Operating-mode definitions | `AGENTS.md § Operating modes` (behaviour: `agent-workflow.md § Operating modes`) |
| Current mission, scope, environments, conductor, stop condition | `docs/07-planning/active-mission.md` |
| Five rules, do-nots, identifier authority, licensing | `AGENTS.md` |
| Protected-merge flow | `AGENTS.md § How work reaches main` |
| Task states, blocking, conductor loop, duplicates, records | `agent-workflow.md` |
| Review roles, model policy, review counts, evidence reuse, batching, altitude, finalizer, sampled review | `agent-workflow.md § Reviews` |
| Verification practice; how unrelated CI failures are routed | `agent-workflow.md § Verification` |
| Integration, pre-/post-merge evidence, publication, SIT | `agent-workflow.md § Integration and release` |
| Escalation and reporting to Thomas | `agent-workflow.md § Escalation and reporting` |
| Handoff and continuation | `agent-workflow.md § Sessions, handoff and continuation` |
| Levels of done; checklists; stage gate | `definition-of-done.md` |
| SDLC steps | `sdlc.md` |
| Failure classes, bounded verification, three-attempt rule, end-to-end runner validation | `error-fix-loop.md` |
| Security-review path list; CI check list | `ci-cd.md` (unchanged) |
| Provider invocation notes | `CLAUDE.md` |
| Task state | `integration-execution-queue.md` (conductor) |

---

## 4 · Scenario validation

Policy behaviour, checked by reading the governing text. No runtime or production action.

| Scenario | Governing text | Required behaviour | Result |
| --- | --- | --- | --- |
| CI finishes while another task is ready | workflow § Task states ("transition, not a reason to end"); § Conductor loop | Conductor advances the queue | Covered |
| One API decision awaits Thomas | § Task states (`WAITING_DECISION`; "stops only the decision path") | Only dependants wait | Covered |
| Policy PR has an unrelated dependency failure | workflow § Verification ("CI today"); error-fix-loop § When a build fails | Assign to dependency owner; PR `WAITING_CI` on that; integration continues | Covered |
| Review-note-only commit follows a completed review | workflow § Exact head and evidence reuse; DoD § Levels of done (merge-ready) | No new review; conductor verifies path list mechanically | Covered |
| Runner helper tests pass but the invocation omits inputs | error-fix-loop § End-to-end validation | Regression drives launcher → … → cleanup; injected helper inputs insufficient | Covered |
| Same runner fails repeatedly under new version names | error-fix-loop § The three-attempt rule ("does not reset the count") | Limit applies; seven-step sequence | Covered |
| Signed release can only publish from accepted `main` | workflow § Integration and release (pre-/post-merge evidence) | Pre-merge checks stay; real-release proof after merge, before closure | Covered |
| Existing PR duplicated in another branch | workflow § Conductor loop ("Duplicate work") | Preserve unique work, then `SUPERSEDED` with pointer | Covered |
| SIT acceptance finishes | active-mission § Stop condition; workflow § Operating modes | Report and Hold; no roadmap work | Covered |
| Agent session ends | workflow § Sessions, handoff and continuation | Record exact resume state; continuation only if verified by config + receipt | Covered |

## 5 · Validation run

- Link and anchor check over every Markdown file: **4** broken links in live docs, identical to
  the #612 baseline (all pre-existing: two queue links to a missing
  `branch-conservation-inventory.md`, one data-model link, one MCP workflow link). Historical
  records: **15** broken, identical to baseline (a hidden anchor keeps the old
  `#bulk-implementation-and-review-cadence` links resolving).
- Policy invariants (no SHAs, no live PR numbers in entry/workflow/adapter, no P4-completion
  mission, no commit-on-request rule, mission name only in the mission record, review counts
  defined once, model names confined, no global wait, no promised continuation): **10/10 pass**.
- Register checks run locally on this tree: `check:vocabulary`, `check:env`, `check:reviews`,
  `check:skips`, `check:inventory`, `check:events` — all exit 0. No checker parses the edited
  policy prose. CI messages citing `AGENTS.md` rule 2 and do-nots 5, 7, 11, 18 point at the
  same items; do-not 15's wording now follows the 2026-10-02 decision (findings mapped and
  dispositioned before merge) while `check-reviews.mjs` still describes the older "not started"
  wording — see F3.
- No `.github/**`, `scripts/ci/**` or `ci-cd.md` change, so CI will not demand a security
  review. **The restructure's own policy row does:** it changes review requirements, evidence
  reuse and retry behaviour, so it needs a full GPT-6 Sol pass before merge.

## 6 · Follow-ups — separate reviewed changes, not in this PR

| # | Change | Why separate | Proposed owner |
| --- | --- | --- | --- |
| F1 | **→ enforcement PR.** Path-aware required-check matrix: docs wording → links/consistency/secret scan; policy/authority → policy review + scenario checks; templates/CI checkers → structural tests and red probes; product/dependency/deployment → full applicable gates; release candidate → full release + SIT | Changes which checks apply = CI/security-control change; needs ruleset update and Thomas's approval | Conductor; security-tier review |
| F2 | **→ enforcement PR.** PR-template check: accept the security reviewer assigned by the model policy instead of the literal `GPT-6 Sol` | `scripts/ci/**` is security scope | Conductor; security-tier review |
| F3 | **→ enforcement PR.** Stale references to moved text: PR template ("CLAUDE.md's Opus 5.5 section", "AGENTS.md's Sampled big review"); `CODEOWNERS` `.claude/agents/` entry and its pointer to "CLAUDE.md's control plane section"; `check-pr-template.mjs` "GPT-6 Sol, always (AGENTS.md)"; `gate-waiver.mjs` "AGENTS.md and CLAUDE.md now both say"; `check-reviews.mjs` do-not 15 wording; `ci-cd.md § Branching` squash statement vs merge commits, and its duplicated merge authority | `.github/**`, `scripts/ci/**` and `ci-cd.md` are security scope | Conductor |
| F4 | **→ conductor, by coordinated handoff** (queue removed from this candidate; see §9). Queue file: move checkpoints below its title, stop duplicating `status.md`, replace its "Execution boundary and state definitions" paragraph with a link to workflow § Task states, fix the missing inventory link | Conductor-owned record | Conductor |
| F5 | **→ enforcement PR.** Turn this audit's link and invariant checks into a CI check | `scripts/ci/**` | Conductor |
| F6 | **→ conductor.** #601: drop its `agent-workflow.md`/`sdlc.md` hunks (superseded here) when composing it | Conductor-owned PR | Conductor |

## 7 · Handoff — what active agents must reload

Reload, in order: `AGENTS.md` → `docs/07-planning/active-mission.md` →
`docs/04-engineering/agent-workflow.md` → `CLAUDE.md` (Claude sessions; GPT agents read its
GPT section). Specialists: `definition-of-done.md § Levels of done`, `error-fix-loop.md`.

Superseded on merge:

- CLAUDE.md as the "OpenAI operating guide", and every mission, routing and review-tier
  paragraph it carried.
- AGENTS.md's "Authority and Integration Freeze Mode", "Bulk implementation and review
  cadence", "Keep moving" and full review-tier sections (now single-homed as above).
- The DoD rule requiring ordinary re-review of review-record-only commits.
- Every reference to an "approved retry policy" (now the bounded verification policy, whose
  one re-run allowance is inactive until Thomas approves it).
- Branch prefix `codex/…` as the default.

Not changed: model assignments, every review count other than the disclosed records-only and
workflow-policy tiers, the security path list, every required check,
merge authority, waiver and design-approval authority, the freeze, GHCR-only publication and
the SIT stop condition. **This policy is proposed until it merges through the protected flow
with its required reviews and CI.**

## 8 · Independent review outcome

Two fresh, non-forked Opus 5.5 contexts reviewed `c0d5ef6a8e76767c7e27d6636f3a61e42c1c5f12`;
both returned **BLOCKED**. Their reports are committed verbatim as
`security-reviews/615-workflow-policy-*-opus.md`. Every blocking finding and the substantive
non-blocking ones were fixed as one batch:

- Review records narrowed to lines added to the PR's own notes plus PR-body reviewer fields;
  historical notes append-only (they are cited by product code).
- Review-record-only check now over landed commits (ancestor + per-commit `name-status` and
  `numstat`), mirroring the CI note rule rather than claiming to equal it.
- Fabricating review evidence or marking an independent review `n/a` restored to do-not 7;
  merge-ready requires each record to be traced to its reviewer.
- One stop rule: waiting on CI or review is never a stop condition.
- Independent whole-entrypoint diagnosis and an agreed bounded repair restored to the
  three-attempt sequence; end-to-end regression applies to every runner fix.
- Lanes hand off; only the conductor writes the queue and `status.md`.
- Re-run allowance narrowed (per job per task, pre-test failures only) and inactive until
  Thomas approves it.
- Disclosed review-tier changes; merge-ready includes pre-merge runtime proofs and no
  unresolved blocking finding; restored owner chat directives, control-plane ownership,
  dropped Sol model rows, packet authorship, policy-shadow rules, continuation notification
  and convention-reading guidance.

**Round 2** (delta to `ed7bb516b2f4e1b0d2c0ddb53f7e036c79419aa8`): consistency **CLEAR WITH
NON-BLOCKING**. Authority closed all three original blockers but **BLOCKED** on transport — the
first commit of the notes (`7955d7df`) was a reformatted transcription labelled verbatim. The
notes now hold the reviewers' final messages extracted mechanically from the subagent
transcripts, byte-identical, with SHA-256 digests. Round-2 non-blocking items were fixed:
audit claims qualified; redaction exception to append-only notes; interim no-re-run rule
recorded with a `WAITING_DECISION` path, and a commit made to get another CI run counts as a
re-run; relayed chat instructions are not owner instructions; lanes may record Thomas's
task decisions in their own PR; both landed-commit listings required; DoD pre-build register
wording aligned to mapping and disposition. One item was not a gap: test names citing spec
rules is already required at `sdlc.md` step 4.

**Round 3** (fresh context, delta to `889daa135cfab536380382a74afadd12bd30ff25`): **CLEAR WITH
NON-BLOCKING**; transport verified byte-identical against the original transcripts. Its six
non-blocking items were fixed in the following commit: lane decision-log entries aligned
with the SDLC/DoD; only owner-decision entries carry owner authority; relayed instructions
need recording on `main` or by the direct recipient; re-run counting by unchanged inputs;
`--summary` added to the landed-commit listing; redaction exception mirrored in the decision
log; spawn provenance added to the note headers. **That final commit has not been reviewed by
an Opus context**; it falls to the required reviews below.

These Opus reviews are additional evidence. The required GPT-6 Luna ordinary reviews and the
GPT-6 Sol pass are still outstanding.

## 9 · Instruction 1 — Opus policy-repair conductor (2026-10-09)

Thomas authorized an Opus session to finish the repair, get it accepted, hand it over and
stop. Recorded in the decision log ("Opus policy-repair conductor"). Changes to this candidate:

- **Model policy:** Claude Opus 5.5 may fill every role in separate independent contexts; GPT
  roles stay valid; reports carry the platform-reported model; accepted security-review
  models live in a machine-readable block that the PR-template check will read **from the
  merge base**.
- **Re-run rule:** the approved one-re-run rule replaces the inactive allowance.
- **Startup order, authority wording, yield-with-trigger, review-record scope and hash
  caveat** aligned to the directive.
- **Records out of the policy candidate:** #612's queue snapshot and `status.md` checkpoint
  are removed from this tree. Preservation check against #601 (conductor's records PR, head at
  the time of the check): its queue holds every #612 checkpoint (12:40, 03:47 and the human
  decisions section) and its `status.md` holds the 12:40 checkpoint. #612's "Historical
  control-plane snapshot" section exists only in #612's own commits, which this candidate
  keeps in its history. Policy files now name the queue by path, without a link, so nothing
  breaks before #601 lands.

**Why two PRs.** The enforcement work (model-aware PR-template check, check applicability,
executable policy check, `.github`/`scripts/ci`/`ci-cd.md` reference fixes) is security scope.
Its checker must take the accepted reviewer models from the trusted merge base, so it can
accept an Opus security review only after this candidate — which adds Opus to that block —
is on `main`. That is a technical boundary, not a preference.

**Merge gate today.** Every PR currently runs every required context. On this candidate the
required `supply chain - dependency audit` (four high/critical advisories in `main`'s
lockfile) and `performance - budgets (G11)` (board render and LCP over budget on `main`'s
product) fail for reasons no documentation change can affect. Those failures belong to the P0
owner (#602, with #614). The applicability change cannot clear them for itself either: it
classifies with the classifier from the merge base, which does not exist until it merges.

## 10 · Enforcement change and validation (Instruction 1)

The enforcement half is PR #616 (`claude/policy-enforcement-20261009`, based on `main`). It
depends on this candidate: its `check:policy` and its model-aware PR-template check read files
that exist only once this candidate is on `main`. Merge order: this candidate → rebase #616 →
delta review → merge.

| Item | Where it is now |
| --- | --- |
| F1 check applicability | #616: merge-base classifier, `change-scope` action, `needs: scope` gates, workflow-gates A9, ci-cd.md § Applicability |
| F2 model-aware security review | #616: `lib/review-models.mjs`, `check-pr-template.mjs`, probes |
| F3 stale references and merge method | #616: template, `CODEOWNERS`, `gate-waiver.mjs`, `check-reviews.mjs`, ci-cd.md |
| F4 queue/policy separation | This candidate carries no queue; the policy names it by path. Remaining queue-schema cleanup is the conductor's, by coordinated handoff |
| F5 executable policy checks | #616: `check:policy`, declared in ci-cd.md, `test-all.mjs` and the registers job |
| F6 #601 overlap | Conductor; #601's other status, decision and evidence content is unaffected |

**Scenario validation — executed vs read.**

| Scenario | How it was checked |
| --- | --- |
| Authorized branch publication | **Executed:** both branches pushed and both PRs opened through the normal flow; no direct push to `main` |
| One blocked decision with another runnable task | Read: workflow § Task states |
| CI / review completion | Read: workflow § Task states, § Conductor loop |
| Safe record-only publication | **Executed** by the round-2 authority reviewer: scratch-repo runs of the landed-commit listing against code-then-revert, deleted, renamed, appended, edited and merge-carried note cases |
| Forged verdict rejection | **Executed** for model labels: probes reject HEAD-only models, near-miss labels and malformed lists. A fabricated verdict *text* cannot be machine-detected; the trace-to-reviewer rule (read) covers it |
| Code-then-revert detection | **Executed:** change-scope probe (a reverted product commit keeps the PR full) and the reviewer's note-listing run |
| Equivalent-SHA retry counting | Read: error-fix-loop § Bounded verification policy |
| Actual runner invocation | Read: error-fix-loop § End-to-end validation (no runner changes here) |
| Main-only signed-release sequencing | Read: workflow § Integration and release |
| Final SIT stop | Read: active mission § Stop condition; DoD § Levels of done |

**Executed checks on #616's tree:** `test:ci-scripts` 1,140/1,142, with the 2 failures also on
an untouched `main` checkout (test-tree typecheck coverage); `test:all --list` reconciles;
`check:policy` passes on this candidate's tree and fails on `main` as designed.
