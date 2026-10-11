# P0 denial contract audit: retained candidate run 08842235

**Candidate source SHA:** 08842235047a3ab2714427edce80331b94558150  
**Run:** 20261006T150819Z-08842235  
**Scope:** source/evidence audit only. The private run, runner and candidate source were not changed. No additional runtime, browser, SQL, Docker, or performance probe was run.

## Run summary

The run retained 130 actor/route traffic rows. The saved progress artifact records 13 expectation mismatches across three route groups: 11 project reads, one workspace detail read, and one task-time-entry list read. The 117 other retained rows agree with their embedded expected statuses. This is a report about these recorded rows, not independent runtime verification.

For no-reach cases, status is not safely inferred from an actor label alone. Current native middleware has distinct resolver semantics: project lookup uses a legacy 400 for no usable project/workspace (including the accepted foreign-project remap); task/time-entry lookups mask missing and foreign targets with 404; path-sourced workspace access checks membership without a workspace existence lookup and returns 403 to an ordinary nonmember. A reachable resource that fails a capability check is 403.

## Contract table for the 13 mismatches

| Captured actor and route(s) | Captured vs expected | Current behavior / evidence | Disposition |
|---|---:|---|---|
| nonmember: GET /api/column/{projectId}; GET /api/projects/{projectId}/assignable; GET /api/projects/{projectId}/work-items; GET /api/project/{id} and its milestones, prerequisites, stakeholders, document-links children; GET /api/task/tasks/{projectId}; GET /api/task/export/{projectId}; GET /api/workflow-rule/{projectId} (11) | 400 vs 404 | All resolve through workspaceAccess.fromProject. The private runner probe itself expects 400 for a foreign project. Live issue #290 says fromProject’s 400-on-unknown needs the same treatment as foreign. Merged PR #307 records the accepted choice: fromProject keeps 400 and #202-era foreign-project tests change to match. Current source and OpenAPI responses document 400. | Exact accepted #290/#307 behavior supports equal 400 for this route family if Thomas confirms retaining that exception. It conflicts with general RBAC 404 prose and project.policy.ts, so do not change product behavior or this oracle until the pending owner scope decision is recorded. |
| nonmember: GET /api/workspace/{workspaceId} | 403 vs 404 | workspaceAccess.fromParam uses validateWorkspaceAccess and performs no workspace existence query. An ordinary nonmember receives the membership-denial 403 before the detail handler; therefore missing and existing foreign IDs receive the same 403 on this native path. Existing workspace-read-detail.test.ts asserts 403 for an existing foreign workspace; route OpenAPI declares 403. The #8 candidate packet and Sol review retain ordinary nonmember 403, while global RBAC says out-of-reach 404 and the route policy declares row scope/reach required. | Genuine route-contract conflict. No behavior/oracle change pending Thomas’s answer. |
| nonmember: GET /api/time-entry/task/{taskId} | 404 vs 403 | workspaceAccess.fromTaskId performs task lookup and masks missing/out-of-reach as 404 Task not found before time_entry:read_any authority is reached. time-entry/index.ts and policy comments state this; the route contract declares 404. The primary actor’s separate 403 row is a reachable target without time_entry:read_any, the capability-denial case. | Runner expectation is wrong; retain 404 for nonmember/no-reach and 403 for reachable/no-capability. No product change. |

## Normative and historical sources

- Canonical general rule: docs/01-architecture/rbac.md § Reach (384–393) and § 404 versus 403 versus 409 (667–678): out of reach → 404; reachable but missing capability → 403.
- Project history: live issue [#290](https://github.com/ThomasHeinThura/ticketing/issues/290) explicitly calls out fromProject’s existing 400-on-unknown and requests the foreign ID receive that same answer. Merged [PR #307](https://github.com/ThomasHeinThura/ticketing/pull/307), head f668ab345f3bfde0c6c6b7da41103567580c86e8, merge 921a3b780cb7b23f8b44041aa2ca718583e7719b, records “fromProject keeps 400,” changes old foreign-project tests to 400 and leaves OpenAPI aligned. This is narrower than general RBAC and must be consciously retained or superseded; the probe harness cannot decide.
- Time-entry: apps/api/src/time-entry/index.ts GET-by-task response and #290 comments require 404 for missing/out-of-reach task; apps/api/src/time-entry/policy.ts declares row scope and required reach.
- Workspace detail: apps/api/src/workspace/index.ts uses fromParam; apps/api/src/utils/validate-workspace-access.ts returns 403 for no membership and does not test existence. apps/api/src/workspace/policy.ts declares row scope/reach. tests/api-integration/workspace-read-detail.test.ts checks a foreign existing workspace gets 403. The retained #8 candidate packet and Sol report say ordinary nonmember 403 is preserved. These conflict with general RBAC and the generated permission-matrix out-of-reach expectation; neither comments nor a harness expectation resolves the owner-level choice.

## Audit of all 130 expectations

The non-mismatch rows cover direct project members (recorded 200/302 targets), custom workspace roles on expected read routes (200/302), workspace members lacking project reach (all 21 project/work-item targets return 404), an in-reach project member lacking work-item list capability (403), bootstrap instance-admin hostile routes (403 for sampled existing targets and missing scoped capability), ordinary nonmembers on registered work-item/attachment paths (404), workspace-scope capability denials (403), self/avatar (200), anonymous avatar (401), authenticated WebSocket (101), and a nonmember work-item PATCH (404 with unchanged-digest witness). No fourth mismatch group appears in the retained rows.

This review did not independently compare every response against separate missing-row and foreign-row requests. Evidence supports the statuses above; it does not support a claim of 130 independently paired probes.

## Expected-status classifier proposal

Replace broad actor/status inference with an explicit route/actor contract function. Inputs should distinguish: native resolver shape (project lookup, task/time-entry lookup, path/request workspace, collection, owner/self, delegated); target facts (missing, live same-scope, live foreign-scope, deleted/inactive); persisted actor reach; and capability outcome after reach resolution.

Back the route-family status contract with API route definitions and accepted historical decisions. Test a table including foreign-live versus missing project through fromProject; foreign versus missing task/time-entry lookup; foreign versus missing workspace for ordinary nonmember and instance-admin actors; reachable target with missing capability; workspace member without project reach; direct project member; and deleted/inactive row. Assert equal status/body wherever the contract promises masking. Preserve only explicit accepted status exceptions after Thomas’s scope decision; do not blanket rewrite nonmember expectations to one status.

## Pending decision

Root has asked Thomas whether to retain the accepted project 400 and path-workspace 403 contracts as narrow legacy exceptions or standardize them to canonical out-of-reach 404. Until that decision is recorded, no candidate behavior or private runner expectation has been changed.

