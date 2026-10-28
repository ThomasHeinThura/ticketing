# Working with agents

The main agent coordinates one shared worktree. Subagents are available for bounded tasks that help finish the current visible outcome. [AGENTS.md](../AGENTS.md) applies to every agent. This file gives the delegation details; it does not add another approval cycle.

## Active repair ownership — 26 October

| Owner | Writable scope |
| --- | --- |
| Coordinator | Shared schema/migrations, API mounts/policy registry, URL/i18n registries, report data, runtime, backups and serial PostgreSQL test scheduling |
| Organisation lane — frozen | Workspace/project settings inheritance APIs, effective SLA/calendar resolution, state-write fences and calendar usage checks; source handed back to coordinator |
| P1 lane — frozen | Project-move planner corrections and eight passing root-run unit tests; no executor. Settings/digest source handed back to coordinator |
| Action lane — frozen | Identity-connection retirement handler/target/tests; shared approval and UI integration remain unfinished |

One PostgreSQL reset suite runs at a time on a separate disposable integration database. Thomas requires one active deployment using only `deploy/compose.testing.yml`; its restored testing copy is at migration196. Superseded native, performance, SSO and image-probe deployments stay down. The coordinator owns all builds, database operations and deployment commands. Current smoke, identity retirement and danger-action layout journeys pass; full phase journeys and reviews remain pending.

## Before starting

Read the current request, `AGENTS.md`, [status](status.md) and the relevant [roadmap](roadmap.md)/requirement rows. Inspect the branch, source revision and dirty files. Identify what belongs to another session. Read archived material only for the specific product contract; archived agent instructions are historical.

Every UI assignment names the original Kaneo component and library it reuses, the interactions it must preserve, and the laptop browser journey that proves them. Necessary semantic HTML may compose these components; native controls or full hand-built HTML replacements do not satisfy the assignment. Report any missing integration rather than substituting a different UX. Restore original drag/drop, inline editing, keyboard, focus and motion alongside persisted APIs. Do not drop features to obtain a cleaner screenshot.

The main agent states the visible deliverable and owns integration. Use existing authorization; do not ask Thomas to approve routine edits or each subtask. A missing product decision blocks only the dependent behavior. Continue independent authorized work and report the exact question.

## Three useful assignments

| Assignment | Deliverable | Boundaries |
| --- | --- | --- |
| Read-only audit/discovery | Evidence-backed finding list with paths and a recommended fix | No edits, source inspection distinguished from executed tests/screens |
| Implementation | A complete assigned behavior with tests and evidence | Explicit disjoint writable paths, agreed API/data contract and root-owned integration |
| Independent phase review | One consolidated design/integration/security finding report | Reviewer did not implement the phase; consumes actual diff, test output and browser evidence |

Do not create an agent for every small edit. Split by a concrete result, not vague roles such as “improve everything”. A new assignment needs a clear benefit. Keep the smallest useful number of agents and reuse an idle agent when appropriate. Do not create nested agent trees without an assigned need and disjoint scope.

## Assignment template

```text
Deliverable: one observable result or one bounded audit question.
Mode: read-only audit / implementation / independent phase review.
Source: branch/revision, applicable requirement IDs and relevant Kaneo components.
Writable paths: exact files or a narrowly bounded directory; all others read-only.
Shared contracts: API/DTO/schema/permission changes agreed before parallel edits.
Checks: targeted local commands and required persisted browser journey, if applicable.
Constraints: existing dirty files, runtime/database ownership, external blockers.
Finish condition: observable acceptance for this task; what requires coordinator input.
Return: changed paths, result, exact checks/screens and failures, gaps and next action.
```

No separate task document or PR is required. Record assignments and ownership in the current coordination message. Add a short row to [status](status.md) only when work needs to survive a session handoff. Never mark an unassigned example as active work.

## File and runtime ownership

- One owner edits a file at a time. Two agents may implement in parallel only on explicitly disjoint paths within the same coordinated worktree.
- The coordinator owns shared integration files: schema/migrations, route registries, package manifests/lockfile, generated routes, common DTOs, seed, shared UI primitives and current status/roadmap. Delegate one of these explicitly before another agent edits it.
- Read shared code freely. If a change outside the assignment is needed, report the path and contract change to the coordinator; do not edit it unannounced.
- If unexpected changes appear in an owned file, stop editing that file and tell the coordinator; continue only on unaffected assigned work.
- Preserve all pre-existing edits. No resets, stashes, cleanup or mass formatting of another session's work. Never remove dirty files to make checks pass.
- Coordinate test processes, ports, database, fixtures and containers. Tests that write temporary application fixtures must not run alongside whole-source scans or conflicting tests. Share read-only checks only when their inputs remain stable.
- Subagents do not commit, push, merge, deploy, add dependencies, change shared environment or delete data unless the main assignment explicitly includes authorization already granted by the user. An assignment cannot expand the user's authorized scope.

## Handoff and integration

Return a compact result: **implemented / checked / visually inspected / missing / blocked**. State whether each check actually ran and whether it used real persistence or fixtures. Include failing output summaries; do not hide failures with unrelated passing counts. List every edited path and any shared-contract assumptions.

The coordinator reads each handoff and inspects the actual changes, integrates adapters and migrations, and runs the affected end-to-end journey. This integration check is ordinary implementation work, not an extra review ceremony. A subagent's “passed” message is not a substitute for integrated evidence.

After phase journeys work, one fresh independent AI reviewer covers the complete phase, including Kaneo appearance and security. The reviewer did not implement it and receives a neutral packet of requirements, diff, code, test output and browser evidence; do not fork the implementation conversation as the review context. Findings are repaired and their fixes verified within that review. Keep one consolidated report. Thomas then sees selected working journeys, makes the acceptance/next-work decision, and the coordinator updates status/plan.

## Ready task boundaries for the first implementation slice

These are preparation examples, **not active assignments or implementation started**. Confirm the chosen source and current dirty-file owners before assigning writable paths.

| Work package | Bounded outcome | Suggested ownership |
| --- | --- | --- |
| Canonical data adapter | Original Kaneo board/list read and mutate real work items | One owner for task/work-item fetchers/hooks and API adapter; coordinator agrees DTO/permission contract first |
| Kaneo composition | Original board/list/detail/navigation present the integrated records | One owner for affected project/task/navigation components after adapter contract is agreed |
| Realistic seed | Repeatable dated, assigned, discussed, hierarchical, related, SLA/approval data | One seed owner; schema/relation dependencies supplied by coordinator |
| Journey/parity coverage | Persisted browser cases and matching upstream/candidate captures | One test owner; coordinate seed/runtime and avoid editing product files |

These packages are dependent: do not run them as independent guesses about the data model. If file sets overlap, combine the work or serialize it. Assign separate triage/settings work only after its placement and shared components are agreed.
