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
| Focused control-plane realignment | Top-level orchestrator / blocked for protected acceptance | [#612](https://github.com/ThomasHeinThura/ticketing/pull/612), `codex/control-plane-integration-freeze-20261009`, candidate `6dddeea86260467fd93c19284e790462642c04e5` | Three ordinary reviews clear the exact candidate; the full Sol review on `da5598ee18f05d7b73a07f26e1983da2cfcd11ce` remains valid under the documented note-only ancestor rule. All 18 required checks completed; only dependency audit is red. G11 is 22/22 on its recorded source. Refresh exact-head state after prerequisite acceptance; do not claim acceptance or merge while a required check is red. |
| Existing-dependency audit prerequisite | Top-level orchestrator / blocked on CI diagnosis and regression | [#614](https://github.com/ThomasHeinThura/ticketing/pull/614), candidate `1fbb373517abf70fdb43b65c37187069f0b6b613` | Two independent Luna reviews and a full Sol review clear the candidate (Sol source `8d5f5c1736c4094d0b6e5d95de25e86bddf1244a`; the `0e068f97`→`8d5f5c17` delta is comments/decision documentation only and shipping inputs were verified unchanged; `8d5f5c17`→`1fbb3735` is review notes only). Runtime receipt remains bound to image source `0e068f97f8716c6cc2d2f599fd533d7b623d08fd` (build/boot and live/ready 200; preserve the recorded original five-container/global-context evidence); do not rebind it to later docs-only commits. High/critical audit passes; one low KaTeX advisory is disclosed. Current required CI run [37907633313](https://github.com/ThomasHeinThura/ticketing/actions/runs/37907633313) is red: E2E 23/24, MFA sign-in `ERR_ABORTED` ([job 113744945366](https://github.com/ThomasHeinThura/ticketing/actions/runs/37907633313/job/113744945366)); G11 17/22 with five budget failures (worklist 532 ms, LCP 2,644 ms, palette 206.3 ms, assignment 326.1 ms, board 674.1 ms; [job 113744945278](https://github.com/ThomasHeinThura/ticketing/actions/runs/37907633313/job/113744945278)). Root cause is unproven. Reviewer B owns sanitized MFA diagnosis and regression; reviewer A owns read-only G11 triage. Preserve receipts; do not rerun unchanged scenarios, waive budgets, or merge. |
| Frozen-source and dependency inventory | Top-level orchestrator / ready after #612 acceptance | Existing integration train [#589](https://github.com/ThomasHeinThura/ticketing/pull/589), observed head `2350397b18f83ed417bf63d73970daacdbaae49c`; existing lane PRs | After #612 protected acceptance, refresh live train/lane heads and source differences against accepted main; classify existing implementation versus new scope and unresolved decisions. Record the retained source manifest, dependency graph, migration allocations and risk-sized acceptance tasks before composing. Do not extend the old full-feature mission. |
| P0 runner convergence and current-source acceptance | Top-level orchestrator / blocked for acceptance; diagnosis is authorized | [#602](https://github.com/ThomasHeinThura/ticketing/pull/602), `codex/p0-final-scope-20261007`, observed head `66c736e71c87b2372ba1cbf8250236ac37191565` | Preserve failed V24/V26/V30 receipts and actual observation sources described in the PR. Identify structural projection/source-order cause; prove the complete actual runner invocation before another acceptance iteration. Current PR reports G11 19/22 failed and strict-runtime acceptance missing; verify logs/counts rather than reuse historical 22/22. No phase closure claim. |
| Existing P1–P4 train integration repairs | Top-level orchestrator / blocked on source inventory and owning contracts | Existing #589 train and retained lane sources; centralized migration ordering | From the manifest, select only existing functionality with resolved contracts, repair composition/integration defects, then exact-source tests/reviews/CI and real SIT journeys. Existing catalogue, identity, approvals, outbox, Users and URL/realtime lanes require individual contract/source classification; draft title or previous implementation authorization does not add scope. |
| Product-decision-dependent scope | Top-level orchestrator / blocked only for dependent tasks | Owning specs/decision log; #589 records unresolved portal admission, pending-action route/deprecation, approver-picker and quiet-hour/DST questions | Recheck whether each decision is already settled. Record only genuinely unresolved owner questions and their consumers. Do not invent DTOs/admission/authority, launch new implementation or stop unrelated repairs. |
| Final consolidated SIT acceptance and audit | Top-level orchestrator / blocked on accepted frozen integration | Source manifest, accepted protected PRs, immutable GHCR/GitHub Releases artifact | Actual integrated runtime acceptance, affected authenticated agent/portal/browser journeys, tenant/permission negatives, required performance/security/CI and rollback evidence; independent audit at the existing risk tier, with blockers resolved. Record accepted scope and residual deferred roadmap items, then stop. This does not itself close P0–P7. |

## Control-plane acceptance blocker — 2026-10-09

PR [#612](https://github.com/ThomasHeinThura/ticketing/pull/612) is the focused delivery.
Its first required dependency-audit run
[37904758386](https://github.com/ThomasHeinThura/ticketing/actions/runs/37904758386)
failed on the unchanged dependency graph: proxy-addr (critical), source-map-js,
prosemirror-view and @modelcontextprotocol/sdk (high), plus one low advisory. No dependency,
lockfile, scanner policy or CI threshold is modified by this control-plane PR. An existing-
dependency security repair is a necessary prerequisite with its own authorized scope,
source-bound tests and independent security review; do not mark the check inapplicable or
mix a dependency remediation into the focused policy change. Recheck live CI before drawing
any conclusion about the final candidate. The historical initial PR-template failure is a
separate receipt; its body/review metadata repair is not dependency remediation. On the
current candidate, the ordinary panel clears the exact head and the Sol source review is
valid under the note-only descendant rule; all 18 required checks completed and only the
dependency audit is red. The separate prerequisite #614 currently clears high/critical audit
but has red E2E/G11 checks; its one low KaTeX advisory is disclosed. Neither PR is accepted.

## Next actionable task

First diagnose the #614 MFA E2E and G11 failures from their actual sanitized evidence and
establish the cause and complete real-invocation regression. Change source only when the
evidence warrants a correction; do not speculate on source optimization or repeat an
unchanged acceptance run. Reviewer B owns the MFA diagnosis; reviewer A owns read-only G11
triage. Preserve the existing run receipts and do not relax thresholds. Then obtain the
required exact-head reviews, runtime evidence and green protected CI before merging #614. After that protected
merge, refresh #612's live head, review bindings and current required checks; merge it only
if its exact candidate is fully green. Then refresh the frozen-source inventory and resume
the authorized existing integration queue. No feature expansion, automatic P4 completion,
SIT acceptance or phase completion is implied.

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
