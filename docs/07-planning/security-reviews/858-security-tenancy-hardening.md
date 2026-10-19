# PR #858 — P0/P1 Security, Tenancy, Soft-Delete Reach, Comment Audit & Portal Auth Hardening

**Reviewed head:** `4a2d007b363ff0ea761a7667aef95bfa54e09f6a`
**Reviewed head:** `b06a045e4c68c4b6d789f7a029fa01ac5fc64291`
Accepted comparison base (`main`): `0350c48d344e5db8780bb87e9008edcab71f6727`.

---

## 1. Independent Security & Critical Review (`2e8ff9ca-0b25-46a3-80d0-e542fa6c85db` — `Gemini 4 Argon`)

### Updated Independent Security & Critical Review — PR #858 (`4a2d007b363ff0ea761a7667aef95bfa54e09f6a`)

- **Exact candidate SHA reviewed:** `4a2d007b363ff0ea761a7667aef95bfa54e09f6a`
- **Prior reviewed SHA:** `b06a045e4c68c4b6d789f7a029fa01ac5fc64291`
- **Comparison base (`main`):** `0350c48d344e5db8780bb87e9008edcab71f6727`
- **Role:** Independent Security & Critical Reviewer (fresh context; did not author, direct, or remediate the change)
- **Model:** `Gemini 4 Argon`
- **Files inspected in delta (`b06a045e..4a2d007b`):**
  - `apps/api/src/workspace/controllers/delete-workspace-role-dependents.ts`

#### Delta Verification (`b06a045e4c68c4b6d789f7a029fa01ac5fc64291..4a2d007b363ff0ea761a7667aef95bfa54e09f6a`)

1. **Unanchored migration-schema table removal:**
   - Removed imports and runtime queries for `customFieldValueTable` and `customFieldTypeVisibilityTable` from `apps/api/src/workspace/controllers/delete-workspace-role-dependents.ts`, satisfying `tests/api/database/unanchored-tables-unreferenced.test.ts` while retaining the explicit delete of `customFieldTable` scoped to `workspaceId`.
2. **Row-level lock on `identity_connection` (`FOR UPDATE`):**
   - Added `.for("update")` to the `identityConnectionTable` query checking `inArray(schema.identityConnectionTable.defaultWorkspaceId, ids)` in `deleteWorkspaceRoleDependents`, explicitly locking matching `identity_connection` rows within the transaction before returning `409 Conflict` (`WorkspaceInUseByIdentityConnectionError`).
3. **Full candidate coverage:**
   - All prior security and correctness verifications on `b06a045e4c68c4b6d789f7a029fa01ac5fc64291` (`#708`, `#724`, `#205`, `#683`, `#682`, `#731`) remain intact and unmodified outside this 1-file improvement.

#### Initial Security & Correctness Verification (`b06a045e4c68c4b6d789f7a029fa01ac5fc64291`)

- **1. Tenancy & RBAC (`#708`, `#724`):**
  - `POST /api/project` capability enforcement (`#708`): `apps/api/src/project/index.ts` replaces `requireWorkspacePermission({ project: ["create"] })` with `requireWorkspaceCapability("project:create")` in the route middleware, enforcing the capability uniformly across both internal and customer-bound project creation.
  - Customer-side principal isolation (`verify-api-key.ts`, `validate-workspace-access.ts`): `findApiKeyOwnerStatus` in `access-lookups.repository.ts` selects `personSide: schema.personTable.side`, and `apiKeyOwnerIsActive` in `verify-api-key.ts` requires `owner.personSide === "staff"`. `validateWorkspaceAccess` in `validate-workspace-access.ts` checks `await isCustomerSidePerson(userId)` before role/membership evaluation and throws `403 Insufficient permissions`.
- **2. Soft-Delete Reach & Anti-Enumeration (`#205` / D3, `#683`):**
  - `workspace-access-middleware.ts` enforces `isNull(schema.projectTable.deletedAt)` unconditionally across `task`, `timeEntry`, `taskActivity`, `comment`, `column`, and `workflowRule` lookups.
  - `access-lookups.repository.ts` (`findWorkspaceReachableAsset`), `activity/repository.ts` (`taskReach`), `label/repository.ts`, `task-relation/repository.ts`, and `time-entry/repository.ts` all enforce `isNull(projectTable.deletedAt)`.
  - `authenticateApiRequest` in `apps/api/src/utils/authenticate-api-request.ts` returns `404 Not found` (instead of `401 Unauthorized`) when an unauthenticated request targets `/api/portal/submissions` or `/api/portal/submissions/*`.
- **3. Audit Integrity (`#682`):**
  - `AUDIT_ONLY_ACTIONS` in `apps/api/src/audit/actions.ts` registers `"comment.updated"` and `"comment.deleted"`.
  - Both `apps/api/src/work-item/controllers/{create-comment,update-comment,delete-comment}.ts` and `apps/api/src/activity/controllers/{create-comment,update-comment,delete-comment}.ts` call `appendAuditLog(tx, ...)` inside the same `db.transaction(async (tx) => ...)` as the comment mutation.
- **4. Workspace Deletion & Account Erasure Integrity (`#731`):**
  - `deleteWorkspace` acquires `lockPendingActionLifecycle(tx)`, `lockWorkspaceRoleAssignment(tx, workspaceId)`, and `acquireWorkspaceDeletionProvisioningLock(tx)`, checks `identityConnectionTable.defaultWorkspaceId` with `.for("update")`, throws `WorkspaceInUseByIdentityConnectionError` (`409 Conflict`), and deletes workspace `ON DELETE RESTRICT` dependents in child-first order.

- **Blocking findings:** None.
- **Non-blocking findings:** None.
- **Verdict:** `APPROVED` (for exact candidate SHA `4a2d007b363ff0ea761a7667aef95bfa54e09f6a`)

---

## 2. Independent Standard Review (`696b1cd0-e418-4ea6-a28c-31ff78313f7c` — `Gemini 3.8 Flash`)

- **Exact candidate SHA reviewed:** `4a2d007b363ff0ea761a7667aef95bfa54e09f6a` (after initial review of `b06a045e4c68c4b6d789f7a029fa01ac5fc64291`)
- **Model:** `Gemini 3.8 Flash`
- **Remediation verified:**
  - Unanchored table references (`customFieldTypeVisibilityTable`, `customFieldValueTable`) removed from `apps/api/src/workspace/controllers/delete-workspace-role-dependents.ts`; `tests/api/database/unanchored-tables-unreferenced.test.ts` passes 2/2 and `CI - fast/unit + component` passes.
  - Explicit `.for("update")` row lock added to `identityConnectionTable` query in `deleteWorkspaceRoleDependents`.
- **Blocking findings:** None on `4a2d007b363ff0ea761a7667aef95bfa54e09f6a`.
- **Verdict:** `APPROVED`
