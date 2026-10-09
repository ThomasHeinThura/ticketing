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
| 4 | C / F | DoD integration checklist: ordinary exact-candidate review still required after note-only commits | CI note-only rule exists so recording a review does not reopen it | #612 gathered 16 review notes and three rounds of note-only "re-verification" | Evidence-reuse table: review-record-only delta needs no new review; conductor checks paths mechanically | Scenario 4 |
| 5 | C / T | "Use the **approved retry policy**" (AGENTS, CLAUDE, error-fix-loop, decision log) | No such policy exists anywhere; only G11's per-metric sampling | Ad-hoc reruns, or stalls with nobody able to cite the rule | Bounded verification policy in error-fix-loop (one infra re-run; G11 sampling unchanged) | Scenario 6; grep shows one definition |
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
| 21 | C | `ci-cd.md § Branching`: "Squash merge" | `main` history uses merge commits (`Merge pull request #579 …`) | Written policy ≠ practice | Not changed here (security-scope file) — F3 | `git log --merges origin/main` |
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
  policy prose; CI messages citing `AGENTS.md` rule 2 and do-nots 5, 7, 11, 15, 18 still point
  at the same-numbered items.
- No `.github/**`, `scripts/ci/**` or `ci-cd.md` change, so no new security-review path is
  touched. Required CI must still run on the exact published candidate; nothing here is
  inferred from earlier results.

## 6 · Follow-ups — separate reviewed changes, not in this PR

| # | Change | Why separate | Proposed owner |
| --- | --- | --- | --- |
| F1 | Path-aware required-check matrix: docs wording → links/consistency/secret scan; policy/authority → policy review + scenario checks; templates/CI checkers → structural tests and red probes; product/dependency/deployment → full applicable gates; release candidate → full release + SIT | Changes which checks apply = CI/security-control change; needs ruleset update and Thomas's approval | Conductor; security-tier review |
| F2 | PR-template check: accept the security reviewer assigned by the model policy instead of the literal `GPT-6 Sol` | `scripts/ci/**` is security scope | Conductor; security-tier review |
| F3 | PR template's reference to "CLAUDE.md's Opus 5.5 section"; `CODEOWNERS` `.claude/agents/` entry; `ci-cd.md § Branching` squash statement and duplicated merge authority | `.github/**` and `ci-cd.md` are security scope | Conductor |
| F4 | Queue file: move checkpoints below its title, stop duplicating `status.md`, replace its "Execution boundary and state definitions" paragraph with a link to workflow § Task states, fix the missing inventory link | Conductor-owned record | Conductor |
| F5 | Turn this audit's link and invariant checks into a CI check | `scripts/ci/**` | Conductor |
| F6 | #601: drop its `agent-workflow.md`/`sdlc.md` hunks (superseded here) when composing it | Conductor-owned PR | Conductor |

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
- Every reference to an "approved retry policy" (now the bounded verification policy).
- Branch prefix `codex/…` as the default.

Not changed: model assignments, review counts, the security path list, every required check,
merge authority, waiver and design-approval authority, the freeze, GHCR-only publication and
the SIT stop condition. **This policy is proposed until it merges through the protected flow
with its required reviews and CI.**
