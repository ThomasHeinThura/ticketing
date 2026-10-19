# Security review — PR #860 (`agy/batch3-sidepane-bulk-backlog-views`)

**Reviewed head:** `0dfdd406524d24c9d37d2d130843721c0351b6fc`
- **Pull request:** `#860` (`feat(web,api): add work-item side pane, bulk edit, backlog and view layouts`)
- **Reviewed candidate SHA:** `0dfdd406524d24c9d37d2d130843721c0351b6fc`
- **Comparison base (`main`):** `ba51c25305a5d47144968f68f7f7d360d445d409`
- **Security-scope paths touched:**
  - `apps/api/src/capabilities/controllers/get-capabilities.ts`
  - `apps/api/src/work-item/bulk-reach.ts`
  - `apps/api/src/work-item/controllers/bulk-work-items.ts`
  - `apps/api/src/work-item/index.ts`
- **Reviewer:** Independent Critical & Security Reviewer subagent (`2e8ff9ca-0b25-46a3-80d0-e542fa6c85db`, `Gemini 4 Argon`)
- **Date:** 2026-10-20

## Scope and threat model

1. **Per-item authorization and non-enumeration on `POST /api/work-items/bulk` (`WI-24`–`WI-27`):**
   - Verified `apps/api/src/work-item/index.ts` enforces `validateWorkspaceAccess` and fails closed with `403` for customer principals (`isCustomerPrincipal`).
   - Verified each bulk operation maps to its exact canonical project capability (`delete` -> `work_item:delete`, `assign` -> `work_item:assign`, `set_priority` -> `work_item:set_priority`, `archive` -> `work_item:update`, `transition` -> `work_item:transition`) at both the workspace precheck and per-item `workItemBulkAuthoriser`.
   - Verified `workItemBulkAuthoriser` (`apps/api/src/work-item/bulk-reach.ts`) returns `"not_found"` for both nonexistent and out-of-reach items (`WI-25` non-enumeration invariant), and `"forbidden"` when reachable without the operation's capability.
   - Verified each item executes in its own transaction (`WI-25`/`WI-26`) and records per-item activity and `audit_log` rows plus a `bulk.performed` summary row (`WI-27`).
2. **Capabilities endpoint (`setPriorityTasks`):**
   - Verified `setPriorityTasks` is derived from `work_item:set_priority` and wrapped in `agentOnly(...)` so customer principals always receive `false`.

## Findings

- **Blocking findings:** None.
- **Non-blocking findings:** None.
- **Residual risk:** Low.

## Verdict

**APPROVED** for exact candidate SHA `0dfdd406524d24c9d37d2d130843721c0351b6fc`.
