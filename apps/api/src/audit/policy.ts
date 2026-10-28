import type { PolicyMap } from "@taskdesk/permissions";

/**
 * Audit-read route policies (`docs/03-features/audit-trail.md` § Permissions + § API).
 *
 * The two list routes the spec tables, with their exact capabilities:
 *
 * - `GET /api/instance/audit` — `instance:read_audit` (AU-11: instance administrators
 *   see everything). Scope `instance`/`scopeSource: "instance"`: the row set is the whole
 *   instance, not a resource this route could reach into. Runtime check is
 *   `isInstanceAdmin(c)` — the same primitive `requireWorkspacePermission`'s instance
 *   bypass and the rest of the codebase uses; it aligns with this capability because
 *   `BUILT_IN_ROLES.instance_admin` holds exactly the five `instance:*` capabilities
 *   (roles.test.ts) and #315's identity mapping grants that authority from the same
 *   user-role source. The alignment is flagged for reviewers, not assumed silently.
 *   `reach` exemption is written because an instance-wide listing addresses no single
 *   row. `elevated: false` with reason — the elevation-coverage rule requires every
 *   `/api/instance/*` route to declare; a read mints no authority.
 *
 * - `GET /api/workspaces/{workspaceId}/audit` — `workspace:manage_settings` (AU-10:
 *   workspace administrators see their workspace's rows). Param-sourced workspace id,
 *   membership-checked by `workspaceAccess.fromParam()` before the capability runs, so
 *   `scopeSource: "request"` and `reach: "required"`.
 *
 * AU-12 (customers never see the log) follows from both capabilities being unreachable
 * to portal sessions. AU-13 (reads are themselves audited) is enforced in the handlers,
 * not here — policy declares, handlers do.
 *
 * The spec's API table uses the plural `/api/workspaces/...` path, matching rbac.md's
 * own elevated-actions table, while every pre-existing runtime workspace route is
 * singular (`/api/workspace/...`). This policy follows the SPEC's literal path; the
 * singular/plural drift is flagged in the PR body as a cross-cutting observation for a
 * future reconciliation pass — not silently normalised either way.
 */
export const auditPolicies = {
  "GET /api/instance/audit": {
    capability: "instance:read_audit",
    scope: "instance",
    scopeSource: "instance",
    reach: {
      exempt: "no_single_resource",
      reason:
        "an instance-wide audit listing addresses no single row; the capability gates who may see it",
    },
    elevated: false,
    elevationExemptionReason:
      "read-only listing; it grants nothing, mints no authority, and changes no state (AU-13's own-audit write is a side effect of reading, not an authority)",
  },
  // AU-13 / P2R1-11: exporting is elevated (permissions.md "Exporting instance data") and
  // spends a one-use `audit_export` proof bound to the export request.
  "POST /api/instance/audit/export": {
    capability: "instance:read_audit",
    scope: "instance",
    scopeSource: "instance",
    reach: {
      exempt: "no_single_resource",
      reason:
        "an instance-wide audit export addresses no single row; the capability and step-up gate it",
    },
    elevated: true,
    sessionOnly: true,
  },
  "GET /api/workspaces/{workspaceId}/audit": {
    capability: "workspace:manage_settings",
    scope: "workspace",
    scopeSource: "request",
    reach: "required",
  },
  // AU-8/AU-9: an entity's own audit rows. Only the work_item type exists; reach and
  // `work_item:read` are those of the work item itself (kind 1, resolved by `{type}`).
  "GET /api/audit/entity/{type}/{id}": {
    capability: "work_item:read",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },
  // AU-8/AU-9: point-in-time reconstruction, a pure fold over the activity journal.
  "GET /api/work-items/{key}/reconstruct": {
    capability: "work_item:read",
    scope: "work_item",
    scopeSource: "row",
    reach: "required",
  },
} as const satisfies PolicyMap;
