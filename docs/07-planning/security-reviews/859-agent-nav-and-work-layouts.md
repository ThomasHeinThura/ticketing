# PR #859 — Batch 2: Unified `/agent` Navigation, Work Views (`table` / `board`), and Streamed CSV Export

**Reviewed head:** `135df80c2568507485eb783673fc37b1c04ceb29`
Accepted comparison base (`main`): `4195ef451cf77e284bd66a05e261be5d5c37f16d`.

---

## 1. Independent Security & Critical Review (`2e8ff9ca-0b25-46a3-80d0-e542fa6c85db` — `Gemini 4 Argon`)

- **Exact candidate SHA reviewed:** `135df80c2568507485eb783673fc37b1c04ceb29`
- **Comparison base (`main`):** `4195ef451cf77e284bd66a05e261be5d5c37f16d`
- **Role:** Independent Critical & Security Reviewer (fresh context; did not author, direct, or remediate the change)
- **Model:** `Gemini 4 Argon`
- **Files inspected:**
  - `apps/api/src/work-item/policy.ts`
  - `apps/api/src/work-item/index.ts`
  - `apps/api/src/work-item/search/csv.ts`
  - `apps/api/src/capabilities/controllers/get-capabilities.ts`
  - `apps/api/src/capabilities/response.ts`
  - `apps/api/src/user-preference/whitelist.ts`
  - `apps/web/src/components/nav-projects.tsx`
  - `apps/web/src/components/work-item/{work-item-board-view,work-item-list-controls,work-item-list}.tsx`
  - `apps/web/src/routes/agent/_layout/_authenticated/agent/projects/$projectKey/work.tsx`
  - `apps/web/src/lib/{routes,project-layout-preference,work-item-list-search}.ts`
  - `apps/web/src/fetchers/work-item/export-work-items.ts`
  - `docs/07-planning/decision-log.md`
  - `tests/api/work-item-export-csv.test.ts`
  - `tests/api-integration/work-item-export.test.ts`
  - `tests/permissions/matrix.fixture.json`
  - `tests/api-contract/openapi.json`

### Security & Critical Verification

1. **`POST /api/work-items/export` Security, Tenancy, Bounds & Audit (`VW-23` / D1):**
   - **Route Policy & Capability Gate:** `apps/api/src/work-item/policy.ts` registers `"POST /api/work-items/export"` with `capability: "work_item:export"`, `scope: "workspace"`, `scopeSource: "request"`, `reach: "required"`. `apps/api/src/work-item/index.ts` enforces body size limit (`SEARCH_BODY_MAX_BYTES` = 32 KiB -> `400`), `workspaceAccess.fromBody("workspaceId")` (converting `403` to `404` for unreachable workspaces), and `requireWorkspaceCapability("work_item:export")` (admitting `owner`, `admin`, `manager`, `lead`; refusing `member`, `viewer`, `customer`, and `instance_admin` without workspace reach/role with `403`).
   - **Tenancy & Project Reach:** Every page of exported rows is fetched through `searchWorkItems`, which applies `buildReachableWorkItemWhere` (workspace scope + project reach + non-deleted project/work-item filters). Out-of-reach projects and cross-workspace items are never returned.
   - **Resource Bounds (`D1`):**
     - **Rate limit:** `checkAndRecordExportRateLimit(userId)` enforces 5 exports / 60s window per user, returning `429` (`code: "rate_limited"`) before running queries.
     - **Row cap:** If `firstPage.meta.total > EXPORT_MAX_ROWS` (`10,000`), returns `422` (`code: "export_limit_exceeded"`, `total`, `limit: 10000`) before streaming or writing an export audit log.
     - **Query timeout:** `withExportTimeout(..., deadline)` enforces a 30-second cumulative deadline (`EXPORT_QUERY_TIMEOUT_MS = 30_000`) across initial and paginated `ReadableStream` pulls (`422 Export query timed out after 30 seconds`).
   - **CSV Formula Injection Prevention:** `safeCell` in `apps/api/src/work-item/search/csv.ts` checks `/^[\s\p{Cc}]*[=+\-@]/u` (covering leading `=`, `+`, `-`, `@` even when preceded by whitespace or control characters like `\t`, `\r`, `\n`) and prefixes a single quote `'`, then RFC 4180 double-quotes the cell (`"` -> `""`).
   - **Resilient `AU-14` Audit Logging:** Writes `action: "work_item.exported"` (`entityType: "work_item_view"`, `entityId: "workspace"`, `after: { format: "csv", count: firstPage.meta.total, columns }`) with full actor/API-key/impersonator attribution, wrapped in `try/catch` calling `recordAuditWriteFailure("mutation")` and `notifyCurrentInstanceAdminsOfAuditFailure("mutation")` per `AU-14`.
