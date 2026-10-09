# Integration execution queue

## Mission and policy

**Integration Freeze and SIT Consolidation**, authorized by the
[2026-10-09 owner directive](decision-log.md#2026-10-09--owner-directive-integration-freeze-and-sit-consolidation).
[AGENTS.md](../../AGENTS.md#authority-and-integration-freeze-mode) is canonical execution
policy; this queue supplies active task state only. New feature scope is frozen. Existing
functionality may receive integration/acceptance fixes. GHCR/GitHub Releases and SIT only;
no Docker Hub or production deployment. No phase completion or gate waiver is implied.

## Queue protocol

Each task records owner, state, dependencies, exact branch/head, next action, evidence and
blockers. States are **ready**, **active**, **blocked**, **accepted** and **deferred scope**.
A ready task must have a written authorized contract and no unresolved dependent product
decision. Re-read live heads/checks before acting; historical body claims are not acceptance.
Only the orchestrator updates shared queue ownership. Do not let two lanes edit one contract.

At each checkpoint record the tested source, actual commands/counts, independent review heads,
CI candidate and SIT artifact/runtime evidence. Preserve failed receipts and historical
verdicts. After repeated failures on the same mechanism, follow the structural convergence
protocol in [error-fix-loop.md](../04-engineering/error-fix-loop.md#the-three-attempt-rule)
before another runner iteration. Never transfer an older green result to new source.

A blocked task leaves unrelated ready tasks runnable. An unresolved product decision blocks
only dependent scope. Commit/push authorized completed work without repeated approval; only
the top-level orchestrator performs protected merges after the existing risk-appropriate
reviews and all required exact-candidate checks pass. At final integrated SIT acceptance and
independent audit, stop and await the next owner roadmap.

## Checkpoint — 2026-10-09

Fresh GitHub inspection found accepted `origin/main` at
`3096cb044bdf6ae98488bfc385f532fa6386343a`. The previous status snapshot is historical.
The following is a bounded initial reconciliation of the existing train, not permission to
implement every open issue or finish every draft feature. Refresh sources before composition.

| Task | Owner / state | Dependencies / source | Next action and acceptance evidence |
| --- | --- | --- | --- |
| Focused control-plane realignment | Top-level orchestrator / blocked for protected acceptance | `codex/control-plane-integration-freeze-20261009`, based on accepted main above | Reconcile seven requested surfaces plus decision/status records; three fresh independent Luna reviews because execution authority spans documents, then full independent Sol confirmation of authority/gate preservation; all required current-head CI before protected merge. Ordinary review of initial source and exact clarification deltas cleared; final published-candidate ordinary reviews and independent Sol confirmation remain required. Initial required dependency audit failed on unchanged source (three high/one critical); no merge or acceptance claimed. |
| Frozen-source and dependency inventory | Top-level orchestrator / ready after control-plane acceptance | Existing integration train [#589](https://github.com/ThomasHeinThura/ticketing/pull/589), observed head `2350397b18f83ed417bf63d73970daacdbaae49c`; existing lane PRs | Refresh live train/lane heads and source differences against accepted main; classify existing implementation versus new scope and unresolved decisions. Record the retained source manifest, dependency graph, migration allocations and risk-sized acceptance tasks before composing. Do not extend the old full-feature mission. |
| P0 runner convergence and current-source acceptance | Top-level orchestrator / blocked for acceptance; diagnosis is authorized | [#602](https://github.com/ThomasHeinThura/ticketing/pull/602), `codex/p0-final-scope-20261007`, observed head `66c736e71c87b2372ba1cbf8250236ac37191565` | Preserve failed V24/V26/V30 receipts and actual observation sources described in the PR. Identify structural projection/source-order cause; prove the complete actual runner invocation before another acceptance iteration. Current PR reports G11 19/22 failed and strict-runtime acceptance missing; verify logs/counts rather than reuse historical 22/22. No phase closure claim. |
| Existing P1–P4 train integration repairs | Top-level orchestrator / blocked on source inventory and owning contracts | Existing #589 train and retained lane sources; centralized migration ordering | From the manifest, select only existing functionality with resolved contracts, repair composition/integration defects, then exact-source tests/reviews/CI and real SIT journeys. Existing catalogue, identity, approvals, outbox, Users and URL/realtime lanes require individual contract/source classification; draft title or previous implementation authorization does not add scope. |
| Product-decision-dependent scope | Top-level orchestrator / blocked only for dependent tasks | Owning specs/decision log; #589 records unresolved portal admission, pending-action route/deprecation, approver-picker and quiet-hour/DST questions | Recheck whether each decision is already settled. Record only genuinely unresolved owner questions and their consumers. Do not invent DTOs/admission/authority, launch new implementation or stop unrelated repairs. |
| Final consolidated SIT acceptance and audit | Top-level orchestrator / blocked on accepted frozen integration | Source manifest, accepted protected PRs, immutable GHCR/GitHub Releases artifact | Actual integrated runtime acceptance, affected authenticated agent/portal/browser journeys, tenant/permission negatives, required performance/security/CI and rollback evidence; independent audit at the existing risk tier, with blockers resolved. Record accepted scope and residual deferred roadmap items, then stop. This does not itself close P0–P7. |

## Control-plane acceptance blocker — 2026-10-09

PR [#612](https://github.com/ThomasHeinThura/ticketing/pull/612) is the focused delivery.
The first required dependency-audit run
[37904758386](https://github.com/ThomasHeinThura/ticketing/actions/runs/37904758386)
failed on the unchanged dependency graph: proxy-addr (critical), source-map-js,
prosemirror-view and @modelcontextprotocol/sdk (high), plus one low advisory. No dependency,
lockfile, scanner policy or CI threshold is modified by this control-plane PR. An existing-
dependency security repair is a necessary prerequisite with its own authorized scope,
source-bound tests and independent security review; do not mark the check inapplicable or
mix a dependency remediation into the focused policy change. Recheck live CI before drawing
any conclusion about the final candidate. Other pending acceptance gates remain pending.

## Next actionable task

Finish and publish the focused control-plane PR review evidence; retain its dependency-audit
blocker until an independently reviewed existing-dependency prerequisite repair clears it.
Do not merge while a required check is red. Continue dependency-safe prerequisite diagnosis
without starting new feature scope, then protected acceptance of the control-plane PR.
Immediately after acceptance, refresh the frozen-source/dependency inventory from live GitHub
and accepted main, then select the first dependency-safe integration or runner-diagnosis task.
Do not start a new feature or automatically claim P4 complete.

## Session handoff and continuation

Resume by reading this queue, the newest status/decision entries and live GitHub. Start with
`gh pr list --state open` and `gh pr view <task-pr> --json headRefOid,mergeable,statusCheckRollup`,
then compare the candidate with its real reviewed/tested source. Preserve task ownership,
branch/head, evidence paths, blocker, exact next command/procedure and continuation identity
before ending. Use the available thread continuation/heartbeat mechanism without duplicates;
record the actual identity once created. If unavailable, state that fact and leave the next
action explicit. An ended session does not keep working by itself.

**Current continuation:** existing active hourly heartbeat `taskdesk-existing-integration-sprint`,
retained on integration chat `01a0f392-46dc-7343-8878-e4409de66519`. Its prompt was reconciled
with this directive and PR #612 on 2026-10-09; no duplicate was created. The completed
`p0-remaining-evidence-dates` schedule remains paused. This continuation checks the control-
plane PR first, preserves blocked gates, resumes the queue automatically after acceptance,
and stops/pauses after final integrated SIT acceptance/audit. It stays quiet on unchanged
state; the current session does not imply continued execution after it ends.