2. **Decision Log Integrity (`docs/07-planning/decision-log.md`):**
   - Verified `git diff main..HEAD -- docs/07-planning/decision-log.md` is strictly append-only (prepends the new `2026-10-19 · Local CI gate verification during GitHub Actions degradation` entry without altering any prior entry).
3. **Capabilities, User Preferences & Contract Synchronization:**
   - `apps/api/src/capabilities/controllers/get-capabilities.ts` and `response.ts` expose `exportTasks: agentOnly(exportTasks)` backed by `hasCanonicalCapability(c, "work_item:export")`.
   - `apps/api/src/user-preference/whitelist.ts` updates `LAYOUT_SCHEMA` to `z.enum(["board", "list", "table"])` matching `VW-2` and `VW-19`–`VW-24`.
   - `tests/permissions/matrix.fixture.json` and `tests/api-contract/openapi.json` are in full sync with `POST /api/work-items/export`.

- **Blocking findings:** None.
- **Non-blocking findings:** None.
- **Verdict:** `APPROVED` (for exact candidate SHA `135df80c2568507485eb783673fc37b1c04ceb29`)

---

## 2. Independent Standard Review (`696b1cd0-e418-4ea6-a28c-31ff78313f7c` — `Gemini 3.8 Flash`)

- **Exact candidate SHA reviewed:** `135df80c2568507485eb783673fc37b1c04ceb29`
- **Comparison base (`main`):** `4195ef451cf77e284bd66a05e261be5d5c37f16d`
- **Role:** Independent Standard Reviewer (fresh context; did not author, direct, or remediate the change)
- **Model:** `Gemini 3.8 Flash`
- **Verification Summary:**
  - `POST /api/work-items/export` (`VW-23` / D1): Verified `work_item:export` capability gate, 10,000-row hard cap (`422 export_limit_exceeded`), 30s query timeout, 5/min/user rate limit (`429 rate_limited`), formula-injection escaping (`work-item-export-csv.test.ts` 8/8), and `AU-14` `work_item.exported` audit logging (`work-item-export.test.ts` 14/14).
  - User preference whitelist (`layout.<projectId>`): `LAYOUT_SCHEMA = z.enum(["board", "list", "table"])` verified in `user-preference.test.ts` (27/27) and synced in `settings-hierarchy.md` and `views.md`.
  - Sidebar project navigation (`nav-projects.tsx`): Routes project clicks and "Copy link" to `/agent/projects/$projectKey/work` (`nav-projects.test.tsx` passed).
  - Work layouts & controls (`work.tsx`, `work-item-board-view.tsx`, `work-item-list-controls.tsx`): Verified `layout=table`, `VW-1` board structured filtering, `VW-2` per-project layout preference persistence, `VW-19` table column customization, and `D1` CSV export UI trigger across unit, component, and Playwright E2E tests (`work-item-structured-search.spec.ts` 13/13).
- **Blocking findings:** None.
- **Verdict:** `APPROVED` (for exact candidate SHA `135df80c2568507485eb783673fc37b1c04ceb29`)
